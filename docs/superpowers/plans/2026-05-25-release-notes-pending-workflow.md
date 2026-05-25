# Release Notes Pending Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tracked pending release notes workflow so normal development records user-facing change context and successful releases publish, archive, and reset those notes.

**Architecture:** This is a repository-process change only. `AGENTS.md` defines the daily completion rule, `RELEASE_NOTES_PENDING.md` stores tracked source material, and release skills describe how pending notes are consumed after a successful package release.

**Tech Stack:** Markdown repository rules, local Codex/Agent skills, GitHub CLI release commands.

---

### Task 1: Add The Pending Notes Template

**Files:**
- Create: `RELEASE_NOTES_PENDING.md`

- [x] **Step 1: Create the tracked template with one seed entry for this workflow**

```markdown
# Pending Release Notes

## 新增功能

- 发版流程新增待发布说明记录机制：日常开发完成后会把用户可感知的功能、优化和修复先记录下来，后续发版成功后再统一整理到 GitHub Release 说明里。

## 功能优化

## 问题修复

## 技术调整

- 发版成功后才消费待发布说明；如果 CI、打包或 GitHub Release 说明更新失败，记录会保留，避免丢失本轮变更上下文。
```

- [x] **Step 2: Review that the file uses only the agreed sections**

Run: `sed -n '1,120p' RELEASE_NOTES_PENDING.md`

Expected: Output contains `新增功能`, `功能优化`, `问题修复`, and `技术调整`.

### Task 2: Update Repository Completion Rules

**Files:**
- Modify: `AGENTS.md`

- [x] **Step 1: Add a release-note rule to the top hard requirements**

Add a short subsection under `### 工程边界` explaining that completed user-visible or release-relevant work must update `RELEASE_NOTES_PENDING.md`.

- [x] **Step 2: Add a completion checklist item**

Add one bullet under `## 完成前` requiring agents to decide whether the task needs a pending release note and update the file when it does.

- [x] **Step 3: Verify the rule is discoverable**

Run: `rg -n "RELEASE_NOTES_PENDING|待发布说明" AGENTS.md`

Expected: At least two matches, one near the top-level requirements and one near completion rules.

### Task 3: Extend The Release Publisher Skill

**Files:**
- Modify: `.agents/skills/synapse-release-publisher/SKILL.md`

- [x] **Step 1: Add fixed paths**

Add `Pending notes file: /Users/liyang/Documents/code/github/Synapse/RELEASE_NOTES_PENDING.md` and `Release notes archive directory: /Users/liyang/Documents/code/github/Synapse/docs/releases`.

- [x] **Step 2: Add release-start note collection**

Before commit/version bump instructions, require reading pending notes and preserving them as release input.

- [x] **Step 3: Add post-success publishing**

After fetching download links, require generating release body Markdown, running `gh release edit "$EXPECTED_TAG" --repo FairyEver/SynapseAppRelease --notes-file <file>`, archiving notes to `docs/releases/$EXPECTED_TAG.md`, resetting `RELEASE_NOTES_PENDING.md`, and committing with `[skip ci]`.

- [x] **Step 4: Add failure guarantees**

State that pending notes must not be cleared if CI, Release, release lookup, `gh release edit`, archive, reset, commit, or push fails.

- [x] **Step 5: Verify no failure path clears notes**

Run: `rg -n "pending|RELEASE_NOTES_PENDING|clear|清空|gh release edit|skip ci" .agents/skills/synapse-release-publisher/SKILL.md`

Expected: Matches show consumption only after successful Release and successful `gh release edit`.

### Task 4: Extend The Release Summary Skill

**Files:**
- Modify: `.agents/skills/synapse-release-summary/SKILL.md`

- [x] **Step 1: Prefer archived release notes**

Add instructions that if `docs/releases/<latest-tag>.md` exists, it should be used as the primary product-context source for summary wording.

- [x] **Step 2: Keep diff analysis as fallback**

State that commit/diff analysis remains required for validation and for releases without archived notes.

- [x] **Step 3: Verify discoverability**

Run: `rg -n "docs/releases|archived|归档|RELEASE_NOTES_PENDING" .agents/skills/synapse-release-summary/SKILL.md`

Expected: The skill mentions archived release notes in data collection or analysis rules.

### Task 5: Final Source Review

**Files:**
- Review all modified Markdown files.

- [x] **Step 1: Check repository status**

Run: `git status --short`

Expected: Only the intended Markdown files are modified or created.

- [x] **Step 2: Check for unfinished markers**

Run: `rg -n "TB""D|TO""DO|fill[[:space:]]in" RELEASE_NOTES_PENDING.md AGENTS.md .agents/skills/synapse-release-publisher/SKILL.md .agents/skills/synapse-release-summary/SKILL.md docs/superpowers/specs/2026-05-25-release-notes-pending-workflow-design.md docs/superpowers/plans/2026-05-25-release-notes-pending-workflow.md`

Expected: No matches.
