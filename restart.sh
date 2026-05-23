#!/bin/bash
# 本机运行：远程重启服务端容器
set -e

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse/server"

echo ">>> 重启服务容器..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose --env-file .env restart server"

echo ">>> 等待服务启动..."
sleep 5

echo ">>> 健康检查..."
ssh "$SERVER" "curl -sf http://127.0.0.1:3000/healthz && echo ' ✓ 服务已就绪' || echo '❌ 服务未就绪，查看日志: ssh $SERVER \"cd $REMOTE_DIR && docker compose logs server --tail=50\"'"
