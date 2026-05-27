---
name: synapse-release-publisher
description: Use when working in the Synapse repository and the user asks to release, publish a new version, 发版, 发布新版, 发布新版本, 打包发布, run release, or continue the CI/Release publish loop for FairyEver/Synapse.
---

# Synapse Release Publisher

## Purpose

Run the Synapse release loop: commit and push a version bump, watch GitHub Actions, fix failures, repeat until CI and Release pass, then report download links from the release repository and open the matching GitHub Release page.

Use this skill only for release/publish commands in `/Users/liyang/Documents/code/github/Synapse`.

## Fixed Configuration

- Source repository: `FairyEver/Synapse`
- Release repository: `FairyEver/SynapseAppRelease`
- Workflows: `CI` and `Release`
- Commit command: `pnpm bump:commit:push`
- Maximum loop count: `10`
- Working directory: `/Users/liyang/Documents/code/github/Synapse/desktop`
- Pending notes file: `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md`
- Release notes archive directory: `/Users/liyang/Documents/code/github/Synapse/docs/releases`
- Release page URL template: `https://github.com/FairyEver/SynapseAppRelease/releases/tag/$EXPECTED_TAG`

## Release Loop

Track the current loop number, latest `EXPECTED_TAG`, `CI_RUN_ID`, `RELEASE_RUN_ID`, and the most recent failure summary.

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

If Release fails, collect failed job logs with:

```bash
gh run view "$RELEASE_RUN_ID" --repo FairyEver/Synapse --log --job="<JOB_ID>" 2>&1 | tail -200
```

Analyze, fix, commit, and return to workflow discovery.

### 8. Fetch Download Links

After Release succeeds, wait up to 3 minutes for the matching release in `FairyEver/SynapseAppRelease`. Record whether the matching `EXPECTED_TAG` release was found:

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

Extract links from `assets`:

- Windows: `.exe`, excluding `blockmap`
- macOS Apple Silicon: filename contains `arm64` and ends with `.dmg`
- macOS Intel / Universal: filename ends with `.dmg` and does not contain `arm64`

Final report must include the release version and every found download link. If a platform asset is missing, say which one was not found.

### 9. Publish And Consume Pending Release Notes

Only run this section after:

- CI succeeded.
- Release succeeded.
- The matching GitHub Release for `EXPECTED_TAG` was found in `FairyEver/SynapseAppRelease`.

Do not publish, archive, reset, or clear pending notes when the download-link lookup fell back to the latest release because the matching `EXPECTED_TAG` release was unavailable. In that case, report that pending notes were left untouched for retry.

If pending release notes contain meaningful bullets, generate a product-facing Markdown release body using this structure. Omit empty sections:

```markdown
## 新增功能

- ...

## 功能优化

- ...

## 问题修复

- ...

## 技术调整

- ...
```

Use concise user-facing wording. Do not include source paths, commit hashes, branch names, raw command output, or implementation details unless they are needed to explain compatibility or release risk.

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

If pending release notes were empty at release start, skip archive/reset and say that no pending release notes were consumed.

### 10. Open The GitHub Release Page

Only run this section after:

- CI succeeded.
- Release succeeded.
- The matching GitHub Release for `EXPECTED_TAG` was found in `FairyEver/SynapseAppRelease`.
- Pending release notes were either published and consumed successfully, or were empty at release start.

Open the matching release page in the system default browser:

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

## Exit Conditions

- Success: CI and Release both pass, release assets are found or explicitly missing, pending release notes are either published and consumed or explicitly empty, the matching GitHub Release page was opened in the system default browser or its URL was reported, and the final response includes version and download links.
- Loop limit: after 10 loops, stop and report unresolved status plus the latest failure summary.
- Commit failure: if `pnpm bump:commit:push` fails, report the command output and stop.
- Release notes failure: if GitHub Release body update, archive, reset, commit, or push fails after the package release succeeds, report the failure and do not clear pending notes unless the successful state can be proven.
