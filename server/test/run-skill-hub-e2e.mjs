import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

export function requireSkillHubE2eDatabase(value) {
  const parsed = new URL(requireLoopbackE2eDatabase(value, "SKILL_HUB_E2E_DATABASE_URL"))
  if (!/^\/[a-zA-Z0-9_]+_e2e$/u.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error("SKILL_HUB_E2E_DATABASE_URL requires a plain loopback PostgreSQL *_e2e database, without query or fragment")
  }
  return parsed.toString()
}

export function runSkillHubE2e(environment = process.env, spawn = spawnSync) {
  const database = requireSkillHubE2eDatabase(environment.SKILL_HUB_E2E_DATABASE_URL)
  const scratch = mkdtempSync(join(tmpdir(), "synapse-skill-hub-e2e-"))
  const cwd = fileURLToPath(new URL("..", import.meta.url))
  const inherited = Object.fromEntries(["PATH", "HOME", "USER", "TMPDIR", "SystemRoot", "ComSpec", "LANG"].flatMap(
    (key) => environment[key] === undefined ? [] : [[key, environment[key]]],
  ))
  const env = {
    ...inherited, NODE_ENV: "test", DATABASE_URL: database, SKILL_HUB_E2E_DATABASE_URL: database,
    SYNAPSE_SKILL_HUB_LOCAL_ROOT: scratch, APP_PUBLIC_URL: "http://127.0.0.1:19700",
    ADMIN_ACCESS_SECRET: randomBytes(48).toString("base64url"), USER_ACCESS_JWT_SECRET: randomBytes(48).toString("base64url"),
    DESKTOP_UPDATE_INTENT_SECRET: randomBytes(48).toString("base64url"),
  }
  try {
    for (const args of [
      ["--filter", "@synapse/shared", "run", "build"],
      ["exec", "prisma", "migrate", "deploy"],
      ["exec", "prisma", "generate"],
      ["run", "build:api"],
      ["--filter", "@synapse/desktop", "run", "build:electron"],
      ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts", "test/skill-hub.e2e.spec.ts"],
    ]) {
      const result = spawn("pnpm", args, { cwd, env, stdio: "inherit" })
      if (result.error) throw new Error("Could not start the Skill Hub E2E command")
      if (result.status !== 0) return result.status ?? 1
    }
    return 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = runSkillHubE2e() }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Skill Hub E2E failed"}\n`); process.exitCode = 1 }
}
