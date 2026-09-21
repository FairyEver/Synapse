#!/bin/bash
# Rebuild the three repositories `SynapseMobileUITests/TerminalGitUITests` walks through.
#
#   scripts/make-git-acceptance-fixture.sh
#
# Why a script: the fixture is **stateful** by design. One of the cases is "discard the
# changes and switch" — which discards the changes and switches. Run the walk twice
# against one fixture and the second run starts from a repo that no longer has anything
# to discard, so it fails on an assertion about the state it expected to find rather
# than on the thing it was testing. Rebuild before every run.
#
# The three repos answer three different questions and are kept apart so neither run can
# spoil the other:
#
#   dirty/     a modified tracked file + an untracked one, no upstream (so 推送 says
#              「首次推送」). Covers the second line, the entry, the three choices, and
#              that discarding keeps the untracked file.
#   conflict/  feature/conflict changes the same line as main (always conflicts),
#              feature/other only adds a file (always merges). Covers the merge flow.
#   remote/    has a real remote, so it has cached refs/remotes to list. Covers the
#              remote-branch list: one branch that exists **only** on the remote, one
#              whose local counterpart exists but has no upstream (so 迁出 has to ask
#              for another local name), and main tracking origin/main.
#
# They live under /tmp because the phone reaches them by `cd`-ing there from the
# terminal, and because nothing here is worth keeping.
set -euo pipefail

ROOT=/tmp/synapse-git-acceptance
rm -rf "$ROOT"
mkdir -p "$ROOT/dirty" "$ROOT/conflict" "$ROOT/remote"

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

# --- C: 有远端（远端分支列表、迁出）---
# 裸远端放在 ROOT 里但不自成一个「让人 cd 进去」的仓库 —— 手机只 cd 到 remote/。
git init -q --bare -b main "$ROOT/remote-origin.git"
git_init "$ROOT/remote"
printf '# 有远端的仓库\n' > "$ROOT/remote/README.md"
git -C "$ROOT/remote" add -A
git -C "$ROOT/remote" commit -qm "初始提交"
git -C "$ROOT/remote" remote add origin "$ROOT/remote-origin.git"
git -C "$ROOT/remote" push -q -u origin main

# 远端有、本地没有：推上去，再把本地那条删掉（refs/remotes/origin/only-on-remote 留下）。
git -C "$ROOT/remote" checkout -qb only-on-remote
printf '只在远端\n' > "$ROOT/remote/remote-file.txt"
git -C "$ROOT/remote" add -A
git -C "$ROOT/remote" commit -qm "只在远端有的提交"
git -C "$ROOT/remote" push -q -u origin only-on-remote
git -C "$ROOT/remote" checkout -q main
git -C "$ROOT/remote" branch -D only-on-remote

# 同名本地分支存在、但**没有上游**：点 origin/taken 应当推「填另一个本地名」那一页。
git -C "$ROOT/remote" branch taken
git -C "$ROOT/remote" push -q origin taken:refs/heads/taken

# 一次 fetch 把三条远端跟踪引用坐实（打开列表是只读缓存的，不获取就看不到）。
git -C "$ROOT/remote" fetch -q --all --prune

echo "夹具建好了："
git -C "$ROOT/dirty" status --short --branch | sed 's/^/  dirty: /'
git -C "$ROOT/conflict" status --short --branch | sed 's/^/  conflict: /'
git -C "$ROOT/remote" status --short --branch | sed 's/^/  remote: /'
echo "  remote 的远端分支："
git -C "$ROOT/remote" for-each-ref --format='    %(refname:short)' refs/remotes
