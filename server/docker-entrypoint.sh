#!/bin/sh
set -eu

cd /app/server
npx prisma migrate deploy

cd /app
nginx -t
nginx -g 'daemon off;' &

exec node server/dist/main.js
