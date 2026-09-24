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
const releaseInstallSource = vi.hoisted(() => vi.fn(async () => undefined))
const inspectGlobalSkillInstallations = vi.hoisted(() => vi.fn())
const installSourceToEditorTargets = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/installers", () => ({
  inspectGlobalSkillInstallations,
  installSourceToEditorTargets,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "synapseSkill") return { prepareInstallSource, releaseInstallSource }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("sonner", () => ({
  toast: { error: toastError, warning: toastWarning },
}))

import { SynapseSkillAutoUpdateHost } from "../auto-update"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  prepareInstallSource.mockResolvedValue(preparedSource)
  inspectGlobalSkillInstallations.mockResolvedValue({ entries: [] })
  installSourceToEditorTargets.mockResolvedValue({ results: [] })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("SynapseSkillAutoUpdateHost", () => {
  it("does not install when no global installation needs an update", async () => {
    await renderHost()

    expect(prepareInstallSource).toHaveBeenCalledTimes(1)
    expect(installSourceToEditorTargets).not.toHaveBeenCalled()
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("does not install when inspection fails", async () => {
    inspectGlobalSkillInstallations.mockRejectedValue(new Error("扫描失败"))

    await renderHost()

    expect(installSourceToEditorTargets).not.toHaveBeenCalled()
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
  })

  it("silently updates only global outdated installations", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets.mockResolvedValue({
      results: [
        { target: { editorId: "codex", scope: "global" }, status: "installed" },
        { target: { editorId: "cursor", scope: "global" }, status: "installed" },
      ],
    })

    await renderHost()

    expect(installSourceToEditorTargets).toHaveBeenCalledWith({
      mode: "update",
      source: preparedSource,
      targets: [
        { editorId: "codex", scope: "global" },
        { editorId: "cursor", scope: "global" },
      ],
    })
    expect(document.body.textContent).toBe("")
    expect(toastError).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
  })

  it("reports failed installations without retrying successful ones", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets.mockResolvedValue({
      results: [
        { target: { editorId: "codex", scope: "global" }, status: "installed" },
        { target: { editorId: "cursor", scope: "global" }, status: "failed", error: "目录不可写" },
      ],
    })

    await renderHost()

    expect(toastError).toHaveBeenCalledWith("Synapse Skill 更新失败", {
      description: "请在 Synapse Skill 中重试。",
    })
    expect(installSourceToEditorTargets).toHaveBeenCalledTimes(1)
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
  })

  it("shows warnings that require manual inspection", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets.mockResolvedValue({
      results: [{
        target: { editorId: "codex", scope: "global" },
        status: "installed",
        result: { targetPath: "/target", warning: "旧 Skill 备份需要手动检查" },
      }],
    })

    await renderHost()

    expect(toastWarning).toHaveBeenCalledWith("Synapse Skill 更新完成，需检查", {
      description: "旧 Skill 备份需要手动检查",
    })
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
  })

  it("checks only once per session even after a failed update", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    installSourceToEditorTargets.mockRejectedValue(new Error("目录不可写"))
    await renderHost()

    act(() => roots.pop()?.unmount())
    await renderHost()

    expect(prepareInstallSource).toHaveBeenCalledTimes(1)
    expect(installSourceToEditorTargets).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("keeps the prepared source until an in-progress update completes", async () => {
    inspectGlobalSkillInstallations.mockResolvedValue({ entries: createInstallEntries() })
    let finishUpdate!: (value: { results: never[] }) => void
    installSourceToEditorTargets.mockReturnValue(new Promise((resolve) => {
      finishUpdate = resolve
    }))

    await renderHost()
    act(() => roots.pop()?.unmount())

    expect(releaseInstallSource).not.toHaveBeenCalled()
    await act(async () => {
      finishUpdate({ results: [] })
      await Promise.resolve()
    })
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
  })

  it("prepares a fresh source if inspection was disabled before it completed", async () => {
    const refreshedSource = { ...preparedSource, preparedSourceId: "synapse-skill:refreshed" }
    let resolveFirstInspection!: (value: { entries: ReturnType<typeof createInstallEntries> }) => void
    prepareInstallSource
      .mockResolvedValueOnce(preparedSource)
      .mockResolvedValueOnce(refreshedSource)
    inspectGlobalSkillInstallations
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstInspection = resolve }))
      .mockResolvedValueOnce({ entries: createInstallEntries() })

    const root = await renderHost()
    await rerenderHost(root, false)
    await act(async () => {
      resolveFirstInspection({ entries: createInstallEntries() })
      await Promise.resolve()
    })
    await rerenderHost(root, true)

    expect(prepareInstallSource).toHaveBeenCalledTimes(2)
    expect(releaseInstallSource).toHaveBeenCalledWith(preparedSource.preparedSourceId)
    expect(installSourceToEditorTargets).toHaveBeenCalledWith(expect.objectContaining({
      source: refreshedSource,
    }))
  })
})

function createInstallEntries() {
  return [
    { editorId: "codex", editorLabel: "Codex", scope: "global", status: "needs_update", targetPath: "/codex", message: null },
    { editorId: "cursor", editorLabel: "Cursor", scope: "global", status: "needs_update", targetPath: "/cursor", message: null },
    { editorId: "windsurf", editorLabel: "Windsurf", scope: "global", status: "not_installed", targetPath: "/windsurf", message: null },
    { editorId: "hermes", editorLabel: "Hermes", scope: "global", status: "conflict", targetPath: "/hermes", message: null },
    { editorId: "claude-code", editorLabel: "CC/Synapse", scope: "global", status: "external_same_name", targetPath: "/claude", message: null },
    { editorId: "codex", editorLabel: "Codex", scope: "project", status: "needs_update", targetPath: "/project", message: null },
  ]
}

async function renderHost(): Promise<Root> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await rerenderHost(root, true)
  return root
}

async function rerenderHost(root: Root, enabled: boolean): Promise<void> {
  await act(async () => {
    root.render(<SynapseSkillAutoUpdateHost enabled={enabled} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}
