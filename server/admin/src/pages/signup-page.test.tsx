import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, userAuthApi } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { SignupPage } from "./signup-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    login: vi.fn(),
  },
  userAuthApi: {
    register: vi.fn(),
  },
}))

describe("SignupPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("shows an invalid link state when invite is missing", async () => {
    const result = await render(<SignupPage inviteToken="" />)
    cleanup = result.unmount

    expect(result.container.textContent).toContain("邀请链接无效")
    expect(result.container.querySelector("form")).toBeNull()
  })

  it("registers with the invite token and shows success", async () => {
    vi.mocked(userAuthApi.register).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })
    vi.mocked(adminApi.login).mockResolvedValue({ email: "new@example.com", role: "user" })
    const result = await render(<SignupPage inviteToken="plain-token" />)
    cleanup = result.unmount

    const email = result.container.querySelector<HTMLInputElement>("#signup-email")!
    const password = result.container.querySelector<HTMLInputElement>("#signup-password")!
    changeInput(email, "new@example.com")
    changeInput(password, "password123")

    await act(async () => {
      result.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }))
    })

    await waitFor(() => {
      expect(result.container.textContent).toContain("注册成功")
    })
    expect(result.container.textContent).toContain("进入团队")
    expect(userAuthApi.register).toHaveBeenCalledWith({
      invitationToken: "plain-token",
      email: "new@example.com",
      password: "password123",
    })
    expect(adminApi.login).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "password123",
    })
  })

  it("shows registration failures", async () => {
    vi.mocked(userAuthApi.register).mockRejectedValue(new Error("邀请无效或已过期。"))
    const result = await render(<SignupPage inviteToken="plain-token" />)
    cleanup = result.unmount

    changeInput(result.container.querySelector<HTMLInputElement>("#signup-email")!, "new@example.com")
    changeInput(result.container.querySelector<HTMLInputElement>("#signup-password")!, "password123")

    await act(async () => {
      result.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }))
    })

    await waitFor(() => {
      expect(result.container.textContent).toContain("邀请无效或已过期。")
    })
  })
})
