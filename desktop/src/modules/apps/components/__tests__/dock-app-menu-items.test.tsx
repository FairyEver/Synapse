import { describe, expect, it } from "vitest"
import { resolveDockAppMenuActions } from "../dock-app-menu-items"

describe("resolveDockAppMenuActions", () => {
  it("offers pin for unpinned apps", () => {
    expect(resolveDockAppMenuActions({ pinned: false, removable: true })).toEqual(["open", "pin", "manage"])
  })

  it("offers unpin for pinned removable apps", () => {
    expect(resolveDockAppMenuActions({ pinned: true, removable: true })).toEqual(["open", "unpin", "manage"])
  })

  it("does not offer unpin for pinned non-removable apps", () => {
    expect(resolveDockAppMenuActions({ pinned: true, removable: false })).toEqual(["open", "manage"])
  })

  it("can omit pin actions for Dock-only menus", () => {
    expect(resolveDockAppMenuActions({ pinned: true, removable: true, includePinAction: false }))
      .toEqual(["open", "unpin", "manage"])
    expect(resolveDockAppMenuActions({ pinned: false, removable: true, includePinAction: false }))
      .toEqual(["open", "manage"])
  })
})
