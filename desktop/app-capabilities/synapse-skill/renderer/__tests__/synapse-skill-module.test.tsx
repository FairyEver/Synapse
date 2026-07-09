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
const resolveEditorInstallStatus = vi.hoisted(() => vi.fn(async () => ({
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

vi.mock("@/app-shell/editor-install-status", () => ({
  resolveEditorInstallStatus,
}))

vi.mock("@/app-shell/installers", () => ({
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
      {source.name}:{initialEditor?.id}:{initialSelection?.scope}
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
  resolveEditorInstallStatus.mockClear()
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
    expect(resolveEditorInstallStatus).toHaveBeenCalledWith({
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      contentType: "skill",
      projects: [],
      sourceFingerprint: "sha256:current",
      title: "Synapse Skill",
    })
    expect(document.body.textContent).toContain("全局安装状态")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("未安装")
    expect(document.body.textContent).toContain("/Users/test/.agents/skills/synapse-skill")
  })

  it("opens the single editor installer flow for missing targets", async () => {
    await renderModule()

    await clickButton("安装")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill:codex:global")
  })

  it("opens an editor Skill directory from the path row", async () => {
    await renderModule()

    await clickButtonContaining("/Users/test/.agents/skills/synapse-skill")

    expect(showItemInFolder).toHaveBeenCalledWith("/Users/test/.agents/skills/synapse-skill")
  })

  it("installs missing global targets in one batch", async () => {
    await renderModule()

    await clickButton("安装缺失项")

    expect(installSourceToEditorTargets).toHaveBeenCalledWith(expect.objectContaining({
      mode: "install",
      targets: [{ editorId: "codex", scope: "global" }],
    }))
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
