// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"

import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"

afterEach(() => {
  delete (window as unknown as { synapse?: unknown }).synapse
})

describe("isAccountUiVisible", () => {
  it("hides account UI in packaged builds", () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    expect(isAccountUiVisible()).toBe(false)
  })

  it("keeps account UI visible in development builds", () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: false,
    }

    expect(isAccountUiVisible()).toBe(true)
  })

  it("keeps account UI visible when the bridge is unavailable", () => {
    expect(isAccountUiVisible()).toBe(true)
  })
})
