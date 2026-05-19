/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SkillCreateDialog } from "../skill-create-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function renderDialog() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const props = {
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    open: true,
  }
  return { root, props }
}

function inputByLabel(label: string): HTMLInputElement {
  const labels = [...document.querySelectorAll("label")]
  const target = labels.find((item) => item.textContent === label)
  if (!target?.htmlFor) throw new Error(`Input label not found: ${label}`)
  const input = document.getElementById(target.htmlFor)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`)
  return input
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function dispatchDrop(target: Element, filePromise: Promise<File>): void {
  const entry = {
    isDirectory: false,
    isFile: true,
    fullPath: "/notes.md",
    file: (success: (file: File) => void, failure: (error: unknown) => void) => {
      filePromise.then(success, failure)
    },
  } as unknown as FileSystemFileEntry
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      dropEffect: "copy",
      files: [],
      items: [{ kind: "file", webkitGetAsEntry: () => entry }],
    },
  })
  target.dispatchEvent(event)
}

describe("SkillCreateDialog", () => {
  it("keeps submit disabled after a cancelled close while attachments are still being collected", async () => {
    const pendingFile = deferred<File>()
    const { root, props } = renderDialog()

    await act(async () => {
      root.render(<SkillCreateDialog {...props} />)
    })

    await act(async () => {
      changeInput(inputByLabel("中文名称"), "API Helper")
    })

    const dropTarget = [...document.querySelectorAll("p")]
      .find((element) => element.textContent === "拖入文件或文件夹")
    if (!dropTarget) throw new Error("Drop target not found")

    await act(async () => {
      dispatchDrop(dropTarget, pendingFile.promise)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("正在整理附件...")
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("保存"))
    expect(saveButton?.disabled).toBe(true)

    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "取消")
    await act(async () => {
      cancelButton?.click()
    })

    expect(document.body.textContent).toContain("放弃当前填写内容？")
    expect(document.body.textContent).toContain("正在整理附件...")
    expect(saveButton?.disabled).toBe(true)

    await act(async () => {
      pendingFile.resolve(new File(["# Notes"], "notes.md", { type: "text/markdown" }))
      await pendingFile.promise
    })
  })
})
