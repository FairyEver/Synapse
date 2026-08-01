import { describe, expect, it } from "vitest"
import {
  hasAccountProfile,
  isAccountOnline,
  isAccountUnavailable,
  type SynapseAccountProfile,
  type SynapseAccountState,
} from "../account"
import type { SynapseBridge } from "../bridge"

const profile = {
  user: { id: "u1", email: "u@example.com", handle: "u1", status: "active" },
  syncedAt: "2026-06-06T00:00:00.000Z",
} satisfies SynapseAccountProfile

const online = {
  status: "authenticated",
  connectivity: "online",
  profile,
} satisfies SynapseAccountState

const offline = {
  status: "authenticated",
  connectivity: "offline",
  offlineReason: "server_unavailable",
  profile: online.profile,
} satisfies SynapseAccountState

describe("account state helpers", () => {
  it("treats online authenticated accounts as available", () => {
    expect(hasAccountProfile(online)).toBe(true)
    expect(isAccountOnline(online)).toBe(true)
    expect(isAccountUnavailable(online)).toBe(false)
  })

  it("treats offline authenticated accounts as having a profile but unavailable", () => {
    expect(hasAccountProfile(offline)).toBe(true)
    expect(isAccountOnline(offline)).toBe(false)
    expect(isAccountUnavailable(offline)).toBe(true)
  })

  it("treats unauthenticated accounts as unavailable with no profile", () => {
    const state = { status: "unauthenticated" } satisfies SynapseAccountState
    expect(hasAccountProfile(state)).toBe(false)
    expect(isAccountOnline(state)).toBe(false)
    expect(isAccountUnavailable(state)).toBe(true)
  })

  it("exposes Drive site methods on the Drive bridge type", () => {
    type DriveSiteBridgeMethods = Pick<
      SynapseBridge["drive"]["site"],
      | "preflight"
      | "create"
      | "list"
      | "updateAccess"
      | "disable"
      | "enable"
      | "delete"
      | "republish"
    >
    const methodNames: Array<keyof DriveSiteBridgeMethods> = [
      "preflight",
      "create",
      "list",
      "updateAccess",
      "disable",
      "enable",
      "delete",
      "republish",
    ]
    expect(methodNames).toHaveLength(8)
  })
})
