#!/bin/bash
# 本机运行：打包代码并上传到服务器
set -euo pipefail

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"
DEFAULT_APP_PUBLIC_URL="https://synapse.d2.pub"
TOTAL_STEPS=9
TOTAL_START=$(date +%s)

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

backup_remote_database() {
  ssh "$SERVER" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

backup_file="$REMOTE_DIR/backups/synapse-before-deploy-$(date +%Y%m%d_%H%M%S).sql"

mkdir -p "$REMOTE_DIR/backups"
cd "$REMOTE_DIR/server"

docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > "$backup_file"
test -s "$backup_file"

printf "backup saved: %s\n" "$backup_file"
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

check_body_contains "healthz" "http://127.0.0.1:3000/healthz" '"status":"ok"'
check_body_contains "dashboard" "http://127.0.0.1:3000/dashboard/" '<div id="root">'
# Expected redirect header: Location: /dashboard/
check_redirect "dashboard redirect" "http://127.0.0.1:3000/dashboard" "/dashboard/"

if [ "$failed" -ne 0 ]; then
  echo ""
  echo "docker compose status:"
  docker compose --env-file .env ps || true
  echo ""
  echo "recent server logs:"
  docker compose --env-file .env logs --tail=80 server || true
  exit 1
fi
REMOTE_SCRIPT
}

echo ""

# [1/9] 确保远程目录存在
step 1 "确保远程目录存在" \
  ssh "$SERVER" "mkdir -p $REMOTE_DIR"

# 检查是否首次部署
if ! ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  # [2/9] 首次部署同步代码（只传后端需要的文件）
  step 2 "同步代码到服务器" \
    sync_remote_code

  echo ""
  echo "首次部署，请 SSH 登录服务器运行初始化："
  echo "  cd $REMOTE_DIR && bash setup.sh"
  exit 0
fi

# [2/9] 检查并补齐旧环境变量
step 2 "检查远程环境变量" \
  ensure_remote_env

# [3/9] 升级前备份远程数据库
step 3 "备份远程数据库" \
  backup_remote_database

# [4/9] 同步代码（只传后端需要的文件）
step 4 "同步代码到服务器" \
  sync_remote_code

# [5/9] 构建 Docker 镜像
step 5 "构建 Docker 镜像" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env build"

# [6/9] 停止旧服务
step 6 "停止旧服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env down"

# [7/9] 启动新服务
step 7 "启动新服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env up -d"

# [8/9] 等待服务就绪
step 8 "等待服务就绪" \
  sleep 5

# [9/9] 健康检查
printf "\n[%d/%d] 健康检查\n" 9 "$TOTAL_STEPS"
if run_remote_health_check 2>&1 | sed 's/^/  /'; then
  printf "[%d/%d] done\n" 9 "$TOTAL_STEPS"
else
  printf "[%d/%d] 健康检查 .......... FAILED\n" 9 "$TOTAL_STEPS"
  exit 1
fi

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "部署完成 (${TOTAL_ELAPSED}s)"
echo "管理面板: https://synapse.d2.pub/dashboard"
