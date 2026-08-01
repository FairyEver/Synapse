import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/20260731160000_drop_teams_and_invitations/migration.sql",
)
const migration = readFileSync(migrationPath, "utf8")

describe("team domain removal migration", () => {
  it("deletes only explicitly attributed team and invitation audit history", () => {
    expect(migration).toContain('"targetType" IN (\'team\', \'invitation\')')
    expect(migration).toContain('"action" LIKE \'team.%\'')
    expect(migration).toContain('"action" LIKE \'teams.%\'')
    expect(migration).toContain('"action" LIKE \'admin.team%\'')
    expect(migration).toContain('"action" LIKE \'admin.invitation%\'')
    expect(migration).not.toMatch(/detail.*LIKE/is)
  })

  it("drops the retired relations before their parent table and enum types", () => {
    const statements = [
      'DROP TABLE "Invitation";',
      'DROP TABLE "TeamMembership";',
      'DROP TABLE "Team";',
      'DROP TYPE "InvitationCreatorType";',
      'DROP TYPE "InvitationType";',
      'DROP TYPE "TeamRole";',
    ]
    const offsets = statements.map(statement => migration.indexOf(statement))

    expect(offsets.every(offset => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
  })

  it("preserves user, session, permission, drive, and audit tables", () => {
    for (const table of ["User", "UserSession", "UserModulePermission", "DriveItem", "AuditLog"]) {
      expect(migration).not.toContain(`DROP TABLE "${table}"`)
    }
  })
})
