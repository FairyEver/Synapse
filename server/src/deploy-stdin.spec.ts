import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "..", "deploy.sh"), "utf8")
const workspaces: string[] = []
const fixtureSql = "SELECT 'synapse-deploy-restore-fixture';\n"

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function remoteScript(functionName: string): string {
  const start = deployScript.indexOf(`\n${functionName}() {`)
  expect(start).toBeGreaterThan(-1)
  const body = deployScript.slice(start).match(/<<'REMOTE_SCRIPT'\n([\s\S]*?)\nREMOTE_SCRIPT/u)?.[1]
  expect(body).toBeDefined()
  return body!
}

function runRemote(functionName: string, env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "synapse-deploy-stdin-"))
  workspaces.push(dir)
  mkdirSync(join(dir, "server"))
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "server", ".env"), "POSTGRES_USER=test_user\nPOSTGRES_DB=test_db\nPOSTGRES_PASSWORD=synthetic-only\n")
  const dump = join(dir, "dump.sql")
  const log = join(dir, "docker.jsonl")
  writeFileSync(dump, fixtureSql)
  const docker = join(dir, "bin", "docker")
  writeFileSync(docker, `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
// Compose exec/run attach stdin by default, even when the command does not read it.
const stdin = fs.readFileSync(0, 'utf8')
fs.appendFileSync(process.env.DOCKER_CALLS, JSON.stringify({ args, stdin }) + '\\n')
if (args.includes('pg_dump') || args.includes('pg_dumpall')) process.stdout.write('synthetic backup\\n')
if (process.env.FAIL_MIGRATION === '1' && args.includes('run')) process.exit(9)
if (process.env.FAIL_RESTORE === '1' && args.includes('psql') && stdin.includes('synapse-deploy-restore-fixture')) {
  process.stderr.write('synthetic SQL restore error\\n')
  process.exit(args.includes('ON_ERROR_STOP=1') ? 3 : 0)
}
`)
  chmodSync(docker, 0o755)
  const backup = join(dir, "backup.sql")
  const result = spawnSync("bash", ["-s"], {
    cwd: join(dir, "server"),
    input: `${remoteScript(functionName)}\nprintf 'REMOTE_SCRIPT_COMPLETE\\n'\n`,
    encoding: "utf8",
    timeout: 5_000,
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      DOCKER_CALLS: log,
      REMOTE_DIR: dir,
      BACKUP_FILE: backup,
      GLOBALS_BACKUP_FILE: backup,
      ONLINE_BACKUP_FILE: dump,
      FINAL_BACKUP_FILE: dump,
      DEPLOY_ID: "synthetic_stdin_test",
      NEW_IMAGE_TAG: "synthetic-candidate",
      MAIL_LEGACY_CUTOVER: "",
      ...env,
    },
  })
  expect(result.error).toBeUndefined()
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[], stdin: string })
  return { result, calls, backup }
}

describe.skipIf(process.platform === "win32")("deployment commands preserve the remote shell input", () => {
  for (const functionName of ["backup_remote_database", "backup_remote_postgres_globals"]) {
    it(`${functionName} verifies and protects its dump after Docker exits`, () => {
      const { result, calls, backup } = runRemote(functionName)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("backup saved:")
      expect(result.stdout).toContain("REMOTE_SCRIPT_COMPLETE")
      expect(calls.every((call) => call.stdin === "")).toBe(true)
      expect(readFileSync(backup, "utf8")).toBe("synthetic backup\n")
      expect(statSync(backup).mode & 0o777).toBe(0o600)
    })
  }

  it("runs the complete restored-database migration rehearsal before confirming success", () => {
    const { result, calls } = runRemote("preflight_remote_migrations")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("preflight migration ok:")
    expect(result.stdout).toContain("REMOTE_SCRIPT_COMPLETE")
    expect(calls.some((call) => call.args.includes("createdb"))).toBe(true)
    expect(calls.find((call) => call.stdin === fixtureSql)?.args).toContain("psql")
    expect(calls.find((call) => call.args.includes("run"))?.stdin).toBe("")
    expect(calls.filter((call) => call.args.includes("dropdb"))).toHaveLength(2)
    expect(calls.filter((call) => call.stdin !== fixtureSql).every((call) => call.stdin === "")).toBe(true)
  })

  it("checks the restored final backup and reaches the completion marker", () => {
    const { result, calls } = runRemote("verify_final_backup_restore")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("final backup restore verified:")
    expect(result.stdout).toContain("REMOTE_SCRIPT_COMPLETE")
    expect(calls.some((call) => call.args.includes("createdb"))).toBe(true)
    expect(calls.some((call) => call.stdin === fixtureSql && call.args.includes("psql"))).toBe(true)
    expect(calls.some((call) => call.args.includes("select 1") && call.stdin === "")).toBe(true)
    expect(calls.filter((call) => call.args.includes("dropdb"))).toHaveLength(2)
  })

  for (const functionName of ["preflight_remote_migrations", "verify_final_backup_restore"]) {
    it(`${functionName} rejects SQL restore errors instead of reporting success`, () => {
      const { result, calls } = runRemote(functionName, { FAIL_RESTORE: "1" })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("synthetic SQL restore error")
      expect(result.stdout).not.toContain("REMOTE_SCRIPT_COMPLETE")
      expect(result.stdout).not.toMatch(/preflight migration ok:|final backup restore verified:/u)
      expect(calls.filter((call) => call.args.includes("dropdb"))).toHaveLength(2)
    })
  }

  it("rejects a migration failure and cleans up the rehearsal database", () => {
    const { result, calls } = runRemote("preflight_remote_migrations", { FAIL_MIGRATION: "1" })
    expect(result.status).toBe(9)
    expect(result.stdout).not.toContain("preflight migration ok:")
    expect(result.stdout).not.toContain("REMOTE_SCRIPT_COMPLETE")
    expect(calls.filter((call) => call.args.includes("dropdb"))).toHaveLength(2)
  })

  it("preserves explicit SQL heredocs without giving Docker the remaining shell commands", () => {
    const { result, calls } = runRemote("fetch_applied_migrations")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("REMOTE_SCRIPT_COMPLETE")
    expect(calls[0]?.stdin).toBe("SELECT to_regclass('public._prisma_migrations');\n")
  })
})
