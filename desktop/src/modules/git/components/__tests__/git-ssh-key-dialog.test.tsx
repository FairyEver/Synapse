/**
 * @vitest-environment jsdom
 */
import { act, type MutableRefObject, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GitSshKeyDialog } from "../git-ssh-key-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: vi.fn(() => "button"),
  track: vi.fn(),
  mergeRefs:
    <T,>(...refs: Array<Ref<T> | undefined>) =>
    (value: T) => {
      for (const ref of refs) {
        if (typeof ref === "function") {
          ref(value)
        } else if (ref) {
          ;(ref as MutableRefObject<T>).current = value
        }
      }
    },
}))

describe("GitSshKeyDialog", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
      await flush()
    })
  })

  it("shows rejected generate error messages", async () => {
    const onGenerate = vi.fn().mockRejectedValue(new Error("SSH 失败详情"))
    await renderDialog(roots, { onGenerate })

    await changeInput("邮箱", "writer@example.com")
    await click(findDialogButton("生成"))

    expect(findDialogText()).toContain("SSH 失败详情")
  })

  it("requires an email before generating", async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)
    await renderDialog(roots, { onGenerate })

    await click(findDialogButton("生成"))

    expect(findDialogText()).toContain("请输入邮箱。")
    expect(onGenerate).not.toHaveBeenCalled()
  })
})

async function renderDialog(
  roots: Root[],
  props: Partial<Parameters<typeof GitSshKeyDialog>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <GitSshKeyDialog
        open
        onOpenChange={vi.fn()}
        defaultEmail={null}
        onGenerate={vi.fn().mockResolvedValue(null)}
        {...props}
      />,
    )
    await flush()
  })
}

function findDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error("Dialog not found")
  return dialog
}

function findDialogText(): string {
  return findDialog().textContent ?? ""
}

function findDialogButton(label: string): HTMLButtonElement {
  const button = Array.from(findDialog().querySelectorAll("button")).find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Dialog button not found: ${label}`)
  return button
}

function findInput(label: string): HTMLInputElement {
  const input = Array.from(findDialog().querySelectorAll("input")).find((item) => {
    const id = item.getAttribute("id")
    return id ? findDialog().querySelector(`label[for="${id}"]`)?.textContent === label : false
  })
  if (!input) throw new Error(`Input not found: ${label}`)
  return input
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await flush()
  })
}

async function changeInput(label: string, value: string) {
  const input = findInput(label)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
