#!/usr/bin/env bash
#
# 用测试环境门户里**已有的登录态**跑冒烟：取会话 token → 注入环境变量 → 执行你给的命令。
#
# 用法：
#   smoke/with-portal-token.sh pnpm smoke:meeting-room
#   smoke/with-portal-token.sh node smoke/submit-meeting-application.mjs
#   smoke/with-portal-token.sh pnpm exec vitest run test/baseline-write.test.ts
#
# 为什么要有这个脚本：
# 冒烟要打真实测试后端，而 `platform.js` 的 token 头取自 cookie `hr-0.0.0-token`
# （`app/portal/utils/system.js:29` 的 `getToken()` 读的就是它；租户同理是 `hr-0.0.0-tenant`）。
# 手工抄 token 既会因为过期而反复返工，也容易在复制粘贴里漏进文件、日志或提交。
# 这里把整件事收进一个进程：取 → 注入 → 跑 → 收会话，token 全程只在环境变量里。
#
# ⚠️ 授权与边界（**不要扩大，也不要照搬到别处**）
#
# 这是用户 2026-09-20 对本项目的**明确授权**，用于跳过 browser-skill 那条
# 「绝不从页面提取凭据/cookie/token」的规则。它的范围**只有测试环境**：
#
#   - 只对 `webtest01.wodecorp.cn`（测试门户）与 `biz-api-test.wodecorp.cn`（测试后端）成立。
#   - **生产环境一律不适用**；其它 host 的实例（那 18 个里的另外 17 个）同样不适用。
#   - token 只进本进程的环境变量：**不落盘、不打印、不进任何产物或提交**。
#   - 抓浏览器基准**不需要**走这里——`tools/baseline/install-hook.js` 的脱敏是在页内做的，
#     抓基准依然不需要凭据，那条路径的规则没有变。
#
# 文档：`docs/conventions.md` 第 8 条（已按本条授权更新）。
set -euo pipefail

PORTAL_URL="${PORTAL_TEST_URL:-https://webtest01.wodecorp.cn/portal.html#/}"
BASE_URL="${PORTAL_BASE_URL:-https://biz-api-test.wodecorp.cn}"

if [ "$#" -eq 0 ]; then
  echo "用法：$0 <命令...>" >&2
  exit 2
fi

if ! command -v bsk >/dev/null 2>&1; then
  echo "找不到 bsk（Browser Skill CLI，通常在 ~/.local/bin/bsk）。" >&2
  exit 1
fi

SID=""
cleanup() {
  if [ -n "$SID" ]; then bsk session stop "$SID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# `bsk session start` 的最后一行是 4 位会话 id
SID=$(bsk session start --no-focus 2>/dev/null | tail -1 | tr -d '[:space:]')
if [ "${#SID}" -ne 4 ]; then
  echo "起会话失败（拿到的会话 id 是「${SID}」）。先跑 bsk doctor 看扩展连没连上。" >&2
  exit 1
fi

bsk navigate "$PORTAL_URL" --session "$SID" >/dev/null
# 门户是 SPA，等它挂载完再读 cookie；读不到会在下面如实报错，不靠这个等待兜底
bsk wait-ms 4000 --session "$SID" >/dev/null 2>&1 || true

# 只读这两个 cookie，页面上别的东西一概不碰
JS="JSON.stringify({t:(document.cookie.split('; ').find(c=>c.startsWith('hr-0.0.0-token='))||'').split('=').slice(1).join('='),n:(document.cookie.split('; ').find(c=>c.startsWith('hr-0.0.0-tenant='))||'').split('=').slice(1).join('=')})"
OUT=$(bsk evaluate --session "$SID" --json "$JS" 2>/dev/null)

VALUES=$(
  printf '%s' "$OUT" | node -e "
    let s=''
    process.stdin.on('data', (d) => { s += d })
    process.stdin.on('end', () => {
      try {
        const v = JSON.parse(JSON.parse(s).value)
        process.stdout.write(String(v.t) + '\n' + String(v.n))
      } catch (error) {
        process.stdout.write('\n')
      }
    })"
)
TOKEN=$(printf '%s' "$VALUES" | sed -n '1p')
TENANT_ID=$(printf '%s' "$VALUES" | sed -n '2p')

if [ -z "$TOKEN" ]; then
  echo "从 $PORTAL_URL 没取到会话 token（cookie hr-0.0.0-token 为空）。" >&2
  echo "多半是那个 Agent Window 里没登录——先用 bsk 手工打开该地址登录一次，之后就有了。" >&2
  exit 1
fi
if [ -z "$TENANT_ID" ]; then
  echo "取到了 token 但没取到租户（cookie hr-0.0.0-tenant 为空）。" >&2
  echo "租户不能猜：后端在部分路径会静默选错租户（设计 F26）。" >&2
  exit 1
fi

# 只报长度与租户，**不报 token 值**
echo "[portal-token] 已取得（${#TOKEN} 字符），租户 ${TENANT_ID}，环境 ${BASE_URL}"

PORTAL_BASE_URL="$BASE_URL" \
PORTAL_TOKEN="$TOKEN" \
PORTAL_TENANT_ID="$TENANT_ID" \
  "$@"
