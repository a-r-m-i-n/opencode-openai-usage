import { createRequire } from "node:module"
import { createTextAttributes } from "@opentui/core"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import {
  formatCommandSummary,
  formatRelativeDuration,
  formatWindowLabel,
  getOpenCodeStateDir,
  getUsageDisplay,
  readUsageState,
  type UsageWindow,
} from "./lib/openai-usage.ts"

export const id = "openai-usage-tui"

const CACHE_SYNC_MS = 5_000
const DIM_ATTRIBUTES = createTextAttributes({ dim: true })
const BAR_WIDTH = 20
const BAR_EMPTY_COLOR = "#6b7280"
const BAR_LABEL_DARK_COLOR = "#111827"
const BAR_LABEL_LIGHT_COLOR = "#f9fafb"
const SIDEBAR_VERSION_COLOR = "#9ca3af"
const SIDEBAR_INVERT_KV_KEY = "openai-usage.sidebar.invert"
const require = createRequire(import.meta.url)
const PLUGIN_VERSION = readPluginVersion()

type TuiOptions = {
  invert?: boolean
}

function readPluginVersion() {
  try {
    const manifest = require("../package.json") as { version?: unknown }
    return typeof manifest.version === "string" && manifest.version.length > 0 ? manifest.version : null
  } catch {
    return null
  }
}

function formatPercent(percent: number) {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`
}

function getBarFillColor(percent: number, labelSuffix: "left" | "used") {
  if (labelSuffix === "used") {
    if (percent >= 50) {
      return "#ef4444"
    }

    if (percent >= 20) {
      return "#eab308"
    }

    return "#22c55e"
  }

  if (percent >= 50) {
    return "#22c55e"
  }

  if (percent >= 20) {
    return "#eab308"
  }

  return "#ef4444"
}

function getBarSegments(percent: number, width: number) {
  const clampedPercent = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clampedPercent / 100) * width)
  return {
    filled: Math.max(0, Math.min(width, filled)),
    empty: Math.max(0, width - filled),
  }
}

function getBarLabelColor(fillColor: string) {
  return fillColor === "#ef4444" ? BAR_LABEL_LIGHT_COLOR : BAR_LABEL_DARK_COLOR
}

function renderProgressBar(percent: number, labelSuffix: "left" | "used") {
  const barSegments = getBarSegments(percent, BAR_WIDTH)
  const barFillColor = getBarFillColor(percent, labelSuffix)
  const label = `${formatPercent(percent)} ${labelSuffix}`
  const labelStart = Math.max(0, Math.floor((BAR_WIDTH - label.length) / 2))
  const labelEnd = labelStart + label.length

  return Array.from({ length: BAR_WIDTH }, (_, index) => {
    const isFilled = index < barSegments.filled
    const isLabelCell = index >= labelStart && index < labelEnd
    const underlyingColor = isFilled ? barFillColor : BAR_EMPTY_COLOR

    if (isLabelCell) {
      return (
        <text fg={isFilled ? getBarLabelColor(barFillColor) : BAR_LABEL_LIGHT_COLOR} bg={underlyingColor}>
          {label[index - labelStart]}
        </text>
      )
    }

    return isFilled ? <text fg={underlyingColor}>█</text> : <text bg={BAR_EMPTY_COLOR}> </text>
  })
}

const module = {
  id,
  tui: async (api, rawOptions) => {
    const stateDir = getOpenCodeStateDir()
    const options = (rawOptions as TuiOptions | undefined) ?? {}
    const [invert, setInvert] = createSignal(api.kv.get<boolean>(SIDEBAR_INVERT_KV_KEY, options.invert === true) === true)
    const [state, setState] = createSignal(await readUsageState(stateDir))
    const [open, setOpen] = createSignal(true)
    let syncInFlight: Promise<void> | null = null

    const syncState = async () => {
      if (syncInFlight) {
        return syncInFlight
      }

      syncInFlight = (async () => {
        try {
          const nextState = await readUsageState(stateDir)
          setState(nextState)
        } finally {
          syncInFlight = null
        }
      })()

      return syncInFlight
    }

    const showUsageDialog = async () => {
      await syncState()
      const latestState = state()
      setState(latestState)

      api.ui.dialog.replace(() =>
        api.ui.DialogAlert({
          title: "OpenAI Usage",
          message: formatCommandSummary(latestState, PLUGIN_VERSION),
        }),
      )
    }

    const toggleSidebarInvert = () => {
      const nextInvert = !invert()
      setInvert(nextInvert)
      api.kv.set(SIDEBAR_INVERT_KV_KEY, nextInvert)
      api.ui.toast({
        message: nextInvert ? "Sidebar now shows usage left." : "Sidebar now shows usage used.",
      })
    }

    void syncState()

    const timer = setInterval(() => {
      void syncState()
    }, CACHE_SYNC_MS)

    api.lifecycle.onDispose(() => {
      clearInterval(timer)
    })

    api.event.on("account.added", () => {
      void syncState()
    })

    api.event.on("account.removed", () => {
      void syncState()
    })

    api.event.on("account.switched", () => {
      void syncState()
    })

    api.event.on("session.next.prompted", () => {
      void syncState()
    })

    api.event.on("command.executed", () => {
      void syncState()
    })

    const renderSidebarWindow = (window: UsageWindow | null) => {
      if (!window) {
        return null
      }

      const usageDisplay = getUsageDisplay(window.usedPercent, invert())

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          <box flexDirection="row" gap={0} padding={0} margin={0}>
            <text>{`${formatWindowLabel(window.windowDurationMins)} `}</text>
            {renderProgressBar(usageDisplay.percent, usageDisplay.label)}
            <text attributes={DIM_ATTRIBUTES}>{` Reset: ${formatRelativeDuration(window.resetsAt)}`}</text>
          </box>
        </box>
      )
    }

    const renderSidebarHeader = () => (
      <box flexDirection="row" gap={0} padding={0} margin={0} onMouseDown={() => setOpen(!open())}>
        <text>{open() ? "▼ OpenAI Usage" : "▶ OpenAI Usage"}</text>
        {PLUGIN_VERSION ? <text fg={SIDEBAR_VERSION_COLOR} attributes={DIM_ATTRIBUTES}>{` ${PLUGIN_VERSION}`}</text> : null}
      </box>
    )

    const renderSidebarBody = () => {
      const currentState = state()

      if (currentState.error && !currentState.primary && !currentState.secondary) {
        return <text>{`Status: unavailable\nError: ${currentState.error}`}</text>
      }

      if (!currentState.primary && !currentState.secondary) {
        return <text>Status: waiting for usage data</text>
      }

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          {renderSidebarWindow(currentState.primary)}
          {renderSidebarWindow(currentState.secondary)}
        </box>
      )
    }

    const renderSidebarContent = () => {
      const currentState = state()

      if (currentState.configured === false) {
        return null
      }

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          {renderSidebarHeader()}
          {open() ? renderSidebarBody() : null}
        </box>
      )
    }

    api.slots.register({
      order: -100,
      slots: {
        sidebar_content: renderSidebarContent,
      },
    })

    const unregisterCommand = api.command?.register(() => [
      ...(state().configured === false
        ? []
        : [
            {
              title: "OpenAI Usage",
              value: "openai-usage.show",
              description: "Show current OpenAI usage",
              category: "OpenAI",
              onSelect: showUsageDialog,
            },
            {
              title: "OpenAI Usage: Toggle Sidebar Display",
              value: "openai-usage.toggle-sidebar-invert",
              description: "Toggle sidebar between used and left usage",
              category: "OpenAI",
              onSelect: toggleSidebarInvert,
            },
          ]),
    ])

    api.lifecycle.onDispose(() => {
      unregisterCommand?.()
    })
  },
} satisfies TuiPluginModule

export default module
