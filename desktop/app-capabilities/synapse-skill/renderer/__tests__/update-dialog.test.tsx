/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const preparedSource = {
  kind: "skill",
  origin: "prepared",
  sourceIdentity: "synapse-skill",
  name: "synapse-skill",
  title: "Synapse Skill",
  preparedSourceId: "synapse-skill:test",
  sourceFingerprint: "sha256:current",
} as const

const prepareInstallSource = vi.hoisted(() => vi.fn())
const inspectGlobalSkillInstallations = vi.hoisted(() => vi.fn())
const installSourceToEditorTargets = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

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
    if (domain === "synapseSkill") return { prepareInstallSource }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("sonner", () => ({
  toast: { success: toastSuccess },
}))

import { SynapseSkillUpdateDialogHost } from "../update-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  prepareInstallSource.mockResolvedValue(preparedSource)
  inspectGlobalSkillInstallations.mockResolvedValue({ entries: [] })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("SynapseSkillUpdateDialogHost", () => {
  it("does not open when no global installation needs an update", async () => {
    await renderDialog()

    expect(prepareInstallSource).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain("Synapse Skill 可更新")
  })

  it("does not open when global inspection fails", async () => {
    inspectGlobalSkillInstallations.mockRejectedValue(new Error("扫描失败"))

    await renderDialog()

    expect(document.body.textContent).not.toContain("Synapse Skill 可更新")
  })

  it("updates only global outdated installations and closes after success", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets.mockResolvedValue({
      results: [
        { target: { editorId: "codex", scope: "global" }, status: "installed" },
        { target: { editorId: "cursor", scope: "global" }, status: "installed" },
      ],
    })
    await renderDialog()

    expect(document.body.textContent).toContain("Synapse Skill 可更新")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("Cursor")
    expect(document.body.textContent).not.toContain("Windsurf")
    await clickButton("更新")

    expect(installSourceToEditorTargets).toHaveBeenCalledWith({
      mode: "update",
      source: preparedSource,
      targets: [
        { editorId: "codex", scope: "global" },
        { editorId: "cursor", scope: "global" },
      ],
    })
    expect(document.body.textContent).not.toContain("Synapse Skill 可更新")
    expect(toastSuccess).toHaveBeenCalledWith("Synapse Skill 已更新")
  })

  it("keeps failed installations and retries only those targets", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets
      .mockResolvedValueOnce({
        results: [
          { target: { editorId: "codex", scope: "global" }, status: "installed" },
          { target: { editorId: "cursor", scope: "global" }, status: "failed", error: "目录不可写" },
        ],
      })
      .mockResolvedValueOnce({
        results: [{ target: { editorId: "cursor", scope: "global" }, status: "installed" }],
      })
    await renderDialog()

    await clickButton("更新")
    expect(document.body.textContent).toContain("部分更新失败")
    expect(document.body.textContent).toContain("目录不可写")
    expect(document.body.textContent).not.toContain("Codex")

    await clickButton("重试失败项")
    expect(installSourceToEditorTargets).toHaveBeenLastCalledWith({
      mode: "update",
      source: preparedSource,
      targets: [{ editorId: "cursor", scope: "global" }],
    })
    expect(toastSuccess).toHaveBeenCalledWith("Synapse Skill 已更新")
  })

  it("prevents closing and duplicate submission while updating", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    let finishUpdate!: (value: { results: never[] }) => void
    installSourceToEditorTargets.mockReturnValue(new Promise((resolve) => {
      finishUpdate = resolve
    }))
    await renderDialog()

    await clickButton("更新")

    const updatingButton = findButton("正在更新")
    const laterButton = findButton("稍后")
    expect(updatingButton.disabled).toBe(true)
    expect(laterButton.disabled).toBe(true)
    expect(document.body.querySelector('[data-slot="dialog-close"]')).toBeNull()
    laterButton.click()
    updatingButton.click()
    expect(installSourceToEditorTargets).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Synapse Skill 可更新")

    await act(async () => {
      finishUpdate({ results: [] })
      await Promise.resolve()
    })
  })

  it("does not check or prompt again after dismissal in the current process", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    await renderDialog()

    await clickButton("稍后")

    act(() => roots.pop()?.unmount())
    await renderDialog()

    expect(document.body.textContent).not.toContain("Synapse Skill 可更新")
    expect(prepareInstallSource).toHaveBeenCalledTimes(1)
    expect(installSourceToEditorTargets).not.toHaveBeenCalled()
  })
})

function createInstallEntries() {
  return [
    {
      editorId: "codex",
      editorLabel: "Codex",
      scope: "global",
      status: "needs_update",
      targetPath: "/Users/test/.agents/skills/synapse-skill",
      message: null,
    },
    {
      editorId: "cursor",
      editorLabel: "Cursor",
      scope: "global",
      status: "needs_update",
      targetPath: "/Users/test/.cursor/skills/synapse-skill",
      message: null,
    },
    {
      editorId: "windsurf",
      editorLabel: "Windsurf",
      scope: "global",
      status: "not_installed",
      targetPath: "/Users/test/.codeium/windsurf/skills/synapse-skill",
      message: null,
    },
    {
      editorId: "codex",
      editorLabel: "Codex",
      scope: "project",
      status: "needs_update",
      targetPath: "/project/.agents/skills/synapse-skill",
      message: null,
    },
  ]
}

async function renderDialog(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SynapseSkillUpdateDialogHost />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickButton(text: string): Promise<void> {
  const button = findButton(text)
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findButton(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
