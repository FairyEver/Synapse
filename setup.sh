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
  echo "  1) 重置（清除所有数据，重新初始化）"
  echo "  2) 退出"
  read -p "输入选项 [1/2]: " CHOICE

  case $CHOICE in
    1)
      echo ""
      echo "⚠️  这将删除数据库所有数据并重新生成密钥"
      read -p "确认重置？[y/N]: " CONFIRM
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
echo "  JWT_SECRET: $JWT_SECRET"
echo ""

echo ">>> 生成 License 密钥对..."
openssl genpkey -algorithm Ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem

PRIVATE_KEY=$(awk 'NR>1{line=line $0} END{print "-----BEGIN PRIVATE KEY-----\\n" line "\\n-----END PRIVATE KEY-----"}' private.pem)
PUBLIC_KEY=$(awk 'NR>1{line=line $0} END{print "-----BEGIN PUBLIC KEY-----\\n" line "\\n-----END PUBLIC KEY-----"}' public.pem)

echo "  密钥对已生成"
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

echo ""

# 写入 .env 文件
cat > .env << EOF
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_HOST_PORT=5432

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_JWT_SECRET=$JWT_SECRET

LICENSE_PRIVATE_KEY="$PRIVATE_KEY"
LICENSE_PUBLIC_KEY="$PUBLIC_KEY"
LICENSE_KEY_ID=prod-key-001
LICENSE_LEASE_DAYS=7

ACTIVATION_ATTEMPT_RETENTION_DAYS=90
ACTIVATION_RATE_WINDOW_MINUTES=15
ACTIVATION_RATE_MAX_FAILURES_PER_IP=20
ACTIVATION_RATE_MAX_FAILURES_PER_EMAIL=8
ACTIVATION_RATE_MAX_FAILURES_PER_DEVICE=8
ACTIVATION_RISK_WINDOW_MINUTES=60
ACTIVATION_RISK_MAX_DISTINCT_IPS_PER_CODE=6
ACTIVATION_RISK_MAX_DISTINCT_EMAILS_PER_CODE=4
ACTIVATION_RISK_MAX_DISTINCT_DEVICES_PER_CODE=4
ACTIVATION_RISK_MAX_BOUND_CONFLICTS_PER_CODE=3

DATABASE_POOL_SIZE=10
PORT=3000
EOF

echo ">>> .env 文件已生成"
echo ""

# 清理临时密钥文件
rm -f private.pem public.pem

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
