# gitee-issue-gatekeeper Design

## Goal

Create a new skill named `gitee-issue-gatekeeper` by copying the issue-readiness workflow from the existing `smarterlayer-issue-gatekeeper` skill and preserving its user-visible behavior.

The architecture change is Gitee access: all Gitee reads and writes must happen at the agent workflow level through the existing `gitee-openapi` skill. The new skill must not resolve Gitee credentials, call Gitee helper scripts directly, build token-bearing URLs, or implement its own Gitee API client.

## Scope

The new skill keeps the current gatekeeper capabilities:

- Audit whether a Gitee issue has enough information for development to start.
- Move qualified issues to `修复中 / progressing`.
- Leave unqualified issues in the current state and produce actionable missing-information feedback.
- Keep open bug table generation.
- Keep bug daily and weekly reports.
- Keep pending issue audit, optional feedback comments, optional label updates, and group notifications.
- Keep enterprise WeCom notification support, including `qwsend` and mention mapping.

User-visible behavior must not be reduced compared with `smarterlayer-issue-gatekeeper`. Removing a Gitee-accessing shell script from the copied skill does not remove that capability; it moves the Gitee read/write part of that capability into the agent workflow that uses `gitee-openapi`.

The new skill changes only the Gitee access boundary:

- Remove direct reliance on `GITEE_ACCESS_TOKEN`.
- Remove direct reliance on `GITEE_API_BASE`.
- Remove direct `access_token=` query construction.
- Do not copy scripts whose main job is to fetch, update, comment on, or label Gitee issues.
- Do not shell out to `gitee-openapi` scripts for authenticated Gitee requests.
- Instruct the agent to use the `gitee-openapi` skill whenever Gitee data must be read or written.

## Target Layout

Install the new skill at:

```text
/Users/liyang/.agents/skills/gitee-issue-gatekeeper
```

Copy and adapt these files from `smarterlayer-issue-gatekeeper`:

```text
SKILL.md
agents/openai.yaml
references/acceptance-criteria.md
references/issue-label-keywords.tsv
references/usage.md
references/wecom-mention-map.example.tsv
references/wecom-mention-map.tsv
scripts/send_issue_group_message.sh
```

Do not copy these Gitee-accessing scripts:

```text
scripts/audit_pending_issues.sh
scripts/send_bug_period_report.sh
scripts/send_open_bug_table.sh
```

`scripts/send_issue_group_message.sh` is optional. Keep it only if it remains purely responsible for WeCom notification delivery and does not access Gitee.

## Compatibility With Original Skill

The new skill must preserve these original capabilities:

| Original capability | Original implementation | New implementation |
|---|---|---|
| Single issue readiness audit | `SKILL.md` workflow plus issue data | `gitee-issue-gatekeeper` instructs the agent to use `gitee-openapi` for issue data, then applies the same readiness criteria. |
| Qualified issue moves to `修复中 / progressing` | Direct Gitee update or MCP/API fallback | `gitee-issue-gatekeeper` decides the issue is qualified, then instructs the agent to use `gitee-openapi` for the state update. |
| Unqualified issue feedback | Missing-item template, optional issue comment, group message | Same missing-item template and notification behavior; issue comments are posted through `gitee-openapi` when enabled. |
| Open bug table | `scripts/send_open_bug_table.sh` fetched Gitee issues and formatted a table | Agent uses `gitee-openapi` to fetch the same issue set; `gitee-issue-gatekeeper` applies the same filters and table format. |
| Bug daily report | `scripts/send_bug_period_report.sh --day` | Agent uses `gitee-openapi` to fetch the same period issue data; `gitee-issue-gatekeeper` computes and formats the same report. |
| Bug weekly report | `scripts/send_bug_period_report.sh --week` | Same as daily report, with week period rules preserved. |
| Pending issue audit | `scripts/audit_pending_issues.sh` fetched pending issues, inferred labels, optionally commented/updated labels | Agent uses `gitee-openapi` to fetch pending issues/comments and perform enabled comments or label updates; gatekeeper keeps the same audit criteria and label inference. |
| WeCom group notification | `scripts/send_issue_group_message.sh` | Keep notification behavior unchanged, with optional script support if it remains Gitee-free. |
| Dry-run mode | `ISSUE_REVIEW_DRY_RUN=1` prevented writes/sends | Preserve dry-run semantics: reads are allowed, writes and group sends are blocked. |

If implementation cannot preserve one of these capabilities without a shell script, stop and revise the design instead of silently dropping the capability.


## Gitee OpenAPI Dependency

`gitee-issue-gatekeeper` depends on `gitee-openapi` as an agent skill, not as a shell helper dependency.

When the gatekeeper workflow needs Gitee data or a Gitee mutation, it instructs the agent to use `gitee-openapi` for that step. This keeps credential resolution inside the `gitee-openapi` skill and the agent runtime that loaded it. `gitee-issue-gatekeeper` should not assume whether credentials come from a skill variable, agent-side dynamic lookup, or another `gitee-openapi` implementation detail.

The dependency is conceptual and procedural:

```text
agent uses gitee-issue-gatekeeper
-> gatekeeper identifies required Gitee read/write step
-> agent uses gitee-openapi for that Gitee operation
-> gatekeeper applies readiness/reporting/notification rules to the result
```

## Script Responsibilities

`gitee-openapi` owns:

- Credential resolution.
- Base host handling.
- HTTP method execution.
- Form and JSON request mechanics.
- OpenAPI reference lookup.
- Gitee endpoint selection for issue lists, details, comments, labels, states, and updates.

`gitee-issue-gatekeeper` owns:

- Issue readiness judgment.
- Missing-information feedback text.
- Bug filtering.
- Report table formatting.
- Period statistics.
- Label inference.
- Dry-run and write-confirmation behavior.
- WeCom message formatting and sending.
- The required sequence of Gitee operations, expressed as instructions to use `gitee-openapi`.

The gatekeeper skill is primarily a workflow skill. It may include notification-only scripts, but it should not include scripts that perform Gitee reads or writes.

## Required Workflow Adaptations

Replace script-based Gitee batching with explicit agent workflow steps.

For open bug tables:

- Use `gitee-openapi` to list relevant Gitee issues.
- Filter `issue_type = 缺陷`.
- Keep the configured pending states such as `待确认` and `修复中`.
- Format the table inside the gatekeeper workflow.
- Send a WeCom message only after the user requested sending, or when the triggering workflow explicitly calls for sending.

For daily and weekly reports:

- Use `gitee-openapi` to fetch the issue set needed for the period.
- Compute created, completed, updated, backlog, owner, and state distribution metrics in the gatekeeper workflow.
- Keep the existing caveat that `修复中更新` is an estimate unless real state-transition events or snapshots are available.

For pending issue audits:

- Use `gitee-openapi` to fetch issue title, body, state, labels, assignee, creator, comments, screenshots/log evidence, and relevant metadata.
- Apply the readiness criteria in this skill.
- If qualified, use `gitee-openapi` to update the issue to `修复中 / progressing`. If the update needs a custom `issue_state_id`, use `gitee-openapi` to discover the state id by title. Do not hardcode enterprise-specific ids.
- If unqualified, do not update state. Use `gitee-openapi` to post the missing-information comment only when the workflow is not dry-run and comment posting is enabled.
- Use `gitee-openapi` for label updates only when label updates are enabled.

Keep `send_issue_group_message.sh` unchanged except for skill-name text if needed, because it does not access Gitee.

## Documentation Changes

Update `SKILL.md` to describe the new skill name and the Gitee dependency:

- Trigger on Gitee issue triage, Gitee bug readiness review, open bug tables, and bug reports.
- State that every Gitee operation must be performed by using the `gitee-openapi` skill.
- State that the skill does not configure, resolve, or expose Gitee credentials.
- Keep the existing readiness criteria and output expectations.

Update `references/usage.md`:

- Replace `smarterlayer-issue-gatekeeper` paths with `gitee-issue-gatekeeper`.
- Remove `GITEE_ACCESS_TOKEN` and `GITEE_API_BASE` setup.
- Remove commands for Gitee-accessing shell scripts that are no longer copied.
- Keep WeCom and dry-run/write-confirmation configuration.
- Explain that users should ask the agent to run the gatekeeper workflow; the agent will use `gitee-openapi` when it needs Gitee data.

## Error Handling

The skill should give a clear response when:

- The `gitee-openapi` skill is unavailable.
- The agent cannot retrieve the required issue data.
- A requested write operation is not clearly authorized.
- A state, label, assignee, creator, or issue id cannot be resolved.

Dry-run may read Gitee data through `gitee-openapi`, but must not write comments, labels, state transitions, or group messages.

## Verification

Implementation should verify:

```bash
zsh -n scripts/send_issue_group_message.sh
```

Run a static check inside the new skill:

```bash
rg -n "GITEE_ACCESS_TOKEN|GITEE_API_BASE|GITEE_OPENAPI_SKILL_DIR|access_token=|10\\.1\\.1\\.156|fetch\\(|curl .*gitee|api/v5|scripts/gitee-openapi|send_open_bug_table|send_bug_period_report|audit_pending_issues"
```

Expected result:

- No direct credential or base URL usage in `gitee-issue-gatekeeper`.
- No direct Gitee HTTP client code.
- No shell dependency on the `gitee-openapi` helper.
- References that instruct the agent to use the `gitee-openapi` skill are allowed.

Manual workflow checks should cover:

- Single issue audit, qualified.
- Single issue audit, unqualified.
- Open bug table.
- Daily report.
- Weekly report.
- Pending issue audit dry-run.
- Write operation refusal when the user did not clearly request mutation.

## Non-Goals

- Do not modify `gitee-openapi`.
- Do not move gatekeeper business rules into `gitee-openapi`.
- Do not create a second Gitee credential source.
- Do not introduce a second internal Gitee client inside `gitee-issue-gatekeeper`.
- Do not call `gitee-openapi` scripts directly from gatekeeper scripts.
- Do not change WeCom notification semantics.
