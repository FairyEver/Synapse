# gitee-issue-gatekeeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `gitee-issue-gatekeeper` as a feature-parity copy of `smarterlayer-issue-gatekeeper` where all Gitee reads and writes are performed by the agent using the `gitee-openapi` skill.

**Architecture:** The new skill is a workflow skill, not a Gitee API script package. It preserves the original gatekeeper decisions, reporting formats, dry-run semantics, label inference, and WeCom notification behavior, while removing Gitee-fetching shell scripts and instructing the agent to use `gitee-openapi` for every Gitee operation.

**Tech Stack:** Codex skill files, Markdown instructions, zsh shell notification script, local skill directories under `/Users/liyang/.agents/skills`.

---

## File Structure

Create:

- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/acceptance-criteria.md`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/issue-label-keywords.tsv`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.example.tsv`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.tsv`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json`

Do not create:

- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/audit_pending_issues.sh`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_bug_period_report.sh`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_open_bug_table.sh`
- `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/gitee_issue_openapi.sh`

Reference source:

- `/Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper`
- `/Users/liyang/.agents/skills/gitee-openapi`
- `/Users/liyang/Documents/code/github/Synapse/docs/superpowers/specs/2026-06-02-gitee-issue-gatekeeper-design.md`

---

### Task 1: Create The Skill Skeleton

**Files:**
- Create: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/`
- Create: selected files listed in File Structure

- [ ] **Step 1: Verify source skills exist**

Run:

```bash
test -f /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/SKILL.md
test -f /Users/liyang/.agents/skills/gitee-openapi/SKILL.md
```

Expected: both commands exit with status `0`.

- [ ] **Step 2: Create the target directory tree**

Run:

```bash
mkdir -p /Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents
mkdir -p /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references
mkdir -p /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts
mkdir -p /Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals
```

Expected: directories exist.

- [ ] **Step 3: Copy non-Gitee-access files from the original skill**

Run:

```bash
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/.synapse.json /Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/agents/openai.yaml /Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/references/acceptance-criteria.md /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/acceptance-criteria.md
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/references/issue-label-keywords.tsv /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/issue-label-keywords.tsv
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/references/wecom-mention-map.example.tsv /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.example.tsv
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/references/wecom-mention-map.tsv /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.tsv
cp /Users/liyang/.agents/skills/smarterlayer-issue-gatekeeper/scripts/send_issue_group_message.sh /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh
```

Expected: copied files exist. Do not copy original Gitee-accessing scripts.

- [ ] **Step 4: Verify excluded scripts are absent**

Run:

```bash
test ! -f /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/audit_pending_issues.sh
test ! -f /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_bug_period_report.sh
test ! -f /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_open_bug_table.sh
test ! -f /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/gitee_issue_openapi.sh
```

Expected: all commands exit with status `0`.

---

### Task 2: Write The New SKILL.md

**Files:**
- Create: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md`

- [ ] **Step 1: Write `SKILL.md` with the new dependency boundary**

Use `apply_patch` to create `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md` with this content:

```markdown
---
name: gitee-issue-gatekeeper
description: Use when triaging or auditing Gitee issues, deciding whether an issue is ready for developers to start fixing, reporting current open bugs as a table, sending Bug daily or weekly reports, or governing pending bug issues. Always use this skill together with gitee-openapi whenever the task needs Gitee issue data, comments, labels, state transitions, members, repositories, projects, or work items. This skill preserves smarterlayer-issue-gatekeeper behavior but all Gitee reads and writes are performed through gitee-openapi at the agent workflow level.
---

# Gitee Issue Gatekeeper

## Overview

Use this skill to audit whether a Gitee Issue has enough information for development to start and to keep the original `smarterlayer-issue-gatekeeper` reporting and notification behavior.

This skill does not access Gitee directly. When Gitee data is needed, use the `gitee-openapi` skill to retrieve or mutate Gitee resources, then return to this skill's criteria, templates, and reporting workflow.

## Hard Boundary

- Do not resolve, configure, print, or expose Gitee credentials in this skill.
- Do not call Gitee APIs with `curl`, `fetch`, token-bearing URLs, or local helper scripts from this skill.
- Do not call files under `gitee-openapi/scripts/` directly from this skill.
- Use `gitee-openapi` as an agent skill for every Gitee read or write.
- Preserve user-visible behavior from `smarterlayer-issue-gatekeeper`; do not drop a capability just because the old shell script is not copied.

## When To Use

Use this skill when the user asks to:

- audit whether an issue can enter fixing
- check whether a bug issue is qualified
- move a qualified issue to `修复中 / progressing`
- write missing-information feedback for an unqualified issue
- report current open bugs
- send a Bug daily report
- send a Bug weekly report
- audit pending bug issues
- comment missing information
- infer labels from issue content
- send the gatekeeper result to a WeCom group

## Required Skill Pairing

When the workflow needs Gitee data or mutation, first use `gitee-openapi` for that Gitee operation.

Examples:

- Use `gitee-openapi` to fetch issue title, body, state, labels, assignee, creator, comments, attachments, project, repository, and issue type.
- Use `gitee-openapi` to list issues for open bug tables, daily reports, weekly reports, and pending issue audits.
- Use `gitee-openapi` to discover state ids, label ids, issue type ids, member ids, project ids, and enterprise ids.
- Use `gitee-openapi` to update issue state, post issue comments, or update labels when the user clearly requested that write action.

After the Gitee data is available, apply the gatekeeper rules below.

## Judgment Contract

Conclusion is always one of:

- `合格`
- `不合格`

`合格` means the issue description is enough for development to begin the first round of investigation and fixing.

`不合格` means a blocking information gap remains, so do not move the issue to fixing.

## Readiness Criteria

Read [references/acceptance-criteria.md](./references/acceptance-criteria.md) before auditing.

An issue is usually qualified when most of these are present and no blocking gap remains:

- Problem phenomenon is clear.
- A page, module, API, client type, repository, project, or business flow is identifiable.
- There is at least one trigger condition, reproduction path, error text, screenshot, recording, log, API response, or comment with equivalent evidence.
- Expected behavior or actual behavior is clear enough to start investigation.
- Missing details do not block the first debugging pass.

An issue is unqualified when any of these blocks development:

- The problem itself is unclear.
- There is no location and no screenshot, log, error text, or reproduction context.
- The issue only says "不能用了", "不对", "异常", or equivalent without context.
- Missing environment information prevents identifying the affected client, project, or flow.
- The request cannot be classified as bug, requirement, or usage question.

## Single Issue Workflow

1. Use `gitee-openapi` to fetch the issue title, body, state, labels, assignee, creator, comments, and useful metadata.
2. Read `references/acceptance-criteria.md`.
3. Decide `合格` or `不合格`.
4. For `合格`:
   - State that the issue has reached the standard for development to start.
   - Explain the evidence in one short paragraph.
   - If the user requested mutation, use `gitee-openapi` to move the issue to `修复中 / progressing`.
   - If a custom state id is required, use `gitee-openapi` to discover the state id by title. Do not hardcode ids.
   - Notify the assignee in the group message.
5. For `不合格`:
   - Do not move the issue state.
   - List only actionable missing items that block development.
   - If comments are enabled and the user requested mutation, use `gitee-openapi` to post the missing-information comment.
   - Notify the creator in the group message.

## Open Bug Table Workflow

This preserves the old `send_open_bug_table.sh` capability without copying that Gitee-accessing script.

1. Use `gitee-openapi` to list the same open or progressing bug issues the old skill reported.
2. Keep issues where `issue_type = 缺陷`.
3. Keep the configured issue states, defaulting to `待确认` and `修复中` unless the user specifies otherwise.
4. Format a plain text table with columns:

```text
编号 / 状态 / 负责人 / 标题
```

5. Collect assignee logins for WeCom mentions.
6. If the user asked to send the table and dry-run is off, send through `scripts/send_issue_group_message.sh`.

## Bug Daily And Weekly Report Workflow

This preserves the old `send_bug_period_report.sh --day` and `--week` capabilities.

1. Use `gitee-openapi` to fetch the issue set required for the requested period.
2. Filter `issue_type = 缺陷`.
3. Compute:
   - created bugs in the period
   - completed bugs in the period
   - current backlog
   - current state distribution
   - owner distribution
   - `修复中更新` by current state plus updated time, with the same caveat as the original skill
4. Format the report in concise plain text.
5. If the user asked to send the report and dry-run is off, send through `scripts/send_issue_group_message.sh`.

## Pending Issue Audit Workflow

This preserves the old `audit_pending_issues.sh` capability without copying that Gitee-accessing script.

1. Use `gitee-openapi` to list pending bug issues, defaulting to `issue_type = 缺陷` and issue state `待确认`.
2. Use `gitee-openapi` to fetch comments for each issue.
3. Apply the readiness criteria.
4. Infer labels using [references/issue-label-keywords.tsv](./references/issue-label-keywords.tsv).
5. In dry-run, report planned comments and label changes only.
6. When not dry-run and explicitly authorized:
   - use `gitee-openapi` to post missing-information comments
   - use `gitee-openapi` to update labels
7. Include an auto-feedback marker in comments:

```text
<!-- gitee-issue-gatekeeper:auto-feedback -->
```

8. Avoid duplicate auto-feedback comments when a marker already exists.

## Dry-Run And Write Safety

Dry-run allows reads through `gitee-openapi`, but blocks:

- issue state updates
- issue comments
- label updates
- group message sends

Before any Gitee write, ensure the user clearly requested mutation. If not, output what would be changed and stop.

## WeCom Notification

Use `scripts/send_issue_group_message.sh` only for group notification delivery. It must not read or write Gitee.

Mention mapping uses:

```text
references/wecom-mention-map.tsv
```

The mapping format is:

```text
gitee_login	wecom_userid	mobile
```

## Output Style

For a single issue audit:

```text
合格

该 Issue 已达到开发可开始修复的标准：...

动作：...
通知：...
```

or:

```text
不合格

缺失信息：
- ...

反馈消息：
...
```

For reports, output the same concise plain text report content that would be sent to the group.

Do not expose credentials, token values, Authorization headers, cookies, or private request internals.
```

- [ ] **Step 2: Verify the new skill metadata**

Run:

```bash
sed -n '1,12p' /Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md
```

Expected: frontmatter name is `gitee-issue-gatekeeper`, and the description mentions using `gitee-openapi`.

---

### Task 3: Rewrite Usage Documentation

**Files:**
- Create: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md`

- [ ] **Step 1: Replace `references/usage.md` with workflow-first usage**

Use `apply_patch` to replace `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md` with this content:

```markdown
# Gitee Issue Gatekeeper Usage

## Install Location

The skill lives at:

```text
/Users/liyang/.agents/skills/gitee-issue-gatekeeper
```

It depends on the agent being able to use:

```text
/Users/liyang/.agents/skills/gitee-openapi
```

This skill does not configure Gitee credentials. All Gitee reads and writes happen when the agent uses `gitee-openapi`.

## WeCom Configuration

Preview mode:

```bash
export ISSUE_REVIEW_DRY_RUN=1
```

Generic webhook:

```bash
export ISSUE_REVIEW_GROUP_WEBHOOK_URL="机器人 webhook"
export ISSUE_REVIEW_GROUP_WEBHOOK_KIND="wecom"
```

`qwsend` mode:

```bash
export ISSUE_REVIEW_SEND_METHOD="qwsend"
export QWSEND_WEBHOOK_KEY="企业微信机器人 key"
```

If `qwsend` is not in `PATH`:

```bash
export ISSUE_REVIEW_WECOM_CLI="/实际路径/qwsend"
```

Mention mapping:

```bash
export ISSUE_REVIEW_WECOM_MENTION_MAP_FILE="/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.tsv"
```

Mapping file format:

```text
gitee_login	wecom_userid	mobile
```

## Common Requests

Single issue audit:

```text
审核这个 Gitee Issue 是否可以进入修复中：<issue url or id>
```

Open bug table:

```text
输出当前待处理 Bug 表格
```

Bug daily report:

```text
发送 Bug 日报
```

Bug weekly report:

```text
发送 Bug 周报
```

Pending issue audit:

```text
审计待确认缺陷，dry-run 先看结果
```

The agent should use `gitee-openapi` whenever it needs Gitee issue data, comments, labels, state ids, members, or mutations.

## Removed Script Commands

The old `smarterlayer-issue-gatekeeper` Gitee-accessing scripts are intentionally not included:

```text
scripts/send_open_bug_table.sh
scripts/send_bug_period_report.sh
scripts/audit_pending_issues.sh
```

Their user-visible capabilities remain. The Gitee API part moved to the agent workflow using `gitee-openapi`.

## Script Self-Check

Only the notification script should remain:

```bash
zsh -n scripts/send_issue_group_message.sh
```

Static boundary check:

```bash
rg -n "GITEE_ACCESS_TOKEN|GITEE_API_BASE|GITEE_OPENAPI_SKILL_DIR|access_token=|10\\.1\\.1\\.156|fetch\\(|curl .*gitee|api/v5|scripts/gitee-openapi|send_open_bug_table|send_bug_period_report|audit_pending_issues" .
```

Expected: no matches, except this usage document may mention removed script names and forbidden patterns as part of the self-check.
```

- [ ] **Step 2: Verify usage doc no longer instructs token setup**

Run:

```bash
rg -n "export GITEE_ACCESS_TOKEN|export GITEE_API_BASE|zsh scripts/send_open_bug_table.sh|zsh scripts/send_bug_period_report.sh|zsh scripts/audit_pending_issues.sh" /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md
```

Expected: no matches.

---

### Task 4: Update Metadata And Notification Boundaries

**Files:**
- Modify: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json`
- Modify: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml`
- Modify: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh`

- [ ] **Step 1: Inspect copied metadata**

Run:

```bash
sed -n '1,120p' /Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json
sed -n '1,160p' /Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml
```

Expected: identify any `smarterlayer-issue-gatekeeper` names or descriptions that need replacement.

- [ ] **Step 2: Replace skill-name references**

Use `apply_patch` to replace references to:

```text
smarterlayer-issue-gatekeeper
SmarterLayer Issue Gatekeeper
```

with:

```text
gitee-issue-gatekeeper
Gitee Issue Gatekeeper
```

in:

```text
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh
```

- [ ] **Step 3: Verify notification script does not access Gitee**

Run:

```bash
rg -n "GITEE_ACCESS_TOKEN|GITEE_API_BASE|access_token=|10\\.1\\.1\\.156|api/v5|enterprises/.*/issues|scripts/gitee-openapi|fetch\\(|curl .*gitee" /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh
```

Expected: no matches.

- [ ] **Step 4: Verify notification script syntax**

Run:

```bash
zsh -n /Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh
```

Expected: exits with status `0`.

---

### Task 5: Add Skill Evaluation Prompts

**Files:**
- Create: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json`

- [ ] **Step 1: Write eval prompts for feature parity**

Use `apply_patch` to create `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json`:

```json
{
  "skill_name": "gitee-issue-gatekeeper",
  "evals": [
    {
      "id": 1,
      "prompt": "审核这个 Gitee 缺陷 Issue 能不能进入修复中：标题是“审批详情页点击输入框后布局错位”，正文写明 iOS 26.4、测试环境、审批详情页、点击输入框后页面被顶起，并附截图。合格的话推进状态并通知负责人。",
      "expected_output": "Uses gitee-openapi for issue data and mutation, concludes 合格, explains why development can start, states that the issue should be moved to 修复中/progressing, and prepares an assignee notification without exposing credentials.",
      "files": []
    },
    {
      "id": 2,
      "prompt": "审核这个 Gitee Issue：标题“审批不对”，正文只有“线上异常，帮看下”。不合格就反馈创建人需要补什么。",
      "expected_output": "Uses gitee-openapi for issue data, concludes 不合格, does not move state, lists actionable missing information, and prepares creator feedback without requesting irrelevant details.",
      "files": []
    },
    {
      "id": 3,
      "prompt": "输出当前待处理 Bug 表格并发到群里，保持原 smarterlayer-issue-gatekeeper 的表格字段。",
      "expected_output": "Uses gitee-openapi to fetch issues, filters 缺陷 in 待确认/修复中 or equivalent configured states, outputs 编号/状态/负责人/标题 table, collects assignees for WeCom mentions, and sends only if authorized and dry-run is off.",
      "files": []
    },
    {
      "id": 4,
      "prompt": "生成本周 Bug 周报，包含新增、完成、积压、负责人分布和状态分布。",
      "expected_output": "Uses gitee-openapi to fetch the weekly issue set, computes the same weekly report metrics as the original skill, keeps the 修复中更新 caveat, and does not rely on removed shell scripts.",
      "files": []
    }
  ]
}
```

- [ ] **Step 2: Validate JSON syntax**

Run:

```bash
python3 -m json.tool /Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json >/dev/null
```

Expected: exits with status `0`.

---

### Task 6: Run Boundary And Feature-Parity Verification

**Files:**
- Verify: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper`

- [ ] **Step 1: List created files**

Run:

```bash
find /Users/liyang/.agents/skills/gitee-issue-gatekeeper -maxdepth 3 -type f | sort
```

Expected output includes:

```text
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/.synapse.json
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/agents/openai.yaml
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/acceptance-criteria.md
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/issue-label-keywords.tsv
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.example.tsv
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/wecom-mention-map.tsv
/Users/liyang/.agents/skills/gitee-issue-gatekeeper/scripts/send_issue_group_message.sh
```

Expected output does not include:

```text
audit_pending_issues.sh
send_bug_period_report.sh
send_open_bug_table.sh
gitee_issue_openapi.sh
```

- [ ] **Step 2: Run hard boundary search**

Run:

```bash
rg -n "GITEE_ACCESS_TOKEN|GITEE_API_BASE|GITEE_OPENAPI_SKILL_DIR|access_token=|10\\.1\\.1\\.156|fetch\\(|curl .*gitee|api/v5|scripts/gitee-openapi" /Users/liyang/.agents/skills/gitee-issue-gatekeeper
```

Expected: no matches, except `references/usage.md` may include the search pattern as a self-check. If matches appear in executable files or `SKILL.md`, fix them.

- [ ] **Step 3: Verify original capabilities are named in the new skill**

Run:

```bash
rg -n "Single Issue Workflow|Open Bug Table Workflow|Bug Daily And Weekly Report Workflow|Pending Issue Audit Workflow|WeCom Notification|Dry-Run" /Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md
```

Expected: all workflow headings are present.

- [ ] **Step 4: Verify `gitee-openapi` dependency is explicit**

Run:

```bash
rg -n "gitee-openapi" /Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md /Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md
```

Expected: matches state that Gitee operations must use the `gitee-openapi` skill, not its scripts.

- [ ] **Step 5: Verify no original skill files were modified**

Run:

```bash
git -C /Users/liyang/Documents/code/github/Synapse status --short
```

Expected: no changes from this task inside the Synapse repository unless the implementation also updates tracked docs. Existing unrelated changes in `desktop/src/modules/settings/...` may remain and must not be touched.

---

### Task 7: Final Review And Handoff

**Files:**
- Review: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/SKILL.md`
- Review: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/references/usage.md`
- Review: `/Users/liyang/.agents/skills/gitee-issue-gatekeeper/evals/evals.json`

- [ ] **Step 1: Compare against the design spec**

Run:

```bash
sed -n '1,240p' /Users/liyang/Documents/code/github/Synapse/docs/superpowers/specs/2026-06-02-gitee-issue-gatekeeper-design.md
```

Expected: every feature-parity row in the spec is represented in `SKILL.md`.

- [ ] **Step 2: Check for placeholder language**

Run:

```bash
pattern="$(printf '%s' 'TB''D|TO''DO|PLACE''HOLDER|待''定|不''确定|implement ''later')"
rg -n "$pattern" /Users/liyang/.agents/skills/gitee-issue-gatekeeper
```

Expected: no matches.

- [ ] **Step 3: Produce final summary**

Report:

```text
Created /Users/liyang/.agents/skills/gitee-issue-gatekeeper.
Feature parity with smarterlayer-issue-gatekeeper is preserved as workflow behavior.
Gitee reads/writes are delegated to agent usage of gitee-openapi.
Gitee-accessing shell scripts were not copied.
Notification-only script was retained and syntax-checked.
```

Do not claim live Gitee mutations were tested unless the user explicitly requested a write operation and it was actually performed.
