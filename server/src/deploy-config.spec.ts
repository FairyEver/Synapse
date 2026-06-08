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

    expect(deployScript).toContain("backup_remote_database")
    expect(deployScript).toContain("synapse-online-before-deploy-${DEPLOY_ID}.sql")
    expect(deployScript).toContain("synapse-final-before-switch-${DEPLOY_ID}.sql")
    expect(deployScript).toContain("docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse")
    expect(deployScript).not.toContain("docker compose --env-file .env down")
    expect(deployScript).not.toContain("docker compose down")
  })

  it("preflights risky migrations and restores the previous service image on failed health checks", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain("check-prisma-migration-risk.mjs")
    expect(deployScript).toContain("fetch_applied_migrations")
    expect(deployScript).toContain("preflight_remote_migrations")
    expect(deployScript).toContain("synapse_preflight_${DEPLOY_ID}")
    expect(deployScript).toContain("ROLLBACK_IMAGE_TAG=\"rollback-${DEPLOY_ID}\"")
    expect(deployScript).toContain("tag_remote_rollback_image")
    expect(deployScript).toContain("rollback_remote_service")
    expect(deployScript).toContain("print_manual_database_restore_instructions")
    expect(deployScript).toContain("docker compose --env-file .env stop server")
    expect(deployScript).toContain("docker compose --env-file .env up -d --no-build server")
  })

  it("runs migrations in the foreground before starting the production process", () => {
    const dockerfile = readRepoFile("server/Dockerfile")
    const compose = readRepoFile("server/compose.yml")
    const entrypoint = readRepoFile("server/docker-entrypoint.sh")

    expect(dockerfile).toContain("COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh")
    expect(dockerfile).toContain('CMD ["sh", "server/docker-entrypoint.sh"]')
    expect(compose).toContain("image: synapse-server:${SYNAPSE_SERVER_IMAGE_TAG:-latest}")
    expect(compose).not.toContain("npx prisma migrate deploy && cd .. && node server/dist/main.js & nginx")
    expect(entrypoint).toContain("npx prisma migrate deploy")
    expect(entrypoint).toContain("nginx -t")
    expect(entrypoint).toContain("nginx -g 'daemon off;' &")
    expect(entrypoint).toContain("exec node server/dist/main.js")
  })

  it("includes the shared workspace package in the server Docker image", () => {
    const dockerfile = readRepoFile("server/Dockerfile")

    expect(dockerfile).toContain("COPY shared/package.json shared/package.json")
    expect(dockerfile).toContain("--filter @synapse/shared")
    expect(dockerfile).toContain("COPY --from=deps /app/shared/node_modules ./shared/node_modules")
    expect(dockerfile).toContain("COPY shared/ shared/")
    expect(dockerfile).toContain("COPY --from=build /app/shared ./shared")
  })

  it("documents the hardened deployment failure path", () => {
    const readme = readRepoFile("server/README.md")

    expect(readme).toContain("临时数据库预演")
    expect(readme).toContain("失败时自动回滚到上一版服务镜像")
    expect(readme).toContain("不会自动覆盖恢复数据库")
    expect(readme).toContain("synapse-final-before-switch")
  })

  it("keeps the old upgrade backup guarantees", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain("backup_remote_database")
    expect(deployScript).toContain('mkdir -p "$REMOTE_DIR/backups"')
    expect(deployScript).toContain("docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse")

    const backupStep = deployScript.indexOf('"在线备份远程数据库"')
    const syncStep = deployScript.indexOf('"同步代码到服务器"')
    const buildStep = deployScript.indexOf('"构建 Docker 镜像"')

    expect(backupStep).toBeGreaterThan(-1)
    expect(syncStep).toBeGreaterThan(-1)
    expect(buildStep).toBeGreaterThan(syncStep)
  })

  it("syncs the local server env file without overwriting protected database keys", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain('LOCAL_ENV_FILE="server/.env"')
    expect(deployScript).toContain('REMOTE_ENV_FILE="$REMOTE_DIR/server/.env"')
    expect(deployScript).toContain('PROTECTED_ENV_KEYS="POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB DATABASE_URL"')
    expect(deployScript).toContain("sync_remote_env")
    expect(deployScript).toContain("test -f \"$LOCAL_ENV_FILE\"")
    expect(deployScript).toContain("scp \"$LOCAL_ENV_FILE\" \"$SERVER:$remote_tmp\"")
    expect(deployScript).toContain("chmod 600 \"$remote_tmp\"")
    expect(deployScript).toContain(".env.backup-${DEPLOY_ID}")
    expect(deployScript).toContain("protected env keys kept from remote")
    expect(deployScript).toContain("docker compose --env-file .env config >/dev/null")
    expect(deployScript).toContain("--exclude='server/.env'")
    expect(deployScript).toContain("--exclude='server/.env.backup-*'")
    expect(deployScript).toContain("--exclude='server/.env.password-rotation-*'")
    expect(deployScript).toContain('"同步本机环境变量到服务器"')
    expect(deployScript).not.toContain("mv \"$remote_tmp\" \"$REMOTE_ENV_FILE\"")
    expect(deployScript).not.toContain("cat server/.env")
    expect(deployScript).not.toContain("grep '^COS_' server/.env")
  })

  it("checks database TCP authentication before deployment cutover and restart", () => {
    const deployScript = readRepoFile("deploy.sh")
    const restartScript = readRepoFile("restart.sh")

    expect(deployScript).toContain("verify_remote_database_auth")
    expect(deployScript).toContain("psql -h postgres -p 5432 -U synapse -d synapse")
    expect(deployScript.indexOf("verify_remote_database_auth")).toBeLessThan(deployScript.indexOf("stop_remote_server"))

    expect(restartScript).toContain("verify_remote_database_auth")
    expect(restartScript).toContain("psql -h postgres -p 5432 -U synapse -d synapse")
    expect(restartScript.indexOf("verify_remote_database_auth")).toBeLessThan(restartScript.indexOf("docker compose --env-file .env restart server"))
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
    const restartScript = readRepoFile("restart.sh")

    expect(deployScript).not.toContain("<title>Synapse</title>")
    expect(deployScript).toContain("run_remote_health_check")
    expect(deployScript).toContain("http://127.0.0.1:3000/healthz")
    expect(deployScript).toContain("http://127.0.0.1:3000/dashboard/")
    expect(deployScript).toContain("http://127.0.0.1:3000/webhooks/not-found/test")
    expect(deployScript).toContain("Location: /dashboard/")
    expect(deployScript).toContain("webhook route")
    expect(deployScript).toContain('<div id="root">')
    expect(deployScript).toContain("docker compose --env-file .env ps")
    expect(deployScript).toContain("docker compose --env-file .env logs --tail=80 server")

    expect(restartScript).toContain("http://127.0.0.1:3000/webhooks/not-found/test")
    expect(restartScript).toContain("webhook route")
  })

  it("routes public webhooks through nginx instead of dashboard redirects", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("location /webhooks/")
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3001")
  })

  it("forwards public origin and websocket upgrade headers to the api server", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("proxy_set_header X-Forwarded-Host $host")
    expect(nginx).toContain("proxy_set_header Upgrade $http_upgrade")
    expect(nginx).toContain("proxy_set_header Connection $connection_upgrade")
    expect(nginx).toContain("map $http_upgrade $connection_upgrade")
  })
})
