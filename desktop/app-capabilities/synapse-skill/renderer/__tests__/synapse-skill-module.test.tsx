/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseEditorAdapterSummary } from "../../../../src/types/editor"

const codexEditor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill"],
}

const preparedSource = {
  kind: "skill",
  origin: "prepared",
  sourceIdentity: "synapse-skill",
  name: "synapse-skill",
  title: "Synapse Skill",
  description: "Synapse MCP 使用指南",
  preparedSourceId: "synapse-skill:/tmp/source",
  mainContent: "# Synapse Skill",
  sourceFingerprint: "sha256:current",
} as const

const synapseSkillBridge = vi.hoisted(() => ({
  prepareInstallSource: vi.fn(async () => ({
    kind: "skill",
    origin: "prepared",
    sourceIdentity: "synapse-skill",
    name: "synapse-skill",
    title: "Synapse Skill",
    description: "Synapse MCP 使用指南",
    preparedSourceId: "synapse-skill:/tmp/source",
    mainContent: "# Synapse Skill",
    sourceFingerprint: "sha256:current",
  })),
}))

const installSourceToEditorTargets = vi.hoisted(() => vi.fn(async () => ({
  results: [{
    target: { editorId: "codex", scope: "global" },
    status: "installed",
  }],
})))
const loadEditors = vi.hoisted(() => vi.fn(async () => undefined))
const inspectGlobalSkillInstallations = vi.hoisted(() => vi.fn(async () => ({
  entries: [
    {
      editorId: "codex",
      editorLabel: "Codex",
      scope: "global",
      status: "not_installed",
      targetPath: "/Users/test/.agents/skills/synapse-skill",
      message: null,
    },
  ],
})))
const showItemInFolder = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [],
      },
    },
  }),
}))

vi.mock("@/app-shell/installers", () => ({
  inspectGlobalSkillInstallations,
  installSourceToEditorTargets,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/components/editor-icon", () => ({
  EditorIcon: ({ editorId }: { editorId: string }) => <span data-editor-icon={editorId} />,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "synapseSkill") return synapseSkillBridge
    if (domain === "shell") return { showItemInFolder }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    filteredAdapters: [codexEditor],
    isLoading: false,
    error: null,
    load: loadEditors,
  }),
}))

vi.mock("@/modules/installers/shared/shared-installer-flow", () => ({
  SharedInstallerFlow: ({
    initialEditor,
    initialSelection,
    source,
  }: {
    initialEditor?: SynapseEditorAdapterSummary | null
    initialSelection?: { scope: string } | null
    source: typeof preparedSource
  }) => (
    <div data-testid="installer-flow">
      {source.name}:{initialEditor?.id ?? "none"}:{initialSelection?.scope}
    </div>
  ),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import { SynapseSkillModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  synapseSkillBridge.prepareInstallSource.mockClear()
  installSourceToEditorTargets.mockClear()
  loadEditors.mockClear()
  inspectGlobalSkillInstallations.mockClear()
  showItemInFolder.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("SynapseSkillModule", () => {
  it("shows global editor install status", async () => {
    await renderModule()

    expect(loadEditors).toHaveBeenCalled()
    expect(inspectGlobalSkillInstallations).toHaveBeenCalledWith(preparedSource)
    expect(document.body.textContent).toContain("全局安装状态")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).not.toContain("未安装")
    expect(document.body.textContent).toContain("/Users/test/.agents/skills/synapse-skill")
  })

  it("opens the single editor installer flow for missing targets", async () => {
    await renderModule()

    await clickButton("安装")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill:codex:global")
  })

  it("shows only a direct reinstall action for installed targets", async () => {
    const installedResult = {
      entries: [
        {
          editorId: "codex",
          editorLabel: "Codex",
          scope: "global",
          status: "installed",
          targetPath: "/Users/test/.agents/skills/synapse-skill",
          message: null,
        },
      ],
    }
    inspectGlobalSkillInstallations
      .mockResolvedValueOnce(installedResult)
      .mockResolvedValueOnce(installedResult)
    await renderModule()

    expect(document.body.textContent).not.toContain("已安装")
    expect(document.body.querySelector('[aria-label="Codex 更多操作"]')).toBeNull()

    await clickButton("重新安装")

    expect(document.body.textContent).toContain("synapse-skill:codex:global")
  })

  it("opens an editor Skill directory from the path row", async () => {
    await renderModule()

    await clickButtonContaining("/Users/test/.agents/skills/synapse-skill")

    expect(showItemInFolder).toHaveBeenCalledWith("/Users/test/.agents/skills/synapse-skill")
  })

  it("opens the standard installer flow from the footer install action", async () => {
    await renderModule()

    await clickLastButton("安装")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill:none:global")
  })

  it("installs missing global targets in one batch", async () => {
    await renderModule()

    await clickButton("安装缺失项")

    expect(installSourceToEditorTargets).toHaveBeenCalledWith(expect.objectContaining({
      mode: "install",
      targets: [{ editorId: "codex", scope: "global" }],
    }))
  })

  it("shows failed batch targets and allows retry", async () => {
    installSourceToEditorTargets
      .mockResolvedValueOnce({
        results: [{
          target: { editorId: "codex", scope: "global" },
          status: "failed",
          error: "目标目录不可写",
        }],
      })
      .mockResolvedValueOnce({
        results: [{
          target: { editorId: "codex", scope: "global" },
          status: "installed",
        }],
      })
    await renderModule()

    await clickButton("安装缺失项")

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("目标目录不可写")
    })

    await clickButton("安装缺失项")

    expect(installSourceToEditorTargets).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("目标目录不可写")
    })
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SynapseSkillModule />)
    await Promise.resolve()
  })
}

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}

async function clickButtonContaining(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(text))
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}

async function clickLastButton(text: string): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((item) => item.textContent === text)
  const button = buttons.at(-1)
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}
