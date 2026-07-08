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
  })),
}))

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

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/components/editor-icon", () => ({
  EditorIcon: ({ editorId }: { editorId: string }) => <span data-editor-icon={editorId} />,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "synapseSkill") return synapseSkillBridge
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
  SharedInstallerFlow: ({ source }: { source: typeof preparedSource }) => (
    <div data-testid="installer-flow">{source.name}</div>
  ),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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
  loadEditors.mockClear()
  resolveEditorInstallStatus.mockClear()
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
      title: "Synapse Skill",
    })
    expect(document.body.textContent).toContain("全局安装状态")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("未安装")
    expect(document.body.textContent).toContain("/Users/test/.agents/skills/synapse-skill")
  })

  it("prepares the bundled Synapse Skill source before installing", async () => {
    await renderModule()

    await clickButton("安装 Synapse Skill")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill")
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
