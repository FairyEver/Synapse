import { spawnSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

let container
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr ?? ""}`)
  return result.stdout.trim()
}
try {
  let database = process.env.CLOUD_TABLE_E2E_DATABASE_URL
  if (!database) {
    const password = randomUUID(), name = `synapse-cloud-tables-e2e-${randomUUID().slice(0, 8)}`
    container = run("docker", ["run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=cloud_tables_e2e", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine"])
    let ready = false
    for (let i = 0; i < 120; i++) {
      const result = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "cloud_tables_e2e"], { stdio: "ignore" })
      if (result.status === 0) { ready = true; break }
      await setTimeout(250)
    }
    if (!ready) throw new Error("Temporary cloud-table PostgreSQL did not become ready")
    const port = run("docker", ["port", container, "5432/tcp"]).split(":").at(-1)
    database = `postgresql://postgres:${password}@127.0.0.1:${port}/cloud_tables_e2e`
  }
  database = requireLoopbackE2eDatabase(database, "CLOUD_TABLE_E2E_DATABASE_URL")
  const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: database, CLOUD_TABLE_E2E_DATABASE_URL: database, ADMIN_ACCESS_SECRET: randomBytes(32).toString("base64url"), USER_ACCESS_JWT_SECRET: randomBytes(32).toString("base64url"), DESKTOP_UPDATE_INTENT_SECRET: randomBytes(32).toString("base64url"), MOBILE_LIVE_ENABLED: "false", PDF_RENDERER_URL: "", PDF_RENDERER_INTERNAL_SECRET: "" }
  // 专用数据库测试不得继承真实外部存储/推送凭据。
  for (const prefix of ["DRIVE_COS", "SKILL_REPOSITORY_COS", "PLATFORM_MEDIA_COS", "MAIL_COS", "BACKUP_COS"]) for (const suffix of ["SECRET_ID", "SECRET_KEY", "BUCKET", "REGION"]) env[`${prefix}_${suffix}`] = ""
  for (const name of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_PATH"]) env[name] = ""
  const commands = [
    ["--filter", "@synapse/shared", "run", "build"],
    ["exec", "prisma", "migrate", "deploy"],
    ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts", "test/cloud-tables.e2e.spec.ts"],
  ]
  for (const args of commands) {
    const result = spawnSync("pnpm", args, { env, stdio: "inherit" })
    if (result.status !== 0) throw new Error("Cloud-table verification failed")
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
finally { if (container) spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" }) }
