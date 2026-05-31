# opencode-openai-usage

OpenCode plugin that reads your ChatGPT account usage and shows it in the TUI footer, sidebar, and command palette.

The sidebar panel starts expanded and can be collapsed.

## What It Does

- fetches usage data from `https://chatgpt.com/backend-api/wham/usage`
- reads the OpenCode OpenAI OAuth token from OpenCode's local state
- shows remaining usage in the footer and sidebar
- adds an `OpenAI Usage` command to the TUI command list

## Requirements

- OpenCode with an OpenAI account connected via OAuth
- Node.js and npm available for installation/build steps

## Install From npm

Add the runtime plugin in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-usage"]
}
```

Add the TUI plugin in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["opencode-openai-usage/tui", { "invert": false }]]
}
```

After changing config, quit and restart OpenCode.

## Local Development

This repository keeps local dev entries under `.opencode/` so you can test the plugin without publishing it.

1. Install dependencies:

```bash
npm install
```

2. Build the publish output when needed:

```bash
npm run build
```

3. Open this repository in OpenCode.

OpenCode auto-loads:

- `.opencode/plugins/openai-usage.ts`
- `.opencode/tui/openai-usage.tsx`
- `.opencode/tui.json`

Those files are thin dev-entry wrappers that re-export the real implementation from `src/`.

## TUI Options

The TUI plugin accepts options in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["opencode-openai-usage/tui", { "invert": true }]]
}
```

| Option | Default | Description |
|---|---|---|
| `invert` | `false` | Default sidebar mode. `false` shows used quota like `60% used`; `true` shows remaining quota like `40% left`. After the `OpenAI Usage: Toggle Sidebar Display` command is used, the last selected mode is persisted across restarts. |

## Project Structure

```text
src/
  index.ts
  tui.tsx
  lib/openai-usage.ts
.opencode/
  plugins/openai-usage.ts
  tui/openai-usage.tsx
  tui.json
```

## Manual Test Flow

1. Run `npm install`.
2. Open the repo in OpenCode.
3. Confirm the footer shows `OpenAI usage: ...` and later current values.
4. Open the command list and run `OpenAI Usage`.
5. Run `OpenAI Usage: Toggle Sidebar Display` and verify the sidebar switches between `used` and `left` mode.
6. Restart OpenCode and verify the selected sidebar mode is preserved.
7. Switch or remove the OpenAI account and verify the error state is shown.
8. Run `npm run build`.
9. Verify `npm pack --dry-run` contains only the publishable package files.

## Notes And Limitations

- The plugin depends on OpenCode's locally stored `auth.json` format.
- The usage endpoint is an internal ChatGPT web endpoint and may change without notice.
- The plugin caches usage data locally in OpenCode's state directory.
- The command summary currently includes the account email returned by the upstream endpoint.

## License

MIT
