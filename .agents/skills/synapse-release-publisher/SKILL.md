---
name: synapse-release-publisher
description: Use when working in the Synapse repository and the user asks to release, publish a new version, 发版, 发布新版, 发布新版本, 打包发布, 静默发版, 静默部署, run release, or continue the CI/Release publish loop for FairyEver/Synapse, including TestFlight, server deploy, and an all-user release mail.
---

# Synapse Release Publisher

## Purpose

Run one complete Synapse release loop: commit outstanding work separately, bump and push the version, explicitly dispatch CI, dispatch Release only after CI succeeds, publish and archive product notes, upload the iOS build to TestFlight, deploy the server, then send one all-user release mail. The release request authorizes that final mail; do not pause for a second confirmation. 「静默发版」/「静默部署」 are legacy aliases for the same complete flow, including the mail. Tell the user that a silent mode no longer exists.

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
- Release mail command: `node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-mail.mjs`
- Release mail credentials: local `server/.env.server` values `APP_PUBLIC_URL` and `ADMIN_ACCESS_SECRET`; never print either secret or the temporary session Cookie.

CI and Release have only `workflow_dispatch` triggers. Ordinary pushes and PR updates start neither workflow. A release request authorizes the explicit CI and Release dispatches below; do not dispatch either workflow during ordinary development or merely because a push succeeded.

The current Release workflow no longer stores installer binaries as GitHub Release assets. It builds platform artifacts as short-lived GitHub Actions artifacts, prepares `cdn-release/`, uploads installers, update metadata, `manifest.json`, and `release-body.md` to Tencent Cloud COS, refreshes/verifies CDN, then creates or edits the GitHub Release body in `FairyEver/SynapseAppRelease`. An empty GitHub `assets` array is expected and must not be treated as a release failure.

## Release Loop

Track the current loop number, latest `EXPECTED_TAG`, tested `HEAD_SHA`, `CI_RUN_ID`, `RELEASE_RUN_ID`, matching release body, CDN download links, `RELEASE_MAIL_NOTES_FILE`, and the most recent failure summary.

### 0. Validate Release Mail Before Bumping

Before changing the version or pushing commits, validate nonempty pending notes, the mail length, production HTTPS configuration, and availability of the protected broadcast API. Print the current active-user count and complete mail text without sending. Preview the next version computed by the bump command; the final mail uses `EXPECTED_TAG` after the version bump. If this check fails, stop before the version commit. The API must be deployed and verified separately before first use:

```bash
NEXT_VERSION=$(node -e "const v=require('/Users/liyang/Documents/code/github/Synapse/desktop/package.json').version.split('.');v[v.length-1]=String(Number(v.at(-1))+1);process.stdout.write(v.join('.'))")
node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-mail.mjs \
  --check \
  --version "v${NEXT_VERSION}" \
  --notes-file /Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md
```

The script reads `server/.env.server`, exchanges `ADMIN_ACCESS_SECRET` for a temporary administrator Cookie, checks the audience, then logs out. Do not use a normal user's API key or call the per-account notification API for the broadcast.

### 1. Collect Pending Release Notes

Before bumping the version, read `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md` from the repository root and record whether it contains meaningful bullets under any of these sections:

- `新增功能`
- `功能优化`
- `问题修复`
- `技术调整`

Keep the original pending notes content as the release-note input for this release attempt. If the file is missing or has no meaningful bullets, stop before bumping the version.

Set `RELEASE_MAIL_NOTES_FILE` to `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md`. When notes are archived successfully in section 9, replace it with the matching archive path.

Do not modify, clear, reset, or archive `RELEASE_NOTES_PENDING.md` at this stage.

### 2. Commit And Record Version

Commit outstanding repository work separately without pushing before the version bump. `pnpm bump:commit:push` runs `git add -A` and would otherwise fold that work into the version commit. From `/Users/liyang/Documents/code/github/Synapse/desktop`, run:

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

### 3. Dispatch CI For This Version

After the version commit has been pushed, verify that local `HEAD` is the commit at remote `main`. Record it as `HEAD_SHA`; stop if the two differ rather than testing a different commit. Record the UTC dispatch time, then explicitly start CI:

```bash
HEAD_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git ls-remote origin refs/heads/main | cut -f1)
test "$HEAD_SHA" = "$REMOTE_SHA" || { echo "本地 HEAD 与远端 main 不一致"; exit 1; }
CI_DISPATCHED_AFTER=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
gh workflow run ci.yml --repo FairyEver/Synapse --ref main
```

Use the run URL returned by `gh workflow run` when available. Otherwise poll the following list for up to 2 minutes and select a `workflow_dispatch` run for `HEAD_SHA` created after `CI_DISPATCHED_AFTER`. Record its `databaseId` as `CI_RUN_ID`; do not select an older run for the same commit:

```bash
gh run list --repo FairyEver/Synapse --workflow ci.yml \
  --event workflow_dispatch --commit "$HEAD_SHA" --limit 20 \
  --json databaseId,status,conclusion,headSha,createdAt,url
```

If no matching run appears, stop and report that manual CI dispatch did not produce a run. Do not start Release.

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

If `conclusion` is `success`, continue to Release. On failure, collect CI logs and fix the cause; Release has not been dispatched yet.

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

After fixing, run `pnpm bump:commit:push`, update `EXPECTED_TAG`, and return to step 3 to dispatch CI for the new commit. Stop after 10 total loops and report the last failure summary.

Pending release notes must remain unchanged while fixing CI or Release failures. Do not archive or clear `RELEASE_NOTES_PENDING.md` until a final target release succeeds and the GitHub Release body is updated successfully.

### 7. Dispatch And Watch Release

After CI succeeds, verify remote `main` still equals the `HEAD_SHA` that passed CI. If another commit reached `main`, do not dispatch Release; inspect the new commit and run CI for that commit first. Record the UTC dispatch time, then explicitly start Release:

```bash
REMOTE_SHA=$(git ls-remote origin refs/heads/main | cut -f1)
test "$HEAD_SHA" = "$REMOTE_SHA" || { echo "远端 main 已变化，需重新运行 CI"; exit 1; }
RELEASE_DISPATCHED_AFTER=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
gh workflow run release.yml --repo FairyEver/Synapse --ref main
```

Use the returned run URL when available. Otherwise poll the following list for up to 2 minutes and select the `workflow_dispatch` run for `HEAD_SHA` created after `RELEASE_DISPATCHED_AFTER`. Record its `databaseId` as `RELEASE_RUN_ID`; stop if none appears. Then watch it:

```bash
gh run list --repo FairyEver/Synapse --workflow release.yml \
  --event workflow_dispatch --commit "$HEAD_SHA" --limit 20 \
  --json databaseId,status,conclusion,headSha,createdAt,url
```

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

Analyze, fix, commit, and return to step 3 to dispatch CI for the new commit.

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
3. Set `RELEASE_MAIL_NOTES_FILE` to `/Users/liyang/Documents/code/github/Synapse/docs/releases/$EXPECTED_TAG.md`.
4. Reset `/Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md` to the empty template:

   ```markdown
   # Pending Release Notes

   ## 新增功能

   ## 功能优化

   ## 问题修复

   ## 技术调整
   ```

5. Commit and push only the archive/reset files. This push does not dispatch CI or Release:

   ```bash
   cd /Users/liyang/Documents/code/github/Synapse
   git add RELEASE_NOTES_PENDING.md "docs/releases/$EXPECTED_TAG.md"
   git commit -m "docs: consume release notes for $EXPECTED_TAG"
   git push
   ```

This consume commit must happen after the package release succeeds. It must not be folded into the version bump commit that is checked and released. If archive, reset, commit, or push fails, report the exact state and do not claim the pending notes were consumed.

An empty pending-notes state cannot reach this section because section 0 stops before bumping.

### 10. Open The GitHub Release Page

Only run this section after:

- CI succeeded.
- Release succeeded.
- The matching GitHub Release for `EXPECTED_TAG` was found in `FairyEver/SynapseAppRelease`.
- CDN links were found in the matching release body.
- Pending release notes were published while preserving CDN links and consumed successfully.

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

### 11. Upload iOS And Deploy The Server

After the matching desktop Release and release-note archive succeed, upload the iOS build and deploy the server. They may run concurrently, but wait for **both commands to finish successfully** before section 12. Apple processing after the upload command returns is not required.

```bash
pnpm mobile:release
bash deploy.sh
```

If either command fails, report the package release as successful and the complete release as unfinished. Resume the failed step for the **same `EXPECTED_TAG`** after fixing its cause; do not bump, rerun CI/Release, republish notes, or clear notes again.

### 12. Send The All-User Release Mail

Use the archived notes in `RELEASE_MAIL_NOTES_FILE`. The script builds one plain-text mail from nonempty sections in their original order, appends `https://synapse.d2.pub/desktop/update`, and uses `release:$EXPECTED_TAG` as the stable request ID. Do not send before both section 11 commands succeed.

```bash
node /Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-release-publisher/scripts/send-release-mail.mjs \
  --send \
  --version "$EXPECTED_TAG" \
  --notes-file "$RELEASE_MAIL_NOTES_FILE"
```

The admin API stores one mail and one visible recipient copy per active user, then queues the usual new-mail reminder. Its success response confirms database acceptance and recipient count, not device display. If the command fails or its response is ambiguous, rerun this step with the same tag and archived notes; the server returns the existing mail and rejects a changed body under the same request ID. Never rerun the package release to retry mail delivery.

## Legacy Silent Phrases

「静默发版」 and 「静默部署」 now mean the full release above, including the all-user mail. Tell the user that the silent mode no longer exists. Do not skip the preflight or the mail.

## Resume An Incomplete Release

When a package release already succeeded but publishing or archiving its notes, TestFlight upload, server deployment, or mail failed, locate the matching tag and verify the previous successful steps. Resume from the first failed step without bumping again or rerunning CI/Release. If the notes were archived, use `docs/releases/<tag>.md`; if section 9 stopped before archival, finish that section using the original pending notes and the matching Release body. Do not replace the archived notes with newly accumulated pending notes. The stable `release:<tag>` request ID prevents duplicate mail.

## Exit Conditions

- Success: CI and Release pass, the matching GitHub Release and CDN links are verified, product notes are archived, TestFlight upload and server deployment complete, and the all-user mail is accepted. Report the tag, CDN links, and actual mail recipient count.
- Mail failure: keep the package release successful, report the complete release as unfinished, and resume the same tag with its archived notes.
- Loop limit: after 10 loops, stop and report unresolved status plus the latest failure summary.
- Commit failure: if `pnpm bump:commit:push` fails, report the command output and stop.
- Download-link failure: if the matching Release exists but expected CDN links are missing from the body, report the body state and do not consume pending notes.
- Release notes failure: if GitHub Release body update, archive, reset, commit, or push fails after the package release succeeds, report the failure and do not clear pending notes unless the successful state can be proven.
