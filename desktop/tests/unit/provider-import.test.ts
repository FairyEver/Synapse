import { describe, expect, it } from "vitest"
import {
  convertCCSwitchProvider,
  createProviderDraft,
  removeProviderRefsFromProjects,
  resolveProjectProviders,
} from "../../electron/services/provider-model-service"
import { DEFAULT_CONFIG } from "../../src/constants/defaults"
import { sanitizeSynapseConfig } from "../../src/lib/config"

describe("provider model import", () => {
  it("stores API keys as secret drafts and keeps provider JSON secret-free", () => {
    const draft = createProviderDraft({
      name: " MiniMax ",
      apiKey: "sk-secret",
      baseUrl: "https://api.example.com/v1",
      model: "claude-test",
      agentTypes: ["claudecode"],
    })

    expect(draft.provider).toMatchObject({
      name: "minimax",
      secretRef: "provider:global:minimax:api-key",
      baseUrl: "https://api.example.com/v1",
      model: "claude-test",
      agentTypes: ["claudecode"],
    })
    expect(draft.secret).toMatchObject({
      id: "provider:global:minimax:api-key",
      kind: "api-key",
      value: "sk-secret",
    })
    expect(JSON.stringify(draft.provider)).not.toContain("sk-secret")
  })

  it("keeps global providers through config sanitization", () => {
    const draft = createProviderDraft({
      name: "MiniMax",
      apiKey: "sk-secret",
      baseUrl: "https://api.example.com/v1",
      model: "claude-test",
      agentTypes: ["claudecode", "codex"],
      endpoints: { codex: "https://api.example.com/codex" },
      agentModels: { codex: "openai/gpt-5.3-codex" },
      codex: { wireApi: "responses" },
    })

    const sanitized = sanitizeSynapseConfig({
      ...DEFAULT_CONFIG,
      global: {
        ...DEFAULT_CONFIG.global,
        providers: [draft.provider],
      },
    })

    expect(sanitized.global.providers).toHaveLength(1)
    expect(sanitized.global.providers[0]).toMatchObject({
      name: "minimax",
      scope: "global",
      secretRef: "provider:global:minimax:api-key",
      endpoints: { codex: "https://api.example.com/codex" },
      agentModels: { codex: "openai/gpt-5.3-codex" },
      codex: { wireApi: "responses" },
    })
    expect(JSON.stringify(sanitized.global.providers)).not.toContain("sk-secret")
  })

  it("removes deleted global provider refs from projects", () => {
    const nextProjects = removeProviderRefsFromProjects(
      [
        {
          id: "project-1",
          name: "Project 1",
          path: "/tmp/project-1",
          providerRefs: ["MiniMax", "other"],
        },
        {
          id: "project-2",
          name: "Project 2",
          path: "/tmp/project-2",
          providerRefs: ["minimax"],
        },
      ],
      "minimax",
    )

    expect(nextProjects[0]?.providerRefs).toEqual(["other"])
    expect(nextProjects[1]?.providerRefs).toBeUndefined()
  })

  it("resolves global provider refs with agent filtering and inline override precedence", () => {
    const globalA = createProviderDraft({
      name: "global-a",
      apiKey: "key-a",
      baseUrl: "https://global-a.example.com",
      agentTypes: ["claudecode"],
    }).provider
    const globalB = createProviderDraft({
      name: "global-b",
      apiKey: "key-b",
      baseUrl: "https://global-b.example.com",
    }).provider
    const inlineA = createProviderDraft({
      name: "global-a",
      apiKey: "override",
      baseUrl: "https://override.example.com",
      scope: "project",
      projectId: "project-1",
    }).provider

    const resolved = resolveProjectProviders(
      [globalA, globalB],
      [inlineA],
      ["global-a", "global-b", "missing"],
      "claudecode",
    )

    expect(resolved.map((provider) => provider.name)).toEqual(["global-b", "global-a"])
    expect(resolved[0]?.baseUrl).toBe("https://global-b.example.com")
    expect(resolved[1]?.baseUrl).toBe("https://override.example.com")

    const codexResolved = resolveProjectProviders([globalA, globalB], [], ["global-a", "global-b"], "codex")
    expect(codexResolved.map((provider) => provider.name)).toEqual(["global-b"])
  })

  it("applies per-agent endpoint, model, and model-list overrides", () => {
    const multi = createProviderDraft({
      name: "multi",
      baseUrl: "https://provider.example.com/api",
      model: "claude-sonnet",
      endpoints: { codex: "https://provider.example.com/api/v1" },
      agentModels: { codex: "openai/gpt-5.3-codex" },
      agentModelLists: {
        codex: [{ model: "openai/gpt-5.3-codex", alias: "codex" }],
      },
    }).provider

    const resolved = resolveProjectProviders([multi], [], ["multi"], "codex")

    expect(resolved[0]).toMatchObject({
      baseUrl: "https://provider.example.com/api/v1",
      model: "openai/gpt-5.3-codex",
      models: [{ model: "openai/gpt-5.3-codex", alias: "codex" }],
    })
  })

  it("converts claude cc-switch rows and carries non-routing env vars", () => {
    const draft = convertCCSwitchProvider({
      name: "Claude Relay",
      appType: "claude",
      settingsConfig: JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-claude",
          ANTHROPIC_BASE_URL: "https://claude.example.com",
          ANTHROPIC_MODEL: "claude-sonnet",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku",
        },
      }),
    })

    expect(draft.provider).toMatchObject({
      name: "claude-relay",
      secretRef: "provider:global:claude-relay:api-key",
      baseUrl: "https://claude.example.com",
      model: "claude-sonnet",
      env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku" },
      agentTypes: ["claudecode"],
    })
    expect(JSON.stringify(draft.provider)).not.toContain("sk-claude")
  })

  it("rejects claude cc-switch rows without API key or extra env", () => {
    expect(() => convertCCSwitchProvider({
      name: "Claude Relay",
      appType: "claude",
      settingsConfig: JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com",
          ANTHROPIC_MODEL: "claude-sonnet",
        },
      }),
    })).toThrow("no API key or env found")
  })

  it("converts codex cc-switch rows from auth and config text", () => {
    const draft = convertCCSwitchProvider({
      name: "Codex Relay",
      appType: "codex",
      settingsConfig: JSON.stringify({
        auth: { OPENAI_API_KEY: "sk-codex" },
        config: 'base_url = "https://codex.example.com/v1"\nmodel = "openai/gpt-5.3-codex"',
      }),
    })

    expect(draft.provider).toMatchObject({
      name: "codex-relay",
      secretRef: "provider:global:codex-relay:api-key",
      baseUrl: "https://codex.example.com/v1",
      model: "openai/gpt-5.3-codex",
      agentTypes: ["codex"],
    })
    expect(draft.secret?.value).toBe("sk-codex")
    expect(JSON.stringify(draft.provider)).not.toContain("sk-codex")
  })
})
