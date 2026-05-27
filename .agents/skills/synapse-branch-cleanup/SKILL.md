---
name: synapse-branch-cleanup
description: Use when working in the Synapse repository and the user says 整理分支, 清理分支, 都合并到main, 合并所有分支到 main, 删除 main 之外的分支, 清理 worktree, merge all branches into main, or clean up branches/worktrees. This Synapse-only workflow merges local, worktree, and remote branch tips into main, verifies they are contained by main, pushes main, then deletes non-main branches and extra worktrees.
---

# Synapse Branch Cleanup

## Scope

This skill is only for `/Users/liyang/Documents/code/github/Synapse`.

Use it to consolidate all local branches, linked worktrees, and remote branches into `main`, then clean up everything except `main`. In this repository, a plain request such as "整理分支" is authorization for the non-force cleanup path described here.

## Hard Rules

- Stop unless `git rev-parse --show-toplevel` is exactly `/Users/liyang/Documents/code/github/Synapse`.
- Stop if the `origin` remote is missing or does not point to `FairyEver/Synapse`.
- Never delete or force-update `main`.
- Never use `git reset --hard`, `git branch -D`, `git worktree remove --force`, `git push --force`, or `rm -rf` unless the user explicitly authorizes that exact destructive operation in the current turn.
- Do not discard uncommitted changes. Never stash unless the user explicitly permits stashing; if stashing is permitted, use a clear stash message and report the stash ref.
- Automatically commit safe dirty changes in the main Synapse worktree before cleanup when all of these are true: the current branch is `main`, there are no untracked files, no linked worktree is dirty, no merge/rebase/cherry-pick/bisect is in progress, and `git diff --check` passes. Inspect the diff, use a concise conventional commit message that matches the changed area, and include the commit in the final summary. If the dirty changes are ambiguous, include untracked files, or belong to another worktree, stop and ask whether to commit, stash, or exclude them.
- Do not delete any branch or worktree until the branch tip is verified as an ancestor of `main`.
- Do not delete any remote branch until the merged `main` has been pushed to `origin/main`.
- If a merge, push, verification, or delete fails, stop immediately. Report what completed and what remains.

## Workflow

### 1. Inspect

From the Synapse repository root:

```bash
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git worktree list --porcelain
git branch --format='%(refname:short)|%(worktreepath)'
git branch -r --format='%(refname:short)'
```

Also check for an in-progress merge, rebase, cherry-pick, or bisect. Stop if one exists.

For this Synapse repository, a request like "整理分支" or "清理分支" counts as authorization for the non-force path only. Still summarize what will be merged/deleted before taking destructive steps in an update, but do not stop for a second confirmation unless a hard rule requires it.

If the main worktree is dirty and meets the safe auto-commit criteria from the Hard Rules, commit it before fetching or merging:

```bash
git diff --check
git add <changed tracked files>
git commit -m "<type>: <short description>"
```

If dirty changes do not meet the criteria, stop and ask whether to commit, stash, or exclude them.

### 2. Prepare `main`

Fetch remote refs without changing local work:

```bash
git fetch --prune origin
```

Switch to `main` and make sure it can safely include `origin/main`:

```bash
git switch main
git merge-base --is-ancestor origin/main main || git merge --ff-only origin/main
```

If `main` and `origin/main` have diverged or fast-forward fails, stop and report the divergence. Do not delete remote branches.

### 3. Build The Merge Queue

Collect these refs:

- Local branches except `main`.
- Remote branches under `origin/` except `origin/main` and `origin/HEAD`.
- Branches checked out by linked worktrees.

Deduplicate refs that point to the same commit. Prefer the local branch name when both local and remote refs exist for the same branch.

### 4. Merge Into `main`

For each queued ref:

1. Skip it when its tip is already contained in `main`:

   ```bash
   git merge-base --is-ancestor <ref> main
   ```

2. Otherwise merge it:

   ```bash
   git merge --no-edit <ref>
   ```

3. After every merge, verify containment:

   ```bash
   git merge-base --is-ancestor <ref> main
   ```

If there is a conflict, handle only this safe recurring case automatically:

- When the only conflicted file is `RELEASE_NOTES_PENDING.md`, resolve it by preserving unique Markdown bullet lines from both sides under the matching headings, removing conflict markers, and keeping existing section order. Then run `git diff --check`, `git add RELEASE_NOTES_PENDING.md`, and complete the merge with `git commit --no-edit`.

For any other conflicted file, non-list release-note conflict, delete/rename conflict, or uncertainty, do not continue deleting branches. Leave the repository in a recoverable state, list the conflicted files, and ask the user how to resolve it.

### 5. Verify And Push `main`

Run a focused verification appropriate to the merged changes. For broad unknown merges, run at least:

```bash
pnpm --filter @synapse/desktop run typecheck
```

If verification fails, stop before deleting remote branches unless the user explicitly decides to continue.

Push `main` before deleting any remote branch:

```bash
git push origin main
```

If this push fails, stop. Keep remote branches intact.

### 6. Remove Extra Worktrees And Local Branches

For every linked worktree that is not the main Synapse worktree:

1. Confirm the worktree is clean.
2. Confirm its branch tip is contained in `main`.
3. Remove the worktree:

   ```bash
   git worktree remove <path>
   ```

Then delete merged local branches with the safe delete form:

```bash
git branch -d <branch>
```

If safe deletion fails, stop and report the branch instead of forcing it.

Finally prune stale worktree metadata:

```bash
git worktree prune
```

### 7. Delete Remote Branches

For each remote branch except `origin/main` and `origin/HEAD`:

1. Verify the remote ref is contained in local `main`.
2. Verify local `main` has been pushed successfully.
3. Delete the remote branch:

   ```bash
   git push origin --delete <branch-without-origin-prefix>
   ```

Do not use wildcard remote deletion. Delete one branch at a time and stop on the first failure.

### 8. Final Check

Confirm the cleanup result:

```bash
git branch --format='%(refname:short)'
git branch -r --format='%(refname:short)'
git worktree list --porcelain
git status --short --branch
```

The final summary must state:

- Which refs were merged into `main`.
- Which local branches, remote branches, and worktrees were deleted.
- Whether `main` was pushed.
- Verification commands and results.
- Any dirty worktrees, conflicts, failed deletions, or remaining branches.
