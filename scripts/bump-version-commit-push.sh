#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

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

git add -A
git commit -m "chore: bump version to ${NEW_VERSION}"

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  CURRENT_BRANCH=$(git branch --show-current)

  if [ -z "$CURRENT_BRANCH" ]; then
    echo "Unable to determine current branch." >&2
    exit 1
  fi

  git push -u origin "$CURRENT_BRANCH"
fi

printf 'Bumped version to %s and pushed the current branch.\n' "$NEW_VERSION"
