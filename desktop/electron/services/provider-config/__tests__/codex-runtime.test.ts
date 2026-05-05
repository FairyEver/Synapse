import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, describe, expect, it } from "vitest"

import { InMemoryAuditSink, createPermissionGuard } from "../../../runtime/security"
import { buildCodexExecArgs } from "../../agent-runtime"
import {
  buildCodexProviderSection,
  prepareCodexRuntime,
  upsertCodexProviderSection,
} from "../codex-runtime"
import type { ProviderRuntimeView } from "../types"

describe("Codex runtime helpers", () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it("upserts one provider section without removing other providers", () => {
    const current = [
      "[model_providers.other]",
      "name = \"other\"",
      "base_url = \"https://other.example\"",
      "",
      "[model_providers.openai]",
      "name = \"openai\"",
      "base_url = \"https://old.example\"",
      "",
      "[model_providers.openai.http_headers]",
      "\"X-Old\" = \"old\"",
      "",
      "[tools]",
      "web_search = true",
      "",
    ].join("\n")

    const section = buildCodexProviderSection(
      "openai",
      "https://new.example",
      "responses",
      { "X-New": "new" },
    )
    const updated = upsertCodexProviderSection(current, "openai", section)

    expect(updated).toContain("[model_providers.other]")
    expect(updated).toContain("[tools]")
    expect(updated).toContain("base_url = \"https://new.example\"")
    expect(updated).toContain("wire_api = \"responses\"")
    expect(updated).toContain("\"X-New\" = \"new\"")
    expect(updated).not.toContain("https://old.example")
    expect(updated).not.toContain("\"X-Old\"")
  })

  it("writes Codex config/auth through guarded file writes and produces exec args", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "synapse-codex-"))
    await writeFile(join(tempDir, "config.toml"), "[model_providers.other]\nname = \"other\"\n", "utf8")
    const auditSink = new InMemoryAuditSink()
    const permissionGuard = createPermissionGuard()
    const view: ProviderRuntimeView = {
      projectId: "project-1",
      agentType: "codex",
      providers: [],
      activeProviderId: "openai",
      activeProvider: undefined,
      activeModel: "gpt-5.4",
      activeMode: "auto-edit",
      provider: {
        id: "openai",
        kind: "openai-compatible",
        baseUrl: "https://api.example/v1",
        secretRef: "secret-openai",
        model: "gpt-5.4",
        models: [],
        env: {},
        effort: "high",
        codex: {
          codexHome: tempDir,
          wireApi: "responses",
          httpHeaders: { "X-Test": "1" },
        },
        scope: "global",
      },
      model: "gpt-5.4",
      mode: "auto-edit",
      baseUrl: "https://api.example/v1",
      apiKey: "sk-secret",
      env: { OPENAI_API_KEY: "sk-secret", OPENAI_BASE_URL: "https://api.example/v1" },
      envAllowlist: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    }

    await prepareCodexRuntime(view, { permissionGuard, auditSink, actor: { kind: "user" } })

    const config = await readFile(join(tempDir, "config.toml"), "utf8")
    expect(config).toContain("[model_providers.other]")
    expect(config).toContain("[model_providers.openai]")
    expect(config).toContain("base_url = \"https://api.example/v1\"")
    expect(config).toContain("wire_api = \"responses\"")
    expect(config).toContain("\"X-Test\" = \"1\"")

    const auth = await readFile(join(tempDir, "auth.json"), "utf8")
    expect(JSON.parse(auth)).toEqual({
      OPENAI_API_KEY: "sk-secret",
      auth_mode: "apikey",
    })
    if (process.platform !== "win32") {
      expect((await stat(join(tempDir, "auth.json"))).mode & 0o777).toBe(0o600)
    }
    expect(auditSink.list().filter((event) => event.action === "fs.write")).toHaveLength(2)

    expect(buildCodexExecArgs({
      workDir: "/repo",
      model: view.model,
      provider: view.provider?.id,
      baseUrl: view.baseUrl,
      effort: view.provider?.effort,
      mode: view.mode,
    })).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--full-auto",
      "--model",
      "gpt-5.4",
      "-c",
      "model_provider=\"openai\"",
      "-c",
      "openai_base_url=\"https://api.example/v1\"",
      "-c",
      "model_reasoning_effort=\"high\"",
      "--json",
      "--cd",
      "/repo",
      "-",
    ])
  })
})

