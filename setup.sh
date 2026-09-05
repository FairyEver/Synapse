#!/bin/bash
# 服务端初始化 / 重置脚本
# 在项目根目录执行: bash setup.sh
set -e

cd "$(dirname "$0")/server"

run_local_health_check() {
  set +e

  local failed=0
  local body_file
  local error_file
  local http_code
  local curl_status

  body_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o "$body_file" -w "%{http_code}" http://127.0.0.1:3000/healthz 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && [[ "$http_code" == 2* ]] && grep -q '"status":"ok"' "$body_file"; then
    echo "healthz ok (HTTP $http_code)"
  else
    echo "healthz FAILED (HTTP $http_code)"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    if [ -s "$body_file" ]; then
      sed -n '1,8p' "$body_file"
    else
      echo "(empty response)"
    fi
    failed=1
  fi

  rm -f "$body_file" "$error_file"

  if [ "$failed" -ne 0 ]; then
    echo ""
    echo "docker compose status:"
    docker compose --env-file .env ps || true
    echo ""
    echo "recent server logs:"
    docker compose --env-file .env logs --tail=80 server || true
    set -e
    return 1
  fi

  set -e
  return 0
}

echo "========================================="
echo "  Synapse Server"
echo "========================================="
echo ""

if [ -f .env ]; then
  echo "检测到已有配置，请选择操作："
  echo "  1) 重置数据库（保留密钥和配置）"
  echo "  2) 完全重置（清除所有数据，重新生成密钥）"
  echo "  3) 退出"
  echo ""
  echo "提示：已有数据库的 POSTGRES_PASSWORD 不能通过 deploy.sh 同步修改；需要轮换时先改数据库用户密码，再更新远端 .env。"
  read -p "输入选项 [1/2/3]: " CHOICE

  case $CHOICE in
    1)
      echo ""
      echo "⚠️  这将删除数据库所有数据，但保留密钥和管理员配置"
      read -p "确认重置数据库？[y/N]: " CONFIRM
      if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "已取消"
        exit 0
      fi
      echo ""
      echo ">>> 重建数据库容器..."
      docker compose down -v 2>/dev/null || true
      docker compose --env-file .env up -d --build
      echo ""
      echo ">>> 等待服务启动..."
      sleep 8
      run_local_health_check && echo " ✅ 服务正常" || exit 1
      exit 0
      ;;
    2)
      echo ""
      echo "⚠️  这将删除数据库所有数据并重新生成密钥"
      read -p "确认完全重置？[y/N]: " CONFIRM
      if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "已取消"
        exit 0
      fi
      echo ""
      echo ">>> 停止服务并清除数据..."
      docker compose down -v 2>/dev/null || true
      rm -f .env
      echo ""
      ;;
    *)
      exit 0
      ;;
  esac
fi

# 生成密钥；不得输出到终端或日志。
echo ">>> 生成服务端密钥..."
ADMIN_ACCESS_SECRET=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
USER_ACCESS_JWT_SECRET=$(openssl rand -hex 32)
DESKTOP_UPDATE_INTENT_SECRET=$(openssl rand -hex 32)
echo "  服务端密钥已生成。"
echo ""

read -p "数据库密码 (留空使用随机生成): " DB_PASSWORD

if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD=$(openssl rand -hex 16)
  echo "  数据库密码已自动生成: $DB_PASSWORD"
fi

DEFAULT_APP_PUBLIC_URL="https://synapse.d2.pub"
read -p "应用公开访问地址 [$DEFAULT_APP_PUBLIC_URL]: " APP_PUBLIC_URL
APP_PUBLIC_URL=${APP_PUBLIC_URL:-$DEFAULT_APP_PUBLIC_URL}
while [ -n "$APP_PUBLIC_URL" ] && [[ "$APP_PUBLIC_URL" != http://* ]] && [[ "$APP_PUBLIC_URL" != https://* ]]; do
  echo "  请输入 http:// 或 https:// 开头的地址"
  read -p "应用公开访问地址 [$DEFAULT_APP_PUBLIC_URL]: " APP_PUBLIC_URL
  APP_PUBLIC_URL=${APP_PUBLIC_URL:-$DEFAULT_APP_PUBLIC_URL}
done

echo ""
echo ">>> Drive COS 存储配置（可选，回车跳过）"
echo "  配置后用户云盘文件将保存到腾讯云 COS"
echo "  未配置时，Drive 文件会保存在 server/data/drive 并由 deploy.sh 在切换窗口备份"
echo "  请填写已存在且服务端有权限访问的用户文件 bucket"
echo ""
read -p "Drive COS SecretId (回车跳过): " DRIVE_COS_SECRET_ID
if [ -n "$DRIVE_COS_SECRET_ID" ]; then
  read -p "Drive COS SecretKey: " DRIVE_COS_SECRET_KEY
  read -p "Drive COS 存储桶名称 (如 synapse-drive-1250000000): " DRIVE_COS_BUCKET
  read -p "Drive COS 地域 (如 ap-guangzhou): " DRIVE_COS_REGION
fi

echo ""
echo ">>> Platform Media COS 存储配置（必填）"
echo "  用户头像、智能体头像和文档公共图床等平台媒体资源将保存到腾讯云 COS"
echo "  请填写已存在且服务端有权限访问的平台媒体 bucket，Bucket 必须保持私有读写"
echo ""
while [ -z "$PLATFORM_MEDIA_COS_SECRET_ID" ]; do
  read -p "Platform Media COS SecretId: " PLATFORM_MEDIA_COS_SECRET_ID
done
while [ -z "$PLATFORM_MEDIA_COS_SECRET_KEY" ]; do
  read -p "Platform Media COS SecretKey: " PLATFORM_MEDIA_COS_SECRET_KEY
done
while [ -z "$PLATFORM_MEDIA_COS_BUCKET" ]; do
  read -p "Platform Media COS 存储桶名称 (如 synapse-file-platform-1250000000): " PLATFORM_MEDIA_COS_BUCKET
done
while [ -z "$PLATFORM_MEDIA_COS_REGION" ]; do
  read -p "Platform Media COS 地域 (如 ap-guangzhou): " PLATFORM_MEDIA_COS_REGION
done

echo ""
echo ">>> Backup COS 存储配置（可选，回车跳过）"
echo "  配置后后台备份将保存到腾讯云 COS"
echo "  请填写已存在且服务端有权限访问的备份 bucket"
echo ""
read -p "Backup COS SecretId (回车跳过): " BACKUP_COS_SECRET_ID
if [ -n "$BACKUP_COS_SECRET_ID" ]; then
  read -p "Backup COS SecretKey: " BACKUP_COS_SECRET_KEY
  read -p "Backup COS 存储桶名称 (如 synapse-backup-1250000000): " BACKUP_COS_BUCKET
  read -p "Backup COS 地域 (如 ap-guangzhou): " BACKUP_COS_REGION
fi

echo ""

# 写入 .env 文件
cat > .env << EOF
POSTGRES_USER=synapse
POSTGRES_DB=synapse
POSTGRES_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://synapse:$DB_PASSWORD@postgres:5432/synapse
POSTGRES_HOST_PORT=5432

ADMIN_ACCESS_SECRET=$ADMIN_ACCESS_SECRET
USER_ACCESS_JWT_SECRET=$USER_ACCESS_JWT_SECRET
DESKTOP_UPDATE_INTENT_SECRET=$DESKTOP_UPDATE_INTENT_SECRET
USER_ACCESS_TOKEN_MINUTES=15
USER_REFRESH_TOKEN_DAYS=30

DATABASE_POOL_SIZE=10
PORT=3001
EOF

cat >> .env << EOF
APP_PUBLIC_URL=$APP_PUBLIC_URL
EOF

if [ -n "$DRIVE_COS_SECRET_ID" ]; then
cat >> .env << EOF

DRIVE_COS_SECRET_ID=$DRIVE_COS_SECRET_ID
DRIVE_COS_SECRET_KEY=$DRIVE_COS_SECRET_KEY
DRIVE_COS_BUCKET=$DRIVE_COS_BUCKET
DRIVE_COS_REGION=$DRIVE_COS_REGION
DRIVE_COLLABORATION_ENABLED=false
EOF
fi

cat >> .env << EOF

PLATFORM_MEDIA_COS_SECRET_ID=$PLATFORM_MEDIA_COS_SECRET_ID
PLATFORM_MEDIA_COS_SECRET_KEY=$PLATFORM_MEDIA_COS_SECRET_KEY
PLATFORM_MEDIA_COS_BUCKET=$PLATFORM_MEDIA_COS_BUCKET
PLATFORM_MEDIA_COS_REGION=$PLATFORM_MEDIA_COS_REGION
EOF

if [ -n "$BACKUP_COS_SECRET_ID" ]; then
cat >> .env << EOF

BACKUP_COS_SECRET_ID=$BACKUP_COS_SECRET_ID
BACKUP_COS_SECRET_KEY=$BACKUP_COS_SECRET_KEY
BACKUP_COS_BUCKET=$BACKUP_COS_BUCKET
BACKUP_COS_REGION=$BACKUP_COS_REGION
EOF
fi

echo ">>> .env 文件已生成"
echo ""

# 构建并启动
echo ">>> 开始构建并启动服务..."
docker compose --env-file .env up -d --build

echo ""
echo ">>> 等待服务启动..."
sleep 8
run_local_health_check && echo " ✅ 服务正常" || exit 1

echo ""
echo "========================================="
echo "  完成！"
echo "========================================="
echo ""
echo "验证: curl http://127.0.0.1:3000/healthz"
echo "日志: docker compose logs -f server"
echo ""
