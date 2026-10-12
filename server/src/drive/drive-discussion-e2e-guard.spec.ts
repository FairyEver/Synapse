import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

describe("dedicated drive discussion database guard", () => {
  it.each([
    undefined, "", "postgresql://user:secret@db.example/test_e2e", "mysql://user:secret@localhost/test_e2e",
    "postgresql://user:secret@localhost/synapse", "postgresql://user:secret@localhost/test%ZZ_e2e",
  ])("rejects unsafe configuration without exposing credentials", async (value) => {
    const { requireLoopbackE2eDatabase } = await import("../../test/e2e-database-guard.mjs")
    let error: unknown
    try { requireLoopbackE2eDatabase(value, "DRIVE_DISCUSSION_E2E_DATABASE_URL") } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain("secret")
    expect(String(error)).not.toContain("user:")
  })
  it.each(["localhost", "127.0.0.1", "[::1]"])("allows a dedicated %s test database", async (host) => {
    const { requireLoopbackE2eDatabase } = await import("../../test/e2e-database-guard.mjs")
    const value = `postgresql://localhost-user:password@${host}:5432/drive_e2e`
    expect(requireLoopbackE2eDatabase(value, "DRIVE_DISCUSSION_E2E_DATABASE_URL")).toBe(value)
  })
  it("the runner rejects before launching migrations or tests", () => {
    const child = spawnSync(process.execPath, ["test/run-drive-discussion-e2e.mjs"], {
      cwd: process.cwd(), encoding: "utf8", env: { PATH: "", DRIVE_DISCUSSION_E2E_DATABASE_URL: "postgresql://user:secret@remote.example/business" },
    })
    expect(child.status).toBe(1)
    expect(child.stderr).toContain("DRIVE_DISCUSSION_E2E_DATABASE_URL")
    expect(child.stderr).not.toContain("secret")
    expect(child.stderr).not.toContain("spawn pnpm")
  })
})
