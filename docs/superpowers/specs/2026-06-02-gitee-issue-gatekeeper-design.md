# gitee-issue-gatekeeper Design

## Goal

Create a new skill named `gitee-issue-gatekeeper` by copying the existing `smarterlayer-issue-gatekeeper` skill and preserving its behavior.

The only functional architecture change is Gitee access: all Gitee reads and writes must go through the existing `gitee-openapi` skill. The new skill must not manage Gitee tokens, build token-bearing URLs, or implement its own Gitee API client.

## Scope

The new skill keeps the current gatekeeper capabilities:

- Audit whether a Gitee issue has enough information for development to start.
- Move qualified issues to `修复中 / progressing`.
- Leave unqualified issues in the current state and produce actionable missing-information feedback.
- Keep open bug table generation.
- Keep bug daily and weekly reports.
- Keep pending issue audit, optional feedback comments, optional label updates, and group notifications.
- Keep enterprise WeCom notification support, including `qwsend` and mention mapping.

The new skill changes only the Gitee access boundary:

- Remove direct reliance on `GITEE_ACCESS_TOKEN`.
- Remove direct reliance on `GITEE_API_BASE`.
- Remove direct `access_token=` query construction.
- Remove direct `fetch` or `curl` calls to Gitee endpoints from gatekeeper scripts.
- Delegate Gitee calls to the `gitee-openapi` helper CLI.

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
scripts/audit_pending_issues.sh
scripts/send_bug_period_report.sh
scripts/send_issue_group_message.sh
scripts/send_open_bug_table.sh
```

Add one thin wrapper:

```text
scripts/gitee_issue_openapi.sh
```

## Gitee OpenAPI Dependency

`gitee-issue-gatekeeper` depends on `gitee-openapi` through its helper CLI, not through another agent run.

Default dependency path:

```text
/Users/liyang/.agents/skills/gitee-openapi
```

The path can be overridden with:

```text
GITEE_OPENAPI_SKILL_DIR
```

The wrapper calls:

```bash
bash "$GITEE_OPENAPI_SKILL_DIR/scripts/gitee-openapi" ...
```

The only stable contract assumed by `gitee-issue-gatekeeper` is the helper CLI shape:

```text
get PATH
post PATH JSON_BODY
put PATH JSON_BODY
delete PATH
form METHOD PATH key=value ...
```

If the `gitee-openapi` helper changes later, update `scripts/gitee_issue_openapi.sh` first. Business scripts should not call the `gitee-openapi` helper directly.

## Script Responsibilities

The gatekeeper scripts remain useful because they are orchestration and business logic, not Gitee client code.

`gitee-openapi` owns:

- Token loading.
- Base host handling.
- HTTP method execution.
- Form and JSON request mechanics.
- OpenAPI reference lookup.

`gitee-issue-gatekeeper` owns:

- Issue readiness judgment.
- Missing-information feedback text.
- Bug filtering.
- Report table formatting.
- Period statistics.
- Label inference.
- Dry-run behavior.
- WeCom message formatting and sending.

The resulting flow is:

```text
gitee-issue-gatekeeper script
-> scripts/gitee_issue_openapi.sh
-> gitee-openapi/scripts/gitee-openapi
-> Gitee API
```

## Required Script Adaptations

Update `send_open_bug_table.sh` so that issue list pagination uses the wrapper instead of direct Gitee requests.

Update `send_bug_period_report.sh` so that all issue list pagination and date-based report inputs use the wrapper.

Update `audit_pending_issues.sh` so that these operations use the wrapper:

- List pending issues.
- Fetch issue comments.
- Post feedback comments.
- Update issue labels.

For state transitions to `修复中 / progressing`, use Gitee OpenAPI through the wrapper. If the update requires a custom `issue_state_id`, resolve the state id by querying Gitee through `gitee-openapi` and matching the state title. Do not hardcode enterprise-specific ids.

Keep `send_issue_group_message.sh` unchanged except for skill-name text if needed, because it does not access Gitee.

## Documentation Changes

Update `SKILL.md` to describe the new skill name and the Gitee dependency:

- Trigger on Gitee issue triage, Gitee bug readiness review, open bug tables, and bug reports.
- State that Gitee operations are delegated to `gitee-openapi`.
- State that the skill does not configure or expose Gitee tokens.
- Keep the existing readiness criteria and output expectations.

Update `references/usage.md`:

- Replace `smarterlayer-issue-gatekeeper` paths with `gitee-issue-gatekeeper`.
- Remove `GITEE_ACCESS_TOKEN` and `GITEE_API_BASE` setup.
- Add `GITEE_OPENAPI_SKILL_DIR` as an optional override.
- Keep WeCom and dry-run configuration.
- Add a dependency self-check command that verifies the `gitee-openapi` helper is available.

## Error Handling

The wrapper should fail early with a clear message when:

- `GITEE_OPENAPI_SKILL_DIR` points to a missing directory.
- `scripts/gitee-openapi` does not exist.
- The helper exits with a non-zero status.

Business scripts should preserve dry-run behavior. Dry-run may read Gitee data through `gitee-openapi`, but must not write comments, labels, state transitions, or group messages.

## Verification

Implementation should verify:

```bash
zsh -n scripts/gitee_issue_openapi.sh
zsh -n scripts/send_issue_group_message.sh
zsh -n scripts/send_open_bug_table.sh
zsh -n scripts/send_bug_period_report.sh
zsh -n scripts/audit_pending_issues.sh
```

Run a static check inside the new skill:

```bash
rg -n "GITEE_ACCESS_TOKEN|GITEE_API_BASE|access_token=|10\\.1\\.1\\.156|fetch\\(|curl .*gitee|api/v5"
```

Expected result:

- No direct token or base URL usage in `gitee-issue-gatekeeper`.
- No direct Gitee HTTP client code in gatekeeper scripts.
- References to `gitee-openapi` are allowed.

Run dry-run smoke checks:

```bash
ISSUE_REVIEW_DRY_RUN=1 zsh scripts/send_open_bug_table.sh
ISSUE_REVIEW_DRY_RUN=1 zsh scripts/send_bug_period_report.sh --day
ISSUE_REVIEW_DRY_RUN=1 zsh scripts/audit_pending_issues.sh --dry-run
```

## Non-Goals

- Do not modify `gitee-openapi` unless its existing helper cannot support the required operations.
- Do not move gatekeeper business rules into `gitee-openapi`.
- Do not create a second Gitee token source.
- Do not introduce a second internal Gitee client inside `gitee-issue-gatekeeper`.
- Do not change WeCom notification semantics.
