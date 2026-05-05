import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, type ActivationCode } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { ActivationCodesPage, resolveActivationCodeExpiresAt } from "./activation-codes-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listActivationCodes: vi.fn(),
    createActivationCode: vi.fn(),
    updateActivationCode: vi.fn(),
    archiveActivationCode: vi.fn(),
    listActivationAttempts: vi.fn(),
    updateActivationCodeRiskLock: vi.fn(),
    replaceActivationCode: vi.fn(),
  },
}))

function activationCodeFixture(overrides: Partial<ActivationCode> = {}): ActivationCode {
  return {
    id: "code_1",
    codeHint: "SYN-****-0001",
    status: "active",
    maxDevices: 1,
    expiresAt: null,
    boundAccountId: null,
    boundAccount: null,
    redeemedAt: null,
    archivedAt: null,
    riskLockedAt: null,
    riskLockedReason: null,
    riskUnlockedAt: null,
    riskReviewNote: null,
    replacedByActivationCodeId: null,
    reservedEmail: null,
    createdAt: "2026-04-29T00:00:00.000Z",
    ...overrides,
  }
}

describe("ActivationCodesPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("renders activation codes returned by the admin api", async () => {
    const activationCode = activationCodeFixture({
      boundAccountId: "account_1",
      boundAccount: { email: "user@example.com" },
    })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("邮箱")
      expect(result.container.textContent).toContain("user@example.com")
      expect(result.container.textContent).toContain("激活码标识")
      expect(result.container.textContent).toContain("SYN-****-0001")
      expect(result.container.textContent).not.toContain("SYN-TEST-0001")
      expect(result.container.textContent).not.toContain("account_1")
      expect(result.container.textContent).toContain("启用")
    })
  })

  it("loads archived activation codes when the filter is selected", async () => {
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([])

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(adminApi.listActivationCodes).toHaveBeenCalledWith({ includeArchived: false })
    })

    const includeArchived = result.container.querySelector("#include-archived") as HTMLElement

    await act(async () => {
      includeArchived.click()
    })

    await waitFor(() => {
      expect(adminApi.listActivationCodes).toHaveBeenCalledWith({ includeArchived: true })
    })
  })

  it("renders fixed action buttons for activation code status changes", async () => {
    const activationCode = activationCodeFixture()
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])
    vi.mocked(adminApi.updateActivationCode).mockResolvedValue({
      ...activationCode,
      status: "disabled",
    })

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      const operationHead = Array.from(result.container.querySelectorAll("th"))
        .find((head) => head.textContent === "操作")
      const operationCell = result.container.querySelector("tbody tr td:last-child")
      expect(operationHead?.className).toContain("sticky")
      expect(operationHead?.className).toContain("right-0")
      expect(operationCell?.className).toContain("sticky")
      expect(operationCell?.className).toContain("right-0")
      expect(operationCell?.querySelector("div")?.className).toContain("gap-px")
      const actionButtons = Array.from(operationCell?.querySelectorAll("button") ?? [])
      expect(actionButtons).toHaveLength(5)
      actionButtons.forEach((button) => {
        expect(button.getAttribute("data-variant")).toBe("ghost")
        expect(button.getAttribute("data-size")).toBe("sm")
        expect(button.className).toContain("px-1.5")
      })
      expect(actionButtons.some((button) => button.textContent === "启用")).toBe(false)
    })

    const disableButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "停用") as HTMLButtonElement

    await act(async () => {
      disableButton.click()
    })

    expect(adminApi.updateActivationCode).toHaveBeenCalledWith("code_1", "disabled")
  })

  it("archives activation codes from the action column", async () => {
    const activationCode = activationCodeFixture()
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])
    vi.mocked(adminApi.archiveActivationCode).mockResolvedValue({
      ...activationCode,
      archivedAt: "2026-04-29T01:00:00.000Z",
    })

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("归档")
    })

    const archiveButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "归档") as HTMLButtonElement

    await act(async () => {
      archiveButton.click()
    })

    expect(adminApi.archiveActivationCode).toHaveBeenCalledWith("code_1")
  })

  it("renders risk state and opens activation attempt records", async () => {
    const activationCode = activationCodeFixture({
      boundAccountId: "account_1",
      boundAccount: { email: "user@example.com" },
      riskLockedAt: "2026-05-03T00:00:00.000Z",
      riskLockedReason: "激活码来源异常。",
    })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])
    vi.mocked(adminApi.listActivationAttempts).mockResolvedValue([
      {
        id: "attempt_1",
        activationCodeId: "code_1",
        activationCodeHash: "hash_1",
        activationCodeHint: "SYN-****-0001",
        email: "attacker@example.com",
        deviceIdHash: "device_hash_1",
        ipAddress: "127.0.0.1",
        userAgent: "Vitest",
        outcome: "bound_conflict",
        reason: "激活码已绑定其他账号。",
        createdAt: "2026-05-03T00:00:00.000Z",
      },
    ])

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("风控")
      expect(result.container.textContent).toContain("已锁定")
    })

    const recordsButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "记录") as HTMLButtonElement

    await act(async () => {
      recordsButton.click()
    })

    await waitFor(() => {
      expect(adminApi.listActivationAttempts).toHaveBeenCalledWith("code_1")
      expect(document.body.textContent).toContain("attacker@example.com")
      expect(document.body.textContent).toContain("127.0.0.1")
      expect(document.body.textContent).toContain("Vitest")
    })
  })

  it("unlocks risk locked activation codes", async () => {
    const activationCode = activationCodeFixture({
      boundAccountId: "account_1",
      boundAccount: { email: "user@example.com" },
      riskLockedAt: "2026-05-03T00:00:00.000Z",
      riskLockedReason: "激活码来源异常。",
    })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])
    vi.mocked(adminApi.updateActivationCodeRiskLock).mockResolvedValue({
      ...activationCode,
      riskLockedAt: null,
      riskLockedReason: null,
    })

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("解锁")
    })

    const unlockButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "解锁") as HTMLButtonElement

    await act(async () => {
      unlockButton.click()
    })

    expect(adminApi.updateActivationCodeRiskLock).toHaveBeenCalledWith("code_1", {
      locked: false,
      note: null,
    })
  })

  it("replaces bound activation codes and shows the new code once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const activationCode = activationCodeFixture({
      boundAccountId: "account_1",
      boundAccount: { email: "user@example.com" },
      riskLockedAt: "2026-05-03T00:00:00.000Z",
      riskLockedReason: "激活码来源异常。",
    })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([activationCode])
    vi.mocked(adminApi.replaceActivationCode).mockResolvedValue({
      id: "new_code",
      code: "SYN-NEWC-0001",
      maxDevices: 1,
    })

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("换码")
    })

    const replaceButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "换码") as HTMLButtonElement

    await act(async () => {
      replaceButton.click()
    })

    expect(adminApi.replaceActivationCode).toHaveBeenCalledWith("code_1")
    await waitFor(() => {
      expect(document.body.textContent).toContain("SYN-NEWC-0001")
    })
  })

  it("resolves duration expiration to a concrete timestamp", () => {
    const now = new Date("2026-04-29T14:00:00.000Z")

    expect(resolveActivationCodeExpiresAt({
      mode: "duration",
      fixedDate: "",
      durationAmount: "1",
      durationUnit: "months",
    }, now)).toBe("2026-05-29T14:00:00.000Z")
    expect(resolveActivationCodeExpiresAt({
      mode: "duration",
      fixedDate: "",
      durationAmount: "1",
      durationUnit: "days",
    }, now)).toBe("2026-04-30T14:00:00.000Z")
    expect(resolveActivationCodeExpiresAt({
      mode: "date",
      fixedDate: "2026-05-01",
      durationAmount: "1",
      durationUnit: "days",
    }, now)).toBe("2026-05-01")
    expect(() => resolveActivationCodeExpiresAt({
      mode: "duration",
      fixedDate: "",
      durationAmount: "0",
      durationUnit: "days",
    }, now)).toThrow("时长无效")
  })

  it("creates activation codes in batches and shows generated codes once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([])
    vi.mocked(adminApi.createActivationCode).mockResolvedValue([
      {
        id: "code_1",
        code: "SYN-TEST-0001",
        maxDevices: 2,
      },
      {
        id: "code_2",
        code: "SYN-TEST-0002",
        maxDevices: 2,
      },
    ])

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    const trigger = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("新建")) as HTMLButtonElement

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(document.body.querySelector("#activation-code")).toBeNull()
    expect(document.body.textContent).toContain("有效时长")
    expect(document.body.textContent).toContain("月")

    const maxDevices = document.body.querySelector("#max-devices") as HTMLInputElement
    const quantity = document.body.querySelector("#activation-code-quantity") as HTMLInputElement
    const form = document.body.querySelector("form") as HTMLFormElement

    await act(async () => {
      changeInput(maxDevices, "2")
      changeInput(quantity, "2")
    })

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(adminApi.createActivationCode).toHaveBeenCalledWith({
      maxDevices: 2,
      expiresAt: expect.any(String),
      quantity: 2,
    })
    expect(result.container.textContent).not.toContain("已创建：")

    await waitFor(() => {
      expect(document.body.textContent).toContain("本次生成的激活码")
      expect(document.body.textContent).toContain("SYN-TEST-0001")
      expect(document.body.textContent).toContain("SYN-TEST-0002")
      expect(document.body.textContent).toContain("只会在此处显示一次，关闭后无法找回。")
    })

    const copyButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "一键复制") as HTMLButtonElement

    await act(async () => {
      copyButton.click()
    })

    expect(writeText).toHaveBeenCalledWith("SYN-TEST-0001\nSYN-TEST-0002")
    await waitFor(() => {
      expect(copyButton.textContent).toBe("已复制")
    })
  })
})
