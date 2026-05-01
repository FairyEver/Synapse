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

  it("submits admin credentials", async () => {
    vi.mocked(adminApi.login).mockResolvedValue({ email: "admin@d2.com" })
    const onLoggedIn = vi.fn()
    const result = await render(<LoginPage onLoggedIn={onLoggedIn} />)
    cleanup = result.unmount

    const email = result.container.querySelector("#admin-email") as HTMLInputElement
    const password = result.container.querySelector("#admin-password") as HTMLInputElement
    const form = result.container.querySelector("form") as HTMLFormElement

    await act(async () => {
      changeInput(email, "admin@d2.com")
      changeInput(password, "secret")
    })

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(adminApi.login).toHaveBeenCalledWith({
      email: "admin@d2.com",
      password: "secret",
    })
    expect(onLoggedIn).toHaveBeenCalledWith({ email: "admin@d2.com" })
  })
})
