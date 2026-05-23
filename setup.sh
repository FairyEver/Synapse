#!/bin/bash
# 服务端初始化 / 重置脚本
# 在项目根目录执行: bash setup.sh
set -e

cd "$(dirname "$0")/server"

echo "========================================="
echo "  Synapse Server"
echo "========================================="
echo ""

if [ -f .env ]; then
  echo "检测到已有配置，请选择操作："
  echo "  1) 重置数据库（保留密钥和配置）"
  echo "  2) 完全重置（清除所有数据，重新生成密钥）"
  echo "  3) 退出"
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
      curl -sf http://127.0.0.1:3000/healthz && echo " ✅ 服务正常" || echo " ❌ 服务未就绪，查看日志: docker compose logs server"
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

# 生成密钥
echo ">>> 生成 JWT Secret..."
JWT_SECRET=$(openssl rand -hex 32)
USER_ACCESS_JWT_SECRET=$(openssl rand -hex 32)
echo "  ADMIN_JWT_SECRET: $JWT_SECRET"
echo "  USER_ACCESS_JWT_SECRET: $USER_ACCESS_JWT_SECRET"
echo ""

# 收集用户输入
read -p "管理员邮箱: " ADMIN_EMAIL
read -p "管理员密码 (至少12位): " ADMIN_PASSWORD

while [ ${#ADMIN_PASSWORD} -lt 12 ]; do
  echo "  ❌ 密码不足12位，请重新输入"
  read -p "管理员密码 (至少12位): " ADMIN_PASSWORD
done

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
echo ">>> 备份配置（可选，回车跳过）"
echo "  配置腾讯云 COS 后将启用自动备份功能"
echo "  参考文档: docs/superpowers/specs/2026-05-05-backup-export-design.md"
echo ""
read -p "腾讯云 COS SecretId (回车跳过): " COS_SECRET_ID
if [ -n "$COS_SECRET_ID" ]; then
  read -p "腾讯云 COS SecretKey: " COS_SECRET_KEY
  read -p "COS 存储桶名称 (如 synapse-backup-1250000000): " COS_BUCKET
  read -p "COS 地域 (如 ap-guangzhou): " COS_REGION
fi

echo ""

# 写入 .env 文件
cat > .env << EOF
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_HOST_PORT=5432

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_JWT_SECRET=$JWT_SECRET
USER_ACCESS_JWT_SECRET=$USER_ACCESS_JWT_SECRET
USER_ACCESS_TOKEN_MINUTES=15
USER_REFRESH_TOKEN_DAYS=30

DATABASE_POOL_SIZE=10
PORT=3000
EOF

cat >> .env << EOF
APP_PUBLIC_URL=$APP_PUBLIC_URL
EOF

if [ -n "$COS_SECRET_ID" ]; then
cat >> .env << EOF

COS_SECRET_ID=$COS_SECRET_ID
COS_SECRET_KEY=$COS_SECRET_KEY
COS_BUCKET=$COS_BUCKET
COS_REGION=$COS_REGION
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
curl -sf http://127.0.0.1:3000/healthz && echo " ✅ 服务正常" || echo " ❌ 服务未就绪，查看日志: docker compose logs server"

echo ""
echo "========================================="
echo "  完成！"
echo "========================================="
echo ""
echo "验证: curl http://127.0.0.1:3000/healthz"
echo "日志: docker compose logs -f server"
echo ""
