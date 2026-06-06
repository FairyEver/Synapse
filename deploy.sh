#!/bin/bash
# 本机运行：打包代码并上传到服务器
set -euo pipefail

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"
DEFAULT_APP_PUBLIC_URL="https://synapse.d2.pub"
DEPLOY_ID=$(date +%Y%m%d_%H%M%S)
NEW_IMAGE_TAG="deploy-${DEPLOY_ID}"
ROLLBACK_IMAGE_TAG="rollback-${DEPLOY_ID}"
ONLINE_BACKUP_FILE="$REMOTE_DIR/backups/synapse-online-before-deploy-${DEPLOY_ID}.sql"
FINAL_BACKUP_FILE="$REMOTE_DIR/backups/synapse-final-before-switch-${DEPLOY_ID}.sql"
APPLIED_MIGRATIONS_FILE=$(mktemp)
TOTAL_STEPS=13
TOTAL_START=$(date +%s)

cleanup() {
  rm -f "$APPLIED_MIGRATIONS_FILE"
}

trap cleanup EXIT

step() {
  local num=$1 desc=$2
  shift 2
  printf "\n[%d/%d] %s\n" "$num" "$TOTAL_STEPS" "$desc"
  "$@" 2>&1 | sed 's/^/  /'
  printf "[%d/%d] done\n" "$num" "$TOTAL_STEPS"
}

ensure_remote_env() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && DEFAULT_APP_PUBLIC_URL='$DEFAULT_APP_PUBLIC_URL' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

ensure_env() {
  local key=$1
  local value=$2

  if grep -q "^${key}=" .env; then
    local current
    current=$(sed -n "s/^${key}=//p" .env | tail -n 1)
    if [ -n "$current" ]; then
      printf "%s ok\n" "$key"
      return
    fi
    sed -i "/^${key}=/d" .env
  fi

  printf "\n%s=%s\n" "$key" "$value" >> .env
  printf "%s added\n" "$key"
}

if [ ! -f .env ]; then
  echo ".env not found"
  exit 1
fi

ensure_env "USER_ACCESS_JWT_SECRET" "$(openssl rand -hex 32)"
ensure_env "USER_ACCESS_TOKEN_MINUTES" "15"
ensure_env "USER_REFRESH_TOKEN_DAYS" "30"
ensure_env "APP_PUBLIC_URL" "$DEFAULT_APP_PUBLIC_URL"
ensure_env "DATABASE_POOL_SIZE" "10"

docker compose --env-file .env config >/dev/null
REMOTE_SCRIPT
}

fetch_applied_migrations() {
  ssh "$SERVER" "cd $REMOTE_DIR/server && bash -s" > "$APPLIED_MIGRATIONS_FILE" <<'REMOTE_SCRIPT'
set -euo pipefail

docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -At <<'SQL'
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

docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -At <<'SQL'
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
    node scripts/deploy/check-prisma-migration-risk.mjs \
      --migrations-dir server/prisma/migrations \
      --applied-file "$APPLIED_MIGRATIONS_FILE"
}

backup_remote_database() {
  local backup_file=$1

  ssh "$SERVER" "REMOTE_DIR='$REMOTE_DIR' BACKUP_FILE='$backup_file' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

mkdir -p "$REMOTE_DIR/backups"
cd "$REMOTE_DIR/server"

docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > "$BACKUP_FILE"
test -s "$BACKUP_FILE"

printf "backup saved: %s\n" "$BACKUP_FILE"
REMOTE_SCRIPT
}

sync_remote_code() {
  rsync -avz --delete \
    --exclude='server/node_modules' \
    --exclude='server/.env' \
    --exclude='server/dist' \
    --exclude='server/admin-dist' \
    --exclude='server/logs' \
    --exclude='dashboard/node_modules' \
    --exclude='dashboard/dist' \
    --include='/.dockerignore' \
    --include='/setup.sh' \
    --include='/restart.sh' \
    --include='/cos.sh' \
    --include='/server/***' \
    --include='/dashboard/***' \
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
postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)
postgres_password=${postgres_password:-synapse}

cleanup_preflight_database() {
  docker compose --env-file .env exec -T postgres psql -U synapse -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${preflight_db}';" >/dev/null 2>&1 || true
  docker compose --env-file .env exec -T postgres dropdb -U synapse --if-exists "$preflight_db" >/dev/null 2>&1 || true
}

trap cleanup_preflight_database EXIT

cleanup_preflight_database
docker compose --env-file .env exec -T postgres createdb -U synapse "$preflight_db"
docker compose --env-file .env exec -T postgres psql -U synapse -d "$preflight_db" < "$ONLINE_BACKUP_FILE"

database_url="postgresql://synapse:${postgres_password}@postgres:5432/${preflight_db}"
SYNAPSE_SERVER_IMAGE_TAG="$NEW_IMAGE_TAG" docker compose --env-file .env run --rm -T --no-deps -e DATABASE_URL="$database_url" server sh -c "cd server && npx prisma migrate deploy"

printf "preflight migration ok: %s\n" "$preflight_db"
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
  docker compose --env-file .env stop server
  docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  docker compose --env-file .env exec -T postgres psql -U synapse -d synapse < $FINAL_BACKUP_FILE
  SYNAPSE_SERVER_IMAGE_TAG=$ROLLBACK_IMAGE_TAG docker compose --env-file .env up -d --no-build server

最终切换前备份：$FINAL_BACKUP_FILE
回滚服务镜像：synapse-server:$ROLLBACK_IMAGE_TAG
EOF
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

run_checks_once() {
  failed=0
  check_body_contains "healthz" "http://127.0.0.1:3000/healthz" '"status":"ok"'
  check_body_contains "dashboard" "http://127.0.0.1:3000/dashboard/" '<div id="root">'
  # Expected redirect header: Location: /dashboard/
  check_redirect "dashboard redirect" "http://127.0.0.1:3000/dashboard" "/dashboard/"
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

# [1/13] 确保远程目录存在
step 1 "确保远程目录存在" \
  ssh "$SERVER" "mkdir -p $REMOTE_DIR"

# 检查是否首次部署
if ! ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  # [2/13] 首次部署同步代码（只传服务端需要的文件）
  step 2 "同步代码到服务器" \
    sync_remote_code

  echo ""
  echo "首次部署，请 SSH 登录服务器运行初始化："
  echo "  cd $REMOTE_DIR && bash setup.sh"
  exit 0
fi

# [2/13] 检查并补齐旧环境变量
step 2 "检查远程环境变量" \
  ensure_remote_env

# [3/13] 获取远程已应用迁移
step 3 "获取远程已应用迁移" \
  fetch_applied_migrations

# [4/13] 扫描待发布迁移风险
step 4 "扫描待发布迁移风险" \
  scan_pending_migrations

# [5/13] 在线备份远程数据库
step 5 "在线备份远程数据库" \
  backup_remote_database "$ONLINE_BACKUP_FILE"

# [6/13] 同步代码（只传服务端需要的文件）
step 6 "同步代码到服务器" \
  sync_remote_code

# [7/13] 构建新 Docker 镜像
step 7 "构建 Docker 镜像" \
  build_remote_image

# [8/13] 标记当前服务镜像，供失败时回滚
step 8 "标记回滚镜像" \
  tag_remote_rollback_image

# [9/13] 用在线备份恢复临时库并预演迁移
step 9 "临时数据库预演迁移" \
  preflight_remote_migrations

# [10/13] 停止旧服务，保留数据库
step 10 "停止旧服务" \
  stop_remote_server

# [11/13] 停服后最终备份远程数据库
step 11 "最终备份远程数据库" \
  backup_remote_database "$FINAL_BACKUP_FILE"

# [12/13] 启动新服务
step 12 "启动新服务" \
  start_new_remote_server

# [13/13] 健康检查
printf "\n[%d/%d] 健康检查\n" 13 "$TOTAL_STEPS"
if run_remote_health_check 2>&1 | sed 's/^/  /'; then
  printf "[%d/%d] done\n" 13 "$TOTAL_STEPS"
else
  printf "[%d/%d] 健康检查 .......... FAILED\n" 13 "$TOTAL_STEPS"
  echo ""
  echo "正在回滚到上一版服务镜像，不自动恢复数据库..."
  if rollback_remote_service 2>&1 | sed 's/^/  /' && run_remote_health_check 2>&1 | sed 's/^/  /'; then
    echo "服务镜像已回滚。"
  else
    echo "服务镜像回滚后健康检查仍失败，请立即查看日志。"
  fi
  print_manual_database_restore_instructions
  exit 1
fi

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "部署完成 (${TOTAL_ELAPSED}s)"
echo "管理面板: https://synapse.d2.pub/dashboard"
echo "在线预演备份: $ONLINE_BACKUP_FILE"
echo "最终切换前备份: $FINAL_BACKUP_FILE"
