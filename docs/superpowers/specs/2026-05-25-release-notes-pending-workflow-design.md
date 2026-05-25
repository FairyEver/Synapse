# Release Notes Pending Workflow Design

## Background

Synapse already has a working release loop driven by `.agents/skills/synapse-release-publisher/SKILL.md`: bump version, push, watch CI and Release, fix failures, repeat, and report download links after success.

The missing piece is first-hand product context between releases. Reconstructing user-facing changes from code diffs after the fact is unreliable because a single requirement can touch many files, and the original intent may not be visible in the final diff.

## Goal

Maintain a tracked, lightweight pending release notes file in the repository. Each completed user-visible change appends a short, plain-language note. A successful release consumes those notes, updates the GitHub Release body in `FairyEver/SynapseAppRelease`, archives the consumed notes, and resets the pending file for the next cycle.

## Non-Goals

- Do not replace the existing release loop.
- Do not require commit-level or code-level references in release notes.
- Do not generate marketing copy.
- Do not clear pending notes before the target release is confirmed successful and the GitHub Release body update succeeds.
- Do not make failed CI or failed Release runs consume pending notes.

## Files

- `RELEASE_NOTES_PENDING.md`: tracked root-level working file. Agents append release-note material here during normal development.
- `docs/releases/<tag>.md`: tracked archive of notes consumed by a successful release, for example `docs/releases/v0.2.169.md`.
- `.agents/skills/synapse-release-publisher/SKILL.md`: release workflow instructions are extended to consume and publish pending notes only after success.
- `.agents/skills/synapse-release-summary/SKILL.md`: optional follow-up so manual summary requests prefer archived release notes before falling back to commit/diff analysis.
- `AGENTS.md`: completion rules require agents to update pending notes for user-visible changes.

## Pending Notes Format

`RELEASE_NOTES_PENDING.md` stays simple and readable:

```markdown
# Pending Release Notes

## 新增功能

- ...

## 功能优化

- ...

## 问题修复

- ...

## 技术调整

- ...
```

Entries should be plain, product-facing source material. They can be slightly conversational, but should describe the user impact:

- What changed.
- What problem it solves.
- What behavior is different now.

Entries should not include code paths, commit hashes, raw implementation notes, or internal self-praise. Technical adjustments are only recorded when they affect packaging, stability, compatibility, diagnostics, release readiness, or future maintenance risk.

## Daily Development Rule

Before finishing a task in this repository, the agent checks whether the work changed anything user-visible or release-relevant:

- New feature or capability.
- Existing behavior changed.
- Bug fixed.
- UX, diagnostics, compatibility, performance, packaging, or stability improved.
- A release risk was added, removed, or verified.

If yes, append or update one bullet in `RELEASE_NOTES_PENDING.md` under the right section. If no, leave the file unchanged. Docs-only planning work, pure internal cleanup, and version bump commits normally do not need entries unless they affect the shipped product or release readiness.

## Release Consumption Flow

The release publisher skill keeps the existing release loop and adds these steps:

1. At release start, read `RELEASE_NOTES_PENDING.md` and record whether it has meaningful bullets.
2. Run the current bump, CI, fix, and Release loop unchanged.
3. If CI or Release fails, stop or continue the existing repair loop without modifying or clearing pending notes.
4. After the target release succeeds and the matching release in `FairyEver/SynapseAppRelease` is available, generate a user-facing release body from the pending notes.
5. Update the GitHub Release body with:

   ```bash
   gh release edit "$EXPECTED_TAG" \
     --repo FairyEver/SynapseAppRelease \
     --notes-file <generated-notes-file>
   ```

6. Only after `gh release edit` succeeds, archive the consumed pending notes to `docs/releases/$EXPECTED_TAG.md`.
7. Reset `RELEASE_NOTES_PENDING.md` to the empty template.
8. Commit and push the archive/reset with a skip-CI message such as:

   ```text
   docs: consume release notes for v0.2.169 [skip ci]
   ```

The skip-CI commit must happen after the successful package release. It must not be part of the version bump commit that triggers the package release.

## GitHub Release Body Format

The generated Release body is product-facing Markdown:

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

Empty sections may be omitted. The wording should be concise and user-facing. It should not mention commits, source files, branch names, CI internals, or implementation details unless needed to understand compatibility or release risk.

## Failure Handling

- Missing pending file: create/report as setup issue during implementation; do not fabricate notes during release.
- Empty pending notes: continue release and publish a minimal release body or preserve generated GitHub notes, but do not archive fake content.
- Release succeeds but `gh release edit` fails: do not clear pending notes. Report the failure and the generated notes file path so it can be retried.
- Archive/reset commit fails: do not lose notes. Leave pending notes intact or report the exact state if archive succeeded but reset commit failed.
- A later release attempt should be idempotent: if notes were not cleared, they remain available for retry.

## Validation

Implementation should be verified by:

- Checking `AGENTS.md` contains the completion requirement.
- Checking `RELEASE_NOTES_PENDING.md` exists and has the agreed template.
- Checking release publisher instructions only consume notes after Release success and `gh release edit` success.
- Checking no release failure path clears pending notes.
- Running markdown/content review by source inspection; no app runtime or browser verification is required.

