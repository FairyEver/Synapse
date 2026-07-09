/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SecretsModule } from ".."

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  secrets: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    onChanged: vi.fn(),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("../../../../src/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "secrets") return mocks.secrets
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("../../../../src/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

const savedSecret = {
  id: "secret-1",
  name: "TOKEN",
  description: "api token",
  hasValue: true,
}

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
  mocks.secrets.list.mockResolvedValue({ secrets: [], total: 0 })
  mocks.secrets.get.mockResolvedValue({ ...savedSecret, value: "super-secret" })
  mocks.secrets.create.mockResolvedValue(savedSecret)
  mocks.secrets.update.mockResolvedValue(savedSecret)
  mocks.secrets.delete.mockResolvedValue(savedSecret)
  mocks.secrets.onChanged.mockReturnValue(() => undefined)
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount()
    })
  }
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("SecretsModule", () => {
  it("renders empty state and opens create dialog", async () => {
    await renderSecretsModule()

    expect(document.body.textContent).toContain("暂无密钥")

    await act(async () => {
      clickButton("新增密钥")
    })

    expect(document.body.textContent).toContain("新增密钥")
    expect(document.querySelector<HTMLInputElement>("#secret-name")).not.toBeNull()
    expect(document.querySelector<HTMLInputElement>("#secret-value")).not.toBeNull()
  })

  it("lists secrets without values", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    expect(document.body.textContent).toContain("TOKEN")
    expect(document.body.textContent).toContain("api token")
    expect(document.body.textContent).toContain("值")
    expect(document.body.textContent).toContain("••••••••")
    expect(document.body.textContent).not.toContain("super-secret")
  })

  it("opens a dialog with the full secret value and copies it", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    expect(document.body.textContent).toContain("TOKEN")
    expect(document.body.textContent).not.toContain("super-secret")
    expect(document.querySelector("table")?.textContent).toContain("••••••••")

    await act(async () => {
      clickButtonByLabel("显示密钥值：TOKEN")
      await Promise.resolve()
    })

    expect(mocks.secrets.get).toHaveBeenCalledWith({ name: "TOKEN", includeValue: true })
    expect(document.body.textContent).toContain("super-secret")
    expect(document.querySelector("table")?.textContent).not.toContain("super-secret")
    expect(document.body.textContent).toContain("TOKEN")
    expect(document.body.textContent).toContain("值已明文显示。")

    const textarea = textareaByLabel("密钥值")
    expect(textarea.readOnly).toBe(true)

    const copyButton = buttonByText("复制")
    expect(document.activeElement).toBe(copyButton)

    await act(async () => {
      clickButton("复制")
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("super-secret")
    expect(mocks.toast.success).toHaveBeenCalledWith("已复制")
    expect(document.body.textContent).toContain("已复制")

    await act(async () => {
      clickButton("关闭")
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("super-secret")
  })

  it("closes the value dialog when secrets change", async () => {
    let changedListener: ((event: { secrets: typeof savedSecret[] }) => void) | null = null
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })
    mocks.secrets.onChanged.mockImplementation((listener) => {
      changedListener = listener
      return () => undefined
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("显示密钥值：TOKEN")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("super-secret")

    await act(async () => {
      changedListener?.({ secrets: [savedSecret] })
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("super-secret")
  })

  it("does not expose a secret value when reveal fails", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })
    mocks.secrets.get.mockRejectedValueOnce(new Error("read failed: super-secret"))

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("显示密钥值：TOKEN")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).not.toContain("super-secret")
    expect(mocks.toast.error).toHaveBeenCalledWith("读取失败")
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to reveal secret value.",
      expect.objectContaining({
        name: "TOKEN",
        errorName: "Error",
        errorMessageLength: "read failed: super-secret".length,
      }),
    )
    expect(mocks.logger.error.mock.calls.at(-1)?.[1]).not.toHaveProperty("error")
  })

  it("does not log secret values when copy fails", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("显示密钥值：TOKEN")
      await Promise.resolve()
    })

    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("clipboard denied: super-secret"))

    await act(async () => {
      clickButton("复制")
      await Promise.resolve()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith("复制失败")
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to copy secret value.",
      expect.objectContaining({
        name: "TOKEN",
        errorName: "Error",
        errorMessageLength: "clipboard denied: super-secret".length,
      }),
    )
    expect(mocks.logger.error.mock.calls.at(-1)?.[1]).not.toHaveProperty("error")
  })

  it("creates a secret", async () => {
    await renderSecretsModule()

    await act(async () => {
      clickButton("新增密钥")
    })
    await act(async () => {
      setInputValue("#secret-name", "GITEE_TOKEN")
      setInputValue("#secret-value", "new-token")
      setInputValue("#secret-description", "gitee")
    })
    await act(async () => {
      clickButton("保存")
      await Promise.resolve()
    })

    expect(mocks.secrets.create).toHaveBeenCalledWith({
      name: "GITEE_TOKEN",
      value: "new-token",
      description: "gitee",
    })
  })

  it("edits metadata without pre-filling the old value", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("编辑密钥：TOKEN")
    })

    expect(document.querySelector<HTMLInputElement>("#secret-name")?.value).toBe("TOKEN")
    expect(document.querySelector<HTMLInputElement>("#secret-description")?.value).toBe("api token")
    expect(document.querySelector<HTMLInputElement>("#secret-value")).toBeNull()

    await act(async () => {
      clickCheckbox("secret-update-value")
    })

    expect(document.querySelector<HTMLInputElement>("#secret-value")?.value).toBe("")
  })

  it("updates value only when the update value control is enabled", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("编辑密钥：TOKEN")
    })
    await act(async () => {
      setInputValue("#secret-description", "updated")
      clickButton("保存")
      await Promise.resolve()
    })

    expect(mocks.secrets.update).toHaveBeenLastCalledWith({
      name: "TOKEN",
      description: "updated",
    })

    await act(async () => {
      clickButtonByLabel("编辑密钥：TOKEN")
    })
    await act(async () => {
      clickCheckbox("secret-update-value")
      await Promise.resolve()
    })
    await act(async () => {
      setInputValue("#secret-value", "changed-secret")
      clickButton("保存")
      await Promise.resolve()
    })

    expect(mocks.secrets.update).toHaveBeenLastCalledWith({
      name: "TOKEN",
      value: "changed-secret",
      description: "api token",
    })
  })

  it("deletes a secret after confirmation", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
    })

    expect(document.body.textContent).toContain("删除密钥")
    expect(document.body.textContent).toContain("TOKEN")

    await act(async () => {
      clickButton("删除")
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).toHaveBeenCalledWith({ name: "TOKEN" })
  })

  it("shows retry when loading fails", async () => {
    mocks.secrets.list.mockRejectedValueOnce(new Error("load failed"))

    await renderSecretsModule()

    expect(document.body.textContent).toContain("加载失败")

    mocks.secrets.list.mockResolvedValue({ secrets: [], total: 0 })
    await act(async () => {
      clickButton("重试")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("暂无密钥")
  })
})

async function renderSecretsModule(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SecretsModule />)
    await Promise.resolve()
  })
}

function clickButton(text: string) {
  buttonByText(text).dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function clickButtonByLabel(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function textareaByLabel(label: string): HTMLTextAreaElement {
  const textarea = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  if (!textarea) throw new Error(`Textarea not found: ${label}`)
  return textarea
}

function clickCheckbox(id: string) {
  const checkbox = document.getElementById(id)
  if (!checkbox) throw new Error(`Checkbox not found: ${id}`)
  checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function setInputValue(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Input not found: ${selector}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
