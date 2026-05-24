#!/bin/bash
# 本机运行：打包代码并上传到服务器
set -euo pipefail

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"
DEFAULT_APP_PUBLIC_URL="https://synapse.d2.pub"
TOTAL_STEPS=8
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

echo ""

# [1/7] 确保远程目录存在
step 1 "确保远程目录存在" \
  ssh "$SERVER" "mkdir -p $REMOTE_DIR"

# [2/7] 同步代码（只传后端需要的文件）
step 2 "同步代码到服务器" \
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

# 检查是否首次部署
if ! ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  echo ""
  echo "首次部署，请 SSH 登录服务器运行初始化："
  echo "  cd $REMOTE_DIR && bash setup.sh"
  exit 0
fi

# [3/8] 检查并补齐旧环境变量
step 3 "检查远程环境变量" \
  ensure_remote_env

# [4/8] 构建 Docker 镜像
step 4 "构建 Docker 镜像" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env build"

# [5/8] 停止旧服务
step 5 "停止旧服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env down"

# [6/8] 启动新服务
step 6 "启动新服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env up -d"

# [7/8] 等待服务就绪
step 7 "等待服务就绪" \
  sleep 5

# [8/8] 健康检查
if ssh "$SERVER" "curl -sf http://127.0.0.1:3000/healthz > /dev/null && curl -sf http://127.0.0.1:3000/dashboard/ | grep -q '<title>Synapse</title>' && curl -sSI http://127.0.0.1:3000/dashboard | grep -q 'Location: /dashboard/'" > /dev/null 2>&1; then
  printf "[%d/%d] 健康检查 .......... passed\n" 8 "$TOTAL_STEPS"
else
  printf "[%d/%d] 健康检查 .......... FAILED\n" 8 "$TOTAL_STEPS"
  echo ""
  echo "  服务未就绪，查看日志:"
  echo "  ssh $SERVER \"cd $REMOTE_DIR/server && docker compose logs server\""
  exit 1
fi

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "部署完成 (${TOTAL_ELAPSED}s)"
echo "管理面板: https://synapse.d2.pub/dashboard"
