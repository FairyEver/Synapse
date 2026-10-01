import { describe, expect, it } from "vitest"
import { alignmentFingerprint, planDriveSyncAlignment, type AlignmentEntry } from "../drive-sync-alignment"
const file = (relativePath: string, hash: string): AlignmentEntry => ({ relativePath, kind: "file", hash })
const folder = (relativePath: string): AlignmentEntry => ({ relativePath, kind: "folder", hash: null })
describe("explicit initial sync alignment", () => {
  it("mirrors local edits, additions and target-only paths without merging", () => {
    expect(planDriveSyncAlignment([file("same", "a"), file("edit", "b"), file("new", "c")], [file("same", "a"), file("edit", "x"), file("extra", "y")], "local")).toEqual({
      unchanged: 1, changes: [
        { relativePath: "edit", kind: "file", action: "upload" },
        { relativePath: "new", kind: "file", action: "upload" },
        { relativePath: "extra", kind: "file", action: "delete_remote" },
      ],
    })
  })
  it("mirrors cloud authority and deletes children before their parent", () => {
    expect(planDriveSyncAlignment([folder(""), folder("old"), file("old/a", "a")], [file("new/a", "b"), folder("new"), folder("")], "remote").changes).toEqual([
      { relativePath: "new", kind: "folder", action: "download" },
      { relativePath: "new/a", kind: "file", action: "download" },
      { relativePath: "old/a", kind: "file", action: "delete_local" },
      { relativePath: "old", kind: "folder", action: "delete_local" },
    ])
  })
  it("blocks type replacement instead of accidentally deleting excluded descendants", () => {
    expect(() => planDriveSyncAlignment([file("x", "a")], [folder("x")], "local")).toThrow("类型不一致")
  })
  it("invalidates approval when bytes, identity, account, scope or authority change", () => {
    const content = [file("a", "original")]
    const token = alignmentFingerprint({ owner: "one", authority: "local" }, content, content)
    expect(alignmentFingerprint({ owner: "one", authority: "local" }, content, [file("a", "changed")])).not.toBe(token)
    expect(alignmentFingerprint({ owner: "two", authority: "local" }, content, content)).not.toBe(token)
    expect(alignmentFingerprint({ owner: "one", authority: "remote" }, content, content)).not.toBe(token)
  })
})
