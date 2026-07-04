import tuiModule from "../../src/tui.tsx"

export const id = "openai-usage-tui-dev"

export default {
  ...tuiModule,
  id,
  tui: async (api, rawOptions) => {
    return tuiModule.tui(api, { ...(rawOptions as Record<string, unknown> | undefined), versionLabel: "dev" })
  },
}
