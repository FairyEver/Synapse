import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = () => readFileSync(resolve(__dirname, "../../prisma/migrations/20261104010000_skill_hub/migration.sql"), "utf8")

describe("Skill Hub migration safeguards", () => {
  it("requires one team and protects that team even when a Skill has been soft deleted", () => {
    const sql = migration()
    const skill = sql.match(/CREATE TABLE "SkillHubSkill" \([\s\S]*?\n\);/)?.[0]
    expect(skill).toContain('"teamId" TEXT NOT NULL')
    expect(skill).not.toMatch(/ownerId|visibility|teamIds/)
    expect(sql).toMatch(/FOREIGN KEY \("teamId"\) REFERENCES "Team"\("id"\) ON DELETE RESTRICT/)
    expect(sql).toMatch(/FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/)
    expect(sql).toMatch(/FOREIGN KEY \("maintainerUserId"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/)
  })

  it("cannot point at another Skill's version and deduplicates actor-scoped writes", () => {
    const sql = migration()
    expect(sql).toMatch(/FOREIGN KEY \("id", "currentVersionId"\) REFERENCES "SkillHubVersion"\("skillId", "id"\)/)
    expect(sql).toMatch(/UNIQUE INDEX "[^"]+" ON "SkillHubVersion"\("skillId", "number"\)/)
    expect(sql).toMatch(/UNIQUE INDEX "[^"]+" ON "SkillHubWriteReceipt"\("actorKey", "action", "requestId"\)/)
  })
})
