import assert from "node:assert/strict"
import test from "node:test"
import { __testing, formatWindowLabel, getOpenCodeStateDir } from "./openai-usage.ts"

test("extractAccessToken returns oauth access token", () => {
  assert.equal(__testing.extractAccessToken({ openai: { type: "oauth", access: "token-123" } }), "token-123")
})

test("extractAccessToken rejects missing token", () => {
  assert.throws(
    () => __testing.extractAccessToken({ openai: { type: "oauth", access: "" } }),
    /OpenCode stored an invalid ChatGPT access token\./,
  )
})

test("normalizeWindow accepts window seconds fallback", () => {
  assert.deepEqual(
    __testing.normalizeWindow(
      {
        limit_window_seconds: 10_800,
        used_percent: 37.5,
        reset_at: 1_700_000_000,
      },
      "primary",
    ),
    {
      usedPercent: 37.5,
      windowDurationMins: 180,
      resetsAt: "2023-11-14T22:13:20.000Z",
    },
  )
})

test("formatWindowLabel formats common durations", () => {
  assert.equal(formatWindowLabel(15), "15m")
  assert.equal(formatWindowLabel(120), "2h")
  assert.equal(formatWindowLabel(2_880), "2d")
})

test("getOpenCodeStateDir returns a non-empty path", () => {
  assert.ok(getOpenCodeStateDir().length > 0)
})
