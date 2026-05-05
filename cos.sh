#!/bin/bash
# 本机运行：交互式配置远程服务器的 COS 备份信息
set -e

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse/server"
ENV_FILE="$REMOTE_DIR/.env"

echo "========================================="
echo "  配置腾讯云 COS 备份"
echo "========================================="
echo ""

# 检查远程 .env 是否存在
if ! ssh "$SERVER" "test -f $ENV_FILE"; then
  echo "❌ 远程服务器未找到 .env 文件，请先运行 setup.sh 初始化"
  exit 1
fi

# 检查是否已配置
EXISTING=$(ssh "$SERVER" "grep -c '^COS_SECRET_ID=' $ENV_FILE 2>/dev/null || echo 0")
if [ "$EXISTING" -gt 0 ]; then
  echo "检测到已有 COS 配置："
  ssh "$SERVER" "grep '^COS_' $ENV_FILE; grep '^BACKUP_ENCRYPT_KEY' $ENV_FILE" 2>/dev/null | sed 's/SECRET_KEY=.*/SECRET_KEY=***/'
  echo ""
  read -p "是否覆盖？[y/N]: " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "已取消"
    exit 0
  fi
  # 删除旧配置
  ssh "$SERVER" "sed -i '/^COS_/d; /^BACKUP_ENCRYPT_KEY/d' $ENV_FILE"
fi

echo ""
read -p "腾讯云 COS SecretId: " COS_SECRET_ID
read -p "腾讯云 COS SecretKey: " COS_SECRET_KEY
read -p "COS 存储桶名称 (如 synapse-backup-1250000000): " COS_BUCKET
read -p "COS 地域 (如 ap-guangzhou): " COS_REGION

BACKUP_ENCRYPT_KEY=$(openssl rand -hex 32)

echo ""
echo ">>> 写入远程 .env..."
ssh "$SERVER" "cat >> $ENV_FILE" << EOF

COS_SECRET_ID=$COS_SECRET_ID
COS_SECRET_KEY=$COS_SECRET_KEY
COS_BUCKET=$COS_BUCKET
COS_REGION=$COS_REGION
BACKUP_ENCRYPT_KEY=$BACKUP_ENCRYPT_KEY
EOF

echo ">>> 重启服务..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose --env-file .env up -d --build"

echo ""
echo ">>> 等待服务启动..."
sleep 8
ssh "$SERVER" "curl -sf http://127.0.0.1:3000/healthz" && echo " ✅ 服务正常" || echo " ❌ 服务未就绪，查看日志: ssh $SERVER \"cd $REMOTE_DIR && docker compose logs server\""

echo ""
echo "========================================="
echo "  配置完成"
echo "========================================="
echo ""
echo "⚠️  请妥善保存备份加密密钥："
echo "  BACKUP_ENCRYPT_KEY=$BACKUP_ENCRYPT_KEY"
echo ""
echo "恢复备份时需要此密钥，丢失将无法解密密钥文件。"
echo ""
