#!/bin/bash
# 兼容旧修复入口；与 pnpm dev 共用开发 .app 准备逻辑，不再修改共享 Electron。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$REPO_ROOT/desktop/scripts/dev/prepare-dev-electron.mjs"
