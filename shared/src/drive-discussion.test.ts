import { describe, expect, it } from "vitest"
import * as discussion from "./index"

describe("Drive discussion locations", () => {
  it("round trips the exact annotation reply without losing the comment ID", () => {
    const location = { kind: "annotation", threadId: "thread_1", commentId: "comment_2" } as const
    expect(discussion.buildDriveDiscussionFragment(location)).toBe("#discussion=annotation&threadId=thread_1&commentId=comment_2")
    expect(discussion.parseDriveDiscussionFragment("#discussion=annotation&threadId=thread_1&commentId=comment_2")).toEqual(location)
  })
  it("distinguishes a root message from a nested reply", () => {
    expect(discussion.parseDriveDiscussionFragment("#discussion=message&messageId=m1")).toEqual({ kind: "message", messageId: "m1", commentId: null })
    expect(discussion.parseDriveDiscussionFragment("#discussion=message&messageId=m1&commentId=c2")).toEqual({ kind: "message", messageId: "m1", commentId: "c2" })
  })
  it.each([
    "#discussion=annotation&threadId=t1", "#discussion=message&messageId=m1&threadId=t1",
    "#discussion=annotation&threadId=t1&commentId=c1&commentId=c2",
    "#discussion=annotation&threadId=t1&commentId=c%2F1",
    "#discussion=message&messageId=m1&selector=body", "#discussion=other&messageId=m1",
    "#discussion=message&messageId=", "#heading",
  ])("rejects invalid or unrelated fragment %s", (hash) => {
    expect(discussion.parseDriveDiscussionFragment(hash)).toBeNull()
  })
  it("restricts notification navigation to the canonical HTTPS path", () => {
    expect(discussion.buildDriveDiscussionNotificationOpenUrl("https://synapse.test/console", "n1")).toBe("https://synapse.test/notifications/n1/open")
    expect(() => discussion.buildDriveDiscussionNotificationOpenUrl("https://synapse.test", "../n1")).toThrow()
    expect(() => discussion.buildDriveDiscussionNotificationOpenUrl("http://synapse.test", "n1")).toThrow()
    expect(discussion.isDriveDiscussionNotificationOpenPath("/notifications/n1/open")).toBe(true)
    expect(discussion.isDriveDiscussionNotificationOpenPath("/notifications/n1/open/other")).toBe(false)
    expect(discussion.isDriveDiscussionNotificationOpenPath("/notifications/n%2F1/open")).toBe(false)
  })
})
