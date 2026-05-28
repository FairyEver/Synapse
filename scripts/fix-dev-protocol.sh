#!/bin/bash
# fix-dev-protocol.sh
# 修复 macOS 开发模式下 synapse:// 协议无法唤起 Electron 的问题。
#
# 原因：开发模式下 Electron 使用 node_modules 中的 Electron.app，
# 其 Info.plist 不含 CFBundleURLTypes，macOS Launch Services 无法
# 识别 synapse:// 协议处理器。
#
# 使用方式：在仓库根目录执行 bash scripts/fix-dev-protocol.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 查找 node_modules 中的 Electron.app Info.plist
PLIST=$(find "$REPO_ROOT/node_modules" -path "*/electron/dist/Electron.app/Contents/Info.plist" -print -quit 2>/dev/null)

if [ -z "$PLIST" ]; then
  echo "❌ 未找到 Electron.app Info.plist，请先执行 pnpm install"
  exit 1
fi

ELECTRON_APP="$(dirname "$(dirname "$PLIST")")"

echo "📍 Electron.app: $ELECTRON_APP"

# 检查是否已添加
if /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST" &>/dev/null; then
  echo "✅ synapse:// 协议已注册，无需重复操作"
else
  echo "🔧 向 Info.plist 添加 synapse:// URL scheme..."
  /usr/libexec/PlistBuddy \
    -c "Add :CFBundleURLTypes array" \
    -c "Add :CFBundleURLTypes:0 dict" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.synapse.desktop" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string synapse" \
    "$PLIST"
  echo "✅ Info.plist 已修改"
fi

# 注册到 Launch Services
echo "🔧 注册到 macOS Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$ELECTRON_APP"

echo "✅ 完成！synapse:// 协议现在可以唤起开发模式的 Electron"
echo ""
echo "验证："
echo "  open \"synapse://auth/callback?code=test&state=test\""
