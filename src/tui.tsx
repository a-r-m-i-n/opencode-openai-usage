import { watch } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname } from "node:path"
import { createTextAttributes } from "@opentui/core"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import {
  formatCommandSummary,
  formatRelativeDuration,
  formatWindowLabel,
  getUsageCachePath,
  getOpenCodeStateDir,
  getUsageDisplay,
  isUsageStateStale,
  readUsageState,
  refreshUsageState,
  type UsageWindow,
} from "./lib/openai-usage.ts"

export const id = "openai-usage-tui"

const CACHE_SYNC_MS = 5_000
const CACHE_WATCH_DELAY_MS = 50
const COMMAND_SYNC_DELAY_MS = 250
const STALE_USAGE_REFRESH_MS = 60_000
const DIM_ATTRIBUTES = createTextAttributes({ dim: true })
const BAR_WIDTH = 20
const BAR_EMPTY_COLOR = "#6b7280"
const BAR_LABEL_DARK_COLOR = "#111827"
const BAR_LABEL_LIGHT_COLOR = "#f9fafb"
const SIDEBAR_VERSION_COLOR = "#9ca3af"
const SIDEBAR_INVERT_KV_KEY = "openai-usage.sidebar.invert"
const SIDEBAR_VISIBLE_KV_KEY = "openai-usage.sidebar.visible"
const require = createRequire(import.meta.url)
const PLUGIN_MANIFEST = readPluginManifest()
const PACKAGE_NAME = PLUGIN_MANIFEST.name
const PLUGIN_VERSION = PLUGIN_MANIFEST.version
const PACKAGE_HOMEPAGE = PLUGIN_MANIFEST.homepage

type TuiOptions = {
  invert?: boolean
  versionLabel?: string
}

function readPluginManifest() {
  try {
    const manifest = require("../package.json") as { name?: unknown, version?: unknown, homepage?: unknown }
    const homepage = typeof manifest.homepage === "string" && manifest.homepage.length > 0
      ? manifest.homepage.replace(/#readme$/i, "")
      : null

    return {
      name: typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : null,
      version: typeof manifest.version === "string" && manifest.version.length > 0 ? manifest.version : null,
      homepage,
    }
  } catch {
    return { name: null, version: null, homepage: null }
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
    const cachePath = getUsageCachePath(stateDir)
    const cacheDir = dirname(cachePath)
    const cacheFileName = basename(cachePath)
    const options = (rawOptions as TuiOptions | undefined) ?? {}
    const versionLabel = options.versionLabel ?? PLUGIN_VERSION
    const [sidebarVisible, setSidebarVisible] = createSignal(
      api.kv.get<boolean>(SIDEBAR_VISIBLE_KV_KEY, true) !== false,
    )
    const [invert, setInvert] = createSignal(api.kv.get<boolean>(SIDEBAR_INVERT_KV_KEY, options.invert === true) === true)
    const [state, setState] = createSignal(await readUsageState(stateDir))
    const [open, setOpen] = createSignal(true)
    let syncInFlight: Promise<void> | null = null
    let refreshInFlight: Promise<void> | null = null
    let syncTimer: ReturnType<typeof setTimeout> | undefined

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

    const refreshState = async () => {
      if (refreshInFlight) {
        return refreshInFlight
      }

      refreshInFlight = (async () => {
        try {
          const nextState = await refreshUsageState(stateDir, state())
          setState(nextState)
        } finally {
          refreshInFlight = null
        }
      })()

      return refreshInFlight
    }

    const scheduleSyncState = (delay = CACHE_WATCH_DELAY_MS) => {
      if (syncTimer) {
        clearTimeout(syncTimer)
      }

      syncTimer = setTimeout(() => {
        syncTimer = undefined
        void syncState()
      }, delay)
    }

    const ensureFreshState = async () => {
      await syncState()

      const currentState = state()
      if (currentState.configured === false) {
        return currentState
      }

      if (currentState.error || isUsageStateStale(currentState, STALE_USAGE_REFRESH_MS)) {
        await refreshState()
      }

      return state()
    }

    const showUsageDialog = async () => {
      const latestState = await ensureFreshState()
      setState(latestState)

      api.ui.dialog.replace(() =>
        api.ui.DialogAlert({
          title: "OpenAI Usage",
          message: formatCommandSummary(latestState, PACKAGE_NAME, PLUGIN_VERSION, PACKAGE_HOMEPAGE),
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

    const toggleSidebarVisibility = () => {
      const nextVisible = !sidebarVisible()
      setSidebarVisible(nextVisible)
      api.kv.set(SIDEBAR_VISIBLE_KV_KEY, nextVisible)
      api.ui.toast({
        message: nextVisible ? "Sidebar section is now visible." : "Sidebar section is now hidden.",
      })
    }

    void ensureFreshState()

    const timer = setInterval(() => {
      void ensureFreshState()
    }, CACHE_SYNC_MS)

    let cacheWatcher: ReturnType<typeof watch> | null = null

    try {
      await mkdir(cacheDir, { recursive: true })

      // The runtime plugin only writes to the shared cache file, so watch it to
      // keep the sidebar in sync instead of waiting for the next poll.
      cacheWatcher = watch(cacheDir, { persistent: false }, (_eventType, filename) => {
        if (filename && filename.toString() !== cacheFileName) {
          return
        }

        scheduleSyncState()
      })
    } catch {
      cacheWatcher = null
    }

    api.lifecycle.onDispose(() => {
      clearInterval(timer)
      cacheWatcher?.close()

      if (syncTimer) {
        clearTimeout(syncTimer)
      }
    })

    api.event.on("account.added", () => {
      void refreshState()
    })

    api.event.on("account.removed", () => {
      void refreshState()
    })

    api.event.on("account.switched", () => {
      void refreshState()
    })

    api.event.on("session.next.prompted", () => {
      void refreshState()
    })

    api.event.on("session.idle", () => {
      void refreshState()
    })

    api.event.on("command.executed", () => {
      scheduleSyncState(COMMAND_SYNC_DELAY_MS)
    })

    api.event.on("server.connected", () => {
      void ensureFreshState()
    })

    api.event.on("session.created", () => {
      void ensureFreshState()
    })

    api.event.on("tui.session.select", () => {
      void ensureFreshState()
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
        {versionLabel ? <text fg={SIDEBAR_VERSION_COLOR} attributes={DIM_ATTRIBUTES}>{` ${versionLabel}`}</text> : null}
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

      if (!sidebarVisible() || currentState.configured === false) {
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
      {
        title: sidebarVisible() ? "Hide Sidebar Section" : "Show Sidebar Section",
        value: "openai-usage.toggle-sidebar-visibility",
        description: "show/hide sidebar entry",
        category: "OpenAI Usage",
        onSelect: toggleSidebarVisibility,
      },
      ...(state().configured === false
        ? []
        : [
            {
              title: "View status",
              value: "openai-usage.show",
              description: "from OpenAI's backend API",
              category: "OpenAI Usage",
              onSelect: showUsageDialog,
            },
            {
              title: "Toggle Display Mode",
              value: "openai-usage.toggle-sidebar-invert",
              description: "between used/left quota",
              category: "OpenAI Usage",
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
