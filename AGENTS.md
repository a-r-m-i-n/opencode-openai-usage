# Repository Notes

- This package publishes two plugin entrypoints from `src/`: runtime plugin `src/index.ts` and TUI plugin `src/tui.tsx`.
- Shared state, fetch, formatting, and auth handling live in `src/lib/openai-usage.ts`; the only automated test is `src/lib/openai-usage.test.ts`.
- Local OpenCode development does not load `src/` directly. OpenCode auto-loads `.opencode/plugins/openai-usage.ts`, `.opencode/tui/openai-usage.tsx`, and `.opencode/tui.json`; the two code files are thin re-export wrappers over `src/`.
- `.opencode/package.json` exists so the repo-local OpenCode plugin runtime can resolve `@opencode-ai/plugin` during local testing.

# Commands

- Install deps: `npm install`
- Run the only wired automated test: `npm test`
- Build the publishable package: `npm run build`
- Check the npm payload before publishing: `npm pack --dry-run`
- `prepublishOnly` runs `npm run build`; keep `dist/` buildable from source.

# Verification

- Preferred focused verification is `npm test && npm run build`.
- If changes touch packaging metadata, exports, or published files, also run `npm pack --dry-run`.
- There is no repo lint script, no CI workflow, and no dedicated typecheck script.
- `npx tsc --noEmit` is not currently a reliable green check here: it fails in the current repo because Node type declarations are not installed.

# Packaging

- `package.json` exports only `.` -> `./dist/index.js` and `./tui` -> `./dist/tui.js`.
- Published files are restricted to `dist/`, `README.md`, and `LICENSE`.
- `npm run build` emits a shared `dist/chunk-*.js` file in addition to `dist/index.js` and `dist/tui.js`; that chunk is part of the published package.

# Runtime Quirks

- The plugin reads OpenCode auth from the local state dir's `auth.json`; manual testing requires an OpenAI account connected to OpenCode via OAuth.
- The plugin caches fetched usage data under the OpenCode state dir at `storage/openai-usage-cache.json`.
- Usage data comes from `https://chatgpt.com/backend-api/wham/usage`, an internal ChatGPT web endpoint; failures may be upstream/auth-related rather than repo regressions.
- The runtime plugin refreshes usage immediately on startup, every 60 seconds afterward, and also on account/session/command events; failures back off up to 15 minutes.
- The TUI plugin polls the cached state every 5 seconds, hides its sidebar section and commands when no OpenAI auth is configured, and persists the used-vs-left sidebar mode in OpenCode KV storage.
