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

function manualRestoreScript(env: NodeJS.ProcessEnv): string {
  const start = deployScript.indexOf("\nprint_manual_database_restore_instructions() {")
  expect(start).toBeGreaterThan(-1)
  const definition = deployScript.slice(start).match(/^[\s\S]*?\nEOF\n\}/u)?.[0]
  expect(definition).toBeDefined()
  const rendered = spawnSync("bash", ["-c", `${definition}\nprint_manual_database_restore_instructions`], {
    env, encoding: "utf8", timeout: 5_000,
  })
  expect(rendered.status).toBe(0)
  const commands = rendered.stdout.split("\n\n").find((block) => block.startsWith("  ssh "))
  expect(commands).toBeDefined()
  return commands!.split("\n").slice(1).join("\n")
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
const attached = args[0] === 'compose' && (args.includes('exec') || args.includes('run'))
const stdin = attached ? fs.readFileSync(0, 'utf8') : ''
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
  const rendererState = join(dir, "pdf-renderer.state")
  writeFileSync(rendererState, env.SYNTHETIC_RENDERER_STATE ?? "present\n")
  const environment = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    DOCKER_CALLS: log,
    SERVER: "synthetic-host",
    REMOTE_DIR: dir,
    BACKUP_FILE: backup,
    GLOBALS_BACKUP_FILE: backup,
    ONLINE_BACKUP_FILE: dump,
    FINAL_BACKUP_FILE: dump,
    ENV_BACKUP_FILE: join(dir, "synthetic.env"),
    PDF_RENDERER_ROLLBACK_STATE_FILE: rendererState,
    ROLLBACK_IMAGE_TAG: "synthetic-rollback",
    DEPLOY_ID: "synthetic_stdin_test",
    NEW_IMAGE_TAG: "synthetic-candidate",
    MAIL_LEGACY_CUTOVER: "",
    ...env,
  }
  const manual = functionName === "print_manual_database_restore_instructions"
  const result = spawnSync("bash", ["-s"], {
    cwd: join(dir, "server"),
    input: manual ? manualRestoreScript(environment) : `${remoteScript(functionName)}\nprintf 'REMOTE_SCRIPT_COMPLETE\\n'\n`,
    encoding: "utf8",
    timeout: 5_000,
    env: environment,
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

  it("starts the rollback image only after the printed manual restore commands succeed", () => {
    const { result, calls } = runRemote("print_manual_database_restore_instructions")
    expect(result.status).toBe(0)
    expect(calls.some((call) => call.stdin === fixtureSql && call.args.includes("ON_ERROR_STOP=1"))).toBe(true)
    expect(calls.some((call) => call.args.includes("up"))).toBe(true)
  })

  it("keeps the service stopped when the printed manual restore encounters a SQL error", () => {
    const { result, calls } = runRemote("print_manual_database_restore_instructions", { FAIL_RESTORE: "1" })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("synthetic SQL restore error")
    expect(calls.some((call) => call.args.includes("stop"))).toBe(true)
    expect(calls.some((call) => call.args.includes("up"))).toBe(false)
  })

  it("restores only the API when the previous renderer was absent", () => {
    const { result, calls } = runRemote("print_manual_database_restore_instructions", { SYNTHETIC_RENDERER_STATE: "absent\n" })
    expect(result.status).toBe(0)
    expect(calls.find((call) => call.args.includes("up"))?.args).toContain("--no-deps")
  })

  it("keeps services stopped for an unknown renderer rollback state", () => {
    const { result, calls } = runRemote("print_manual_database_restore_instructions", { SYNTHETIC_RENDERER_STATE: "invalid\n" })
    expect(result.status).not.toBe(0)
    expect(calls.some((call) => call.args.includes("up"))).toBe(false)
  })
})
