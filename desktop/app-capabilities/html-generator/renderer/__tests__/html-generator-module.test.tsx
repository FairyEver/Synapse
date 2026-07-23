/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const htmlGeneratorBridge = vi.hoisted(() => ({
  output: { choose: vi.fn(async () => "/tmp/report.html") },
  ejs: {
    generate: vi.fn(async () => ({
      ok: true as const,
      result: { html: "<h1>Report</h1>", size: 15 },
    })),
  },
  ejsFile: {
    generate: vi.fn(async () => ({
      ok: true as const,
      result: {
        output: {
          path: "/tmp/report.html",
          fileName: "report.html",
          format: "html" as const,
          encoding: "utf8" as const,
          size: 15,
          overwritten: false,
        },
      },
    })),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({ platform: "darwin" }),
  requireBridgeDomain: (domain: string) => {
    if (domain === "htmlGenerator") return htmlGeneratorBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({ tabs, value, onValueChange, actions, children }: {
    tabs?: readonly { id: string; label: string }[]
    value?: string
    onValueChange?: (value: string) => void
    actions?: ReactNode
    children: ReactNode
  }) => (
    <div>
      <div>{tabs?.map((tab) => <button key={tab.id} role="tab" data-slot="tabs-trigger" data-active={value === tab.id} onClick={() => onValueChange?.(tab.id)}>{tab.label}</button>)}</div>
      {actions}
      {children}
    </div>
  ),
}))

import { HtmlGeneratorModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

describe("HtmlGeneratorModule", () => {
  it("submits inline EJS and JSON, then displays source as read-only text without DOM preview", async () => {
    renderModule()
    await changeValue(document.querySelector("#html-generator-template"), "<h1><%= data.title %></h1>")
    await changeValue(document.querySelector("#html-generator-data"), "{\"title\":\"Report\"}")
    await clickActionButton("生成 HTML")

    expect(htmlGeneratorBridge.ejs.generate).toHaveBeenCalledWith({
      template: "<h1><%= data.title %></h1>",
      data: { title: "Report" },
    })
    expect(document.body.textContent).toContain("HTML 源码")
    expect(document.querySelector("h1")).toBeNull()
    const source = Array.from(document.querySelectorAll("textarea")).find((item) => item.readOnly)
    expect(source?.value).toBe("<h1>Report</h1>")
  })

  it("keeps shared drafts across tabs and submits the file-only fields", async () => {
    renderModule()
    await changeValue(document.querySelector("#html-generator-template"), "<%= data.title %>")
    await changeValue(document.querySelector("#html-generator-data"), "{\"title\":\"Report\"}")
    await clickTab("生成文件")
    await changeValue(document.querySelector("#html-generator-output"), "/tmp/report.html")
    await clickActionButton("生成 HTML 文件")

    expect(htmlGeneratorBridge.ejsFile.generate).toHaveBeenCalledWith({
      template: "<%= data.title %>",
      data: { title: "Report" },
      outputPath: "/tmp/report.html",
      overwrite: false,
    })
    expect(document.body.textContent).toContain("/tmp/report.html")
    expect(document.body.textContent).toContain("已覆盖")
    await clickTab("生成 HTML")
    expect((document.querySelector("#html-generator-template") as HTMLTextAreaElement).value).toBe("<%= data.title %>")
  })
})

function renderModule(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<HtmlGeneratorModule />))
}

async function clickTab(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-slot=tabs-trigger]"))
    .find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Tab not found: ${text}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }))
    button.click()
    await Promise.resolve()
  })
}

async function clickActionButton(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button:not([role=tab])"))
    .find((candidate) => candidate.textContent === text)
  await act(async () => {
    button?.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function changeValue(element: Element | null, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Form control not found.")
  }
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}
