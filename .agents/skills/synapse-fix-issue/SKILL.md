---
name: synapse-fix-issue
description: Use when working in the Synapse repository and the user provides a FairyEver/Synapse GitHub issues directory URL, issue search/query URL, or says to 修改问题, 改 bug, 修 bug, 解决 issue. Sequentially process every eligible open bug from the supplied list with safe GitHub status transitions, focused commits, validation, Chinese issue comments, refreshed queues, text progress bars, and estimated remaining time.
---

# Synapse Fix Issue

## Purpose And Completion Contract

Process all eligible open `bug` issues from the user's GitHub issues list for `FairyEver/Synapse`.

- Treat `https://github.com/FairyEver/Synapse/issues` as the full repository issue list.
- For an issues URL with `q=...`, preserve every supplied filter and intersect it with this skill's eligibility rules.
- Process one issue at a time. Finish its state transition before touching the next issue.
- End when the refreshed queue has no unattempted eligible issue or a safety rule requires stopping.
- Treat a fix as complete only after validation, a focused commit, a detailed Chinese issue comment, and issue closure all succeed.

Create local commits by default. Do not push, merge, or open a pull request unless the user explicitly requests it or another governing workflow requires it. Always report whether each commit is local-only or reachable from a remote ref.

## Labels And State Model

Classification labels come from issue triage. Never add, remove, or rewrite them:

```text
bug
优先级:<P0|P1|P2|P3>
类型:<崩溃|数据丢失|安全|错误处理|交互|UI质量|死代码|架构>
模块:<工作流|Agent|调度器|数据库|设置|内容|应用壳|Electron|UI|基础设施|MCP|管理后台|Server|网盘>
```

Manage only these status labels:

| Label | Meaning | Missing-label color | Missing-label description |
|---|---|---:|---|
| `状态:待确认` | Eligible and waiting to be claimed | `FBCA04` | `等待 agent 认领处理` |
| `状态:处理中` | Claimed by an active worker | `0E8A16` | `已有 agent 正在处理` |
| `状态:误判` | Confirmed false positive, duplicate, non-bug, or already fixed | `E4E669` | `issue 判断为误报` |
| `状态:需要决策` | Missing required information or blocked by a product/user decision | `D93F0B` | `信息不足需要用户确认` |

Use these transitions:

```text
no 状态:* or 状态:待确认 -> 状态:处理中 -> fixed and closed
                                      -> 状态:误判, kept open
                                      -> 状态:需要决策, kept open
```

- Treat an open `bug` with no `状态:*` or only `状态:待确认` as unclaimed and eligible.
- Exclude `状态:处理中`, `状态:误判`, and `状态:需要决策`.
- Exclude and report issues carrying an unknown or conflicting `状态:*` combination. Do not normalize them automatically.
- Create only missing status labels with the metadata above. Never overwrite metadata for an existing label.

## Run Ledger

Maintain an in-memory ledger for the current run:

- Source URL and decoded query.
- Initial eligible count.
- Attempted issue numbers.
- Completed issue numbers and results.
- Skipped issues and reasons.
- Current issue start time and excluded pause intervals.
- Valid timing samples.
- Changed files, verification commands, commit hashes, and publication status.

Never process the same issue twice in one run. Newly eligible issue numbers discovered during refresh may join the queue. If a completed issue reappears, report the anomaly and do not retry it automatically.

## Workflow

### 1. Prepare

- Work from the local Synapse repository and verify the Git remote targets `FairyEver/Synapse`.
- Run `git status` before any mutation. Inspect both working-tree and staged changes.
- Treat all pre-existing changes as user-owned. Do not overwrite, revert, unstage, stage, or commit them.
- Continue with unrelated dirty files only when target issue files do not overlap and validation remains meaningful. Stop before claiming when overlap makes isolation unsafe.
- Pull only when safe. Prefer a non-interactive fast-forward-only update; never force-reset, discard, or silently merge unrelated remote changes.
- Verify GitHub authentication and repository read/write access before claiming the first issue.
- Confirm all four status labels exist. Create only missing labels using the state-model metadata.
- Do not start a dev server or open the application unless the issue's verification requires it and repository rules permit it.

### 2. Parse And Fetch The Source List

- Accept only `FairyEver/Synapse` issue directory or issue-search URLs. Reject a different repository instead of silently switching scope.
- URL-decode `q` exactly once and preserve its search text, labels, assignee, milestone, author, and priority filters.
- Apply required repository, open-state, `bug`, and status eligibility locally after fetching so user filters remain intact.
- Fetch at least `number,title,state,labels,url,body,updatedAt,assignees` for queue construction.
- Never rely on the `gh issue list` default limit of 30. Fetch all pages. `--limit 1000` is acceptable only when the result is below the cap; if a search reaches an API cap or cannot be proven complete, stop and report truncation before claiming anything.
- Prefer `gh issue list --json ...` plus local filtering when query escaping is fragile. Use a paginated GitHub API or connector query when CLI search cannot return the full set.

### 3. Build And Refresh The Queue

Select issues that:

- Match the decoded user query.
- Are in `FairyEver/Synapse`.
- Are open and have `bug`.
- Have no status label or only `状态:待确认`.
- Have not already been attempted in this run.

Sort by priority, then issue number:

```text
优先级:P0 > 优先级:P1 > 优先级:P2 > 优先级:P3 > no priority
```

Process lower issue numbers first within the same priority. Do not shard or process issues in parallel.

Re-run the original source query after every attempt. Do not decrement a cached count. If a failed claim remains eligible after refresh, stop and report it instead of selecting it repeatedly or moving past it silently.

### 4. Show Progress And Estimate Remaining Time

Start an issue timer immediately before presenting the next issue. Stop it when the issue reaches its final result for this run, before refreshing the queue.

Record elapsed seconds, issue number, and result. Exclude explicit waits for user input or external approval.

Use these valid ETA samples:

- `已修复并关闭`
- `状态:误判`
- `状态:需要决策`

Exclude attempts skipped before full analysis because of a status race, claim failure, permission/auth failure, or worktree safety block. Show excluded elapsed time, but do not use it for ETA.

Calculate after every refresh:

```text
average seconds per issue = sum(valid elapsed seconds) / valid sample count
estimated remaining seconds = average seconds per issue * refreshed remaining eligible count
```

- Use samples from the current run only. Never infer active processing time from issue age, comments, commits, or earlier runs.
- Keep calculations in seconds. Display whole minutes below 90 minutes, then hours and minutes. Display `不足 1 分钟` instead of zero caused by rounding.
- With no sample, display `粗略预计剩余：暂无样本（完成首个有效 issue 后提供）`.
- With no remaining issue, display `粗略预计剩余：0 分钟`.
- Always display the sample count and average duration so uncertainty is visible.

Render a 20-cell plain-text progress bar immediately before every ETA:

```text
current total = completed queue items + refreshed remaining eligible count
progress percentage = completed queue items / current total * 100
completed cells = floor(progress percentage * 20 / 100)
```

- Use `█` for completed cells and `░` for remaining cells.
- Increment `completed queue items` for fixed or classified issues and for safely skipped issues confirmed no longer eligible. Do not increment it for a failed attempt that remains eligible or blocked.
- Show completed count, current total, and the percentage rounded to the nearest whole number.
- For an initially empty queue, show a full bar followed by `完成（0/0）`.
- Recalculate from the refreshed queue. The percentage may move backward or forward when matching issues enter or leave the queue.
- Keep the bar on one text line. Do not replace it with a table, diagram, image, or emoji.

Before claiming, use:

```text
当前待处理（含本条）：<remaining count>
进度：[<20 text cells>] <completed>/<current total>（<percentage>%）
粗略预计剩余：<暂无样本 | estimated duration>
估算依据：<无有效样本 | sample count 条有效样本，平均每条 average duration>
正在处理：#<number> <title>
链接：<url>
内容：
<body, or “（无正文）”>
```

Always show the issue number, title, link, and body before analysis.

### 5. Claim One Issue

- Re-read state, labels, assignees, updated time, and latest comments immediately before claiming.
- Continue only when the issue is still open, still has `bug`, and has no status or only `状态:待确认`.
- Add `状态:处理中` and remove `状态:待确认` in the same edit when applicable.
- Re-read the issue after the edit. Continue only when it is open with `状态:处理中`, without `状态:待确认`, `状态:误判`, or `状态:需要决策`.
- Treat label claiming as best-effort concurrency control, not an atomic lock. Abandon the attempt if another actor's comment, assignment, or status transition indicates a competing claim.
- If the claim fails, refresh once. If the issue is still eligible, stop to avoid a retry loop. Otherwise record a safe skip and continue.

### 6. Analyze And Decide

- Read the complete body, comments, linked references, classification labels, relevant code, tests, and recent history.
- Establish the trigger, expected behavior, actual behavior, root cause, affected scope, and a verifiable success condition.
- Use priority, type, and module labels to guide risk and search scope; do not treat labels as proof of root cause.
- Read `AGENTS.md`, applicable `.claude/rules/*`, product context, and module design documents before changing product boundaries or UI behavior.
- Check whether current `HEAD` already fixes the issue. Require concrete code/test/history evidence before classifying it as already fixed.
- Evaluate whether a proposed fix removes, restricts, degrades, slows, or hides an existing user capability. Positive changes that improve safety, clarity, reliability, speed, or capability without removing behavior are not blockers.
- Re-read the issue immediately before modifying code. Continue only while it remains open with `状态:处理中` and no terminal status.

Choose exactly one result:

- Fixable: implement and verify.
- Misjudged: proven false positive, duplicate, non-bug, or already fixed.
- Needs decision: missing reproduction information, unclear expected behavior, or a negative user-facing tradeoff requiring approval.

Do not classify an issue as `状态:误判` merely because reproduction failed, a test already exists, or the implementation is difficult.

### 7. Classify Without Fixing

For `状态:误判`:

- Keep the issue open.
- Comment in Chinese with concrete evidence and links or code references when available.
- Add `状态:误判` and remove `状态:处理中`.
- Do not change classification labels.

For `状态:需要决策`:

- Keep the issue open.
- Comment in Chinese with the exact missing information or decision required.
- For a negative behavior tradeoff, state the existing capability that would be lost, why the technical fix creates that loss, and the options requiring a decision.
- Add `状态:需要决策` and remove `状态:处理中`.
- Do not use this status for an ordinary technical failure that needs more engineering work but no user/product decision.

Make classification transitions idempotent. Before retrying a partial operation, re-read labels and comments to avoid duplicate comments. Verify the issue remains open with the intended terminal status and without `状态:处理中`. Stop on any partial GitHub write failure.

### 8. Fix And Verify

- Make the smallest change that resolves only the current issue. Do not refactor adjacent code or combine issues.
- Reuse existing modules, services, hooks, components, utilities, and test patterns before adding anything.
- Follow Synapse UI, Electron, IPC, data, logging, security, and dependency boundaries.
- Apply the `AGENTS.md` change-impact checklist: update `RELEASE_NOTES_PENDING.md` for user-visible/release-relevant changes; synchronize MCP schemas, system Skill guidance, generated files, API docs, or packaged-asar checks when the affected capability requires them.
- Run the narrowest meaningful verification for the changed area. Add or update a focused regression test when practical.
- Record exact commands and results. If a command cannot run, record why and assess whether remaining evidence is proportionate to the issue risk.
- Do not commit when a relevant verification fails because of the change. High-risk security, data-loss, crash, migration, or Electron-boundary fixes require decisive verification; unavailable decisive verification is a blocker.
- Re-read the issue and inspect worktree overlap again before staging.

### 9. Commit And Close

- Inspect both unstaged and staged diffs. Ensure every issue file is isolated from pre-existing user edits.
- Never use broad staging such as `git add .` or `git add -A`.
- Stage only explicit issue paths. If unrelated changes were already staged, use a path-limited commit such as `git commit --only -- <issue paths>` so they remain untouched.
- Create one focused commit, usually `fix: resolve issue #123`. Do not bypass hooks with `--no-verify`.
- Verify the resulting commit diff and capture its full hash, subject, branch, and remote reachability.
- Re-read the issue one final time. Continue only if it remains open with `状态:处理中` and no terminal status.
- Check existing comments for the commit hash before posting, so retries do not duplicate the closing comment.

Close with a detailed Chinese comment:

```markdown
已处理。

## 问题分析

说明根因、触发条件和影响范围。

## 修改方案

说明行为变化和关键修改。

## 验证结果

- `<command>`：<result>
- 未运行的验证及原因（如有）

## 交付状态

- `<commit hash>` `<commit message>`
- 分支：`<branch>`
- 可达性：<仅本地 | remote ref>
```

- Close with reason `completed` only after the comment succeeds.
- Remove `状态:处理中` after closure when GitHub permits it.
- Re-read and verify the final closed state. If closure succeeded but label cleanup failed, record that partial cleanup; do not reopen the issue solely for label cleanup.
- Do not push, merge, or create a PR unless separately authorized.

### 10. Refresh And Report

After each fixed, classified, or safely skipped issue:

```text
#<number> 处理结果：<已修复并关闭 | 状态:误判 | 状态:需要决策 | 已跳过：reason>
本条耗时：<duration> <已纳入估算 | 未纳入估算：reason>
已重新获取列表，当前待处理：<remaining count>
进度：[<20 text cells>] <completed>/<current total>（<percentage>%）
粗略预计剩余：<0 分钟 | 暂无样本 | estimated duration>
估算依据：<无有效样本 | sample count 条有效样本，平均每条 average duration>
```

Then select the next issue only from the refreshed, sorted, unattempted queue.

## Failure And Resume Rules

- Never continue to the next issue after a partial GitHub state transition, failed commit, failed close, or unsafe worktree overlap.
- If work stops before local edits, remove `状态:处理中` when safe, explain the failure in a Chinese comment when possible, and verify the issue is eligible again.
- If work stops after isolated uncommitted edits, restore only edits created for the current issue when that can be done safely. Never discard user changes with destructive Git commands.
- If work stops after a commit or when local edits cannot be safely isolated, keep `状态:处理中`, report the exact branch/commit/worktree state, and stop for explicit recovery.
- If GitHub permissions prevent cleanup, report the stranded status label and required manual action.
- Resume a `状态:处理中` issue only when the user explicitly identifies it or the current run ledger proves it is this run's own interrupted issue. Never steal an arbitrary processing issue.

## Final Summary

End with a concise Chinese summary containing:

- Source URL and effective query scope.
- Initial eligible count, attempted count, completed count, and latest refreshed remaining count.
- Final text progress bar, total active processing time, valid sample count, average duration, and latest ETA.
- For every issue: number, title, classification labels, result, elapsed time, ETA inclusion, verification commands, commit hash, branch, and remote reachability when applicable.
- Skips, partial GitHub states, permission failures, validation blockers, worktree blockers, and issues intentionally left `状态:处理中`.
- Required follow-up decisions or recovery steps.

## Safety Rules

- Never run destructive Git commands, force-push, silently discard changes, or modify user-owned work.
- Never modify classification labels.
- Never close `状态:误判` or `状态:需要决策` issues.
- Never close a fix without a focused commit and adequate verification.
- Never batch unrelated issue fixes into one commit.
- Never silently continue after GitHub auth, label, comment, close, commit, or permission failures.
