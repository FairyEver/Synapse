#!/bin/bash
# 本机运行：远程重启服务端容器
set -e

SERVER="root@120.53.17.64"
REMOTE_DIR="/www/wwwroot/synapse/server"

verify_remote_database_auth() {
  ssh "$SERVER" "cd $REMOTE_DIR && bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

read_env_value() {
  sed -n "s/^${1}=//p" .env | tail -n 1
}

postgres_user=$(read_env_value POSTGRES_USER)
postgres_db=$(read_env_value POSTGRES_DB)
postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)

if [ -z "$postgres_user" ] || [ -z "$postgres_db" ] || [ -z "$postgres_password" ]; then
  echo "database tcp auth failed: POSTGRES_USER, POSTGRES_DB and POSTGRES_PASSWORD must be set; restart stopped before touching the server container"
  exit 1
fi

if docker compose --env-file .env exec -T -e PGPASSWORD="$postgres_password" postgres \
  psql -h postgres -p 5432 -U "$postgres_user" -d "$postgres_db" -Atc 'select 1' >/dev/null; then
  echo "database tcp auth ok"
else
  echo "database tcp auth failed: .env Postgres identity does not match the existing database; restart stopped before touching the server container"
  exit 1
fi
REMOTE_SCRIPT
}

run_remote_health_check() {
  ssh "$SERVER" "cd $REMOTE_DIR && bash -s" <<'REMOTE_SCRIPT'
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

check_not_redirect_to_dashboard() {
  local name=$1
  local url=$2
  local header_file
  local body_file
  local error_file
  local http_code
  local curl_status

  header_file=$(mktemp)
  body_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o "$body_file" -D "$header_file" -w "%{http_code}" "$url" 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && ! grep -qi "^Location: /dashboard/" "$header_file"; then
    printf "%s ok (HTTP %s)\n" "$name" "$http_code"
  else
    printf "%s FAILED (HTTP %s, should not redirect to /dashboard/)\n" "$name" "$http_code"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    echo "headers:"
    print_file_preview "$header_file"
    echo "body:"
    print_file_preview "$body_file"
    record_failure
  fi

  rm -f "$header_file" "$body_file" "$error_file"
}

check_body_contains "healthz" "http://127.0.0.1:3000/healthz" '"status":"ok"'
check_body_contains "console" "http://127.0.0.1:3000/console/" '<div id="root">'
check_body_contains "admin" "http://127.0.0.1:3000/admin/" '<title>Synapse 管理</title>'
check_redirect "dashboard redirect" "http://127.0.0.1:3000/dashboard" "/console/"
check_not_redirect_to_dashboard "webhook route" "http://127.0.0.1:3000/webhooks/not-found/test"
check_not_redirect_to_dashboard "drive share route" "http://127.0.0.1:3000/share/shr_not_found"

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

echo ">>> 检查数据库网络认证..."
verify_remote_database_auth

echo ">>> 重启服务容器..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose --env-file .env restart server"

echo ">>> 等待服务启动..."
sleep 5

echo ">>> 健康检查..."
run_remote_health_check && echo " ✓ 服务已就绪"
