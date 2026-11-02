import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

export function runPokerCardE2e(environment = process.env, spawn = spawnSync) {
  const database = requireLoopbackE2eDatabase(environment.GAME_E2E_DATABASE_URL, "GAME_E2E_DATABASE_URL")
  const commands = [
    ["--filter", "@synapse/shared", "run", "build"],
    ["exec", "prisma", "migrate", "deploy"],
    ["exec", "prisma", "generate"],
    ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts", "test/poker-card.e2e.spec.ts"],
  ]
  for (const args of commands) {
    const result = spawn("pnpm", args, { stdio: "inherit", env: { ...environment, DATABASE_URL: database, GAME_POKER_CARD_MODE_ENABLED: "true" } })
    if (result.error) throw new Error("Poker card e2e command could not start")
    if (result.status !== 0) return result.status ?? 1
  }
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = runPokerCardE2e() }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
