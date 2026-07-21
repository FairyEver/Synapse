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
    expect(deployScript).toContain('docker compose --env-file .env exec -T postgres pg_dump -U "$postgres_user" "$postgres_db"')
    expect(deployScript).toContain("chmod 600 \"$BACKUP_FILE\"")
    expect(deployScript).not.toContain("docker compose --env-file .env down")
    expect(deployScript).not.toContain("docker compose down")
  })

  it("backs up deployment secrets and postgres globals without printing values", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain('ENV_BACKUP_FILE="$BACKUP_DIR/env/synapse-env-before-sync-${DEPLOY_ID}.env"')
    expect(deployScript).toContain('GLOBALS_BACKUP_FILE="$BACKUP_DIR/globals/synapse-globals-before-deploy-${DEPLOY_ID}.sql"')
    expect(deployScript).toContain("backup_remote_postgres_globals")
    expect(deployScript).toContain('pg_dumpall -U "$postgres_user" --globals-only')
    expect(deployScript).toContain("chmod 600 \"$ENV_BACKUP_FILE\"")
    expect(deployScript).toContain("chmod 600 \"$GLOBALS_BACKUP_FILE\"")
    expect(deployScript).not.toContain("backup_file=\"$(dirname \"$REMOTE_ENV_FILE\")/.env.backup-${DEPLOY_ID}\"")
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

  it("verifies the final database backup before starting the new service", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain("verify_final_backup_restore")
    expect(deployScript).toContain("synapse_final_verify_${DEPLOY_ID}")
    expect(deployScript).toContain('docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$verify_db" < "$FINAL_BACKUP_FILE"')

    const finalBackupStep = deployScript.indexOf('"最终备份远程数据库"')
    const finalVerifyStep = deployScript.indexOf('"恢复验证最终数据库备份"')
    const driveBackupStep = deployScript.indexOf('"备份本地 Drive 数据"')
    const startStep = deployScript.indexOf('"启动新服务"')

    expect(finalBackupStep).toBeGreaterThan(-1)
    expect(finalVerifyStep).toBeGreaterThan(finalBackupStep)
    expect(driveBackupStep).toBeGreaterThan(finalVerifyStep)
    expect(startStep).toBeGreaterThan(driveBackupStep)
  })

  it("prints the same deployment artifact summary on success and health-check failure", () => {
    const deployScript = readRepoFile("deploy.sh")

    expect(deployScript).toContain("print_deployment_artifacts")
    expect(deployScript).toContain("远端 .env 备份: $ENV_BACKUP_FILE")
    expect(deployScript).toContain("Postgres globals 备份: $GLOBALS_BACKUP_FILE")
    expect(deployScript).toContain("本地 Drive 备份: $(drive_backup_summary)")
    expect(deployScript).toContain("print_deployment_artifacts\n  print_manual_database_restore_instructions")
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
    expect(entrypoint).toContain("nginx_pid=$!")
    expect(entrypoint).toContain("node_pid=$!")
    expect(entrypoint).toContain("kill -0 \"$nginx_pid\"")
    expect(entrypoint).toContain("kill -0 \"$node_pid\"")
    expect(entrypoint).toContain("trap 'shutdown; exit 143' INT TERM")
  })

  it("checks the public nginx entrypoint health through compose", () => {
    const compose = readRepoFile("server/compose.yml")

    expect(compose).toContain("healthcheck:")
    expect(compose).toContain("http://127.0.0.1:3000/healthz")
    expect(compose).not.toContain("http://127.0.0.1:3001/healthz")
  })

  it("uses the configured postgres identity in compose", () => {
    const compose = readRepoFile("server/compose.yml")
    const envExample = readRepoFile("server/.env.example")

    expect(compose).toContain("POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER is required}")
    expect(compose).toContain("POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB is required}")
    expect(compose).toContain("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}")
    expect(compose).toContain("DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}")
    expect(compose).toContain("pg_isready -U ${POSTGRES_USER:?POSTGRES_USER is required} -d ${POSTGRES_DB:?POSTGRES_DB is required}")
    expect(compose).not.toContain("POSTGRES_PASSWORD:-synapse")
    expect(compose).not.toContain("POSTGRES_USER: synapse")
    expect(compose).not.toContain("POSTGRES_DB: synapse")
    expect(compose).not.toContain("postgresql://synapse:${POSTGRES_PASSWORD:-synapse}")
    expect(envExample).toContain("POSTGRES_USER=synapse")
    expect(envExample).toContain("POSTGRES_DB=synapse")
    expect(envExample).toContain("POSTGRES_PASSWORD=")
    expect(envExample).not.toContain("POSTGRES_PASSWORD=synapse")
  })

  it("provisions the dedicated desktop update intent secret without an example secret value", () => {
    const compose = readRepoFile("server/compose.yml")
    const envExample = readRepoFile("server/.env.example")
    const setupScript = readRepoFile("setup.sh")
    const deployScript = readRepoFile("deploy.sh")
    const readme = readRepoFile("server/README.md")

    expect(compose).toContain("DESKTOP_UPDATE_INTENT_SECRET: ${DESKTOP_UPDATE_INTENT_SECRET:?DESKTOP_UPDATE_INTENT_SECRET is required}")
    expect(envExample).toContain("DESKTOP_UPDATE_INTENT_SECRET=\n")
    expect(setupScript).toContain("DESKTOP_UPDATE_INTENT_SECRET=$(openssl rand -hex 32)")
    expect(setupScript).toContain("DESKTOP_UPDATE_INTENT_SECRET=$DESKTOP_UPDATE_INTENT_SECRET")
    expect(deployScript).toContain("DESKTOP_UPDATE_INTENT_SECRET")
    expect(readme).toContain("DESKTOP_UPDATE_INTENT_SECRET")
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
    expect(deployScript).toContain('mkdir -p "$(dirname "$BACKUP_FILE")"')
    expect(deployScript).toContain('docker compose --env-file .env exec -T postgres pg_dump -U "$postgres_user" "$postgres_db"')

    const backupStep = deployScript.indexOf('"在线备份远程数据库"')
    const syncStep = deployScript.indexOf('"同步代码到服务器"')
    const buildStep = deployScript.indexOf('"构建 Docker 镜像"')

    expect(backupStep).toBeGreaterThan(-1)
    expect(syncStep).toBeGreaterThan(-1)
    expect(buildStep).toBeGreaterThan(syncStep)
  })

  it("syncs the production server env file by replacing the remote env", () => {
    const deployScript = readRepoFile("deploy.sh")
    const dockerIgnore = readRepoFile(".dockerignore")

    expect(deployScript).toContain('LOCAL_ENV_FILE="server/.env.server"')
    expect(deployScript).toContain('REMOTE_ENV_FILE="$REMOTE_DIR/server/.env"')
    expect(deployScript).not.toContain("PROTECTED_ENV_KEYS")
    expect(deployScript).toContain("sync_remote_env")
    expect(deployScript).toContain("test -f \"$LOCAL_ENV_FILE\"")
    expect(deployScript).toContain("scp \"$LOCAL_ENV_FILE\" \"$SERVER:$remote_tmp\"")
    expect(deployScript).toContain("chmod 600 \"$remote_tmp\"")
    expect(deployScript).toContain("cleanup_env_sync_tmp()")
    expect(deployScript).toContain('rm -f "$remote_tmp"')
    expect(deployScript).toContain("trap cleanup_env_sync_tmp EXIT")
    expect(deployScript).toContain("synapse-env-before-sync-${DEPLOY_ID}.env")
    expect(deployScript).toContain("validate_env_file \"$remote_tmp\"")
    expect(deployScript).toContain("DATABASE_URL must use the compose service host postgres:5432 in production")
    expect(deployScript).toContain("docker compose --env-file \"$env_file\" config >/dev/null")
    expect(deployScript).toContain("cp \"$remote_tmp\" \"$REMOTE_ENV_FILE\"")
    expect(deployScript).toContain(".env replaced from %s and validated")
    expect(deployScript).toContain("--exclude='server/.env'")
    expect(deployScript).toContain("--exclude='server/.env.local'")
    expect(deployScript).toContain("--exclude='server/.env.server'")
    expect(dockerIgnore).toContain("**/.env.server")
    expect(deployScript).toContain("--exclude='server/.env.backup-*'")
    expect(deployScript).toContain("--exclude='server/.env.password-rotation-*'")
    expect(deployScript).toContain("--exclude='server/.env.merged-*'")
    expect(deployScript).toContain("--exclude='server/.env.tmp-*'")
    expect(deployScript).toContain('"同步本机环境变量到服务器"')
    expect(deployScript).not.toContain("protected env keys kept from remote")
    expect(deployScript).not.toContain("awk -v protected=")
    expect(deployScript).not.toContain("cat server/.env")
    expect(deployScript).not.toContain("grep '^COS_' server/.env")
  })

  it("checks database TCP authentication before deployment cutover and restart", () => {
    const deployScript = readRepoFile("deploy.sh")
    const restartScript = readRepoFile("restart.sh")

    expect(deployScript).toContain("verify_remote_database_auth")
    expect(deployScript).toContain('psql -h postgres -p 5432 -U "$postgres_user" -d "$postgres_db"')
    expect(deployScript.indexOf("verify_remote_database_auth")).toBeLessThan(deployScript.indexOf("stop_remote_server"))
    expect(deployScript).not.toContain("psql -h postgres -p 5432 -U synapse -d synapse")
    expect(deployScript).not.toContain("pg_dump -U synapse synapse")

    expect(restartScript).toContain("verify_remote_database_auth")
    expect(restartScript).toContain('psql -h postgres -p 5432 -U "$postgres_user" -d "$postgres_db"')
    expect(restartScript.indexOf("verify_remote_database_auth")).toBeLessThan(restartScript.indexOf("docker compose --env-file .env restart server"))
    expect(restartScript).not.toContain("psql -h postgres -p 5432 -U synapse -d synapse")
  })

  it("persists server file logs outside the rebuilt container", () => {
    const compose = readRepoFile("server/compose.yml")

    expect(compose).toContain("volumes:")
    expect(compose).toContain("- ./logs:/app/logs")
  })

  it("persists and protects local Drive fallback data during deployment", () => {
    const deployScript = readRepoFile("deploy.sh")
    const compose = readRepoFile("server/compose.yml")

    expect(compose).toContain("SYNAPSE_DRIVE_LOCAL_ROOT: /app/data/drive")
    expect(compose).toContain("- ./data/drive:/app/data/drive")
    expect(deployScript).toContain('DRIVE_BACKUP_FILE="$BACKUP_DIR/drive/synapse-drive-final-before-switch-${DEPLOY_ID}.tar.gz"')
    expect(deployScript).toContain("backup_remote_drive_fallback")
    expect(deployScript).toContain("tar -czf \"$DRIVE_BACKUP_FILE\" -C data drive")
    expect(deployScript).toContain("chmod 600 \"$DRIVE_BACKUP_FILE\"")
    expect(deployScript).toContain("read_env_value DRIVE_COS_SECRET_ID")
    expect(deployScript).toContain("read_env_value DRIVE_COS_SECRET_KEY")
    expect(deployScript).toContain("read_env_value DRIVE_COS_BUCKET")
    expect(deployScript).toContain("read_env_value DRIVE_COS_REGION")
    expect(compose).toContain("SKILL_REPOSITORY_COS_SECRET_ID: ${SKILL_REPOSITORY_COS_SECRET_ID:-}")
    expect(compose).toContain("SKILL_REPOSITORY_COS_SECRET_KEY: ${SKILL_REPOSITORY_COS_SECRET_KEY:-}")
    expect(compose).toContain("SKILL_REPOSITORY_COS_BUCKET: ${SKILL_REPOSITORY_COS_BUCKET:-}")
    expect(compose).toContain("SKILL_REPOSITORY_COS_REGION: ${SKILL_REPOSITORY_COS_REGION:-}")
    expect(compose).toContain("PLATFORM_MEDIA_COS_SECRET_ID: ${PLATFORM_MEDIA_COS_SECRET_ID:-}")
    expect(compose).toContain("PLATFORM_MEDIA_COS_SECRET_KEY: ${PLATFORM_MEDIA_COS_SECRET_KEY:-}")
    expect(compose).toContain("PLATFORM_MEDIA_COS_BUCKET: ${PLATFORM_MEDIA_COS_BUCKET:-}")
    expect(compose).toContain("PLATFORM_MEDIA_COS_REGION: ${PLATFORM_MEDIA_COS_REGION:-}")
    expect(compose).not.toContain(["SYNAPSE", "SKILL", "REPOSITORY", "LOCAL", "ROOT"].join("_"))
    expect(compose).not.toContain(["data", "skill-repository"].join("/"))
    expect(deployScript).not.toContain(["SKILL", "REPOSITORY", "BACKUP", "FILE"].join("_"))
    expect(deployScript).not.toContain(["backup", "remote", "skill", "repository", "fallback"].join("_"))
    expect(deployScript).not.toContain(["data", "skill-repository"].join(" "))
    expect(deployScript).not.toContain(`read_env_value ${["SKILL", "REPOSITORY", "COS", "SECRET", "ID"].join("_")}`)
    expect(deployScript).not.toContain("read_env_value BACKUP_COS_BUCKET")
    expect(deployScript).toContain("--exclude='server/data'")
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
    expect(deployScript).toContain("http://127.0.0.1:3000/console/")
    expect(deployScript).toContain("http://127.0.0.1:3000/webhooks/not-found/test")
    expect(deployScript).toContain("http://127.0.0.1:3000/share/shr_not_found")
    expect(deployScript).toContain("Location: /console/")
    expect(deployScript).toContain("webhook route")
    expect(deployScript).toContain("drive share route")
    expect(deployScript).toContain('<div id="root">')
    expect(deployScript).toContain("docker compose --env-file .env ps")
    expect(deployScript).toContain("docker compose --env-file .env logs --tail=80 server")

    expect(restartScript).toContain("http://127.0.0.1:3000/webhooks/not-found/test")
    expect(restartScript).toContain("webhook route")
    expect(restartScript).toContain("http://127.0.0.1:3000/share/shr_not_found")
    expect(restartScript).toContain("drive share route")
  })

  it("routes public webhooks through nginx instead of dashboard redirects", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("location /webhooks/")
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3001")
  })

  it("serves drive browser pages from the console bundle and proxies direct file responses", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("location ~ ^/drive/items/[^/]+/(download|render)$")
    expect(nginx).toContain("location ~ ^/share/[^/]+/(download|render)$")
    expect(nginx).toContain("location ~ ^/share/[^/]+/items/[^/]+/(download|render)$")
    expect(nginx).toContain("location /drive/items/")
    expect(nginx).toContain("location = /drive")
    expect(nginx).toContain("location = /drive/")
    expect(nginx).toContain("location /share/")
    expect(nginx).toContain("location /files/")
    expect(nginx).toContain("location /sites/")
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3001")
    expect(nginx).not.toContain("location /pages/")
    expect(nginx).not.toContain("download|zip")
    expect(nginx).toContain("alias /app/dashboard/dist/;")
    expect(nginx).toContain("try_files $uri $uri/ /console/index.html;")
  })

  it("keeps retired page publication routes out of nginx while serving sites", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).not.toContain("location /pages/")
    expect(nginx).toContain("location /sites/")
    expect(nginx).toContain("location /share/")
  })

  it("keeps drive browser pages inside the Vite SPA while proxying direct responses", () => {
    const viteConfig = readRepoFile("dashboard/vite.config.ts")

    expect(viteConfig).toContain("'^/drive/items/[^/]+/(download|render)$'")
    expect(viteConfig).toContain("'^/share/[^/]+/(download|render)$'")
    expect(viteConfig).toContain("'^/share/[^/]+/items/[^/]+/(download|render)$'")
    expect(viteConfig).toContain("'/files':")
    expect(viteConfig).not.toContain("download|zip")
  })

  it("serves the console bundle and redirects legacy dashboard paths", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("location = /console")
    expect(nginx).toContain("return 301 /console/;")
    expect(nginx).toContain("location /console/")
    expect(nginx).toContain("alias /app/dashboard/dist/;")
    expect(nginx).toContain("try_files $uri $uri/ /console/index.html;")
    expect(nginx).toContain("location = /dashboard")
    expect(nginx).toContain("return 301 /console/;")
    expect(nginx).toContain("location /dashboard/")
    expect(nginx).toContain("return 301 /console/$is_args$args;")
    expect(nginx).toContain("location ~ ^/dashboard/(.*)$")
    expect(nginx).toContain("return 301 /console/$1$is_args$args;")
    expect(nginx).toContain("return 302 /console/;")
  })

  it("forwards public origin and websocket upgrade headers to the api server", () => {
    const nginx = readRepoFile("server/nginx.conf")

    expect(nginx).toContain("proxy_set_header X-Forwarded-Host $host")
    expect(nginx).toContain("proxy_set_header Upgrade $http_upgrade")
    expect(nginx).toContain("proxy_set_header Connection $connection_upgrade")
    expect(nginx).toContain("map $http_upgrade $connection_upgrade")
  })
})
