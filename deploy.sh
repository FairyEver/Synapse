#!/bin/bash
# 本机运行：打包代码并上传到服务器
# 用法: bash deploy.sh [--verbose]
set -e

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"
TOTAL_STEPS=7
LOG_FILE=$(mktemp)
TOTAL_START=$(date +%s)
VERBOSE=false

[[ "$1" == "--verbose" || "$1" == "-v" ]] && VERBOSE=true

cleanup() { rm -f "$LOG_FILE"; }
trap cleanup EXIT

step() {
  local num=$1 desc=$2
  shift 2
  local start=$(date +%s)

  if $VERBOSE; then
    printf "[%d/%d] %s\n" "$num" "$TOTAL_STEPS" "$desc"
    if "$@"; then
      local elapsed=$(( $(date +%s) - start ))
      printf "[%d/%d] %s .......... done (%ds)\n\n" "$num" "$TOTAL_STEPS" "$desc" "$elapsed"
      return 0
    else
      printf "[%d/%d] %s .......... FAILED\n" "$num" "$TOTAL_STEPS" "$desc"
      return 1
    fi
  else
    printf "[%d/%d] %s " "$num" "$TOTAL_STEPS" "$desc"
    if "$@" > "$LOG_FILE" 2>&1; then
      local elapsed=$(( $(date +%s) - start ))
      if [ "$elapsed" -gt 0 ]; then
        printf ".......... done (%ds)\n" "$elapsed"
      else
        printf ".......... done\n"
      fi
      return 0
    else
      printf ".......... FAILED\n"
      echo ""
      echo "  最后输出:"
      tail -10 "$LOG_FILE" | sed 's/^/  /'
      echo ""
      return 1
    fi
  fi
}

echo ""

# [1/5] 确保远程目录存在
step 1 "确保远程目录存在" \
  ssh "$SERVER" "mkdir -p $REMOTE_DIR"

# [2/5] 同步代码
step 2 "同步代码到服务器" \
  rsync -avz --delete \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=server/.env \
    ./ "$SERVER:$REMOTE_DIR/"

# 检查是否首次部署
if ! ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  echo ""
  echo "首次部署，请 SSH 登录服务器运行初始化："
  echo "  cd $REMOTE_DIR && bash setup.sh"
  exit 0
fi

# [3/7] 构建 Docker 镜像
step 3 "构建 Docker 镜像" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env build"

# [4/7] 停止旧服务
step 4 "停止旧服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env down"

# [5/7] 启动新服务
step 5 "启动新服务" \
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env up -d"

# [6/7] 等待服务就绪
step 6 "等待服务就绪" \
  sleep 5

# [7/7] 健康检查
if ssh "$SERVER" "curl -sf http://127.0.0.1:3000/healthz" > /dev/null 2>&1; then
  printf "[%d/%d] 健康检查 .......... passed\n" 7 "$TOTAL_STEPS"
else
  printf "[%d/%d] 健康检查 .......... FAILED\n" 7 "$TOTAL_STEPS"
  echo ""
  echo "  服务未就绪，查看日志:"
  echo "  ssh $SERVER \"cd $REMOTE_DIR/server && docker compose logs server\""
  exit 1
fi

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "部署完成 (${TOTAL_ELAPSED}s)"
echo "管理面板: https://synapse.d2.pub/admin"
