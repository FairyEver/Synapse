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

  it("shows and copies the full invite URL after creation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.mocked(adminApi.createSignupInvitation).mockResolvedValue({
      id: "invite-1",
      token: "plain-token",
      inviteUrl: "https://app.example.com/invite#token=plain-token",
      expiresAt: "2026-05-28T00:00:00.000Z",
    })
    const onCreated = vi.fn()
    const result = await render(<SignupInvitationAction onCreated={onCreated} />)
    cleanup = result.unmount

    await act(async () => {
      result.container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect((result.container.querySelector("input") as HTMLInputElement).value)
        .toBe("https://app.example.com/invite#token=plain-token")
    })
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/invite#token=plain-token")
    expect(onCreated).toHaveBeenCalled()
  })

  it("keeps the invite URL visible when clipboard copy fails", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    vi.mocked(adminApi.createSignupInvitation).mockResolvedValue({
      id: "invite-1",
      token: "plain-token",
      inviteUrl: "https://app.example.com/invite#token=plain-token",
      expiresAt: "2026-05-28T00:00:00.000Z",
    })
    const onCreated = vi.fn()
    const result = await render(<SignupInvitationAction onCreated={onCreated} />)
    cleanup = result.unmount

    await act(async () => {
      result.container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect((result.container.querySelector("input") as HTMLInputElement).value)
        .toBe("https://app.example.com/invite#token=plain-token")
    })
    expect(onCreated).toHaveBeenCalled()
    expect(result.container.textContent).toContain("复制失败")
  })
})
