import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { changeInput, render } from "@/test/render"
import { LoginPage } from "./login-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    login: vi.fn(),
  },
}))

describe("LoginPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("submits account credentials", async () => {
    vi.mocked(adminApi.login).mockResolvedValue({ email: "user@example.com", role: "user" })
    const onLoggedIn = vi.fn()
    const result = await render(<LoginPage onLoggedIn={onLoggedIn} />)
    cleanup = result.unmount

    const email = result.container.querySelector("#admin-email") as HTMLInputElement
    const password = result.container.querySelector("#admin-password") as HTMLInputElement
    const form = result.container.querySelector("form") as HTMLFormElement

    await act(async () => {
      changeInput(email, "user@example.com")
      changeInput(password, "secret")
    })

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(adminApi.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
    })
    expect(onLoggedIn).toHaveBeenCalledWith({ email: "user@example.com", role: "user" })
  })

  it("uses generic account login copy", async () => {
    const result = await render(<LoginPage onLoggedIn={vi.fn()} />)
    cleanup = result.unmount

    expect(result.container.textContent).toContain("登录")
    expect(result.container.textContent).not.toContain("管理员登录")
  })
})
