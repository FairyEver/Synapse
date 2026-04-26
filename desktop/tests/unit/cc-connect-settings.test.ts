import { describe, expect, it } from "vitest"
import {
  CcConnectSettingsService,
  ccConnectSettingsToToml,
  normalizeCcConnectSettings,
  redactTomlSecrets,
} from "../../electron/services/cc-connect-settings-service"
import { applySynapseConfigPatch, createDefaultConfig } from "../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../src/types/config"

function memoryConfig(initial: SynapseConfig = createDefaultConfig()) {
  let current = initial
  return {
    load: async () => structuredClone(current),
    update: async (patch: SynapseConfigPatch) => {
      current = applySynapseConfigPatch(current, patch)
      return structuredClone(current)
    },
    read: () => current,
  }
}

describe("cc connect settings service", () => {
  it("matches CC Connect global settings defaults and normalizes invalid updates", () => {
    const current = createDefaultConfig().global.ccConnect
    expect(current).toMatchObject({
      language: "en",
      attachmentSend: "",
      logLevel: "info",
      idleTimeoutMins: 120,
      thinkingMessages: true,
      thinkingMaxLen: 300,
      toolMessages: true,
      toolMaxLen: 500,
      streamPreviewEnabled: true,
      streamPreviewIntervalMs: 1500,
      rateLimitMaxMessages: 20,
      rateLimitWindowSecs: 60,
    })

    expect(normalizeCcConnectSettings(current, {
      language: "zh",
      attachmentSend: "off",
      logLevel: "debug",
      idleTimeoutMins: 0,
      streamPreviewIntervalMs: 10,
      rateLimitWindowSecs: 0,
    })).toMatchObject({
      language: "zh",
      attachmentSend: "off",
      logLevel: "debug",
      idleTimeoutMins: 0,
      streamPreviewIntervalMs: 1500,
      rateLimitWindowSecs: 60,
    })
  })

  it("updates settings and records guarded reload/restart requests", async () => {
    const store = memoryConfig()
    const service = new CcConnectSettingsService({
      config: store,
      now: () => new Date("2026-04-26T06:00:00.000Z"),
    })

    await expect(service.updateSettings({
      attachmentSend: "on",
      logLevel: "warn",
      rateLimitMaxMessages: 0,
    })).resolves.toMatchObject({
      attachmentSend: "on",
      logLevel: "warn",
      rateLimitMaxMessages: 0,
    })

    await expect(service.reload()).resolves.toEqual({
      message: "config reloaded",
      projectsUpdated: [],
      reloadedAt: "2026-04-26T06:00:00.000Z",
    })
    await expect(service.restart()).resolves.toEqual({
      status: "confirmation_required",
      message: "restart requires confirmation",
    })
    await expect(service.restart({ confirmed: true, sessionKey: "telegram:1:2", platform: "telegram" })).resolves.toEqual({
      status: "recorded",
      message: "restart requested",
      requestedAt: "2026-04-26T06:00:00.000Z",
      sessionKey: "telegram:1:2",
      platform: "telegram",
    })
    expect(store.read().global.ccConnect.lastRestartRequestedAt).toBe("2026-04-26T06:00:00.000Z")
  })

  it("generates redacted raw TOML for CC Connect settings", () => {
    const config = createDefaultConfig()
    config.global.providers = [{
      id: "provider-1",
      schemaVersion: 1,
      kind: "llm",
      name: "anthropic",
      scope: "global",
      secretRef: "secret-real-value",
      baseUrl: "https://api.example.test",
      model: "claude",
    }]

    const toml = ccConnectSettingsToToml(config)
    expect(toml).toContain("[stream_preview]")
    expect(toml).toContain("[rate_limit]")
    expect(toml).toContain('secret_ref = "***REDACTED***"')
    expect(toml).not.toContain("secret-real-value")
    expect(redactTomlSecrets('token = "abc"\napi_key = "sk-test"\nname = "safe"\n')).toBe('token = "***REDACTED***"\napi_key = "***REDACTED***"\nname = "safe"\n')
  })

  it("reports Bridge, Webhook, API, daemon, doctor, and update diagnostics", async () => {
    const store = memoryConfig()
    const service = new CcConnectSettingsService({
      config: store,
      homeDir: "/tmp/synapse-user",
      pathStatus: async (targetPath) => targetPath.endsWith("api.sock") ? "available" : "missing",
      platform: "darwin",
      version: "test-version",
    })

    const diagnostics = await service.diagnostics()
    expect(diagnostics.bridge).toMatchObject({
      enabled: false,
      endpoint: "ws://127.0.0.1:9810/bridge/ws",
      tokenSet: false,
    })
    expect(diagnostics.webhook).toMatchObject({
      endpoint: "http://127.0.0.1:9111/hook",
      authMethods: ["Bearer", "X-Webhook-Token", "query token"],
    })
    expect(diagnostics.localApi).toMatchObject({
      socketPath: "/tmp/synapse-user/.cc-connect/run/api.sock",
      status: "available",
      permission: "0600",
    })
    expect(diagnostics.managementApi.endpoint).toBe("http://127.0.0.1:9820/api/v1")
    expect(diagnostics.daemon).toMatchObject({
      platform: "darwin",
      status: "stopped",
      logMaxSizeMb: 10,
    })
    expect(diagnostics.doctor.summary.warn).toBeGreaterThan(0)
    expect(diagnostics.update).toMatchObject({
      currentVersion: "test-version",
      sources: ["GitHub", "Gitee"],
    })
  })
})
