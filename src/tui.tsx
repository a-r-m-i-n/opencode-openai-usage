import { createTextAttributes } from "@opentui/core"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import {
  formatCommandSummary,
  formatRelativeDuration,
  formatSidebarContent,
  formatWindowLabel,
  getOpenCodeStateDir,
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

function formatRemainingPercent(leftPercent: number) {
  return Number.isInteger(leftPercent) ? `${leftPercent}%` : `${leftPercent.toFixed(1)}%`
}

function getBarFillColor(leftPercent: number) {
  if (leftPercent >= 50) {
    return "#22c55e"
  }

  if (leftPercent >= 20) {
    return "#eab308"
  }

  return "#ef4444"
}

function getBarSegments(leftPercent: number, width: number) {
  const clampedPercent = Math.max(0, Math.min(100, leftPercent))
  const filled = Math.round((clampedPercent / 100) * width)
  return {
    filled: Math.max(0, Math.min(width, filled)),
    empty: Math.max(0, width - filled),
  }
}

function getBarLabelColor(fillColor: string) {
  return fillColor === "#ef4444" ? BAR_LABEL_LIGHT_COLOR : BAR_LABEL_DARK_COLOR
}

function renderProgressBar(leftPercent: number) {
  const barSegments = getBarSegments(leftPercent, BAR_WIDTH)
  const barFillColor = getBarFillColor(leftPercent)
  const label = `${formatRemainingPercent(leftPercent)} left`
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
  tui: async (api) => {
    const stateDir = getOpenCodeStateDir()
    const [state, setState] = createSignal(await readUsageState(stateDir))
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
          message: formatCommandSummary(latestState),
        }),
      )
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

    const sidebarText = createMemo(() => formatSidebarContent(state()))

    const renderSidebarWindow = (window: UsageWindow | null) => {
      if (!window) {
        return null
      }

      const leftPercent = Math.max(0, 100 - window.usedPercent)

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          <box flexDirection="row" gap={0} padding={0} margin={0}>
            <text>{`${formatWindowLabel(window.windowDurationMins)} `}</text>
            {renderProgressBar(leftPercent)}
            <text attributes={DIM_ATTRIBUTES}>{` Reset: ${formatRelativeDuration(window.resetsAt)}`}</text>
          </box>
        </box>
      )
    }

    const renderSidebarContent = () => {
      const currentState = state()

      if (currentState.error && !currentState.primary && !currentState.secondary) {
        return <text>{sidebarText()}</text>
      }

      if (!currentState.primary && !currentState.secondary) {
        return <text>{sidebarText()}</text>
      }

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          <text>OpenAI Usage</text>
          {renderSidebarWindow(currentState.primary)}
          {renderSidebarWindow(currentState.secondary)}
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
        title: "OpenAI Usage",
        value: "openai-usage.show",
        description: "Show current OpenAI usage",
        category: "OpenAI",
        onSelect: showUsageDialog,
      },
    ])

    api.lifecycle.onDispose(() => {
      unregisterCommand?.()
    })
  },
} satisfies TuiPluginModule

export default module
