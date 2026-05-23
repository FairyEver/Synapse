import { describe, expect, it } from "vitest"
import { buildBackupKey, buildPgDumpOptions } from "./backup.service"

describe("buildPgDumpOptions", () => {
  it("keeps database passwords out of pg_dump command arguments", () => {
    const databaseUrl = "postgresql://synapse_user:secret%40pass@localhost:5433/synapse?sslmode=require"

    const options = buildPgDumpOptions(databaseUrl, "/tmp/dump.sql", { PATH: "/usr/bin" })

    expect(options.args).toEqual([
      "-h",
      "localhost",
      "-p",
      "5433",
      "-U",
      "synapse_user",
      "-d",
      "synapse",
      "-f",
      "/tmp/dump.sql",
    ])
    expect(options.args.join(" ")).not.toContain("secret")
    expect(options.args).not.toContain(databaseUrl)
    expect(options.env.PGPASSWORD).toBe("secret@pass")
    expect(options.env.PGSSLMODE).toBe("require")
  })
})

describe("buildBackupKey", () => {
  it("rejects path traversal filenames", () => {
    expect(() => buildBackupKey("backups/", "../dump.tar.gz")).toThrow("备份文件名无效。")
    expect(() => buildBackupKey("backups/", "nested/dump.tar.gz")).toThrow("备份文件名无效。")
    expect(() => buildBackupKey("backups/", "nested\\dump.tar.gz")).toThrow("备份文件名无效。")
  })

  it("builds keys for plain backup filenames", () => {
    expect(buildBackupKey("backups/", "synapse-backup.tar.gz")).toBe("backups/synapse-backup.tar.gz")
  })
})
