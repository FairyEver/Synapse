#!/bin/sh
set -eu

cd /app/server
npx prisma migrate deploy

cd /app
nginx -t
nginx -g 'daemon off;' &
nginx_pid=$!

node server/dist/main.js &
node_pid=$!

shutdown() {
  kill -TERM "$nginx_pid" "$node_pid" 2>/dev/null || true
  wait "$nginx_pid" "$node_pid" 2>/dev/null || true
}

trap 'shutdown; exit 143' INT TERM

while true; do
  if ! kill -0 "$nginx_pid" 2>/dev/null; then
    wait "$nginx_pid" || true
    kill -TERM "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
    exit 1
  fi

  if ! kill -0 "$node_pid" 2>/dev/null; then
    set +e
    wait "$node_pid"
    node_status=$?
    set -e
    exit "$node_status"
  fi

  sleep 2
done
