import { spawnSync } from "node:child_process"
import { requireDriveDiscussionTestDatabase } from "./drive-discussion-e2e-database-guard.mjs"

let database
try { database = requireDriveDiscussionTestDatabase(process.env.DRIVE_DISCUSSION_E2E_DATABASE_URL) }
catch (error) { process.stderr.write(error.message + "\n"); process.exit(1) }
const commands = [
  ["--filter", "@synapse/shared", "run", "build"],
  ["exec", "prisma", "migrate", "deploy"],
  ["exec", "prisma", "generate"],
  ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts", "test/drive-discussion-commit.e2e.spec.ts", "test/drive-discussion-delivery-races.e2e.spec.ts"],
]
for (const args of commands) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env: { ...process.env, DATABASE_URL: database } })
  if (result.error) { process.stderr.write("Drive discussion e2e command could not start\n"); process.exit(1) }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
