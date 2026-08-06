---
name: synapse-release-publisher
description: Use when working in the Synapse repository and the user asks to release, publish a new version, 发版, 发布新版, 发布新版本, 打包发布, run release, or continue the CI/Release publish loop for FairyEver/Synapse, including the success-only Enterprise WeChat update notification.
---

# Synapse Release Publisher

## Purpose

Run the Synapse release loop: commit and push a version bump, watch GitHub Actions, fix failures, repeat until CI and Release pass, then report Tencent Cloud COS/CDN download links from the matching GitHub Release body, open the matching GitHub Release page, and send the configured Enterprise WeChat group a minimal one-click update notification.

Use this skill only for release/publish commands in `/Users/liyang/Documents/code/github/Synapse`.

## Fixed Configuration

- Source repository: `FairyEver/Synapse`
- Release index repository: `FairyEver/SynapseAppRelease`
- Workflows: `CI` and `Release`
- Commit command: `pnpm bump:commit:push`
- Maximum loop count: `10`
- Working directory: `/Users/liyang/Documents/code/github/Synapse/desktop`
- Pending notes file: `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md`
- Release notes archive directory: `/Users/liyang/Documents/code/github/Synapse/docs/releases`
- Release page URL template: `https://github.com/FairyEver/SynapseAppRelease/releases/tag/$EXPECTED_TAG`
- CDN base URL: `https://desktop.release.synapse.d2.pub/`
- COS bucket: `synapse-desktop-release-1252371654`
- One-click update URL: `https://synapse.d2.pub/desktop/update`
- WeCom notification command: `node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-notification.mjs`
- WeCom destination configuration: local ignored `.env` key `SYNAPSE_RELEASE_WECOM_WEBHOOK_URL`

The current Release workflow no longer stores installer binaries as GitHub Release assets. It builds platform artifacts as short-lived GitHub Actions artifacts, prepares `cdn-release/`, uploads installers, update metadata, `manifest.json`, and `release-body.md` to Tencent Cloud COS, refreshes/verifies CDN, then creates or edits the GitHub Release body in `FairyEver/SynapseAppRelease`. An empty GitHub `assets` array is expected and must not be treated as a release failure.

## Release Loop

Track the current loop number, latest `EXPECTED_TAG`, `CI_RUN_ID`, `RELEASE_RUN_ID`, matching release body, CDN download links, and the most recent failure summary.

### 0. Validate The Enterprise WeChat Destination

Before changing the version or pushing commits, validate the configured destination and exact Markdown payload without sending a message:

```bash
node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-notification.mjs --check
```

If this check fails, report the configuration or helper error and stop before starting the release.

### 1. Collect Pending Release Notes

Before bumping the version, read `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md` from the repository root and record whether it contains meaningful bullets under any of these sections:

- `新增功能`
- `功能优化`
- `问题修复`
- `技术调整`

Keep the original pending notes content as the release-note input for this release attempt. If the file is missing, report that the pending release notes file is missing and stop before bumping the version. If the file exists but has no meaningful bullets, continue the release and state that no pending release notes were found.

Do not modify, clear, reset, or archive `RELEASE_NOTES_PENDING.md` at this stage.

### 2. Commit And Record Version

From `/Users/liyang/Documents/code/github/Synapse/desktop`, run:

```bash
pnpm bump:commit:push
```

If the command fails, report the error and stop.

After a successful commit, record the expected release tag:

```bash
VERSION=$(node -p "require('./package.json').version")
EXPECTED_TAG="v${VERSION}"
echo "本轮版本: $EXPECTED_TAG"
```

### 3. Find This Push's Workflow Runs

Wait 5 seconds, then list recent push runs:

```bash
sleep 5
gh run list --repo FairyEver/Synapse --event push --limit 4 \
  --json databaseId,status,conclusion,headBranch,name,createdAt
```

Pick the newest runs named `CI` and `Release`, and record their `databaseId` values as `CI_RUN_ID` and `RELEASE_RUN_ID`.

If the newest CI run is not `in_progress`, `queued`, or `pending`, wait 10 seconds and retry up to 3 times. If CI is still missing, report `CI 未被触发，请检查分支和触发条件` and stop.

### 4. Watch CI

```bash
gh run watch "$CI_RUN_ID" --repo FairyEver/Synapse --exit-status
```

If watch times out or is interrupted, inspect the current state:

```bash
gh run view "$CI_RUN_ID" --repo FairyEver/Synapse --json status,conclusion
```

Then inspect the final CI result:

```bash
gh run view "$CI_RUN_ID" --repo FairyEver/Synapse --json status,conclusion,jobs
```

If `conclusion` is `success`, continue to Release. If `conclusion` is `failure`, cancel the same round's Release workflow if it is still running:

```bash
gh run cancel "$RELEASE_RUN_ID" --repo FairyEver/Synapse
```

### 5. Collect Failure Logs

From the CI jobs JSON, find every job whose `conclusion` is `failure`, then fetch the last 200 log lines for each failed job:

```bash
gh run view "$CI_RUN_ID" --repo FairyEver/Synapse --log --job="<JOB_ID>" 2>&1 | tail -200
```

Summarize each failed job before editing. Prioritize the earliest root failure.

### 6. Fix With Test Discipline

Before changing tests, decide whether the failure is caused by stale tests or a real code bug:

- If logic is wrong, fix production code and do not patch tests.
- If typecheck fails, normally fix TypeScript or code structure.
- Only update tests after confirming the test expectation no longer matches the intended current behavior.
- Never patch tests merely to turn CI green.

If the same error appears more than twice, pause and inspect the root cause more deeply before another fix.

When possible, run the relevant local test from `/Users/liyang/Documents/code/github/Synapse/desktop`:

```bash
pnpm --filter @synapse/desktop run test -- --run <test-file-path>
```

Do not use `pnpm dlx vitest`.

After fixing, run `pnpm bump:commit:push`, update `EXPECTED_TAG`, and return to workflow discovery. Stop after 10 total loops and report the last failure summary.

Pending release notes must remain unchanged while fixing CI or Release failures. Do not archive or clear `RELEASE_NOTES_PENDING.md` until a final target release succeeds and the GitHub Release body is updated successfully.

### 7. Watch Release

After CI succeeds, watch the same round's Release workflow:

```bash
gh run watch "$RELEASE_RUN_ID" --repo FairyEver/Synapse --exit-status
gh run view "$RELEASE_RUN_ID" --repo FairyEver/Synapse --json status,conclusion,jobs
```

Expect the Release workflow to include these logical stages:

- Build macOS installer.
- Build Windows installer.
- Publish release: downloads Actions artifacts, prepares CDN files, installs COSCLI, uploads to COS, refreshes/verifies CDN, and creates/edits the GitHub Release body.
- Notify package completion.

If Release fails, collect failed job logs with:

```bash
gh run view "$RELEASE_RUN_ID" --repo FairyEver/Synapse --log --job="<JOB_ID>" 2>&1 | tail -200
```

Analyze, fix, commit, and return to workflow discovery.

### 8. Fetch CDN Download Links

After Release succeeds, wait up to 3 minutes for the matching release index page in `FairyEver/SynapseAppRelease`. Record whether the matching `EXPECTED_TAG` release was found:

```bash
for i in $(seq 1 18); do
  RELEASE_JSON=$(gh release view "$EXPECTED_TAG" \
    --repo FairyEver/SynapseAppRelease \
    --json tagName,assets,body 2>/dev/null)
  [ $? -eq 0 ] && [ -n "$RELEASE_JSON" ] && break
  echo "等待 release $EXPECTED_TAG... ($i/18)"
  sleep 10
done
```

If the matching release is still unavailable, fall back to the latest release and record that the matching release was not found:

```bash
RELEASE_JSON=$(gh release list --repo FairyEver/SynapseAppRelease \
  --limit 1 --json tagName,assets,body | jq '.[0]')
```

Extract links from `.body`, not `.assets`. The normal body is generated from `desktop/scripts/prepare-cdn-release-artifacts.mjs` and contains CDN URLs like:

- `https://desktop.release.synapse.d2.pub/vX.Y.Z/Synapse-X.Y.Z-mac-arm64.dmg`
- `https://desktop.release.synapse.d2.pub/vX.Y.Z/Synapse-X.Y.Z-mac-arm64.zip`
- `https://desktop.release.synapse.d2.pub/vX.Y.Z/Synapse-X.Y.Z-win-x64.exe`
- `https://desktop.release.synapse.d2.pub/latest.yml`
- `https://desktop.release.synapse.d2.pub/latest-mac.yml`

Classify body links this way:

- Windows: `.exe`, excluding `blockmap`
- macOS Apple Silicon DMG: filename contains `mac-arm64` and ends with `.dmg`
- macOS Apple Silicon ZIP: filename contains `mac-arm64` and ends with `.zip`
- Update metadata: `latest.yml` and `latest-mac.yml`

When editing release notes later, preserve the exact CDN URLs from the current body. Prefer extracting URLs from `RELEASE_JSON.body` and reusing them verbatim instead of reconstructing them from version strings.

Do not report empty GitHub assets as missing platform assets. Final report must include the release version, every found CDN download link, and any expected CDN link missing from the body.

### 9. Publish Product Notes And Consume Pending Release Notes

Only run this section after:

- CI succeeded.
- Release succeeded.
- The matching GitHub Release for `EXPECTED_TAG` was found in `FairyEver/SynapseAppRelease`.
- CDN links were extracted from the matching release body.

Do not publish, archive, reset, or clear pending notes when the download-link lookup fell back to the latest release because the matching `EXPECTED_TAG` release was unavailable. In that case, report that pending notes were left untouched for retry.

If pending release notes contain meaningful bullets, generate a product-facing Markdown release body that preserves the existing CDN download section. Put product notes before the CDN links using this structure and omit empty sections:

```markdown
# Synapse vX.Y.Z

## 新增功能

- ...

## 功能优化

- ...

## 问题修复

- ...

## 技术调整

- ...

## 下载链接

macOS Apple Silicon DMG:
<existing CDN dmg link>

macOS Apple Silicon ZIP:
<existing CDN zip link>

Windows x64:
<existing CDN exe link>

更新元数据：
<existing latest.yml link>
<existing latest-mac.yml link>
```

Use concise user-facing wording. Do not include source paths, commit hashes, branch names, raw command output, or implementation details unless they are needed to explain compatibility or release risk.

Important: `gh release edit --notes-file` replaces the whole Release body. Never update the body with only pending notes; always include the CDN download links extracted in step 8. If you cannot confidently preserve the download links, do not edit the release body and do not clear pending notes.

Write the generated notes to a temporary file, then update the release body:

```bash
gh release edit "$EXPECTED_TAG" \
  --repo FairyEver/SynapseAppRelease \
  --notes-file <generated-notes-file>
```

If `gh release edit` fails, do not clear or archive `RELEASE_NOTES_PENDING.md`. Report the generated notes file path and stop after the normal release link report.

After `gh release edit` succeeds:

1. Create `/Users/liyang/Documents/code/github/Synapse/docs/releases` if needed.
2. Copy the consumed pending notes to `/Users/liyang/Documents/code/github/Synapse/docs/releases/$EXPECTED_TAG.md`.
3. Reset `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md` to the empty template:

   ```markdown
   # Pending Release Notes

   ## 新增功能

   ## 功能优化

   ## 问题修复

   ## 技术调整
   ```

4. Commit and push only the archive/reset files with a skip-CI message:

   ```bash
   cd /Users/liyang/Documents/code/github/Synapse
   git add RELEASE_NOTES_PENDING.md "docs/releases/$EXPECTED_TAG.md"
   git commit -m "docs: consume release notes for $EXPECTED_TAG [skip ci]"
   git push
   ```

This consume commit must happen after the package release succeeds. It must not be folded into the version bump commit that triggers the release. If archive, reset, commit, or push fails, report the exact state and do not claim the pending notes were consumed.

If pending release notes were empty at release start, do not edit the Release body; keep the workflow-generated CDN body and say that no pending release notes were consumed.

### 10. Open The GitHub Release Page

Only run this section after:

- CI succeeded.
- Release succeeded.
- The matching GitHub Release for `EXPECTED_TAG` was found in `FairyEver/SynapseAppRelease`.
- CDN links were found in the matching release body.
- Pending release notes were either published while preserving CDN links and consumed successfully, or were empty at release start.

Open the matching release page in the user's system default browser. Do not use the Codex in-app browser, Browser plugin, browser MCP, or `node_repl` browser session for this step; on the user's Mac, `open "$RELEASE_URL"` should normally launch Google Chrome because it is the default browser.

```bash
RELEASE_URL="https://github.com/FairyEver/SynapseAppRelease/releases/tag/$EXPECTED_TAG"
if command -v open >/dev/null 2>&1; then
  open "$RELEASE_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$RELEASE_URL" >/dev/null 2>&1 &
elif command -v cmd.exe >/dev/null 2>&1; then
  cmd.exe /c start "" "$RELEASE_URL"
else
  echo "未找到系统默认浏览器打开命令: $RELEASE_URL"
fi
```

If opening the browser fails or no opener command exists, keep the release successful and include the release URL in the final response.

### 11. Send The Enterprise WeChat Update Notification

Run this section only after all release success conditions in section 10 are satisfied. Read and follow `/Users/liyang/.agents/skills/wecom-notification/SKILL.md`, then use the bundled command, which delegates delivery to that Skill's helper and passes the configured webhook through stdin:

```bash
node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-notification.mjs
```

The notification must use WeCom `markdown` and its complete body must remain exactly:

```markdown
[一键更新](https://synapse.d2.pub/desktop/update)
```

Do not add a title, version, current-state text, GitHub repository or Release information, installer or metadata links, release notes, timestamps, mentions, or any other content.

If delivery fails, do not rerun or roll back the successful release, do not change pending release notes again, and do not try another destination. Report that the release succeeded but the Enterprise WeChat notification failed, including status, `errcode`, and `errmsg` when available.

## Exit Conditions

- Success: CI and Release both pass, the matching GitHub Release is found, Tencent Cloud COS/CDN download links are extracted from the Release body, pending release notes are either published while preserving CDN links and consumed or explicitly empty, the matching GitHub Release page was opened in the system default browser or its URL was reported, the Enterprise WeChat one-click update notification was delivered, and the final response includes version and download links.
- Notification failure: keep the package release successful, stop after reporting the Enterprise WeChat delivery failure, and do not claim the complete release workflow succeeded.
- Loop limit: after 10 loops, stop and report unresolved status plus the latest failure summary.
- Commit failure: if `pnpm bump:commit:push` fails, report the command output and stop.
- Download-link failure: if the matching Release exists but expected CDN links are missing from the body, report the body state and do not consume pending notes.
- Release notes failure: if GitHub Release body update, archive, reset, commit, or push fails after the package release succeeds, report the failure and do not clear pending notes unless the successful state can be proven.
