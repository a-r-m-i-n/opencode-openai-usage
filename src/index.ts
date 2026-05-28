import type { PluginModule } from "@opencode-ai/plugin"
import { buildFailureState, buildUsageState, getOpenCodeStateDir, readUsageState, writeUsageState } from "./lib/openai-usage.ts"

export const id = "openai-usage"

const REFRESH_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000

function shouldRefreshOnEvent(type: string) {
  return (
    type === "account.added"
    || type === "account.removed"
    || type === "account.switched"
    || type === "session.next.prompted"
    || type === "command.executed"
  )
}

const module = {
  id,
  server: async () => {
    const stateDir = getOpenCodeStateDir()

    let currentState = await readUsageState(stateDir)
    let refreshInFlight: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let nextDelay = REFRESH_MS

    const persistState = async (state = currentState) => {
      currentState = state
      await writeUsageState(stateDir, currentState)
    }

    const refresh = async (_force = false) => {
      if (refreshInFlight) {
        return refreshInFlight
      }

      refreshInFlight = (async () => {
        try {
          if (!currentState.fetchedAt) {
            await persistState({ ...currentState, loading: true, error: null })
          }

          const nextState = await buildUsageState(stateDir)
          nextDelay = REFRESH_MS
          await persistState(nextState)
        } catch (error) {
          nextDelay = Math.min(nextDelay * 2, MAX_BACKOFF_MS)
          await persistState(buildFailureState(currentState, error))
        } finally {
          refreshInFlight = null
          schedule(nextDelay)
        }
      })()

      return refreshInFlight
    }

    const schedule = (delay: number) => {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        void refresh(true)
      }, delay)
    }

    void refresh(true)

    return {
      event: async ({ event }) => {
        if (!shouldRefreshOnEvent(event.type)) {
          return
        }

        await refresh(true)
      },
    }
  },
} satisfies PluginModule

export default module
