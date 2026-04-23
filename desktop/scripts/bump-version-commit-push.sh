#!/usr/bin/env sh
# 作用：把 desktop 子包 package.json 的版本号最后一段自动加 1，然后在仓库根目录
# 执行 `git add -A` 把工作区所有改动一起提交，并推送当前分支。
# 一般通过根目录 `pnpm bump:commit:push` 触发（会转发到 @synapse/desktop）。
# 由于使用 `git add -A`，执行前要先确认工作区改动范围。
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(git -C "$PACKAGE_ROOT" rev-parse --show-toplevel)

cd "$PACKAGE_ROOT"

NEW_VERSION=$(
node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const packageJsonPath = path.join(process.cwd(), "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = String(packageJson.version ?? "").trim();

if (!version) {
  throw new Error("package.json is missing version");
}

const parts = version.split(".");
const lastPart = Number.parseInt(parts[parts.length - 1], 10);

if (!Number.isInteger(lastPart)) {
  throw new Error(`package.json version must end with a number: ${version}`);
}

parts[parts.length - 1] = String(lastPart + 1);
packageJson.version = parts.join(".");

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
process.stdout.write(packageJson.version);
NODE
)

cd "$REPO_ROOT"

git add -A
git commit -m "chore: bump version to ${NEW_VERSION}"

CURRENT_BRANCH=$(git branch --show-current)

if [ -z "$CURRENT_BRANCH" ]; then
  echo "Unable to determine current branch." >&2
  exit 1
fi

git branch --set-upstream-to=origin/"$CURRENT_BRANCH" "$CURRENT_BRANCH" 2>/dev/null || true
git push -u origin "$CURRENT_BRANCH"

printf 'Bumped version to %s and pushed the current branch.\n' "$NEW_VERSION"
