/**
 * @vitest-environment jsdom
 */
import { act, type MutableRefObject, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GitCredentialDialog } from "../git-credential-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

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

describe("GitCredentialDialog", () => {
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

  it("submits only username and password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    const onOpenChange = vi.fn()
    await renderDialog(roots, { onOpenChange, onSubmit })

    await changeInput("账号", "writer")
    await changeInput("密码", "secret")
    await click(findDialogButton("保存"))

    expect(onSubmit).toHaveBeenCalledWith({
      username: "writer",
      password: "secret",
    })
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("provider")
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("host")
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("protocol")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("preserves password whitespace when submitting", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    await renderDialog(roots, { onSubmit })

    await changeInput("账号", " writer ")
    await changeInput("密码", "  secret  ")
    await click(findDialogButton("保存"))

    expect(onSubmit).toHaveBeenCalledWith({
      username: "writer",
      password: "  secret  ",
    })
  })

  it("clears password when submit fails", async () => {
    const onSubmit = vi.fn().mockResolvedValue("请先设置安全的凭证保存方式。")
    await renderDialog(roots, { onSubmit })

    await changeInput("账号", "writer")
    await changeInput("密码", "secret")
    await click(findDialogButton("保存"))

    expect(findDialogText()).toContain("请先设置安全的凭证保存方式。")
    expect(findInput("密码").value).toBe("")
  })

  it("shows rejected submit error messages", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("请先设置安全的凭证保存方式。"))
    await renderDialog(roots, { onSubmit })

    await changeInput("账号", "writer")
    await changeInput("密码", "secret")
    await click(findDialogButton("保存"))

    expect(findDialogText()).toContain("请先设置安全的凭证保存方式。")
    expect(findInput("密码").value).toBe("")
  })

  it("opens the token page", async () => {
    bridge.shell.openExternal.mockResolvedValue(undefined)
    await renderDialog(roots, {
      mode: "github-token",
      tokenUrl: "https://github.com/settings/tokens",
    })

    await click(findDialogButton("打开令牌页面"))

    expect(bridge.shell.openExternal).toHaveBeenCalledWith("https://github.com/settings/tokens")
  })

  it("shows token page open error messages", async () => {
    bridge.shell.openExternal.mockRejectedValue(new Error("浏览器打开失败"))
    await renderDialog(roots, {
      mode: "github-token",
      tokenUrl: "https://github.com/settings/tokens",
    })

    await click(findDialogButton("打开令牌页面"))

    expect(findDialogText()).toContain("浏览器打开失败")
  })
})

async function renderDialog(
  roots: Root[],
  props: Partial<Parameters<typeof GitCredentialDialog>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <GitCredentialDialog
        open
        onOpenChange={vi.fn()}
        host="github.com"
        mode="generic"
        provider="github"
        onSubmit={vi.fn().mockResolvedValue(null)}
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
