#!/bin/bash
# 本机运行：打包代码并上传到服务器
set -e

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse"

echo ">>> 确保远程目录存在..."
ssh "$SERVER" "mkdir -p $REMOTE_DIR"

echo ">>> 同步代码到服务器..."
rsync -avz --delete \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=server/.env \
  ./ "$SERVER:$REMOTE_DIR/"

echo ">>> 上传完成"
echo ""

if ssh "$SERVER" "test -f $REMOTE_DIR/server/.env"; then
  echo ">>> 重新构建并启动服务..."
  ssh "$SERVER" "cd $REMOTE_DIR/server && docker compose --env-file .env up -d --build"
  echo ""
  echo ">>> 等待服务启动..."
  sleep 5
  echo ">>> 健康检查..."
  ssh "$SERVER" "curl -sf http://127.0.0.1:3000/healthz && echo '' || echo '❌ 服务未就绪，请查看日志: ssh $SERVER \"cd $REMOTE_DIR/server && docker compose logs server\"'"
  echo ""
  echo ">>> 部署完成"
else
  echo ">>> 首次部署，请 SSH 登录服务器运行初始化："
  echo "  cd $REMOTE_DIR && bash setup.sh"
fi
