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
    scanSkillEnvBindings: vi.fn(),
    queueSkillEnvBindings: vi.fn(),
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

const skillEnvScanResult = {
  scanSessionId: "scan-1",
  items: [
    {
      id: "item-1",
      skillName: "skill-one",
      editors: [{ id: "codex", label: "Codex" }],
      scope: "global" as const,
      envPath: "/Users/me/.codex/skills/skill-one/.env",
      status: "needs_update" as const,
    },
    {
      id: "item-2",
      skillName: "skill-two",
      editors: [{ id: "claude", label: "Claude Code" }],
      scope: "project" as const,
      projectId: "project-1",
      projectName: "Synapse",
      envPath: "/workspace/.claude/skills/skill-two/.env",
      status: "up_to_date" as const,
    },
    {
      id: "item-3",
      skillName: "skill-three",
      editors: [{ id: "cursor", label: "Cursor" }],
      scope: "global" as const,
      envPath: "/Users/me/.cursor/skills/skill-three/.env",
      status: "invalid" as const,
      message: "配置文件格式无效。",
    },
    {
      id: "item-4",
      skillName: "skill-four",
      editors: [{ id: "codex", label: "Codex" }],
      scope: "global" as const,
      envPath: "/Users/me/.codex/skills/skill-four/.env",
      status: "unwritable" as const,
      message: "配置文件不可读或不可写。",
    },
    {
      id: "item-5",
      skillName: "skill-five",
      editors: [{ id: "claude", label: "Claude Code" }],
      scope: "global" as const,
      envPath: "/Users/me/.claude/skills/skill-five/.env",
      status: "unsafe_link" as const,
      message: "配置文件路径不安全。",
    },
  ],
}

const roots: Root[] = []

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
  mocks.secrets.scanSkillEnvBindings.mockResolvedValue({ scanSessionId: "scan-empty", items: [] })
  mocks.secrets.queueSkillEnvBindings.mockResolvedValue({ items: [] })
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
    mocks.secrets.create.mockResolvedValueOnce({ ...savedSecret, name: "GITEE_TOKEN" })
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
    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "GITEE_TOKEN" })
  })

  it("scans after creating a secret with an empty stored value", async () => {
    const emptySecret = { ...savedSecret, name: "EMPTY", hasValue: true }
    mocks.secrets.create.mockResolvedValueOnce(emptySecret)

    await renderSecretsModule()
    await act(async () => {
      clickButton("新增密钥")
    })
    await act(async () => {
      setInputValue("#secret-name", "EMPTY")
      clickButton("保存")
      await Promise.resolve()
    })

    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "EMPTY" })
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
    expect(document.querySelector<HTMLInputElement>("#secret-name")?.readOnly).toBe(true)
    expect(document.querySelector<HTMLInputElement>("#secret-name")?.getAttribute("aria-readonly")).toBe("true")
    expect(document.querySelector<HTMLInputElement>("#secret-description")?.value).toBe("api token")
    expect(document.querySelector<HTMLInputElement>("#secret-value")).toBeNull()

    await act(async () => {
      clickCheckbox("secret-update-value")
    })

    expect(document.querySelector<HTMLInputElement>("#secret-value")?.value).toBe("")
  })

  it("updates description without scanning", async () => {
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

    expect(mocks.secrets.scanSkillEnvBindings).not.toHaveBeenCalled()
  })

  it("scans after a value update and queues the default selected bindings", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })
    mocks.secrets.scanSkillEnvBindings.mockResolvedValueOnce(skillEnvScanResult)
    mocks.secrets.queueSkillEnvBindings.mockResolvedValueOnce({
      items: [{
        ...skillEnvScanResult.items[0],
        status: "updated",
      }],
    })

    await renderSecretsModule()

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
    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(document.body.textContent).toContain("更新 Skill 配置")
    expect(document.body.textContent).toContain("待更新")
    expect(document.body.textContent).toContain("已是最新")
    expect(document.body.textContent).toContain("格式错误")
    expect(document.body.textContent).toContain("不可写")
    expect(document.body.textContent).toContain("不安全路径")
    expect(rowText("skill-three")).toContain("配置文件格式无效。")
    expect(rowText("skill-four")).toContain("配置文件不可读或不可写。")
    expect(rowText("skill-five")).toContain("配置文件路径不安全。")
    expect(document.body.textContent).not.toContain("changed-secret")

    await act(async () => {
      clickButton("更新选中项")
      await Promise.resolve()
    })

    expect(mocks.secrets.queueSkillEnvBindings).toHaveBeenCalledWith({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    })
    expect(document.body.textContent).toContain("已更新")
    expect(document.body.textContent).toContain("skill-one")
  })

  it("keeps queued rows visible and maps ordered failure results", async () => {
    const scanResult = {
      scanSessionId: "scan-results",
      items: skillEnvScanResult.items.slice(0, 3).map((item) => ({ ...item, status: "needs_update" as const })),
    }
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockResolvedValueOnce(scanResult)
    mocks.secrets.queueSkillEnvBindings.mockResolvedValueOnce({
      items: [
        { ...scanResult.items[0], status: "updated" },
        {
          ...scanResult.items[1],
          status: "failed",
          message: "当前 Windows 环境不支持安全原子更新。",
        },
        { ...scanResult.items[2], status: "conflict", message: "扫描结果已失效。" },
      ],
    })

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("扫描关联 Skill：TOKEN")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("更新选中项")
      await Promise.resolve()
    })

    expect(mocks.secrets.queueSkillEnvBindings).toHaveBeenCalledWith({
      name: "TOKEN",
      scanSessionId: "scan-results",
      itemIds: ["item-1", "item-2", "item-3"],
    })
    expect(document.body.textContent).toContain("skill-one")
    expect(document.body.textContent).toContain("skill-two")
    expect(document.body.textContent).toContain("skill-three")
    expect(document.body.textContent).toContain("已更新")
    expect(document.body.textContent).toContain("更新失败")
    expect(document.body.textContent).toContain("文件已变化")
    expect(rowText("skill-two")).toContain("当前 Windows 环境不支持安全原子更新。")
    expect(rowText("skill-three")).toContain("扫描结果已失效。")
    expect(rowText("skill-three")).not.toContain("配置文件格式无效。")
    expect(document.body.textContent).not.toContain("super-secret")
  })

  it("keeps the scanned rows available when the queue request fails", async () => {
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockResolvedValueOnce(skillEnvScanResult)
    mocks.secrets.queueSkillEnvBindings.mockRejectedValueOnce(new Error("queue failed: changed-secret"))

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("扫描关联 Skill：TOKEN")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("更新选中项")
      await Promise.resolve()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith("更新失败，请重试。")
    expect(document.body.textContent).toContain("skill-one")
    expect(document.body.textContent).toContain("更新选中项")
    expect(document.body.textContent).not.toContain("changed-secret")
  })

  it("rescans an expired update group before retrying", async () => {
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings
      .mockResolvedValueOnce(skillEnvScanResult)
      .mockResolvedValueOnce({
        scanSessionId: "scan-refreshed",
        items: [skillEnvScanResult.items[0]],
      })
    mocks.secrets.queueSkillEnvBindings.mockRejectedValueOnce(
      new Error("扫描会话已过期，请重新扫描。"),
    )

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("扫描关联 Skill：TOKEN")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("更新选中项")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("TOKEN 的扫描会话已过期，请重新扫描。")

    await act(async () => {
      clickButton("重新扫描")
      await Promise.resolve()
    })

    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenNthCalledWith(2, { name: "TOKEN" })
    expect(document.body.textContent).not.toContain("扫描会话已过期")
    expect(document.body.textContent).toContain("skill-one")
  })

  it("scans bindings from the row action", async () => {
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockResolvedValueOnce(skillEnvScanResult)

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("扫描关联 Skill：TOKEN")
      await Promise.resolve()
    })

    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(document.body.textContent).toContain("更新 Skill 配置")
  })

  it("ignores an older scan that finishes after a newer row scan", async () => {
    const otherSecret = { ...savedSecret, id: "secret-2", name: "OTHER" }
    let resolveFirstScan: ((result: typeof skillEnvScanResult) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret, otherSecret], total: 2 })
    mocks.secrets.scanSkillEnvBindings
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstScan = resolve }))
      .mockResolvedValueOnce({
        scanSessionId: "scan-newer",
        items: [{ ...skillEnvScanResult.items[1], skillName: "newer-skill" }],
      })

    await renderSecretsModule()
    act(() => {
      clickButtonByLabel("扫描关联 Skill：TOKEN")
    })
    await act(async () => {
      clickButtonByLabel("扫描关联 Skill：OTHER")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("newer-skill")

    await act(async () => {
      resolveFirstScan?.(skillEnvScanResult)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("newer-skill")
    expect(document.body.textContent).not.toContain("skill-one")
  })

  it("deletes a secret after confirmation", async () => {
    mocks.secrets.list.mockResolvedValue({
      secrets: [savedSecret],
      total: 1,
    })

    await renderSecretsModule()

    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除密钥")
    expect(document.body.textContent).toContain("TOKEN")

    await act(async () => {
      clickButton("删除")
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "TOKEN" })
  })

  it("shows the binding count in delete confirmation", async () => {
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockResolvedValueOnce(skillEnvScanResult)

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("发现 5 个关联 Skill，删除密钥不会删除这些 .env 键。")
    expect(document.body.textContent).not.toContain("删除“TOKEN”后不可恢复。")
  })

  it("keeps the secret when delete scanning fails", async () => {
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockRejectedValueOnce(new Error("scan failed: super-secret"))

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledWith("扫描失败，请重试。")
    expect(document.body.textContent).toContain("TOKEN")
    expect(document.body.textContent).not.toContain("删除密钥")
  })

  it("keeps the latest delete target when scans resolve out of order", async () => {
    const otherSecret = { ...savedSecret, id: "secret-2", name: "OTHER" }
    let resolveTokenScan: ((result: typeof skillEnvScanResult) => void) | undefined
    let resolveOtherScan: ((result: typeof skillEnvScanResult) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret, otherSecret], total: 2 })
    mocks.secrets.scanSkillEnvBindings.mockImplementation(({ name }: { name: string }) => new Promise((resolve) => {
      if (name === "TOKEN") resolveTokenScan = resolve
      if (name === "OTHER") resolveOtherScan = resolve
    }))

    await renderSecretsModule()
    act(() => {
      clickButtonByLabel("删除密钥：TOKEN")
      clickButtonByLabel("删除密钥：OTHER")
    })
    await act(async () => {
      resolveOtherScan?.({ scanSessionId: "scan-other", items: [] })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除“OTHER”后不可恢复。")

    await act(async () => {
      resolveTokenScan?.({ scanSessionId: "scan-token", items: [] })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除“OTHER”后不可恢复。")
    expect(document.body.textContent).not.toContain("删除“TOKEN”后不可恢复。")

    await act(async () => {
      clickButton("删除")
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).toHaveBeenCalledTimes(1)
    expect(mocks.secrets.delete).toHaveBeenCalledWith({ name: "OTHER" })
  })

  it("never executes a stale bypass delete after a newer target is selected", async () => {
    const otherSecret = { ...savedSecret, id: "secret-2", name: "OTHER" }
    let resolveTokenScan: ((result: typeof skillEnvScanResult) => void) | undefined
    let resolveOtherScan: ((result: typeof skillEnvScanResult) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret, otherSecret], total: 2 })
    mocks.secrets.scanSkillEnvBindings.mockImplementation(({ name }: { name: string }) => new Promise((resolve) => {
      if (name === "TOKEN") resolveTokenScan = resolve
      if (name === "OTHER") resolveOtherScan = resolve
    }))

    await renderSecretsModule()
    act(() => {
      clickButtonByLabel("删除密钥：TOKEN", { altKey: true })
      clickButtonByLabel("删除密钥：OTHER")
    })
    await act(async () => {
      resolveOtherScan?.({ scanSessionId: "scan-other", items: [] })
      await Promise.resolve()
    })
    await act(async () => {
      resolveTokenScan?.({ scanSessionId: "scan-token", items: [] })
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("删除“OTHER”后不可恢复。")
  })

  it("invalidates a pending bypass delete scan when refresh begins", async () => {
    let resolveDeleteScan: ((result: typeof skillEnvScanResult) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDeleteScan = resolve
    }))

    await renderSecretsModule()
    act(() => {
      clickButtonByLabel("删除密钥：TOKEN", { altKey: true })
    })
    await act(async () => {
      clickRefreshButton()
      await Promise.resolve()
    })
    await act(async () => {
      resolveDeleteScan?.({ scanSessionId: "scan-token", items: [] })
      await Promise.resolve()
    })

    expect(mocks.secrets.delete).not.toHaveBeenCalled()
  })

  it("invalidates a pending bypass delete scan after editing the target", async () => {
    let resolveDeleteScan: ((result: typeof skillEnvScanResult) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.scanSkillEnvBindings.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDeleteScan = resolve
    }))

    await renderSecretsModule()
    act(() => {
      clickButtonByLabel("删除密钥：TOKEN", { altKey: true })
      clickButtonByLabel("编辑密钥：TOKEN")
    })
    await act(async () => {
      setInputValue("#secret-description", "updated")
      clickButton("保存")
      await Promise.resolve()
    })
    await act(async () => {
      resolveDeleteScan?.({ scanSessionId: "scan-token", items: [] })
      await Promise.resolve()
    })

    expect(mocks.secrets.update).toHaveBeenCalledWith({ name: "TOKEN", description: "updated" })
    expect(mocks.secrets.delete).not.toHaveBeenCalled()
  })

  it("reports a started delete failure after the confirmation dialog closes", async () => {
    let rejectDelete: ((error: Error) => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.delete.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectDelete = reject
    }))

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
      await Promise.resolve()
    })
    act(() => {
      clickButton("删除")
    })

    expect(document.body.textContent).not.toContain("删除“TOKEN”后不可恢复。")

    await act(async () => {
      rejectDelete?.(new Error("delete failed: super-secret"))
      await Promise.resolve()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith("删除失败")
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to delete secret.",
      expect.objectContaining({
        errorName: "Error",
        errorMessageLength: "delete failed: super-secret".length,
      }),
    )
    expect(mocks.logger.error.mock.calls.at(-1)?.[1]).not.toHaveProperty("error")
    expect(document.body.textContent).toContain("TOKEN")
  })

  it("submits only one delete request when confirmation is repeated", async () => {
    let resolveDelete: (() => void) | undefined
    mocks.secrets.list.mockResolvedValue({ secrets: [savedSecret], total: 1 })
    mocks.secrets.delete.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveDelete = resolve
    }))

    await renderSecretsModule()
    await act(async () => {
      clickButtonByLabel("删除密钥：TOKEN")
      await Promise.resolve()
    })
    act(() => {
      clickButton("删除")
      clickButton("删除")
    })

    expect(mocks.secrets.delete).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDelete?.()
      await Promise.resolve()
    })
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

function clickRefreshButton() {
  const button = document.querySelector<HTMLButtonElement>("[data-system-app-top-bar-actions] button")
  if (!button) throw new Error("Refresh button not found")
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function clickButtonByLabel(label: string, init: MouseEventInit = {}) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }))
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

function rowText(skillName: string): string {
  const row = Array.from(document.querySelectorAll("tr"))
    .find((candidate) => candidate.textContent?.includes(skillName))
  if (!row) throw new Error(`Missing Skill row: ${skillName}`)
  return row.textContent ?? ""
}

function setInputValue(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Input not found: ${selector}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
