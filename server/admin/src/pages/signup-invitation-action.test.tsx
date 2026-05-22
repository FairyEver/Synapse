import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { SignupInvitationAction } from "./signup-invitation-action"

vi.mock("@/lib/api", () => ({
  adminApi: {
    createSignupInvitation: vi.fn(),
  },
}))

describe("SignupInvitationAction", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("labels the action as creating a user invitation", async () => {
    const result = await render(<SignupInvitationAction onCreated={vi.fn()} />)
    cleanup = result.unmount

    expect(result.container.textContent).toContain("创建用户邀请")
  })

  it("opens a dialog with the full invite URL after creation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.mocked(adminApi.createSignupInvitation).mockResolvedValue({
      id: "invite-1",
      token: "plain-token",
      inviteUrl: "https://app.example.com/dashboard/signup?invite=plain-token",
      expiresAt: "2026-05-28T00:00:00.000Z",
    })
    const onCreated = vi.fn()
    const result = await render(<SignupInvitationAction onCreated={onCreated} />)
    cleanup = result.unmount

    await act(async () => {
      result.container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain("用户邀请链接")
      expect((document.body.querySelector("input") as HTMLInputElement).value)
        .toBe("https://app.example.com/dashboard/signup?invite=plain-token")
    })
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/dashboard/signup?invite=plain-token")
    expect(onCreated).not.toHaveBeenCalled()

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-slot='dialog-close']")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(onCreated).toHaveBeenCalled()
  })

  it("copies the dialog invite URL on demand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.mocked(adminApi.createSignupInvitation).mockResolvedValue({
      id: "invite-1",
      token: "plain-token",
      inviteUrl: "https://app.example.com/dashboard/signup?invite=plain-token",
      expiresAt: "2026-05-28T00:00:00.000Z",
    })
    const result = await render(<SignupInvitationAction onCreated={vi.fn()} />)
    cleanup = result.unmount

    await act(async () => {
      result.container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    vi.clearAllMocks()
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[aria-label='复制邀请链接']")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(writeText).toHaveBeenCalledWith("https://app.example.com/dashboard/signup?invite=plain-token")
  })

  it("keeps the invite URL visible when clipboard copy fails", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    vi.mocked(adminApi.createSignupInvitation).mockResolvedValue({
      id: "invite-1",
      token: "plain-token",
      inviteUrl: "https://app.example.com/dashboard/signup?invite=plain-token",
      expiresAt: "2026-05-28T00:00:00.000Z",
    })
    const onCreated = vi.fn()
    const result = await render(<SignupInvitationAction onCreated={onCreated} />)
    cleanup = result.unmount

    await act(async () => {
      result.container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect((document.body.querySelector("input") as HTMLInputElement).value)
        .toBe("https://app.example.com/dashboard/signup?invite=plain-token")
    })
    expect(onCreated).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("复制失败")
  })
})
