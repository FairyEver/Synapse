---
name: synapse-release-summary
description: Use when working in the Synapse repository and the user asks to 整理发版总结, 生成发版说明, 写 release notes, 发版变更介绍, compare latest release with previous successful package, or summarize what changed between Synapse releases. This is a project-only read-only workflow for FairyEver/Synapse and FairyEver/SynapseAppRelease; always produce standard Markdown and write the report to the user's Desktop.
---

# Synapse Release Summary

## Purpose

Create a product-facing Markdown release summary for Synapse by comparing the latest successful package in the release repository with the previous successful package, then mapping those versions back to source commits in `FairyEver/Synapse`.

This skill is only for `/Users/liyang/Documents/code/github/Synapse`.

## Fixed Configuration

- Source repository: `FairyEver/Synapse`
- Release repository: `FairyEver/SynapseAppRelease`
- Release workflow: `Release`
- Source working directory: `/Users/liyang/Documents/code/github/Synapse`
- Output directory: `/Users/liyang/Desktop`
- Archived release notes directory: `/Users/liyang/Documents/code/github/Synapse/docs/releases`

This is a read-only analysis workflow. Do not run version bump, release, push, build, dev server, browser preview, or runtime debugging commands.

## Triggered Task

When the user asks for "整理发版总结" or similar:

1. Find the latest successful release package.
2. Find the previous successful release package.
3. Resolve each release version to the corresponding source commit.
4. Read archived release notes for the latest version when available.
5. Analyze source commits between those two commits.
6. Group the changes into user-facing feature updates, bug fixes, and technical changes.
7. Save a standard Markdown report to the Desktop.
8. Briefly tell the user the file path and the versions compared.

If the user explicitly names versions, compare those versions instead of the latest pair.

## Data Collection

### 1. List release packages

Use the release repository first:

```bash
gh release list --repo FairyEver/SynapseAppRelease --limit 20 \
  --json tagName,name,isDraft,isPrerelease,isLatest,publishedAt,createdAt
```

Pick non-draft releases in published order. The default pair is:

- latest: newest non-draft release
- previous: the next newest non-draft release

Then inspect both releases:

```bash
gh release view <tag> --repo FairyEver/SynapseAppRelease \
  --json tagName,name,publishedAt,assets,body
```

Use asset presence as supporting evidence that the package exists. Expected assets usually include Windows `.exe`, macOS arm64 `.dmg`, update metadata, and blockmaps.

### 2. Resolve source commits

Release tags live in `FairyEver/SynapseAppRelease`, so do not assume the same tags exist in the source repository.

Use successful `Release` workflow runs in `FairyEver/Synapse`:

```bash
gh run list --repo FairyEver/Synapse --workflow Release --limit 30 \
  --json databaseId,status,conclusion,headSha,headBranch,displayTitle,createdAt,updatedAt,url
```

Match runs by version in `displayTitle`, for example `chore: bump version to 0.2.144`. Select runs where:

- `conclusion` is `success`
- `displayTitle` contains the target version
- `headBranch` is usually `main`

Record each run's `headSha` as the source commit.

When needed, verify the run:

```bash
gh run view <run-id> --repo FairyEver/Synapse \
  --json status,conclusion,headSha,displayTitle,jobs
```

### 3. Analyze the source diff

Compare the previous source commit to the latest source commit:

```bash
git log --reverse --oneline <previous-sha>..<latest-sha>
git diff --stat <previous-sha>..<latest-sha>
git diff --name-status <previous-sha>..<latest-sha>
```

Inspect important commits and changed files instead of relying only on commit subjects:

```bash
git show --stat --oneline <sha>
git show --patch --minimal <sha> -- <relevant-path>
```

Use design or plan docs inside `docs/superpowers/specs/` and `docs/superpowers/plans/` as supporting context, but do not let docs-only commits dominate the release summary.

Ignore version bump commits as product changes unless they also contain meaningful fixes.

### 4. Read archived release notes

Before writing the summary, check whether the latest tag has archived notes:

```bash
ARCHIVED_NOTES="/Users/liyang/Documents/code/github/Synapse/docs/releases/<latest-tag>.md"
test -f "$ARCHIVED_NOTES" && sed -n '1,240p' "$ARCHIVED_NOTES"
```

If the archived notes file exists, use it as the primary product-context source for release wording. Still inspect commits and changed files to validate the notes, catch missing changes, and avoid carrying over stale or incorrect statements.

If the archived notes file does not exist, fall back to commit and diff analysis plus relevant design/plan docs.

## Classification Rules

Group the summary by product impact:

- 新增功能: new user-visible capabilities, APIs, workflows, pages, commands, or integrations.
- 功能优化: behavior improvements, UX improvements, performance, compatibility, diagnostics, or reliability improvements.
- 问题修复: defects fixed, crashes avoided, incorrect states corrected, missing feedback added, leaks removed.
- 技术调整: architecture, schema, removal of obsolete domains, environment handling, test coverage, or CI/package mechanics.

Prefer clear product language over raw commit messages. Mention implementation details only when they help the user understand the impact.

## Markdown Output

Always create a Markdown file on the Desktop. Use this filename pattern unless the user requests another name:

```text
/Users/liyang/Desktop/Synapse发版总结-<previous-tag>-to-<latest-tag>.md
```

Use this report structure:

```markdown
# Synapse 发版总结：<previous-tag> → <latest-tag>

## 版本信息

| 项目 | 版本 | 源码提交 | 发布时间 | 状态 |
| --- | --- | --- | --- | --- |
| 最新版本 | ... | ... | ... | 打包成功 |
| 上一成功版本 | ... | ... | ... | 打包成功 |

## 更新概要

...

## 新增功能

- ...

## 功能优化

- ...

## 问题修复

- ...

## 技术调整

- ...

## 主要提交

| 提交 | 类型 | 说明 |
| --- | --- | --- |
| ... | ... | ... |
```

Keep the report readable as pure text. Do not include decorative emoji, marketing copy, or raw command dumps.

## Final Response

After writing the file, respond briefly:

- compared version range
- source commit range
- Markdown file path
- one-sentence summary of the largest changes

Do not paste the full report into chat unless the user asks.
