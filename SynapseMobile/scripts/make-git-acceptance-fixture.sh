#!/bin/bash
# Rebuild the two repositories `SynapseMobileUITests/TerminalGitUITests` walks through.
#
#   scripts/make-git-acceptance-fixture.sh
#
# Why a script: the fixture is **stateful** by design. One of the cases is "discard the
# changes and switch" — which discards the changes and switches. Run the walk twice
# against one fixture and the second run starts from a repo that no longer has anything
# to discard, so it fails on an assertion about the state it expected to find rather
# than on the thing it was testing. Rebuild before every run.
#
# The two repos answer two different questions and are kept apart so neither run can
# spoil the other:
#
#   dirty/     a modified tracked file + an untracked one, no upstream (so 推送 says
#              「首次推送」). Covers the second line, the entry, the three choices, and
#              that discarding keeps the untracked file.
#   conflict/  feature/conflict changes the same line as main (always conflicts),
#              feature/other only adds a file (always merges). Covers the merge flow.
#
# They live under /tmp because the phone reaches them by `cd`-ing there from the
# terminal, and because nothing here is worth keeping.
set -euo pipefail

ROOT=/tmp/synapse-git-acceptance
rm -rf "$ROOT"
mkdir -p "$ROOT/dirty" "$ROOT/conflict"

git_init() {
  git -C "$1" init -q -b main
  git -C "$1" config user.email acceptance@example.com
  git -C "$1" config user.name "Acceptance Fixture"
}

# --- A: 有改动（含未跟踪文件）---
git_init "$ROOT/dirty"
printf '第一行\n第二行\n' > "$ROOT/dirty/tracked.txt"
printf '# 说明\n' > "$ROOT/dirty/README.md"
git -C "$ROOT/dirty" add -A
git -C "$ROOT/dirty" commit -qm "初始提交"
printf '第一行\n第二行改了\n' > "$ROOT/dirty/tracked.txt"   # 已跟踪文件的修改
printf '草稿\n' > "$ROOT/dirty/scratch.md"                   # 未跟踪的新文件
git -C "$ROOT/dirty" branch feature/other

# --- B: 冲突 + 可成功合并 ---
git_init "$ROOT/conflict"
printf 'A\nB\nC\n' > "$ROOT/conflict/shared.txt"
printf '# 冲突仓库\n' > "$ROOT/conflict/README.md"
git -C "$ROOT/conflict" add -A
git -C "$ROOT/conflict" commit -qm "初始提交"
git -C "$ROOT/conflict" checkout -qb feature/conflict
printf 'A\nB 来自 feature\nC\n' > "$ROOT/conflict/shared.txt"
git -C "$ROOT/conflict" add -A
git -C "$ROOT/conflict" commit -qm "feature 改了这一行"
git -C "$ROOT/conflict" checkout -q main
printf 'A\nB 来自 main\nC\n' > "$ROOT/conflict/shared.txt"
git -C "$ROOT/conflict" add -A
git -C "$ROOT/conflict" commit -qm "main 也改了同一行"
git -C "$ROOT/conflict" checkout -qb feature/other
printf '新文件\n' > "$ROOT/conflict/added-by-other.txt"
git -C "$ROOT/conflict" add -A
git -C "$ROOT/conflict" commit -qm "加了个文件"
git -C "$ROOT/conflict" checkout -q main

echo "夹具建好了："
git -C "$ROOT/dirty" status --short --branch | sed 's/^/  dirty: /'
git -C "$ROOT/conflict" status --short --branch | sed 's/^/  conflict: /'
