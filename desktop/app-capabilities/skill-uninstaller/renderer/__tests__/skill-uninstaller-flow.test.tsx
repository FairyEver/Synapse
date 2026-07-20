/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SkillUninstallCandidate, SkillUninstallScanResult } from "../../shared/schema"
import { SkillUninstallerFlow, type SkillUninstallerFlowProps } from "../skill-uninstaller-flow"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
HTMLElement.prototype.scrollIntoView = vi.fn()

const mocks = vi.hoisted(() => ({
  cancelUninstall: vi.fn(),
  cancelScan: vi.fn(),
  chooseDirectory: vi.fn(),
  error: vi.fn(),
  scan: vi.fn(),
  scanNames: vi.fn(),
  uninstall: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "skillUninstaller") {
      return {
        cancelUninstall: mocks.cancelUninstall,
        cancelScan: mocks.cancelScan,
        scan: mocks.scan,
        scanNames: mocks.scanNames,
        uninstall: mocks.uninstall,
      }
    }
    if (domain === "settings") return { repository: { chooseDirectory: mocks.chooseDirectory } }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: mocks.error,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let roots: Root[] = []

function candidate(path: string): SkillUninstallCandidate {
  return {
    path,
    name: "jenkins",
    editorIds: ["codex"],
    source: "external",
  }
}

async function renderFlow(props: Partial<SkillUninstallerFlowProps> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <SkillUninstallerFlow
        mode="page"
        initialQuery={{ name: "jenkins" }}
        {...props}
      />,
    )
  })
}

function getButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function click(text: string) {
  await act(async () => {
    getButton(text).dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

async function clickCheckbox(label: string) {
  const checkbox = document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`)
  if (!checkbox) throw new Error(`Checkbox not found: ${label}`)
  await act(async () => {
    checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cancelScan.mockResolvedValue({ cancelled: true })
  mocks.cancelUninstall.mockResolvedValue({ cancelled: true })
  mocks.chooseDirectory.mockResolvedValue(null)
  mocks.scanNames.mockResolvedValue({ names: [], complete: true, warnings: [] })
})

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount())
  })
  roots = []
  document.body.innerHTML = ""
})

describe("SkillUninstallerFlow", () => {
  it("preloads editable name options and supports keyboard selection", async () => {
    mocks.scanNames.mockResolvedValue({ names: ["jenkins"], complete: true, warnings: [] })
    await renderFlow({ initialQuery: { name: "" } })
    const input = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    if (!input) throw new Error("Skill name input not found")

    await act(async () => {
      await Promise.resolve()
      input.focus()
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(mocks.scanNames).toHaveBeenCalledWith({
      scanId: expect.any(String),
    })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(input.value).toBe("jenkins")
  })

  it("does not preload name options for a read-only flow", async () => {
    await renderFlow({ queryReadOnly: true })
    expect(mocks.scanNames).not.toHaveBeenCalled()
  })

  it("refreshes name options after choosing a custom search root", async () => {
    mocks.chooseDirectory.mockResolvedValue("/chosen ")
    await renderFlow({ initialQuery: { name: "" } })
    await click("选择")

    expect(mocks.scanNames).toHaveBeenLastCalledWith({
      scanId: expect.any(String),
      searchRootPath: "/chosen ",
    })
  })

  it("keeps the exact custom root when starting a scan", async () => {
    mocks.scan.mockResolvedValue({ candidates: [], complete: true, warnings: [] })
    await renderFlow({ initialQuery: { name: "jenkins", searchRootPath: "/skills " } })

    await click("扫描")

    expect(mocks.scan).toHaveBeenCalledWith({
      scanId: expect.any(String),
      query: { name: "jenkins", searchRootPath: "/skills " },
    })
  })

  it("refreshes name options after a manually entered search root loses focus", async () => {
    await renderFlow({ initialQuery: { name: "" } })
    const searchRootInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-search-root")
    const nameInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    if (!searchRootInput || !nameInput) throw new Error("Query inputs not found")

    await act(async () => {
      searchRootInput.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(searchRootInput, "/typed ")
      searchRootInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      nameInput.focus()
    })

    expect(mocks.scanNames).toHaveBeenLastCalledWith({
      scanId: expect.any(String),
      searchRootPath: "/typed ",
    })
  })

  it("ignores stale name options after the search root changes", async () => {
    let resolveGlobal!: (result: { names: string[]; complete: boolean; warnings: string[] }) => void
    let resolveCustom!: (result: { names: string[]; complete: boolean; warnings: string[] }) => void
    mocks.scanNames.mockImplementation(({ searchRootPath }: { searchRootPath?: string }) => (
      new Promise((resolve) => {
        if (searchRootPath) resolveCustom = resolve
        else resolveGlobal = resolve
      })
    ))
    mocks.chooseDirectory.mockResolvedValue("/chosen")
    await renderFlow({ initialQuery: { name: "" } })
    await click("选择")

    await act(async () => {
      resolveCustom({ names: ["current-skill"], complete: true, warnings: [] })
      await Promise.resolve()
      resolveGlobal({ names: ["stale-skill"], complete: true, warnings: [] })
    })
    const nameInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    await act(async () => nameInput?.focus())

    expect(document.body.textContent).toContain("current-skill")
    expect(document.body.textContent).not.toContain("stale-skill")
  })

  it("starts with no selected candidates and supports select all", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })

    await renderFlow()
    await click("扫描")

    expect(document.querySelectorAll('[role="checkbox"][aria-label^="选择"]').length).toBe(2)
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).not.toContain("codex")
    const scanButton = getButton("扫描")
    const separator = document.querySelector<HTMLElement>('[data-slot="separator"]')
    const allCheckbox = document.querySelector<HTMLElement>('[role="checkbox"][aria-label="全选"]')
    const candidateCheckbox = document.querySelector<HTMLElement>('[role="checkbox"][aria-label^="选择"]')
    expect(scanButton.parentElement?.className).toContain("justify-end")
    expect(separator).toBeInstanceOf(HTMLElement)
    expect(scanButton.compareDocumentPosition(separator as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0)
    expect((separator?.compareDocumentPosition(allCheckbox as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0)
    expect(allCheckbox?.parentElement?.className).toContain("gap-3")
    expect(candidateCheckbox?.parentElement?.className).toContain("gap-3")
    expect(getButton("移到废纸篓").disabled).toBe(true)
    await clickCheckbox("全选")
    expect(getButton("移到废纸篓（2）").disabled).toBe(false)
  })

  it("confirms before submitting and keeps failed rows", async () => {
    const onCompleted = vi.fn()
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockResolvedValue({
      results: [
        { path: "/one/jenkins", status: "trashed" },
        { path: "/two/jenkins", status: "failed", error: "没有写入该位置的权限。" },
      ],
    })

    await renderFlow({ onCompleted })
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（2）")

    expect(mocks.uninstall).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("已选 2 个 Skill")
    await click("确认移到废纸篓")

    expect(mocks.uninstall).toHaveBeenCalledWith({
      operationId: expect.any(String),
      targets: expect.arrayContaining([
        { query: { name: "jenkins" }, path: "/one/jenkins" },
        { query: { name: "jenkins" }, path: "/two/jenkins" },
      ]),
    })
    expect(document.body.textContent).not.toContain("/one/jenkins")
    expect(document.body.textContent).toContain("没有写入该位置的权限。")
    expect(document.body.textContent).toContain("已移到废纸篓 1 个，未完成 1 个。")
    expect(onCompleted).toHaveBeenCalledWith({
      results: [
        { path: "/one/jenkins", status: "trashed" },
        { path: "/two/jenkins", status: "failed", error: "没有写入该位置的权限。" },
      ],
    })
  })

  it("combines partial failure and install-status warnings", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockResolvedValue({
      results: [
        { path: "/one/jenkins", status: "trashed", warning: "已移到废纸篓，安装状态刷新失败。" },
        { path: "/two/jenkins", status: "skipped", error: "目标已发生变化，已跳过。" },
      ],
    })
    await renderFlow()
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（2）")
    await click("确认移到废纸篓")

    expect(document.body.textContent).toContain("已移到废纸篓 1 个，未完成 1 个。")
    expect(document.body.textContent).toContain("安装状态刷新失败")
  })

  it("preserves result notices when the completion refresh also fails", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockResolvedValue({
      results: [
        { path: "/one/jenkins", status: "trashed", warning: "已移到废纸篓，安装状态刷新失败。" },
        { path: "/two/jenkins", status: "failed", error: "没有写入该位置的权限。" },
      ],
    })
    await renderFlow({ onCompleted: vi.fn().mockRejectedValue(new Error("refresh failed")) })
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（2）")
    await click("确认移到废纸篓")

    expect(document.body.textContent).toContain("已移到废纸篓 1 个，未完成 1 个。")
    expect(document.body.textContent).toContain("安装状态刷新失败")
    expect(document.body.textContent).toContain("刷新失败")
  })

  it("preserves a name edited while the directory chooser is open", async () => {
    let resolveDirectory!: (value: string) => void
    mocks.chooseDirectory.mockImplementation(() => new Promise<string>((resolve) => {
      resolveDirectory = resolve
    }))
    await renderFlow()
    const nameInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    if (!nameInput) throw new Error("Skill name input not found")
    await click("选择")
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(nameInput, "updated")
      nameInput.dispatchEvent(new Event("input", { bubbles: true }))
      resolveDirectory("/chosen")
    })

    expect(nameInput.value).toBe("updated")
    expect(document.querySelector<HTMLInputElement>("#skill-uninstaller-search-root")?.value).toBe("/chosen")
  })

  it("shows incomplete scans, warnings, and an empty result", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [],
      complete: false,
      warnings: ["部分目录无法读取。"],
    } satisfies SkillUninstallScanResult)

    await renderFlow()
    await click("扫描")

    expect(document.body.textContent).toContain("扫描未完成")
    expect(document.body.textContent).toContain("部分目录无法读取。")
    expect(document.body.textContent).toContain("未找到匹配的 Skill。")
  })

  it("discards partial results returned after cancelling an active scan", async () => {
    let resolveScan: ((result: SkillUninstallScanResult) => void) | undefined
    mocks.scan.mockImplementation(() => new Promise<SkillUninstallScanResult>((resolve) => {
      resolveScan = resolve
    }))

    await renderFlow()
    await click("扫描")
    const request = mocks.scan.mock.calls[0]?.[0]
    expect(getButton("取消扫描")).toBeTruthy()

    await click("取消扫描")

    expect(mocks.cancelScan).toHaveBeenCalledWith({ scanId: request.scanId })

    await act(async () => {
      resolveScan?.({
        candidates: [candidate("/late/jenkins")],
        complete: false,
        warnings: ["扫描已取消。"],
      })
    })
    expect(document.body.textContent).not.toContain("/late/jenkins")
    expect(document.body.textContent).not.toContain("扫描未完成")
    expect(getButton("扫描")).toBeTruthy()
  })

  it("uses the query snapshot that discovered selected targets", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockResolvedValue({ results: [{ path: "/one/jenkins", status: "trashed" }] })
    await renderFlow()
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（1）")
    await click("确认移到废纸篓")

    expect(mocks.uninstall).toHaveBeenCalledWith({
      operationId: expect.any(String),
      targets: [{ query: { name: "jenkins" }, path: "/one/jenkins" }],
    })
  })

  it("stops an active uninstall and keeps unprocessed candidates", async () => {
    let resolveUninstall!: (result: {
      results: Array<{ path: string; status: "trashed" }>
      cancelled: true
    }) => void
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockImplementation(() => new Promise((resolve) => {
      resolveUninstall = resolve
    }))
    mocks.cancelUninstall.mockImplementation(async () => {
      resolveUninstall({
        results: [{ path: "/one/jenkins", status: "trashed" }],
        cancelled: true,
      })
      return { cancelled: true }
    })

    await renderFlow()
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（2）")
    await click("确认移到废纸篓")
    expect(document.body.textContent).toContain("已处理 0/2 个")
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("已处理 0/2 个")

    await click("停止处理")

    expect(mocks.cancelUninstall).toHaveBeenCalledWith({
      operationId: mocks.uninstall.mock.calls[0]?.[0].operationId,
    })
    expect(document.body.textContent).not.toContain("/one/jenkins")
    expect(document.body.textContent).toContain("/two/jenkins")
    expect(document.body.textContent).toContain("已停止，未处理 1 个。")
  })

  it("clears stale scan results when the editable query changes", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins")],
      complete: true,
      warnings: [],
    })
    await renderFlow()
    await click("扫描")
    const input = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    if (!input) throw new Error("Skill name input not found")

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "other")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(document.body.textContent).not.toContain("/one/jenkins")
  })

  it("does not misreport a completed trash when the caller refresh fails", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins")],
      complete: true,
      warnings: [],
    })
    mocks.uninstall.mockResolvedValue({ results: [{ path: "/one/jenkins", status: "trashed" }] })
    await renderFlow({ onCompleted: vi.fn().mockRejectedValue(new Error("refresh failed")) })
    await click("扫描")
    await clickCheckbox("全选")
    await click("移到废纸篓（1）")
    await click("确认移到废纸篓")

    expect(document.body.textContent).toContain("已移到废纸篓，刷新失败。")
    expect(document.body.textContent).not.toContain("移到废纸篓失败。")
  })

  it("validates an empty name and labels the default search scope", async () => {
    await renderFlow({ initialQuery: { name: "" } })
    expect(document.querySelector<HTMLInputElement>("#skill-uninstaller-search-root")?.placeholder)
      .toBe("全局 Skill 目录")
    await click("扫描")
    expect(document.body.textContent).toContain("请输入 Skill 名称。")
  })

  it("labels candidates without editor attribution as other locations", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [{ ...candidate("/other/jenkins"), editorIds: [] }],
      complete: true,
      warnings: [],
    })
    await renderFlow()
    await click("扫描")
    expect(document.body.textContent).toContain("其它位置")
  })

  it("cancels and discards an active page scan when the query is edited", async () => {
    let resolveScan: ((result: SkillUninstallScanResult) => void) | undefined
    mocks.scan.mockImplementation(() => new Promise<SkillUninstallScanResult>((resolve) => {
      resolveScan = resolve
    }))
    await renderFlow()
    await click("扫描")
    const request = mocks.scan.mock.calls[0]?.[0]
    const input = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    if (!input) throw new Error("Skill name input not found")

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      valueSetter?.call(input, "jenkins-updated")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(mocks.cancelScan).toHaveBeenCalledWith({ scanId: request.scanId })
    expect(getButton("扫描")).toBeTruthy()
    await act(async () => {
      resolveScan?.({ candidates: [candidate("/stale/jenkins")], complete: false, warnings: ["扫描已取消。"] })
    })
    expect(document.body.textContent).not.toContain("/stale/jenkins")
  })

  it("cancels an active scan when unmounted", async () => {
    mocks.scan.mockImplementation(() => new Promise<SkillUninstallScanResult>(() => undefined))
    await renderFlow()
    await click("扫描")
    const request = mocks.scan.mock.calls[0]?.[0]

    await act(async () => {
      roots[0]?.unmount()
    })
    roots = []

    expect(mocks.cancelScan).toHaveBeenCalledWith({ scanId: request.scanId })
  })
})
