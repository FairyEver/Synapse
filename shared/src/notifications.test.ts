import { describe, expect, it } from "vitest"
import * as discussion from "./index"

describe("notification discussion actions", () => {
  it("labels a new comment, message and either reply by the actual action", () => {
    expect(discussion.getDriveDiscussionActionLabel({ kind: "annotation", action: "created" })).toBe("查看评论")
    expect(discussion.getDriveDiscussionActionLabel({ kind: "message", action: "created" })).toBe("查看留言")
    expect(discussion.getDriveDiscussionActionLabel({ kind: "annotation", action: "replied" })).toBe("查看回复")
    expect(discussion.getDriveDiscussionActionLabel({ kind: "message", action: "replied" })).toBe("查看回复")
  })
  it("allows old notification payloads without metadata", () => {
    expect(discussion.getDriveDiscussionActionLabel()).toBe("查看文档")
  })
})
