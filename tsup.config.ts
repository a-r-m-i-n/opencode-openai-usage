import { solidPlugin } from "esbuild-plugin-solid"
import { defineConfig } from "tsup"

const nodeEnv = process.env.NODE_ENV ?? "production"

export default defineConfig({
  entry: ["src/index.ts", "src/tui.tsx"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opentui/core",
    "@opentui/keymap",
    "@opentui/solid",
    "solid-js",
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify(nodeEnv),
  },
  esbuildOptions(options) {
    options.conditions = [nodeEnv]
  },
  esbuildPlugins: [
    solidPlugin({
      solid: {
        moduleName: "@opentui/solid",
        generate: "universal",
      },
    }),
  ],
})
