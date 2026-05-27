/** @jsxImportSource @opentui/solid */

import { createTextAttributes } from "@opentui/core"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import {
  formatCommandSummary,
  formatFooter,
  formatSidebarContent,
  formatRelativeDuration,
  formatTime,
  formatTimestamp,
  formatWindowLabel,
  getOpenCodeStateDir,
  readUsageState,
  type UsageWindow,
} from "../lib/openai-usage.ts"

export const id = "openai-usage-tui"

const CACHE_SYNC_MS = 5_000
const DIM_ATTRIBUTES = createTextAttributes({ dim: true })

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

    const footerText = createMemo(() => formatFooter(state()))
    const sidebarText = createMemo(() => formatSidebarContent(state()))

    const renderSidebarWindow = (window: UsageWindow | null) => {
      if (!window) {
        return null
      }

      const leftPercent = Math.max(0, 100 - window.usedPercent)

      return (
        <box flexDirection="column" gap={0} padding={0} margin={0}>
          <text>{`${formatWindowLabel(window.windowDurationMins)}: ${Number.isInteger(leftPercent) ? `${leftPercent}%` : `${leftPercent.toFixed(1)}%`} left`}</text>
          <text attributes={DIM_ATTRIBUTES}>
            {`Resets in ${formatRelativeDuration(window.resetsAt)} (${formatTimestamp(window.resetsAt)})`}
          </text>
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
          {currentState.fetchedAt ? (
            <text attributes={DIM_ATTRIBUTES}>{`Last update at ${formatTime(currentState.fetchedAt)}`}</text>
          ) : null}
          {renderSidebarWindow(currentState.primary)}
          {renderSidebarWindow(currentState.secondary)}
        </box>
      )
    }

    api.slots.register({
      order: -100,
      slots: {
        home_footer: () => <text>{footerText()}</text>,
        sidebar_content: renderSidebarContent,
        sidebar_footer: () => <text>{footerText()}</text>,
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
