/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SkillEnvSecretConfigDialog } from "@/modules/content/components/skill-env-secret-config-dialog"
import type { SynapseContentMeta } from "@/types/content"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  inspectSkillEnvSource: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  secrets: {
    get: vi.fn(),
    list: vi.fn(),
    queueSkillEnvBindings: vi.fn(),
    scanSkillEnvBindings: vi.fn(),
    scanSkillEnvBindingsBatch: vi.fn(),
    upsert: vi.fn(),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/app-shell/installers", () => ({
  inspectSkillEnvSource: mocks.inspectSkillEnvSource,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "secrets") return mocks.secrets
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

const item: SynapseContentMeta<"skill"> = {
  attachmentCount: 2,
  category: "automation",
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "user-1",
  createdByDisplayName: "User",
  deleted: false,
  description: "Send notifications",
  hasEnv: true,
  icon: "message-circle",
  iconBg: "muted",
  id: "skill-1",
  latestHistoryDirname: "20260701000000",
  modifiedAt: "2026-07-01T00:00:00.000Z",
  modifiedBy: "user-1",
  modifiedByDisplayName: "User",
  name: "wecom-notification",
  title: "企业微信通知",
  type: "skill",
}

const roots: Root[] = []

beforeEach(() => {
  mocks.inspectSkillEnvSource.mockResolvedValue({ declarations: [], legacyPlaceholders: [] })
  mocks.secrets.list.mockResolvedValue({ secrets: [], total: 0 })
  mocks.secrets.scanSkillEnvBindings.mockResolvedValue({ scanSessionId: "scan-empty", items: [] })
  mocks.secrets.scanSkillEnvBindingsBatch.mockImplementation(async ({ names }: { names: string[] }) => ({
    groups: names.map((name) => ({
      name,
      scanResult: { scanSessionId: `scan-${name}`, items: [] },
    })),
  }))
  mocks.secrets.queueSkillEnvBindings.mockResolvedValue({ items: [] })
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("SkillEnvSecretConfigDialog", () => {
  it("loads every declaration and reuses existing secrets without reading values", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [
        { name: "TOKEN", defaultValue: "" },
        { name: "REGION", defaultValue: "cn-beijing" },
        { name: "OPTIONAL", defaultValue: "" },
      ],
      legacyPlaceholders: ["LEGACY_TOKEN"],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [
        { id: "secret-1", name: "TOKEN", hasValue: true },
        { id: "secret-2", name: "OPTIONAL", hasValue: false },
      ],
      total: 2,
    })

    await renderDialog()

    expect(document.body.textContent).toContain("配置环境变量")
    expect(document.body.textContent).toContain("企业微信通知")
    expect(document.body.textContent).toContain("TOKEN")
    expect(document.body.textContent).toContain("REGION")
    expect(document.body.textContent).toContain("OPTIONAL")
    expect(document.body.textContent).not.toContain("LEGACY_TOKEN")
    expect(document.body.textContent).toContain("已保存")
    expect(document.body.textContent).toContain("使用默认值")
    expect(document.body.textContent).toContain("未设置")
    expect(inputForLabel("OPTIONAL").disabled).toBe(false)
    expect(rowForLabel("OPTIONAL").textContent).not.toContain("取消替换")
    expect(mocks.secrets.get).not.toHaveBeenCalled()
    expect(mocks.inspectSkillEnvSource).toHaveBeenCalledWith({
      kind: "skill",
      origin: "repository",
      repositoryContentId: "skill-1",
      sourceIdentity: "skill-1",
      name: "wecom-notification",
      title: "企业微信通知",
      description: "Send notifications",
    })
  })

  it("starts replacement empty and preserves the exact existing name", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "repository-default" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", description: "existing", hasValue: true }],
      total: 1,
    })
    mocks.secrets.upsert.mockResolvedValue({
      created: false,
      secret: { id: "secret-1", name: "TOKEN", description: "existing", hasValue: true },
    })
    const onOpenChange = vi.fn()

    await renderDialog(onOpenChange)
    await act(async () => clickButton("替换"))

    const input = inputForLabel("TOKEN")
    expect(input.value).toBe("")
    expect(input.type).toBe("password")
    expect(document.body.textContent).not.toContain("repository-default")

    await act(async () => {
      setInputValue(input, "replacement-value")
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(mocks.secrets.upsert).toHaveBeenCalledWith({ name: "TOKEN", value: "replacement-value" })
    expect(mocks.secrets.get).not.toHaveBeenCalled()
    expect(mocks.secrets.scanSkillEnvBindingsBatch).toHaveBeenCalledWith({ names: ["TOKEN"] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(document.body.textContent).not.toContain("replacement-value")
  })

  it("scans installed bindings when reusing an existing secret", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", hasValue: true }],
      total: 1,
    })

    await renderDialog()
    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(mocks.secrets.upsert).not.toHaveBeenCalled()
    expect(mocks.secrets.scanSkillEnvBindingsBatch).toHaveBeenCalledWith({ names: ["TOKEN"] })
  })

  it("keeps a truncated binding scan available for retry after installed Skills are reduced", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", hasValue: true }],
      total: 1,
    })
    mocks.secrets.scanSkillEnvBindingsBatch.mockResolvedValueOnce({
      groups: [{
        name: "TOKEN",
        scanResult: { scanSessionId: "scan-limited", items: [], truncated: true },
      }],
    })

    await renderDialog()
    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(mocks.toast.warning).toHaveBeenCalledWith("关联 Skill 过多，请整理后重新扫描。")
    expect(document.body.textContent).toContain("关联 Skill 过多，请整理后重新扫描。")
    expect(document.body.textContent).toContain("重新扫描")
  })

  it("keeps a failed binding scan available for retry", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", hasValue: true }],
      total: 1,
    })
    mocks.secrets.scanSkillEnvBindingsBatch.mockResolvedValueOnce({
      groups: [{
        name: "TOKEN",
        scanResult: { scanSessionId: "scan-failed", items: [], failed: true },
      }],
    })

    await renderDialog()
    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith("扫描关联 Skill 失败，请重试。")
    expect(document.body.textContent).toContain("扫描关联 Skill 失败，请重试。")
    expect(document.body.textContent).toContain("重新扫描")
  })

  it("keeps a warning-only binding scan available for retry without reporting success", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", hasValue: true }],
      total: 1,
    })
    mocks.secrets.scanSkillEnvBindingsBatch.mockResolvedValueOnce({
      groups: [{
        name: "TOKEN",
        scanResult: {
          scanSessionId: "scan-warning",
          items: [],
          warnings: [{
            skillName: "unreadable-skill",
            editors: [{ id: "codex", label: "Codex" }],
            scope: "global",
            envPath: "/skills/unreadable-skill/.env",
            status: "unwritable",
          }],
        },
      }],
    })
    const onOpenChange = vi.fn()

    await renderDialog(onOpenChange)
    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(mocks.toast.warning).toHaveBeenCalledWith("部分 Skill 配置无法检查。")
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("部分 Skill 配置无法检查，请重新扫描。")
    expect(document.body.textContent).toContain("重新扫描")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("blocks a declaration whose key differs only by case from an existing secret", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "api_key", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "API_KEY", hasValue: true }],
      total: 1,
    })

    await renderDialog()

    expect(rowForLabel("api_key").textContent).toContain("名称冲突")
    expect(rowForLabel("api_key").textContent).toContain("已存在密钥 API_KEY")
    expect(inputForLabel("api_key").disabled).toBe(true)
    expect(buttonByText("保存到密钥库")?.disabled).toBe(true)
    expect(mocks.secrets.upsert).not.toHaveBeenCalled()
    expect(mocks.secrets.scanSkillEnvBindingsBatch).not.toHaveBeenCalled()
  })

  it("keeps failed values for retry and then queues multiple scan groups serially", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [
        { name: "TOKEN_A", defaultValue: "value-a" },
        { name: "TOKEN_B", defaultValue: "value-b" },
      ],
      legacyPlaceholders: [],
    })
    mocks.secrets.upsert
      .mockResolvedValueOnce({ created: true, secret: { id: "a", name: "TOKEN_A", hasValue: true } })
      .mockRejectedValueOnce(new Error("save failed: value-b"))
      .mockResolvedValueOnce({ created: true, secret: { id: "b", name: "TOKEN_B", hasValue: true } })
    mocks.secrets.scanSkillEnvBindingsBatch.mockImplementation(async ({ names }: { names: string[] }) => ({
      groups: names.map((name) => ({
        name,
        scanResult: { scanSessionId: `scan-${name}`, items: [bindingItem(name)] },
      })),
    }))
    mocks.secrets.queueSkillEnvBindings.mockImplementation(async ({ name }: { name: string }) => ({
      items: [{ ...bindingItem(name), status: "updated" as const }],
    }))

    await renderDialog()
    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(document.body.textContent).toContain("部分密钥已保存，失败项可重试。")
    expect(rowForLabel("TOKEN_A").textContent).toContain("已保存")
    expect(rowForLabel("TOKEN_B").textContent).toContain("保存失败")
    expect(inputForLabel("TOKEN_B").value).toBe("value-b")
    expect(document.body.textContent).not.toContain("save failed: value-b")
    expect(mocks.secrets.scanSkillEnvBindingsBatch).toHaveBeenCalledTimes(1)
    expect(mocks.secrets.scanSkillEnvBindingsBatch).toHaveBeenCalledWith({ names: ["TOKEN_A"] })

    await act(async () => {
      clickButton("保存到密钥库")
      await flushPromises()
    })

    expect(document.body.textContent).toContain("更新 Skill 配置")
    expect(document.body.textContent).toContain("TOKEN_A")
    expect(document.body.textContent).toContain("TOKEN_B")

    await act(async () => {
      clickButton("更新选中项")
      await flushPromises()
    })

    expect(mocks.secrets.queueSkillEnvBindings.mock.calls.map(([request]) => request)).toEqual([
      { name: "TOKEN_A", scanSessionId: "scan-TOKEN_A", itemIds: ["shared-item"] },
      { name: "TOKEN_B", scanSessionId: "scan-TOKEN_B", itemIds: ["shared-item"] },
    ])
    expect(document.body.textContent).toContain("已更新")
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to save Skill environment secret.",
      expect.objectContaining({
        contentId: "skill-1",
        errorName: "Error",
        errorMessageLength: "save failed: value-b".length,
      }),
    )
  })

  it("asks before discarding an unsaved default value", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "REGION", defaultValue: "cn-beijing" }],
      legacyPlaceholders: [],
    })
    const onOpenChange = vi.fn()

    await renderDialog(onOpenChange)
    await act(async () => clickButton("取消"))

    expect(document.body.textContent).toContain("放弃未保存的值？")
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => clickButton("继续配置"))
    expect(document.body.textContent).toContain("配置环境变量")

    await act(async () => clickButton("取消"))
    await act(async () => clickButton("放弃"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("asks before discarding a touched empty replacement", async () => {
    mocks.inspectSkillEnvSource.mockResolvedValue({
      declarations: [{ name: "TOKEN", defaultValue: "" }],
      legacyPlaceholders: [],
    })
    mocks.secrets.list.mockResolvedValue({
      secrets: [{ id: "secret-1", name: "TOKEN", hasValue: true }],
      total: 1,
    })
    const onOpenChange = vi.fn()

    await renderDialog(onOpenChange)
    await act(async () => clickButton("替换"))
    await act(async () => setInputValue(inputForLabel("TOKEN"), "temporary"))
    await act(async () => setInputValue(inputForLabel("TOKEN"), ""))

    expect(rowForLabel("TOKEN").textContent).toContain("待保存")
    expect(rowForLabel("TOKEN").textContent).not.toContain("未设置")

    await act(async () => clickButton("取消"))

    expect(document.body.textContent).toContain("放弃未保存的值？")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("shows reload for inspection failures and omits save for empty declarations", async () => {
    mocks.inspectSkillEnvSource.mockRejectedValueOnce(new Error("parse failed: secret-value"))

    await renderDialog()

    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).toContain("重新加载")
    expect(document.body.textContent).not.toContain("parse failed: secret-value")
    expect(buttonByText("保存到密钥库")).toBeUndefined()

    mocks.inspectSkillEnvSource.mockResolvedValueOnce({ declarations: [], legacyPlaceholders: [] })
    await act(async () => {
      clickButton("重新加载")
      await flushPromises()
    })

    expect(document.body.textContent).toContain("没有可配置的环境变量")
    expect(buttonByText("保存到密钥库")).toBeUndefined()
  })
})

function bindingItem(name: string) {
  return {
    id: "shared-item",
    skillName: `${name.toLowerCase()}-skill`,
    editors: [{ id: "codex", label: "Codex" }],
    scope: "global" as const,
    envPath: `/skills/${name}/.env`,
    status: "needs_update" as const,
  }
}

async function renderDialog(onOpenChange = vi.fn()): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<SkillEnvSecretConfigDialog item={item} onOpenChange={onOpenChange} />)
    await flushPromises()
  })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
}

function clickButton(text: string): void {
  const button = buttonByText(text)
  if (!button) throw new Error(`Button not found: ${text}`)
  button.click()
}

function inputForLabel(label: string): HTMLInputElement {
  const labelElement = Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
    .find((element) => element.textContent?.trim() === label)
  const input = labelElement?.htmlFor ? document.getElementById(labelElement.htmlFor) : null
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`)
  return input
}

function rowForLabel(label: string): HTMLElement {
  const labelElement = Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
    .find((element) => element.textContent?.trim() === label)
  const row = labelElement?.closest<HTMLElement>('[data-slot="field"]')
  if (!row) throw new Error(`Field not found: ${label}`)
  return row
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
