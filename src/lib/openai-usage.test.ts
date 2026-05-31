import assert from "node:assert/strict"
import test from "node:test"
import { __testing, formatCommandSummary, formatWindowLabel, getOpenCodeStateDir } from "./openai-usage.ts"

test("extractAccessToken returns oauth access token", () => {
  assert.equal(__testing.extractAccessToken({ openai: { type: "oauth", access: "token-123" } }), "token-123")
})

test("extractAccessToken rejects missing token", () => {
  assert.throws(
    () => __testing.extractAccessToken({ openai: { type: "oauth", access: "" } }),
    error => {
      assert.equal(__testing.isNotConfiguredError(error), true)
      assert.match((error as Error).message, /OpenCode has no ChatGPT auth configured\./)
      return true
    },
  )
})

test("extractAccessToken rejects missing auth entry as unconfigured", () => {
  assert.throws(
    () => __testing.extractAccessToken({}),
    error => {
      assert.equal(__testing.isNotConfiguredError(error), true)
      return true
    },
  )
})

test("buildUnconfiguredState hides plugin output", () => {
  assert.deepEqual(__testing.buildUnconfiguredState(), {
    primary: null,
    secondary: null,
    fetchedAt: null,
    error: null,
    loading: false,
    configured: false,
    rateLimitReachedType: null,
    accountId: null,
    userId: null,
    email: null,
    planType: null,
  })
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

test("getUsageDisplay shows used percent when invert is false", () => {
  assert.deepEqual(__testing.getUsageDisplay(60, false), {
    percent: 60,
    label: "used",
  })
})

test("getUsageDisplay shows remaining percent when invert is true", () => {
  assert.deepEqual(__testing.getUsageDisplay(60, true), {
    percent: 40,
    label: "left",
  })
})

test("getUsageDisplay clamps input to valid percentage range", () => {
  assert.deepEqual(__testing.getUsageDisplay(120, false), {
    percent: 100,
    label: "used",
  })

  assert.deepEqual(__testing.getUsageDisplay(-20, true), {
    percent: 100,
    label: "left",
  })
})

test("formatCommandSummary includes plugin version when provided", () => {
  assert.equal(
    formatCommandSummary(
      {
        primary: null,
        secondary: null,
        fetchedAt: null,
        error: null,
        loading: false,
        configured: true,
        rateLimitReachedType: null,
        accountId: null,
        userId: null,
        email: null,
        planType: null,
      },
      "@a-r-m-i-n/opencode-openai-usage",
      "0.1.0",
    ),
    "@a-r-m-i-n/opencode-openai-usage\nPlugin version: 0.1.0\n\nStatus: unavailable\nError: Usage data has not been fetched yet.",
  )
})

test("formatCommandSummary puts window labels on their own lines", () => {
  assert.equal(
    formatCommandSummary(
      {
        primary: {
          usedPercent: 37.5,
          windowDurationMins: 180,
          resetsAt: "never",
        },
        secondary: {
          usedPercent: 12,
          windowDurationMins: 15,
          resetsAt: "later",
        },
        fetchedAt: null,
        error: null,
        loading: false,
        configured: true,
        rateLimitReachedType: null,
        accountId: null,
        userId: null,
        email: null,
        planType: "plus",
      },
      "@a-r-m-i-n/opencode-openai-usage",
    ),
    "@a-r-m-i-n/opencode-openai-usage\nPrimary window\n3h: 37.5% used, 62.5% left, resets never\n\nSecondary window\n15m: 12% used, 88% left, resets later\n\nPlan: plus",
  )
})
