#!/usr/bin/env bash
#
# 用测试环境的 OSS 配置跑上传冒烟：读字段 → 注入环境变量 → 执行你给的命令。
#
# 用法：
#   smoke/with-oss-credentials.sh node smoke/upload.mjs
#   OSS_SMOKE_CONFIRM=yes smoke/with-oss-credentials.sh node smoke/upload.mjs
#   smoke/with-oss-credentials.sh pnpm exec vitest run test/base-upload.test.ts
#
# 为什么要有这个脚本：
# 上传的真实链路要有凭据才跑得起来，而凭据**不能手工抄**——抄进命令行会进 shell 历史，
# 抄进文件会进提交。这里把整件事收进一个进程：读 → 注入 → 跑，凭据全程只在环境变量里。
#
# ⚠️ 与 `with-portal-token.sh` 的关系
#
# 两者是**同级**的两条路，各管各的凭据，**不要互相照搬、也不要合并**：
#   - `with-portal-token.sh` 取的是**会话 token**（从浏览器 cookie），打的是 Portal 后端。
#   - 本脚本读的是**OSS 的 AK/SK**（从构建期 env 文件），打的是阿里云 OSS。
# 浏览器 cookie 里没有 OSS 的 AK/SK（它由 ali-oss 在页面内本地签名），
# 所以 OSS 这条路**没法**从 `with-portal-token.sh` 那条路取到凭据。
#
# ⚠️ 授权与边界（**不要扩大**）
#
# 这是用户 2026-09-20 对本项目的**明确授权**，范围**只有测试环境**：
#
#   - 只读 `CodeReview_Projects_Js`（`test/portal/main`）的 `build/env/.env.build.test`（测试环境那份）。
#     **不要**去读 `.env.build`（生产那份），也不要去读别的实例的 env 文件。
#   - 凭据只进本进程的环境变量：**不落盘、不打印、不进任何产物或提交**。
#   - 本脚本只被授权用于「跑上传冒烟」这一件事。
#
# ⚠️ 这是一个**会真写外部存储**的入口
#
# 它本身只注入环境变量，但下游 `smoke/upload.mjs` 会往测试桶里写一个探针对象
# （并在验证后自行删除）。**不要把它接到生产配置上。**
set -euo pipefail

PORTAL_REPO="${PORTAL_REPO:-/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js}"
ENV_FILE="$PORTAL_REPO/build/env/.env.build.test"

if [ "$#" -eq 0 ]; then
  echo "用法：$0 <命令...>" >&2
  echo "例：  $0 node smoke/upload.mjs" >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "找不到测试环境配置文件：$ENV_FILE" >&2
  # ⚠️ `$PORTAL_REPO` 必须加花括号：它后面紧跟的是全角 `）`，
  # 而这个 locale 下 bash 会把那个多字节字符当成变量名的一部分，
  # 于是报 `PORTAL_REPO）: unbound variable` —— 一个只在出错分支里才现形的坑（实测踩到过）。
  echo "Portal 前端仓库的根可以用 PORTAL_REPO 覆盖（当前：${PORTAL_REPO}）。" >&2
  exit 1
fi

# 取一个字段的值。
# ⚠️ 只按**第一个** `=` 切分：AK/SK 里可能出现 `=`（base64 结尾常见），
# 用 `cut -d= -f2` 那种写法会把值截断。
# 顺带处理：可选的 `export ` 前缀、两侧空白、CRLF、以及整体被引号包起来的情况。
read_field() {
  local key="$1"
  sed -nE "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*(.*)$/\2/p" "$ENV_FILE" \
    | head -1 \
    | tr -d '\r' \
    | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' \
    | sed -E 's/[[:space:]]+$//'
}

# .env 里的字段名 → smoke/upload.mjs 期望的环境变量名
OSS_ACCESS_KEY_ID="$(read_field VITE_OSS_V2_ACCESS_KEY_ID)"
OSS_ACCESS_KEY_SECRET="$(read_field VITE_OSS_V2_ACCESS_KEY_SECRET)"
OSS_BUCKET="$(read_field VITE_OSS_V2_BUCKET)"
OSS_ENDPOINT="$(read_field VITE_OSS_V2_ENDPOINT)"
OSS_REGION="$(read_field VITE_OSS_V2_REGION)"

# ⚠️ 缺字段就**明确报错**，不要带着半份配置往下跑 ——
# 半份配置的失败方式会变成 OSS 那边的 403，把"少读了字段"伪装成"签名算错了"。
missing=()
for pair in \
  "VITE_OSS_V2_ACCESS_KEY_ID:${OSS_ACCESS_KEY_ID}" \
  "VITE_OSS_V2_ACCESS_KEY_SECRET:${OSS_ACCESS_KEY_SECRET}" \
  "VITE_OSS_V2_BUCKET:${OSS_BUCKET}" \
  "VITE_OSS_V2_ENDPOINT:${OSS_ENDPOINT}"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  if [ -z "$value" ]; then missing+=("$name"); fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "在 $ENV_FILE 里没读到：${missing[*]}" >&2
  echo "带着半份配置往下跑会把「少读了字段」伪装成「签名算错了」，所以这里直接停。" >&2
  exit 1
fi

# ⚠️ 只报「取到了哪几个字段」，**不报任何值** —— 连长度都不报。
# （`with-portal-token.sh` 报了 token 长度；这里更严一档，因为 AK/SK 是长期密钥。）
echo "[oss-credentials] 已从测试环境配置取得 5 个字段：" \
  "VITE_OSS_V2_ACCESS_KEY_ID / _ACCESS_KEY_SECRET / _BUCKET / _ENDPOINT / _REGION"
if [ -z "$OSS_REGION" ]; then
  # region 不参与 V1 签名（它只出现在 V4 的 scope 里），缺了不影响，
  # 但要**说出来**而不是默默往下跑。
  echo "[oss-credentials] 注意：VITE_OSS_V2_REGION 是空的（V1 签名用不到它，继续）"
fi

OSS_ACCESS_KEY_ID="$OSS_ACCESS_KEY_ID" \
OSS_ACCESS_KEY_SECRET="$OSS_ACCESS_KEY_SECRET" \
OSS_BUCKET="$OSS_BUCKET" \
OSS_ENDPOINT="$OSS_ENDPOINT" \
OSS_REGION="$OSS_REGION" \
  "$@"
