import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const CACHE_FILE = "storage/openai-usage-cache.json"
const AUTH_FILE = "auth.json"
const FETCH_TIMEOUT_MS = 15_000

export type UsageWindow = {
  usedPercent: number
  windowDurationMins: number
  resetsAt: string
}

export type UsageDisplay = {
  percent: number
  label: "left" | "used"
}

export type UsageState = {
  primary: UsageWindow | null
  secondary: UsageWindow | null
  fetchedAt: string | null
  error: string | null
  loading: boolean
  configured: boolean | null
  rateLimitReachedType: string | null
  accountId: string | null
  userId: string | null
  email: string | null
  planType: string | null
}

type AuthFile = Record<string, unknown>

type UsagePayload = Record<string, unknown>

type ProviderAuth = {
  type?: unknown
  access?: unknown
}

export const DEFAULT_USAGE_STATE: UsageState = {
  primary: null,
  secondary: null,
  fetchedAt: null,
  error: null,
  loading: true,
  configured: null,
  rateLimitReachedType: null,
  accountId: null,
  userId: null,
  email: null,
  planType: null,
}

export function getOpenCodeStateDir() {
  const xdgDataHome = process.env.XDG_DATA_HOME
  if (xdgDataHome) {
    return join(xdgDataHome, "opencode")
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode")
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA
    if (appData) {
      return join(appData, "opencode")
    }
  }

  return join(homedir(), ".local", "share", "opencode")
}

export function getUsageCachePath(stateDir: string) {
  return join(stateDir, CACHE_FILE)
}

export async function readUsageState(stateDir: string) {
  const cachePath = getUsageCachePath(stateDir)

  try {
    const raw = await readFile(cachePath, "utf8")
    return normalizeStoredState(JSON.parse(raw) as Partial<UsageState>)
  } catch {
    return { ...DEFAULT_USAGE_STATE }
  }
}

export async function writeUsageState(stateDir: string, state: UsageState) {
  const cachePath = getUsageCachePath(stateDir)

  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify(state, null, 2))
}

export async function buildUsageState(stateDir: string): Promise<UsageState> {
  let accessToken: string

  try {
    const auth = await readAuthFile(stateDir)
    accessToken = extractAccessToken(auth)
  } catch (error) {
    if (isNotConfiguredError(error)) {
      return buildUnconfiguredState()
    }

    throw error
  }

  const data = await fetchUsagePayload(accessToken)
  const rateLimits = extractRateLimitsPayload(data)

  const secondaryPayload = rateLimits.secondary ?? rateLimits.secondary_window ?? null
  const rateLimitReachedType = normalizeOptionalString(
    rateLimits.rateLimitReachedType ?? rateLimits.rate_limit_reached_type ?? null,
  )

  return {
    primary: normalizeWindow(rateLimits.primary ?? rateLimits.primary_window ?? null, "primary"),
    secondary: secondaryPayload === null ? null : normalizeWindow(secondaryPayload, "secondary"),
    fetchedAt: new Date().toISOString(),
    error: null,
    loading: false,
    configured: true,
    rateLimitReachedType,
    email: normalizeOptionalString(data.email ?? rateLimits.email ?? null),
    accountId: normalizeOptionalString(
      data.account_id ?? data.accountId ?? rateLimits.account_id ?? rateLimits.accountId ?? null,
    ),
    userId: normalizeOptionalString(
      data.user_id ?? data.userId ?? rateLimits.user_id ?? rateLimits.userId ?? null,
    ),
    planType: normalizeOptionalString(
      data.plan_type ?? data.planType ?? rateLimits.plan_type ?? rateLimits.planType ?? null,
    ),
  }
}

export async function refreshUsageState(stateDir: string, previous?: UsageState) {
  const currentState = previous ?? await readUsageState(stateDir)

  try {
    const nextState = await buildUsageState(stateDir)
    await writeUsageState(stateDir, nextState)
    return nextState
  } catch (error) {
    const failureState = buildFailureState(currentState, error)
    await writeUsageState(stateDir, failureState)
    return failureState
  }
}

export function buildFailureState(previous: UsageState, error: unknown): UsageState {
  return {
    ...previous,
    loading: false,
    error: formatError(error),
  }
}

export function formatCommandSummary(state: UsageState) {
  const lines = ["OpenAI usage status"]

  if (state.error) {
    lines.push("Status: unavailable")
    lines.push(`Error: ${state.error}`)
  }

  appendWindowLines(lines, "Primary", state.primary)
  appendWindowLines(lines, "Secondary", state.secondary)

  if (state.rateLimitReachedType) {
    lines.push(`Rate limit reached type: ${state.rateLimitReachedType}`)
  }

  if (state.planType) {
    lines.push(`Plan: ${state.planType}`)
  }

  if (state.email) {
    lines.push(`Account email: ${state.email}`)
  }

  if (state.fetchedAt) {
    lines.push(`Fetched at: ${formatTimestamp(state.fetchedAt)}`)
  }

  if (lines.length === 1) {
    lines.push("Status: unavailable")
    lines.push("Error: Usage data has not been fetched yet.")
  }

  return lines.join("\n")
}

export function formatSidebarContent(state: UsageState) {
  if (state.configured === false) {
    return ""
  }

  const lines = ["OpenAI Usage", ""]

  if (state.error && !state.primary && !state.secondary) {
    lines.push("Status: unavailable")
    lines.push(`Error: ${state.error}`)
  } else {
    appendSidebarWindowLines(lines, state.primary)
    appendSidebarWindowLines(lines, state.secondary)

    if (!state.primary && !state.secondary) {
      lines.push("Status: waiting for usage data")
    }
  }

  return lines.join("\n")
}

export function isUsageStateStale(state: UsageState, maxAgeMs: number) {
  if (!state.fetchedAt) {
    return true
  }

  const fetchedAt = Date.parse(state.fetchedAt)
  if (Number.isNaN(fetchedAt)) {
    return true
  }

  return Date.now() - fetchedAt > maxAgeMs
}

export function getUsageDisplay(usedPercent: number, invert: boolean): UsageDisplay {
  const clampedUsedPercent = Math.max(0, Math.min(100, usedPercent))

  if (invert) {
    return {
      percent: Math.max(0, 100 - clampedUsedPercent),
      label: "left",
    }
  }

  return {
    percent: clampedUsedPercent,
    label: "used",
  }
}

function appendWindowLines(lines: string[], label: string, window: UsageWindow | null) {
  if (!window) {
    return
  }

  const leftPercent = Math.max(0, 100 - window.usedPercent)

  lines.push(
    `${label} window (${formatWindowLabel(window.windowDurationMins)}): ${formatPercent(window.usedPercent)} used, ${formatPercent(leftPercent)} left, resets ${formatTimestamp(window.resetsAt)}`,
  )
}

function appendSidebarWindowLines(lines: string[], window: UsageWindow | null) {
  if (!window) {
    return
  }

  const leftPercent = Math.max(0, 100 - window.usedPercent)

  lines.push(`${formatWindowLabel(window.windowDurationMins)}: ${formatPercent(leftPercent)} left`)
  lines.push(`Resets in ${formatRelativeDuration(window.resetsAt)}`)
  lines.push("")
}

async function readAuthFile(stateDir: string) {
  const authPath = join(stateDir, AUTH_FILE)
  let raw: string

  try {
    raw = await readFile(authPath, "utf8")
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new NotConfiguredError("OpenCode has no ChatGPT auth configured.")
    }

    throw error
  }

  return JSON.parse(raw) as AuthFile
}

function extractAccessToken(auth: AuthFile) {
  const provider = auth.openai
  if (!isRecord(provider)) {
    throw new NotConfiguredError("OpenCode has no ChatGPT auth configured.")
  }

  const oauth = provider as ProviderAuth
  if (oauth.type !== "oauth") {
    throw new NotConfiguredError("OpenCode has no ChatGPT auth configured.")
  }

  if (typeof oauth.access !== "string" || oauth.access.length === 0) {
    throw new NotConfiguredError("OpenCode has no ChatGPT auth configured.")
  }

  return oauth.access
}

function buildUnconfiguredState(): UsageState {
  return {
    ...DEFAULT_USAGE_STATE,
    loading: false,
    configured: false,
  }
}

async function fetchUsagePayload(accessToken: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response

  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Usage request timed out after ${Math.floor(FETCH_TIMEOUT_MS / 1000)}s.`)
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    let details = ""

    try {
      details = await response.text()
    } catch {
      details = ""
    }

    const body = details.trim()
    const suffix = body ? ` - ${body.slice(0, 300)}` : ""
    throw new Error(`Usage request failed: HTTP ${response.status}${suffix}`)
  }

  const data = (await response.json()) as unknown
  if (!isRecord(data)) {
    throw new Error("Usage response is not a JSON object.")
  }

  return data
}

function extractRateLimitsPayload(data: UsagePayload) {
  const rateLimits = data.rateLimits ?? data.rate_limits ?? data.rate_limit ?? null
  return isRecord(rateLimits) ? rateLimits : data
}

function normalizeWindow(window: unknown, name: string): UsageWindow {
  if (!isRecord(window)) {
    throw new Error(`Usage response is missing ${name} window data.`)
  }

  let windowDurationMins = toNumber(window.windowDurationMins ?? window.window_duration_mins ?? null)
  const windowDurationSeconds = toNumber(window.limit_window_seconds ?? null)
  const usedPercent = toNumber(window.usedPercent ?? window.used_percent ?? null)
  const resetsAt = window.resetsAt ?? window.resetAt ?? window.reset_at ?? null

  if (windowDurationMins === null && windowDurationSeconds !== null) {
    windowDurationMins = Math.ceil(windowDurationSeconds / 60)
  }

  if (usedPercent === null || windowDurationMins === null || !isValidResetValue(resetsAt)) {
    throw new Error(`Usage response contains incomplete ${name} window data.`)
  }

  return {
    usedPercent,
    windowDurationMins,
    resetsAt: normalizeResetValue(resetsAt as string | number),
  }
}

function normalizeStoredState(input: Partial<UsageState>): UsageState {
  return {
    primary: normalizeStoredWindow(input.primary),
    secondary: normalizeStoredWindow(input.secondary),
    fetchedAt: normalizeOptionalString(input.fetchedAt ?? null),
    error: normalizeOptionalString(input.error ?? null),
    loading: input.loading === true,
    configured: typeof input.configured === "boolean" ? input.configured : null,
    rateLimitReachedType: normalizeOptionalString(input.rateLimitReachedType ?? null),
    accountId: normalizeOptionalString(input.accountId ?? null),
    userId: normalizeOptionalString(input.userId ?? null),
    email: normalizeOptionalString(input.email ?? null),
    planType: normalizeOptionalString(input.planType ?? null),
  }
}

function normalizeStoredWindow(window: unknown): UsageWindow | null {
  if (!isRecord(window)) {
    return null
  }

  const usedPercent = toNumber(window.usedPercent ?? null)
  const windowDurationMins = toNumber(window.windowDurationMins ?? null)
  const resetsAt = normalizeOptionalString(window.resetsAt ?? null)

  if (usedPercent === null || windowDurationMins === null || !resetsAt) {
    return null
  }

  return { usedPercent, windowDurationMins, resetsAt }
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

export function formatWindowLabel(windowDurationMins: number) {
  if (windowDurationMins % (60 * 24) === 0) {
    return `${windowDurationMins / (60 * 24)}d`
  }

  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`
  }

  return `${windowDurationMins}m`
}

export function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const yyyy = `${date.getFullYear()}`
  const mm = `${date.getMonth() + 1}`.padStart(2, "0")
  const dd = `${date.getDate()}`.padStart(2, "0")
  const hh = `${date.getHours()}`.padStart(2, "0")
  const mi = `${date.getMinutes()}`.padStart(2, "0")

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const hh = `${date.getHours()}`.padStart(2, "0")
  const mi = `${date.getMinutes()}`.padStart(2, "0")

  return `${hh}:${mi}`
}

export function formatRelativeDuration(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return formatTimestamp(value)
  }

  return formatDurationParts(Math.max(0, timestamp - Date.now()))
}

export function formatElapsedDuration(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return formatTimestamp(value)
  }

  return formatDurationParts(Math.max(0, Date.now() - timestamp))
}

function formatDurationParts(diffMs: number) {
  const totalMinutes = Math.ceil(diffMs / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  return `${Math.max(1, minutes)}m`
}

function isValidResetValue(value: unknown) {
  return (typeof value === "string" && value.length > 0) || typeof value === "number"
}

function normalizeResetValue(value: string | number) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : value
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown) {
  return isRecord(error) && error.code === "ENOENT"
}

function isNotConfiguredError(error: unknown) {
  return error instanceof NotConfiguredError
}

class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotConfiguredError"
  }
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unknown usage error."
}

export const __testing = {
  buildUnconfiguredState,
  extractAccessToken,
  getUsageDisplay,
  isNotConfiguredError,
  normalizeWindow,
}
