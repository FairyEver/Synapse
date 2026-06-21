#!/bin/bash
# 本机运行：打包代码并上传到服务器
set -euo pipefail

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"
LOCAL_ENV_FILE="server/.env.server"
REMOTE_ENV_FILE="$REMOTE_DIR/server/.env"
DEPLOY_ID=$(date +%Y%m%d_%H%M%S)
NEW_IMAGE_TAG="deploy-${DEPLOY_ID}"
ROLLBACK_IMAGE_TAG="rollback-${DEPLOY_ID}"
BACKUP_DIR="$REMOTE_DIR/backups"
ENV_BACKUP_FILE="$BACKUP_DIR/env/synapse-env-before-sync-${DEPLOY_ID}.env"
GLOBALS_BACKUP_FILE="$BACKUP_DIR/globals/synapse-globals-before-deploy-${DEPLOY_ID}.sql"
ONLINE_BACKUP_FILE="$BACKUP_DIR/synapse-online-before-deploy-${DEPLOY_ID}.sql"
FINAL_BACKUP_FILE="$BACKUP_DIR/synapse-final-before-switch-${DEPLOY_ID}.sql"
DRIVE_BACKUP_FILE="$BACKUP_DIR/drive/synapse-drive-final-before-switch-${DEPLOY_ID}.tar.gz"
CONTENT_STORE_BACKUP_FILE="$BACKUP_DIR/content-store/synapse-content-store-final-before-switch-${DEPLOY_ID}.tar.gz"
APPLIED_MIGRATIONS_FILE=$(mktemp)
DRIVE_BACKUP_STATUS_FILE=$(mktemp)
CONTENT_STORE_BACKUP_STATUS_FILE=$(mktemp)
TOTAL_STEPS=19
TOTAL_START=$(date +%s)

cleanup() {
  rm -f "$APPLIED_MIGRATIONS_FILE"
  rm -f "$DRIVE_BACKUP_STATUS_FILE"
  rm -f "$CONTENT_STORE_BACKUP_STATUS_FILE"
}

trap cleanup EXIT

step() {
  local num=$1 desc=$2
  shift 2
  printf "\n[%d/%d] %s\n" "$num" "$TOTAL_STEPS" "$desc"
  "$@" 2>&1 | sed 's/^/  /'
  printf "[%d/%d] done\n" "$num" "$TOTAL_STEPS"
}

ensure_remote_dirs() {
  ssh "$SERVER" "mkdir -p '$REMOTE_DIR/server' '$BACKUP_DIR/env' '$BACKUP_DIR/globals' '$BACKUP_DIR/drive' '$REMOTE_DIR/server/data/drive'"
}

validate_remote_env() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

if [ ! -f .env ]; then
  echo ".env not found"
  exit 1
fi

read_env_value() {
  sed -n "s/^${1}=//p" .env | tail -n 1
}

database_url=$(read_env_value DATABASE_URL)
case "$database_url" in
  *"@localhost:"*|*"@localhost/"*|*"@127.0.0.1:"*|*"@127.0.0.1/"*)
    echo "DATABASE_URL must use the compose service host postgres:5432 in production"
    exit 1
    ;;
esac

docker compose --env-file .env config >/dev/null

for key in USER_ACCESS_JWT_SECRET USER_ACCESS_TOKEN_MINUTES USER_REFRESH_TOKEN_DAYS APP_PUBLIC_URL DATABASE_POOL_SIZE; do
  value=$(read_env_value "$key")
  if [ -z "$value" ]; then
    echo "$key missing"
    exit 1
  fi
  printf "%s ok\n" "$key"
done
REMOTE_SCRIPT
}

sync_remote_env() {
  if ! test -f "$LOCAL_ENV_FILE"; then
    echo "本机 $LOCAL_ENV_FILE 不存在，已停止部署。"
    echo "请先创建本机 server/.env.server，并在其中维护生产数据库、COS、JWT、公开访问地址等配置。"
    exit 1
  fi

  local remote_tmp="$REMOTE_ENV_FILE.tmp-${DEPLOY_ID}"

  ssh "$SERVER" "mkdir -p '$REMOTE_DIR/server'"
  scp "$LOCAL_ENV_FILE" "$SERVER:$remote_tmp" >/dev/null
  ssh "$SERVER" "REMOTE_ENV_FILE='$REMOTE_ENV_FILE' remote_tmp='$remote_tmp' ENV_BACKUP_FILE='$ENV_BACKUP_FILE' LOCAL_ENV_FILE='$LOCAL_ENV_FILE' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cleanup_env_sync_tmp() {
  rm -f "$remote_tmp"
}
trap cleanup_env_sync_tmp EXIT

chmod 600 "$remote_tmp"
cd "$(dirname "$REMOTE_ENV_FILE")"

count_env_keys() {
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1" | sort -u | wc -l | tr -d ' '
}

validate_env_file() {
  local env_file=$1
  local database_url

  database_url=$(sed -n 's/^DATABASE_URL=//p' "$env_file" | tail -n 1)
  if [ -z "$database_url" ]; then
    echo "DATABASE_URL missing in $env_file"
    exit 1
  fi

  case "$database_url" in
    *"@localhost:"*|*"@localhost/"*|*"@127.0.0.1:"*|*"@127.0.0.1/"*)
      echo "DATABASE_URL must use the compose service host postgres:5432 in production"
      exit 1
      ;;
  esac

  docker compose --env-file "$env_file" config >/dev/null
}

validate_env_file "$remote_tmp"

if [ -f "$REMOTE_ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_BACKUP_FILE")"
  cp "$REMOTE_ENV_FILE" "$ENV_BACKUP_FILE"
  chmod 600 "$ENV_BACKUP_FILE"
  printf "remote env backup: %s\n" "$ENV_BACKUP_FILE"
fi

cp "$remote_tmp" "$REMOTE_ENV_FILE"
chmod 600 "$REMOTE_ENV_FILE"
rm -f "$remote_tmp"

printf ".env replaced from %s and validated (%s keys)\n" "$LOCAL_ENV_FILE" "$(count_env_keys "$REMOTE_ENV_FILE")"
REMOTE_SCRIPT
}

verify_remote_database_auth() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

read_env_value() {
  sed -n "s/^${1}=//p" .env | tail -n 1
}

postgres_user=$(read_env_value POSTGRES_USER)
postgres_db=$(read_env_value POSTGRES_DB)
postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)

if [ -z "$postgres_user" ] || [ -z "$postgres_db" ] || [ -z "$postgres_password" ]; then
  echo "database tcp auth failed: POSTGRES_USER, POSTGRES_DB and POSTGRES_PASSWORD must be set"
  exit 1
fi

if docker compose --env-file .env exec -T -e PGPASSWORD="$postgres_password" postgres \
  psql -h postgres -p 5432 -U "$postgres_user" -d "$postgres_db" -Atc 'select 1' >/dev/null; then
  echo "database tcp auth ok"
else
  echo "database tcp auth failed: .env Postgres identity does not match the existing database"
  exit 1
fi
REMOTE_SCRIPT
}

fetch_applied_migrations() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" > "$APPLIED_MIGRATIONS_FILE" <<'REMOTE_SCRIPT'
set -euo pipefail

postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)
postgres_db=$(sed -n 's/^POSTGRES_DB=//p' .env | tail -n 1)

docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$postgres_db" -At <<'SQL'
SELECT to_regclass('public._prisma_migrations');
SQL
REMOTE_SCRIPT

  if ! grep -q "_prisma_migrations" "$APPLIED_MIGRATIONS_FILE"; then
    : > "$APPLIED_MIGRATIONS_FILE"
    printf "applied migrations: 0\n"
    return
  fi

  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" > "$APPLIED_MIGRATIONS_FILE" <<'REMOTE_SCRIPT'
set -euo pipefail

postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)
postgres_db=$(sed -n 's/^POSTGRES_DB=//p' .env | tail -n 1)

docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$postgres_db" -At <<'SQL'
SELECT migration_name
FROM public._prisma_migrations
WHERE finished_at IS NOT NULL
ORDER BY migration_name;
SQL
REMOTE_SCRIPT

  local count
  count=$(wc -l < "$APPLIED_MIGRATIONS_FILE" | tr -d ' ')
  printf "applied migrations: %s\n" "$count"
}

scan_pending_migrations() {
  env ALLOW_RISKY_MIGRATIONS="${ALLOW_RISKY_MIGRATIONS:-}" \
    STRICT_MIGRATION_RISK_SCAN="${STRICT_MIGRATION_RISK_SCAN:-}" \
    node scripts/deploy/check-prisma-migration-risk.mjs \
      --migrations-dir server/prisma/migrations \
      --applied-file "$APPLIED_MIGRATIONS_FILE"
}

backup_remote_database() {
  local backup_file=$1

  ssh "$SERVER" "REMOTE_DIR='$REMOTE_DIR' BACKUP_FILE='$backup_file' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

mkdir -p "$(dirname "$BACKUP_FILE")"
cd "$REMOTE_DIR/server"

postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)
postgres_db=$(sed -n 's/^POSTGRES_DB=//p' .env | tail -n 1)

docker compose --env-file .env exec -T postgres pg_dump -U "$postgres_user" "$postgres_db" > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

printf "backup saved: %s\n" "$BACKUP_FILE"
REMOTE_SCRIPT
}

backup_remote_postgres_globals() {
  ssh "$SERVER" "REMOTE_DIR='$REMOTE_DIR' GLOBALS_BACKUP_FILE='$GLOBALS_BACKUP_FILE' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

mkdir -p "$(dirname "$GLOBALS_BACKUP_FILE")"
cd "$REMOTE_DIR/server"

postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)

docker compose --env-file .env exec -T postgres pg_dumpall -U "$postgres_user" --globals-only > "$GLOBALS_BACKUP_FILE"
test -s "$GLOBALS_BACKUP_FILE"
chmod 600 "$GLOBALS_BACKUP_FILE"

printf "postgres globals backup saved: %s\n" "$GLOBALS_BACKUP_FILE"
REMOTE_SCRIPT
}

sync_remote_code() {
  rsync -avz --delete \
    --exclude='server/node_modules' \
    --exclude='server/.env' \
    --exclude='server/.env.local' \
    --exclude='server/.env.server' \
    --exclude='server/.env.backup-*' \
    --exclude='server/.env.password-rotation-*' \
    --exclude='server/.env.merged-*' \
    --exclude='server/.env.tmp-*' \
    --exclude='server/dist' \
    --exclude='server/admin-dist' \
    --exclude='server/logs' \
    --exclude='server/data' \
    --exclude='dashboard/node_modules' \
    --exclude='dashboard/dist' \
    --exclude='shared/node_modules' \
    --exclude='shared/dist' \
    --include='/.dockerignore' \
    --include='/setup.sh' \
    --include='/restart.sh' \
    --include='/server/***' \
    --include='/dashboard/***' \
    --include='/shared/***' \
    --include='/pnpm-lock.yaml' \
    --include='/pnpm-workspace.yaml' \
    --include='/package.json' \
    --exclude='*' \
    ./ "$SERVER:$REMOTE_DIR/"
}

build_remote_image() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && SYNAPSE_SERVER_IMAGE_TAG='$NEW_IMAGE_TAG' docker compose --env-file .env build server"
}

tag_remote_rollback_image() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && ROLLBACK_IMAGE_TAG='$ROLLBACK_IMAGE_TAG' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

container_id=$(docker compose --env-file .env ps -q server || true)
if [ -z "$container_id" ]; then
  echo "server container is not running; cannot create rollback image"
  exit 1
fi

image_id=$(docker inspect -f '{{.Image}}' "$container_id")
docker tag "$image_id" "synapse-server:${ROLLBACK_IMAGE_TAG}"
printf "rollback image tagged: synapse-server:%s\n" "$ROLLBACK_IMAGE_TAG"
REMOTE_SCRIPT
}

preflight_remote_migrations() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && DEPLOY_ID='$DEPLOY_ID' NEW_IMAGE_TAG='$NEW_IMAGE_TAG' ONLINE_BACKUP_FILE='$ONLINE_BACKUP_FILE' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

preflight_db="synapse_preflight_${DEPLOY_ID}"
postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)
postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)

cleanup_preflight_database() {
  docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${preflight_db}';" >/dev/null 2>&1 || true
  docker compose --env-file .env exec -T postgres dropdb -U "$postgres_user" --if-exists "$preflight_db" >/dev/null 2>&1 || true
}

trap cleanup_preflight_database EXIT

cleanup_preflight_database
docker compose --env-file .env exec -T postgres createdb -U "$postgres_user" "$preflight_db"
docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$preflight_db" < "$ONLINE_BACKUP_FILE"

database_url="postgresql://${postgres_user}:${postgres_password}@postgres:5432/${preflight_db}"
SYNAPSE_SERVER_IMAGE_TAG="$NEW_IMAGE_TAG" docker compose --env-file .env run --rm -T --no-deps -e DATABASE_URL="$database_url" server sh -c "cd server && npx prisma migrate deploy"

printf "preflight migration ok: %s\n" "$preflight_db"
REMOTE_SCRIPT
}

verify_final_backup_restore() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && DEPLOY_ID='$DEPLOY_ID' FINAL_BACKUP_FILE='$FINAL_BACKUP_FILE' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

verify_db="synapse_final_verify_${DEPLOY_ID}"
postgres_user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)

cleanup_verify_database() {
  docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${verify_db}';" >/dev/null 2>&1 || true
  docker compose --env-file .env exec -T postgres dropdb -U "$postgres_user" --if-exists "$verify_db" >/dev/null 2>&1 || true
}

trap cleanup_verify_database EXIT

cleanup_verify_database
docker compose --env-file .env exec -T postgres createdb -U "$postgres_user" "$verify_db"
docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$verify_db" < "$FINAL_BACKUP_FILE"
docker compose --env-file .env exec -T postgres psql -U "$postgres_user" -d "$verify_db" -Atc 'select 1' >/dev/null

printf "final backup restore verified: %s\n" "$verify_db"
REMOTE_SCRIPT
}

backup_remote_drive_fallback() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && DRIVE_BACKUP_FILE='$DRIVE_BACKUP_FILE' bash -s" <<'REMOTE_SCRIPT' | tee "$DRIVE_BACKUP_STATUS_FILE"
set -euo pipefail

read_env_value() {
  sed -n "s/^${1}=//p" .env | tail -n 1
}

drive_cos_secret_id=$(read_env_value DRIVE_COS_SECRET_ID)
drive_cos_secret_key=$(read_env_value DRIVE_COS_SECRET_KEY)
drive_cos_bucket=$(read_env_value DRIVE_COS_BUCKET)
drive_cos_region=$(read_env_value DRIVE_COS_REGION)

if [ -n "$drive_cos_secret_id" ] && [ -n "$drive_cos_secret_key" ] && [ -n "$drive_cos_bucket" ] && [ -n "$drive_cos_region" ]; then
  echo "drive backup skipped: COS storage is configured"
  exit 0
fi

if [ ! -d data/drive ]; then
  echo "drive backup skipped: local drive directory not found"
  exit 0
fi

mkdir -p "$(dirname "$DRIVE_BACKUP_FILE")"
tar -czf "$DRIVE_BACKUP_FILE" -C data drive
test -s "$DRIVE_BACKUP_FILE"
chmod 600 "$DRIVE_BACKUP_FILE"

printf "drive backup saved: %s\n" "$DRIVE_BACKUP_FILE"
REMOTE_SCRIPT
}

backup_remote_content_store_fallback() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && CONTENT_STORE_BACKUP_FILE='$CONTENT_STORE_BACKUP_FILE' bash -s" <<'REMOTE_SCRIPT' | tee "$CONTENT_STORE_BACKUP_STATUS_FILE"
set -euo pipefail

read_env_value() {
  sed -n "s/^${1}=//p" .env | tail -n 1
}

content_store_cos_secret_id=$(read_env_value CONTENT_STORE_COS_SECRET_ID)
content_store_cos_secret_key=$(read_env_value CONTENT_STORE_COS_SECRET_KEY)
content_store_cos_bucket=$(read_env_value CONTENT_STORE_COS_BUCKET)
content_store_cos_region=$(read_env_value CONTENT_STORE_COS_REGION)

if [ -n "$content_store_cos_secret_id" ] && [ -n "$content_store_cos_secret_key" ] && [ -n "$content_store_cos_bucket" ] && [ -n "$content_store_cos_region" ]; then
  echo "content store backup skipped: COS storage is configured"
  exit 0
fi

if [ ! -d data/content-store ]; then
  echo "content store backup skipped: local content-store directory not found"
  exit 0
fi

mkdir -p "$(dirname "$CONTENT_STORE_BACKUP_FILE")"
tar -czf "$CONTENT_STORE_BACKUP_FILE" -C data content-store
test -s "$CONTENT_STORE_BACKUP_FILE"
chmod 600 "$CONTENT_STORE_BACKUP_FILE"

printf "content store backup saved: %s\n" "$CONTENT_STORE_BACKUP_FILE"
REMOTE_SCRIPT
}

stop_remote_server() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env stop server"
}

start_new_remote_server() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && SYNAPSE_SERVER_IMAGE_TAG='$NEW_IMAGE_TAG' docker compose --env-file .env up -d --no-build server"
}

rollback_remote_service() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && SYNAPSE_SERVER_IMAGE_TAG='$ROLLBACK_IMAGE_TAG' docker compose --env-file .env up -d --no-build server"
}

print_manual_database_restore_instructions() {
  cat <<EOF

数据库没有自动恢复。若确认需要回到部署前数据库，请人工执行：

  ssh $SERVER
  cd $REMOTE_DIR/server
  postgres_user=\$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)
  postgres_db=\$(sed -n 's/^POSTGRES_DB=//p' .env | tail -n 1)
  docker compose --env-file .env stop server
  docker compose --env-file .env exec -T postgres psql -U "\$postgres_user" -d "\$postgres_db" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  docker compose --env-file .env exec -T postgres psql -U "\$postgres_user" -d "\$postgres_db" < $FINAL_BACKUP_FILE
  SYNAPSE_SERVER_IMAGE_TAG=$ROLLBACK_IMAGE_TAG docker compose --env-file .env up -d --no-build server

最终切换前备份：$FINAL_BACKUP_FILE
Postgres globals 备份：$GLOBALS_BACKUP_FILE
远端 .env 备份：$ENV_BACKUP_FILE
回滚服务镜像：synapse-server:$ROLLBACK_IMAGE_TAG
EOF
}

drive_backup_summary() {
  if grep -q "drive backup saved" "$DRIVE_BACKUP_STATUS_FILE"; then
    echo "$DRIVE_BACKUP_FILE"
  elif grep -q "COS storage is configured" "$DRIVE_BACKUP_STATUS_FILE"; then
    echo "skipped (COS storage is configured)"
  elif grep -q "local drive directory not found" "$DRIVE_BACKUP_STATUS_FILE"; then
    echo "skipped (local drive directory not found)"
  else
    echo "not recorded"
  fi
}

content_store_backup_summary() {
  if grep -q "content store backup saved" "$CONTENT_STORE_BACKUP_STATUS_FILE"; then
    echo "$CONTENT_STORE_BACKUP_FILE"
  elif grep -q "COS storage is configured" "$CONTENT_STORE_BACKUP_STATUS_FILE"; then
    echo "skipped (COS storage is configured)"
  elif grep -q "local content-store directory not found" "$CONTENT_STORE_BACKUP_STATUS_FILE"; then
    echo "skipped (local content-store directory not found)"
  else
    echo "not available"
  fi
}

print_deployment_artifacts() {
  echo "远端 .env 备份: $ENV_BACKUP_FILE"
  echo "Postgres globals 备份: $GLOBALS_BACKUP_FILE"
  echo "在线预演备份: $ONLINE_BACKUP_FILE"
  echo "最终切换前备份: $FINAL_BACKUP_FILE"
  echo "本地 Drive 备份: $(drive_backup_summary)"
  echo "Content Store 本地备份: $(content_store_backup_summary)"
  echo "回滚服务镜像: synapse-server:$ROLLBACK_IMAGE_TAG"
}

run_remote_health_check() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" <<'REMOTE_SCRIPT'
set -uo pipefail

failed=0

print_file_preview() {
  local path=$1

  if [ -s "$path" ]; then
    sed -n '1,8p' "$path"
  else
    echo "(empty response)"
  fi
}

record_failure() {
  failed=1
}

check_body_contains() {
  local name=$1
  local url=$2
  local expected=$3
  local body_file
  local error_file
  local http_code
  local curl_status

  body_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o "$body_file" -w "%{http_code}" "$url" 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && [[ "$http_code" == 2* ]] && grep -q "$expected" "$body_file"; then
    printf "%s ok (HTTP %s)\n" "$name" "$http_code"
  else
    printf "%s FAILED (HTTP %s)\n" "$name" "$http_code"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    print_file_preview "$body_file"
    record_failure
  fi

  rm -f "$body_file" "$error_file"
}

check_redirect() {
  local name=$1
  local url=$2
  local expected_location=$3
  local header_file
  local error_file
  local http_code
  local curl_status

  header_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o /dev/null -D "$header_file" -w "%{http_code}" "$url" 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && { [ "$http_code" = "301" ] || [ "$http_code" = "302" ]; } && grep -qi "^Location: ${expected_location}" "$header_file"; then
    printf "%s ok (HTTP %s, Location: %s)\n" "$name" "$http_code" "$expected_location"
  else
    printf "%s FAILED (HTTP %s, expected Location: %s)\n" "$name" "$http_code" "$expected_location"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    print_file_preview "$header_file"
    record_failure
  fi

  rm -f "$header_file" "$error_file"
}

check_not_redirect_to_dashboard() {
  local name=$1
  local url=$2
  local header_file
  local body_file
  local error_file
  local http_code
  local curl_status

  header_file=$(mktemp)
  body_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o "$body_file" -D "$header_file" -w "%{http_code}" "$url" 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && ! grep -qi "^Location: /dashboard/" "$header_file"; then
    printf "%s ok (HTTP %s)\n" "$name" "$http_code"
  else
    printf "%s FAILED (HTTP %s, should not redirect to /dashboard/)\n" "$name" "$http_code"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    echo "headers:"
    print_file_preview "$header_file"
    echo "body:"
    print_file_preview "$body_file"
    record_failure
  fi

  rm -f "$header_file" "$body_file" "$error_file"
}

run_checks_once() {
  failed=0
  check_body_contains "healthz" "http://127.0.0.1:3000/healthz" '"status":"ok"'
  check_body_contains "console" "http://127.0.0.1:3000/console/" '<div id="root">'
  # Expected redirect header: Location: /console/
  check_redirect "dashboard redirect" "http://127.0.0.1:3000/dashboard" "/console/"
  check_not_redirect_to_dashboard "webhook route" "http://127.0.0.1:3000/webhooks/not-found/test"
  check_not_redirect_to_dashboard "drive share route" "http://127.0.0.1:3000/share/shr_not_found"
  return "$failed"
}

deadline=$((SECONDS + 90))
attempt=1

while true; do
  echo "health check attempt ${attempt}"
  if run_checks_once; then
    exit 0
  fi

  if [ "$SECONDS" -ge "$deadline" ]; then
    echo ""
    echo "docker compose status:"
    docker compose --env-file .env ps || true
    echo ""
    echo "recent server logs:"
    docker compose --env-file .env logs --tail=80 server || true
    exit 1
  fi

  attempt=$((attempt + 1))
  sleep 3
done
REMOTE_SCRIPT
}

echo ""

# [1/19] 确保远程目录存在
step 1 "确保远程目录存在" \
  ensure_remote_dirs

# 检查是否首次部署
if ! ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  # [2/19] 首次部署同步代码（只传服务端需要的文件）
  step 2 "同步代码到服务器" \
    sync_remote_code

  # [3/19] 首次部署同步本机环境变量
  step 3 "同步本机环境变量到服务器" \
    sync_remote_env

  echo ""
  echo "首次部署已同步本机 server/.env.server，请 SSH 登录服务器启动服务："
  echo "  cd $REMOTE_DIR/server && docker compose --env-file .env up -d --build"
  exit 0
fi

# [2/19] 同步本机环境变量
step 2 "同步本机环境变量到服务器" \
  sync_remote_env

# [3/19] 检查远程环境变量
step 3 "检查远程环境变量" \
  validate_remote_env

# [4/19] 检查数据库网络认证
step 4 "检查数据库网络认证" \
  verify_remote_database_auth

# [5/19] 获取远程已应用迁移
step 5 "获取远程已应用迁移" \
  fetch_applied_migrations

# [6/19] 扫描待发布迁移风险
step 6 "扫描待发布迁移风险" \
  scan_pending_migrations

# [7/19] 备份 Postgres globals
step 7 "备份 Postgres globals" \
  backup_remote_postgres_globals

# [8/19] 在线备份远程数据库
step 8 "在线备份远程数据库" \
  backup_remote_database "$ONLINE_BACKUP_FILE"

# [9/19] 同步代码（只传服务端需要的文件）
step 9 "同步代码到服务器" \
  sync_remote_code

# [10/19] 构建新 Docker 镜像
step 10 "构建 Docker 镜像" \
  build_remote_image

# [11/19] 标记当前服务镜像，供失败时回滚
step 11 "标记回滚镜像" \
  tag_remote_rollback_image

# [12/19] 用在线备份恢复临时库并预演迁移
step 12 "临时数据库预演迁移" \
  preflight_remote_migrations

# [13/19] 停止旧服务，保留数据库
step 13 "停止旧服务" \
  stop_remote_server

# [14/19] 停服后最终备份远程数据库
step 14 "最终备份远程数据库" \
  backup_remote_database "$FINAL_BACKUP_FILE"

# [15/19] 恢复验证最终数据库备份
step 15 "恢复验证最终数据库备份" \
  verify_final_backup_restore

# [16/19] 备份本地 Drive fallback 数据
step 16 "备份本地 Drive 数据" \
  backup_remote_drive_fallback

# [17/19] 备份本地 Content Store fallback 数据
step 17 "备份本地 Content Store 数据" \
  backup_remote_content_store_fallback

# [18/19] 启动新服务
step 18 "启动新服务" \
  start_new_remote_server

# [19/19] 健康检查
printf "\n[%d/%d] 健康检查\n" 19 "$TOTAL_STEPS"
if run_remote_health_check 2>&1 | sed 's/^/  /'; then
  printf "[%d/%d] done\n" 19 "$TOTAL_STEPS"
else
  printf "[%d/%d] 健康检查 .......... FAILED\n" 19 "$TOTAL_STEPS"
  echo ""
  echo "正在回滚到上一版服务镜像，不自动恢复数据库..."
  if rollback_remote_service 2>&1 | sed 's/^/  /' && run_remote_health_check 2>&1 | sed 's/^/  /'; then
    echo "服务镜像已回滚。"
  else
    echo "服务镜像回滚后健康检查仍失败，请立即查看日志。"
  fi
  echo ""
  print_deployment_artifacts
  print_manual_database_restore_instructions
  exit 1
fi

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "部署完成 (${TOTAL_ELAPSED}s)"
echo "管理面板: https://synapse.d2.pub/console"
print_deployment_artifacts
