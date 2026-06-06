import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repositoryRoot = join(process.cwd(), "..")

function readRepoFile(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8")
}

describe("server deployment configuration", () => {
  it("backs up the remote database before syncing and rebuilding", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain("TOTAL_STEPS=9")
    expect(deployScript).toContain("backup_remote_database")
    expect(deployScript).toContain('mkdir -p "$REMOTE_DIR/backups"')
    expect(deployScript).toContain("synapse-before-deploy-$(date +%Y%m%d_%H%M%S).sql")
    expect(deployScript).toContain("docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse")

    const backupStep = deployScript.indexOf('step 3 "备份远程数据库"')
    const syncStep = deployScript.indexOf('step 4 "同步代码到服务器"')
    const buildStep = deployScript.indexOf('"构建 Docker 镜像"')

    expect(backupStep).toBeGreaterThan(-1)
    expect(syncStep).toBeGreaterThan(backupStep)
    expect(buildStep).toBeGreaterThan(syncStep)
  })

  it("persists server file logs outside the rebuilt container", () => {
    const compose = readRepoFile("server/compose.yml")

    expect(compose).toContain("volumes:")
    expect(compose).toContain("- ./logs:/app/logs")
  })

  it("documents the dashboard package instead of the retired server admin frontend", () => {
    const readme = readRepoFile("server/README.md")

    expect(readme).not.toContain("server/admin")
    expect(readme).toContain("dashboard/")
    expect(readme).toContain("bash deploy.sh")
    expect(readme).toContain("/www/wwwroot/synapse/backups")
  })

  it("uses stable deployment health checks with actionable diagnostics", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).not.toContain("<title>Synapse</title>")
    expect(deployScript).toContain("run_remote_health_check")
    expect(deployScript).toContain("http://127.0.0.1:3000/healthz")
    expect(deployScript).toContain("http://127.0.0.1:3000/dashboard/")
    expect(deployScript).toContain("Location: /dashboard/")
    expect(deployScript).toContain('<div id="root">')
    expect(deployScript).toContain("docker compose --env-file .env ps")
    expect(deployScript).toContain("docker compose --env-file .env logs --tail=80 server")
  })
})
