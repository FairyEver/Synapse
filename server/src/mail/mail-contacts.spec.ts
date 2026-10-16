import { describe, expect, it } from "vitest"
import { mailContactsQuery } from "./mail-contacts"

describe("historical mail contacts query boundaries", () => {
  it("binds the authenticated reader and only includes their non-deleted inbox copies", () => {
    const userId = "reader' OR 1=1 --"
    const query = mailContactsQuery(userId, "inbox")
    expect(query.values).toEqual([userId])
    expect(query.text).not.toContain(userId)
    expect(query.text).toContain('r."userId" = $1 AND r."deletedAt" IS NULL')
    expect(query.text).toContain('CASE WHEN r."readAt" IS NULL THEN 1 ELSE 0 END')
    expect(query.text).not.toMatch(/LIMIT|"senderDeletedAt"/)
    expect(query.text).toContain('ORDER BY "lastSentAt" DESC, key ASC')
  })

  it("scopes both sent address snapshots and legacy recipient fallback to the sender's visible copies", () => {
    const query = mailContactsQuery("writer", "sent")
    expect(query.values).toEqual(["writer", "writer"])
    expect(query.text).toContain('m."senderId" = $1 AND m."senderDeletedAt" IS NULL')
    expect(query.text).toContain('m."senderId" = $2 AND m."senderDeletedAt" IS NULL AND m."addressSnapshot" IS NULL')
    expect(query.text).toContain('m."addressSnapshot"->\'to\'')
    expect(query.text).toContain('m."addressSnapshot"->\'cc\'')
    expect(query.text).not.toMatch(/OrganizationMembership|LIMIT|r\."deletedAt"/)
  })
})
