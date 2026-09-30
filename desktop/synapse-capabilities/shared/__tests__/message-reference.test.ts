import { describe, expect, it } from "vitest"
import {
  buildMailMessageReference,
  buildNotificationReference,
  parseMailMessageReference,
  parseNotificationReference,
} from "../message-reference"

describe("copied message references", () => {
  it("keeps the mail route and notification ID distinguishable", () => {
    expect(buildMailMessageReference("mail_1-2")).toBe("synapse://mail/mail_1-2")
    expect(parseMailMessageReference("synapse://mail/mail_1-2")).toBe("mail_1-2")
    expect(buildNotificationReference("notice_1-2")).toBe("synapse:notification:notice_1-2")
    expect(parseNotificationReference("synapse:notification:notice_1-2")).toBe("notice_1-2")
  })

  it.each(["", "a/b", "a?b", "a b", "a".repeat(201)])("rejects unsafe IDs: %s", (id) => {
    expect(() => buildMailMessageReference(id)).toThrow()
    expect(() => buildNotificationReference(id)).toThrow()
  })

  it.each([
    "synapse://notifications/n1",
    "synapse://mail/n1?extra=1",
    "synapse://mail/n1/extra",
    "synapse://mail/%6e1",
    "synapse:notification:n1#extra",
    "synapse:notification:n1/extra",
  ])("rejects changed or mismatched references: %s", (reference) => {
    expect(() => parseMailMessageReference(reference)).toThrow()
    expect(() => parseNotificationReference(reference)).toThrow()
  })
})
