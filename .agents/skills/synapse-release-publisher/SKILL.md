---
name: synapse-release-publisher
description: Use when working in the Synapse repository and the user asks to release, publish a new version, 发版, 发布新版, 发布新版本, 打包发布, run release, or continue the CI/Release publish loop for FairyEver/Synapse.
---

# Synapse Release Publisher

## Purpose

Run the Synapse release loop: commit and push a version bump, watch GitHub Actions, fix failures, repeat until CI and Release pass, then report download links from the release repository.

Use this skill only for release/publish commands in `/Users/liyang/Documents/code/github/Synapse`.

## Fixed Configuration

- Source repository: `FairyEver/Synapse`
- Release repository: `FairyEver/SynapseAppRelease`
- Workflows: `CI` and `Release`
- Commit command: `pnpm bump:commit:push`
- Maximum loop count: `10`
- Working directory: `/Users/liyang/Documents/code/github/Synapse/desktop`

## Release Loop

Track the current loop number, latest `EXPECTED_TAG`, `CI_RUN_ID`, `RELEASE_RUN_ID`, and the most recent failure summary.

### 1. Commit And Record Version

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

### 2. Find This Push's Workflow Runs

Wait 5 seconds, then list recent push runs:

```bash
sleep 5
gh run list --repo FairyEver/Synapse --event push --limit 4 \
  --json databaseId,status,conclusion,headBranch,name,createdAt
```

Pick the newest runs named `CI` and `Release`, and record their `databaseId` values as `CI_RUN_ID` and `RELEASE_RUN_ID`.

If the newest CI run is not `in_progress`, `queued`, or `pending`, wait 10 seconds and retry up to 3 times. If CI is still missing, report `CI 未被触发，请检查分支和触发条件` and stop.

### 3. Watch CI

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

### 4. Collect Failure Logs

From the CI jobs JSON, find every job whose `conclusion` is `failure`, then fetch the last 200 log lines for each failed job:

```bash
gh run view "$CI_RUN_ID" --repo FairyEver/Synapse --log --job="<JOB_ID>" 2>&1 | tail -200
```

Summarize each failed job before editing. Prioritize the earliest root failure.

### 5. Fix With Test Discipline

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

### 6. Watch Release

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

### 7. Fetch Download Links

After Release succeeds, wait up to 3 minutes for the matching release in `FairyEver/SynapseAppRelease`:

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

If the matching release is still unavailable, fall back to the latest release:

```bash
RELEASE_JSON=$(gh release list --repo FairyEver/SynapseAppRelease \
  --limit 1 --json tagName,assets,body | jq '.[0]')
```

Extract links from `assets`:

- Windows: `.exe`, excluding `blockmap`
- macOS Apple Silicon: filename contains `arm64` and ends with `.dmg`
- macOS Intel / Universal: filename ends with `.dmg` and does not contain `arm64`

Final report must include the release version and every found download link. If a platform asset is missing, say which one was not found.

## Exit Conditions

- Success: CI and Release both pass, release assets are found or explicitly missing, and the final response includes version and download links.
- Loop limit: after 10 loops, stop and report unresolved status plus the latest failure summary.
- Commit failure: if `pnpm bump:commit:push` fails, report the command output and stop.

