---
name: synapse-fix-issue
description: Use when working in the Synapse repository and the user provides a FairyEver/Synapse GitHub issues directory URL, issue search/query URL, or says to 修改问题, 改 bug, 修 bug, 解决 issue. Sequentially fix eligible open bug issues from the supplied list, using GitHub labels for claim/status management, focused commits, validation, Chinese issue comments, and live remaining-count updates after every issue.
---

# Synapse Fix Issue

## Purpose

Fix all eligible open `bug` issues from the user's GitHub issues list for `FairyEver/Synapse`.

The user may provide only a GitHub issues URL. Treat that as an instruction to run this workflow:

- For the repository issues directory, such as `https://github.com/FairyEver/Synapse/issues`, process all eligible issues in that directory.
- For an issues URL with `q=...`, process only issues matching that query, preserving all supplied filters.

Intersect either list with open `bug` issues that are not already in a terminal/blocked status.

## Status Labels

The repository uses classification labels and status labels.

Classification labels are created by issue triage and must not be changed by this skill:

```text
bug
优先级:<P0|P1|P2|P3>
类型:<崩溃|数据丢失|安全|错误处理|交互|UI质量|死代码|架构>
模块:<工作流|Agent|调度器|数据库|设置|内容|应用壳|Electron|UI|基础设施>
```

This skill manages only these status labels:

```text
状态:处理中
状态:误判
状态:需要决策
```

An open issue with `bug` and no `状态:*` label is unclaimed.

## Workflow

### 1. Prepare

- Work from the local Synapse repository.
- Check `git status` first. Do not overwrite, revert, stage, or commit user changes.
- If the tree is dirty with changes outside the target issue scope, continue without asking when the unrelated files can be avoided. Treat those files as user-owned, do not edit them, and stage/commit only files changed for the current issue. Stop and ask only when the existing dirty files overlap the files that must be changed for the issue or make safe validation impossible.
- Pull the latest code only when it is safe for the current worktree. Do not force-reset or discard local changes.
- Confirm the GitHub status labels exist: `状态:处理中`, `状态:误判`, `状态:需要决策`. Create missing labels before processing issues.
- Parse the supplied GitHub issues URL. Treat a plain repository issues directory as having no additional user filter. For a `q=...` URL, preserve its filters, including labels, search text, assignee, milestone, and priority filters.
- Query matching issues with `gh` or the GitHub connector. Prefer `gh issue list --json number,title,state,labels,url,body` plus local filtering when query escaping is fragile.

### 2. Build The Target Queue

Select only issues that satisfy all of these rules:

- Match the user's supplied GitHub search filter.
- Are in `FairyEver/Synapse`.
- Are open.
- Have the `bug` label.
- Do not have `状态:处理中`, `状态:误判`, or `状态:需要决策`.

Sort the queue by priority label, then issue number:

```text
优先级:P0 > 优先级:P1 > 优先级:P2 > 优先级:P3 > no priority
```

Within the same priority, process lower issue numbers first.

Process the whole queue sequentially. There is no "one issue per run" limit and no agent ordinal/parallel sharding rule. Treat the initial queue as a snapshot only; rebuild it from the source URL after every issue attempt.

Before claiming each issue, show a concise progress update in the conversation using the latest snapshot:

```text
当前待处理（含本条）：<remaining count>
正在处理：#<number> <title>
链接：<url>
内容：
<body, or “（无正文）”>
```

Always show the issue number, link, title, and body before starting its analysis. Do not defer these details to the final summary.

### 3. Claim One Issue At A Time

For each queued issue:

- Re-read the issue state and labels immediately before claiming.
- Claim only if it is still open, has `bug`, and has no `状态:*` label.
- Add `状态:处理中`.
- Re-read the issue state and labels after claiming.
- Continue only if it is still open, still has `状态:处理中`, and does not have `状态:误判` or `状态:需要决策`.
- If claiming fails or another actor changed the state, skip that issue and record the reason in the final summary. Do not grab a different issue out of order until the current attempt is safely abandoned.

### Refresh Progress After Every Issue

After an issue is fixed and closed, classified as `状态:误判` or `状态:需要决策`, or safely skipped:

- Re-run the original source URL query instead of decrementing a cached count.
- Reapply the eligibility rules and sorting from step 2.
- Report the completed issue's result and the refreshed remaining eligible count in the conversation.
- Select the next issue only from this refreshed queue, then show its number, link, title, and body before claiming it.

Use this progress format:

```text
#<number> 处理结果：<已修复并关闭 | 状态:误判 | 状态:需要决策 | 已跳过：reason>
已重新获取列表，当前待处理：<remaining count>
```

Continue until the refreshed queue is empty or a safety rule requires stopping.

### 4. Analyze

For the claimed issue:

- Read the title, body, comments, linked references, and classification labels.
- Use `优先级:*`, `类型:*`, and `模块:*` to guide the search.
- Locate relevant docs before product-boundary changes. Follow `AGENTS.md`, `.claude/rules/*`, and module design documents.
- Identify whether the issue needs a code fix, is a false positive, or requires a product/user decision.
- Before choosing an implementation, evaluate whether the fix would create a negative user-facing behavior change. Treat it as negative when a user could previously perform an action or rely on a behavior, but the proposed fix would remove, restrict, degrade, slow down, hide, or otherwise make that capability worse from the user's perspective.
- Positive user-facing changes, such as making behavior clearer, safer, faster, more reliable, or more capable without removing an existing capability, are not blockers and should continue through the normal bug-fix flow.
- Before modifying code, re-read the issue and continue only if it remains open with `状态:处理中`.

### 5. Classify Without Fixing

If the issue should not be directly fixed, do not close it.

For a false positive, unavailable reproduction, existing coverage, or clear non-bug:

- Add `状态:误判`.
- Remove `状态:处理中`.
- Keep the issue open.
- Do not change classification labels.
- Comment in Chinese with the reason.

For missing information, unclear product behavior, or a required decision:

- Add `状态:需要决策`.
- Remove `状态:处理中`.
- Keep the issue open.
- Do not change classification labels.
- Comment in Chinese with the specific decision/questions needed.

For a proposed fix that would cause a negative user-facing behavior change:

- Treat it as blocked by product decision, even if it would technically resolve the reported bug.
- Do not implement the fix.
- Add `状态:需要决策`.
- Remove `状态:处理中`.
- Keep the issue open.
- Do not change classification labels.
- Comment in Chinese with the blocking item, including what existing user capability or behavior would be lost or negatively affected, why the fix creates that tradeoff, and what decision is needed before continuing.

After classification, refresh the source list and report progress before selecting the next issue.

### 6. Fix

When the issue is fixable:

- Make the smallest code change that resolves this issue.
- Do not mix multiple issues in one code change or commit. Finish, commit, and close the current issue before editing for the next issue.
- Follow Synapse rules: no unsafe Electron boundary changes, no naked IPC/webContents/fs writes in restricted areas, no UI custom colors/styles, no wasteful UI copy, and no unrelated refactors.
- If the fix is user-visible or release-relevant, update the root `RELEASE_NOTES_PENDING.md`.
- Run the narrowest meaningful verification for the changed area: tests, typecheck, lint, hard-constraint checks, package checks, or source-level checks as appropriate.
- If a verification cannot run, record the reason.
- Before staging or committing, re-read the issue and continue only if it remains open with `状态:处理中`.

### 7. Commit And Close

For each fixed issue:

- Stage only files related to that issue.
- Create one focused commit, usually:

```text
fix: resolve issue #123
```

- Capture the commit hash.
- Re-read the issue one final time before closing. Continue only if it is still open with `状态:处理中` and without `状态:误判` or `状态:需要决策`.
- Close the issue with a detailed Chinese comment:

```markdown
已处理。

## 问题分析

说明 issue 的根因、触发条件、影响范围。

## 修改方案

说明具体改了哪些逻辑、文件或行为。

## 验证结果

列出运行过的测试 / check / 手动验证结果。
如果有未能运行的验证，也要说明原因。

## 相关提交

- `<commit hash>` `<commit message>`
```

- Remove `状态:处理中` after closing when GitHub permits it. If removal fails after close, mention it in the final summary.
- Then refresh the source list and report progress before selecting the next issue.

## Final Summary

End with a concise Chinese summary:

- The source GitHub query URL.
- Initial eligible count, number processed, and latest refreshed remaining count.
- For each issue: number, title, classification labels, final result, verification commands, and commit hash when applicable.
- Issues skipped because status changed, claim failed, permission failed, or worktree safety blocked progress.
- Remaining blockers or follow-up decisions.

## Safety Rules

- Never run destructive git commands such as `git reset --hard`, forced checkout, or force-push unless the user explicitly requests them.
- A dirty worktree is not by itself a blocker. When unrelated user changes exist, keep a clear boundary, avoid those files, and stage/commit only this run's issue fix files.
- Never close an issue unless its fix has been committed or it was explicitly handled according to the close requirements above.
- Never close `状态:误判` or `状态:需要决策` issues.
- Never modify classification labels.
- Never batch unrelated issue fixes into one commit.
- Stop the relevant operation and report clearly if GitHub auth, permissions, push, issue comments, label updates, or close actions fail.
