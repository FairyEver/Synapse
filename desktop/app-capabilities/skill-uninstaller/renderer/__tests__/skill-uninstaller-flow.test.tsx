/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SkillUninstallCandidate, SkillUninstallScanResult } from "../../shared/schema"
import { SkillUninstallerFlow, type SkillUninstallerFlowProps } from "../skill-uninstaller-flow"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  cancelScan: vi.fn(),
  chooseDirectory: vi.fn(),
  error: vi.fn(),
  scan: vi.fn(),
  uninstall: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "skillUninstaller") {
      return {
        cancelScan: mocks.cancelScan,
        scan: mocks.scan,
        uninstall: mocks.uninstall,
      }
    }
    if (domain === "repository") return { chooseDirectory: mocks.chooseDirectory }
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
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  mocks.chooseDirectory.mockResolvedValue(null)
})

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount())
  })
  roots = []
  document.body.innerHTML = ""
})

describe("SkillUninstallerFlow", () => {
  it("starts with no selected candidates and supports select all", async () => {
    mocks.scan.mockResolvedValue({
      candidates: [candidate("/one/jenkins"), candidate("/two/jenkins")],
      complete: true,
      warnings: [],
    })

    await renderFlow()
    await click("扫描")

    expect(document.querySelectorAll('[role="checkbox"][aria-label^="选择"]').length).toBe(2)
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
      targets: expect.arrayContaining([
        { query: { name: "jenkins" }, path: "/one/jenkins" },
        { query: { name: "jenkins" }, path: "/two/jenkins" },
      ]),
    })
    expect(document.body.textContent).not.toContain("/one/jenkins")
    expect(document.body.textContent).toContain("没有写入该位置的权限。")
    expect(onCompleted).toHaveBeenCalledWith({
      results: [
        { path: "/one/jenkins", status: "trashed" },
        { path: "/two/jenkins", status: "failed", error: "没有写入该位置的权限。" },
      ],
    })
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

  it("cancels an active scan", async () => {
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
    expect(getButton("扫描")).toBeTruthy()

    await act(async () => {
      resolveScan?.({ candidates: [candidate("/late/jenkins")], complete: true, warnings: [] })
    })
    expect(document.body.textContent).not.toContain("/late/jenkins")
  })

  it("keeps an active page scan cancellable when the query is edited", async () => {
    mocks.scan.mockImplementation(() => new Promise<SkillUninstallScanResult>(() => undefined))
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

    expect(getButton("取消扫描")).toBeTruthy()
    await click("取消扫描")
    expect(mocks.cancelScan).toHaveBeenCalledWith({ scanId: request.scanId })
    expect(getButton("扫描")).toBeTruthy()
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
