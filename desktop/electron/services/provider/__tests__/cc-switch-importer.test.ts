import { DatabaseSync } from "node:sqlite"
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CC_SWITCH_IMPORT_JSON_MAX_BYTES,
  CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS,
} from "../../../../config"
import {
  buildCcSwitchClaudeImportPreview,
  buildProviderInputFromCcSwitchCandidate,
  readCcSwitchClaudeProvidersFromSource,
  resolveCcSwitchCandidateSources,
} from "../cc-switch-importer"

afterEach(() => {
  vi.unstubAllEnvs()
})

function tempRoot(): string {
  const dir = path.join(os.tmpdir(), `synapse-ccs-import-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createCcSwitchDb(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        website_url TEXT,
        category TEXT,
        created_at INTEGER,
        sort_index INTEGER,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );
    `)
    const insert = db.prepare(`
      INSERT INTO providers (
        id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      "deepseek",
      "claude",
      "DeepSeek",
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_MODEL: "deepseek-chat",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-chat",
        },
      }),
      "https://platform.deepseek.com",
      "cn_official",
      1,
      2,
      "work account",
      "{}",
    )
    insert.run(
      "codex-only",
      "codex",
      "Codex Only",
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-ignore" } }),
      null,
      "custom",
      2,
      3,
      null,
      "{}",
    )
    insert.run(
      "missing-key",
      "claude",
      "Missing Key",
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://example.com" } }),
      null,
      "custom",
      3,
      4,
      null,
      "{}",
    )
  } finally {
    db.close()
  }
}

function createManyCcSwitchDb(filePath: string, count: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        website_url TEXT,
        category TEXT,
        created_at INTEGER,
        sort_index INTEGER,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );
    `)
    const insert = db.prepare(`
      INSERT INTO providers (
        id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let index = 0; index < count; index += 1) {
      insert.run(
        `provider-${String(index).padStart(4, "0")}`,
        "claude",
        `Provider ${index}`,
        JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: `sk-${index}` } }),
        null,
        "custom",
        index,
        index,
        null,
        "{}",
      )
    }
  } finally {
    db.close()
  }
}

describe("cc-switch importer", () => {
  it("resolves default and Windows HOME fallback sources", () => {
    const homeDir = path.join(tempRoot(), "User Profile")
    const homeEnv = path.join(tempRoot(), "Git Home")

    const sources = resolveCcSwitchCandidateSources({
      platform: "win32",
      homeDir,
      envHome: homeEnv,
      exists: (candidate) => candidate.includes("Git Home"),
    })

    expect(sources[0]).toEqual({
      kind: "sqlite",
      path: path.join(homeEnv, ".cc-switch", "cc-switch.db"),
    })
  })

  it("reads only Claude providers from SQLite and classifies preview status", () => {
    const dbPath = path.join(tempRoot(), ".cc-switch", "cc-switch.db")
    createCcSwitchDb(dbPath)

    const source = readCcSwitchClaudeProvidersFromSource({ kind: "sqlite", path: dbPath })
    const preview = buildCcSwitchClaudeImportPreview(source.providers, new Set(["deepseek"]))

    expect(source.kind).toBe("sqlite")
    expect(source.providers.map((item) => item.id)).toEqual(["deepseek", "missing-key"])
    expect(preview.items).toEqual([
      expect.objectContaining({
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        category: "cn_official",
        status: "duplicate",
        selectedByDefault: false,
      }),
      expect.objectContaining({
        id: "missing-key",
        status: "missing_api_key",
        selectedByDefault: false,
      }),
    ])
  })

  it("limits SQLite provider preview rows", () => {
    const dbPath = path.join(tempRoot(), ".cc-switch", "cc-switch.db")
    createManyCcSwitchDb(dbPath, CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS + 1)

    const source = readCcSwitchClaudeProvidersFromSource({ kind: "sqlite", path: dbPath })

    expect(source.providers).toHaveLength(CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS)
    expect(source.providers.at(-1)?.id).toBe(`provider-${String(CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS - 1).padStart(4, "0")}`)
  }, 20_000)

  it("reads legacy config.json as an explicit JSON source", () => {
    const jsonPath = path.join(tempRoot(), ".cc-switch", "config.json")
    mkdirSync(path.dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, JSON.stringify({
      apps: {
        claude: {
          current: "moonshot",
          providers: {
            moonshot: {
              id: "moonshot",
              name: "Moonshot",
              category: "cn_official",
              settingsConfig: {
                env: {
                  ANTHROPIC_AUTH_TOKEN: "sk-moonshot",
                  ANTHROPIC_MODEL: "kimi-k2",
                },
              },
            },
          },
        },
      },
    }))

    const source = readCcSwitchClaudeProvidersFromSource({ kind: "json", path: jsonPath })
    const preview = buildCcSwitchClaudeImportPreview(source.providers, new Set())

    expect(preview.items).toEqual([
      expect.objectContaining({
        id: "moonshot",
        name: "Moonshot",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "kimi-k2",
        status: "ready",
        selectedByDefault: true,
      }),
    ])
  })

  it("rejects oversized legacy config.json before parsing", () => {
    const jsonPath = path.join(tempRoot(), ".cc-switch", "config.json")
    mkdirSync(path.dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, " ".repeat(CC_SWITCH_IMPORT_JSON_MAX_BYTES + 1))

    expect(() => readCcSwitchClaudeProvidersFromSource({ kind: "json", path: jsonPath }))
      .toThrow("CC Switch 配置文件过大，无法导入。")
  })

  it("moves imported API keys to apiKey and redacts stored settings config", () => {
    const input = buildProviderInputFromCcSwitchCandidate({
      id: "deepseek",
      name: "DeepSeek",
      category: "cn_official",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_MODEL: "deepseek-chat",
          ENABLE_TOOL_SEARCH: "true",
        },
      },
    }, 3)

    expect(input).toEqual(expect.objectContaining({
      apiKey: "sk-deepseek",
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "deepseek-chat",
      env: {
        ENABLE_TOOL_SEARCH: "true",
      },
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_MODEL: "deepseek-chat",
          ENABLE_TOOL_SEARCH: "true",
        },
      },
      sortIndex: 3,
    }))
    expect(JSON.stringify(input.settingsConfig)).not.toContain("sk-deepseek")
  })
})
