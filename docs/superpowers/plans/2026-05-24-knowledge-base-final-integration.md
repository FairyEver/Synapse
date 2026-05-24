# Knowledge Base Final Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Check doc:** `docs/superpowers/specs/2026-05-24-knowledge-base-final-integration-check.md`

**Goal:** Wire Synapse's internal DragonScale services into user-visible knowledge-base workflows so `/wiki lint` and boundary-first research no longer rely on user-vault scripts or model-only imitation.

**Architecture:** Keep deterministic maintenance in Electron main-process knowledge-base services. Use prompt commands and knowledge-base project contributions as the only Agent integration boundary. The Agent receives compact preflight appendices and handles semantic writing, but Synapse owns address validation, tiling diagnostics, tiling reports, and boundary topic candidates.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Vitest, existing Agent project contributions, existing Claude SDK plugin resources.

---

## File Map

- Create: `desktop/electron/services/knowledge-base/lint-addresses.ts`
  - Deterministic DragonScale address validation.
- Create: `desktop/electron/services/knowledge-base/lint-preflight.ts`
  - Wiki inventory, wikilink, frontmatter, manifest, address, and tiling preflight.
- Create: `desktop/electron/services/knowledge-base/research-preflight.ts`
  - Boundary-first topic candidate generation.
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
  - Wire `/wiki lint` and `/wiki research`.
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
  - Add lint preflight appendix and research candidate appendix copy.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Publish `/wiki research`; optionally detect natural-language research intents later.
- Modify: `desktop/resources/knowledge-base/prompts/lint.md`
  - Tell Agent to use Synapse preflight facts and not invent DragonScale output.
- Create: `desktop/resources/knowledge-base/prompts/research.md`
  - Internal autoresearch prompt derived from upstream behavior, cleaned for Synapse.
- Optional create: `desktop/resources/knowledge-base/claude-plugin/skills/autoresearch/SKILL.md`
  - Natural-language routing skill that stays inside Synapse resources.
- Test: `desktop/electron/services/knowledge-base/__tests__/lint-addresses.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/lint-preflight.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/research-preflight.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

---

## Hard Rules

- Do not copy scripts, skills, commands, hooks, agents, or full operational prompts into the user vault.
- Do not run vendored DragonScale scripts in production command paths.
- Do not expose knowledge-base tiling/boundary/address behavior to ordinary projects.
- Do not add Scheduler or Workflow integration in this plan.
- Lint observes address issues; it must not assign or rewrite addresses.
- Tiling may write `.vault-meta/tiling-cache.json` and `wiki/meta/tiling-report-YYYY-MM-DD.md`.
- Research may write only wiki knowledge pages and `.raw/.manifest.json` through the Agent's normal knowledge-base rules.
- Synapse must not modify `.raw/` sources except `.raw/.manifest.json`.

---

### Task 1: Add Deterministic Address Lint Service

**Files:**
- Create: `desktop/electron/services/knowledge-base/lint-addresses.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/lint-addresses.test.ts`

- [ ] **Step 1: Add failing address lint tests**

Cover:

- valid `c-NNNNNN` and `l-NNNNNN` formats;
- invalid address format;
- duplicate address values across pages;
- counter drift using `DragonScaleAddressService.peek()`;
- post-rollout eligible page missing address;
- legacy page missing address is informational;
- `.vault-meta/legacy-pages.txt` overrides classification;
- `.raw/.manifest.json` address_map points to a missing page;
- address_map mismatch between manifest and page frontmatter;
- meta/fold/system pages ignored.

- [ ] **Step 2: Implement page scanning**

Reuse or extract safe wiki walking helpers from existing DragonScale services where practical.

The service should return structured issues:

```ts
type KnowledgeBaseLintSeverity = "error" | "warning" | "info"

interface KnowledgeBaseLintIssue {
  readonly severity: KnowledgeBaseLintSeverity
  readonly code: string
  readonly path?: string
  readonly message: string
}
```

- [ ] **Step 3: Implement rollout and legacy classification**

Default rollout date: `2026-04-23`.

Support `.vault-meta/legacy-pages.txt`:

- ignore blank lines;
- ignore `#` comments;
- parse optional `# rollout: YYYY-MM-DD`.

- [ ] **Step 4: Implement manifest and counter checks**

Use existing `readKnowledgeBaseManifest()` and `DragonScaleAddressService.peek()`.

Do not call `allocate()` or `rebuild()`.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/lint-addresses.test.ts
```

Expected: PASS.

---

### Task 2: Add Lint Preflight Service

**Files:**
- Create: `desktop/electron/services/knowledge-base/lint-preflight.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/lint-preflight.test.ts`

- [ ] **Step 1: Add failing preflight tests**

Cover:

- page inventory count;
- orphan pages;
- dead wikilinks;
- missing frontmatter fields;
- empty headings;
- stale `wiki/index.md` entries;
- manifest source issues;
- address lint issues included;
- tiling unavailable due to Ollama missing is reported as skipped, not fatal;
- tiling ready writes `wiki/meta/tiling-report-YYYY-MM-DD.md` and returns summary.

- [ ] **Step 2: Implement deterministic wiki checks**

Keep checks conservative and deterministic:

- collect `wiki/**/*.md` safely;
- ignore system/meta/fold pages where appropriate;
- parse wikilinks by filename stem;
- find dead links by missing stem;
- find orphans by zero inbound links, excluding system pages;
- detect required frontmatter fields for maintained pages;
- detect headings followed by no non-empty content until next heading;
- detect index links pointing to missing pages.

- [ ] **Step 3: Integrate address lint**

Call `KnowledgeBaseAddressLintService`.

Return counts grouped by severity and code.

- [ ] **Step 4: Integrate semantic tiling**

Call `DragonScaleTilingService.peek()`.

If status is `ok`, call:

```ts
check(projectPath, {
  reportPath: `wiki/meta/tiling-report-${YYYY-MM-DD}.md`,
})
```

If status is not `ok`, return a lint issue/summary but do not fail the whole preflight.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/lint-preflight.test.ts
```

Expected: PASS.

---

### Task 3: Wire `/wiki lint` To Preflight

**Files:**
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- Modify: `desktop/resources/knowledge-base/prompts/lint.md`
- Modify: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add failing command prompt tests**

Assert `/wiki lint` command output contains:

- the base lint prompt;
- a Synapse preflight appendix;
- address validation summary;
- semantic tiling summary;
- tiling report path when generated;
- instruction that Agent must not run or reference user-vault scripts.

- [ ] **Step 2: Extend `BuildKnowledgeBaseCommandOutputInput`**

Add optional dependencies for tests:

```ts
readonly lintPreflight?: Pick<KnowledgeBaseLintPreflightService, "run">
readonly now?: () => Date
```

Production default creates the real service.

- [ ] **Step 3: Implement `buildLintOutput()`**

Replace current direct prompt return:

```ts
case "lint":
  return { kind: "prompt", content: await input.readPrompt("lint.md") }
```

with:

```ts
case "lint":
  return buildLintOutput(input.projectPath, input.readPrompt, deps)
```

- [ ] **Step 4: Update lint prompt copy**

Tell the Agent:

- Synapse already performed deterministic checks below;
- use those facts in the final report;
- do not run DragonScale scripts;
- do not invent address/tiling results;
- semantic/stale-claim/missing-concept review is still the Agent's job;
- write final lint report to `wiki/meta/lint-report-YYYY-MM-DD.md`.

- [ ] **Step 5: Run command tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

---

### Task 4: Add Boundary-First Research Preflight

**Files:**
- Create: `desktop/electron/services/knowledge-base/research-preflight.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/research-preflight.test.ts`

- [ ] **Step 1: Add failing research preflight tests**

Cover:

- explicit topic bypasses boundary scoring;
- missing topic calls `DragonScaleBoundaryService.score(top: 5)`;
- empty boundary results returns `needs-topic`;
- score failure returns `needs-topic` with reason;
- candidates include title, path, score, out degree, in degree.

- [ ] **Step 2: Implement service**

Return:

```ts
type KnowledgeBaseResearchPreflight =
  | { mode: "explicit-topic"; topic: string }
  | { mode: "boundary-candidates"; candidates: readonly Candidate[] }
  | { mode: "needs-topic"; reason?: string }
```

- [ ] **Step 3: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-preflight.test.ts
```

Expected: PASS.

---

### Task 5: Add `/wiki research` Prompt Command

**Files:**
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Create: `desktop/resources/knowledge-base/prompts/research.md`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`

- [ ] **Step 1: Add failing published-command tests**

Expect knowledge-base projects to publish:

```text
wiki research
```

Suggested UI:

- label: `研究入库`
- action: `insert`
- insertText: `/wiki research `

- [ ] **Step 2: Add research prompt resource**

Create `research.md` based on upstream autoresearch, adapted to Synapse:

- no script execution;
- no user-vault skills;
- filing goes to `wiki/sources/`, `wiki/concepts/`, `wiki/entities/`, `wiki/questions/`;
- update `wiki/index.md`, `wiki/hot.md`, `wiki/log.md`;
- preserve existing `address:` fields;
- Synapse ingest finalizer handles address assignment only after ingest-like turns if the command later opts into that path.

- [ ] **Step 3: Implement command output**

`/wiki research topic words`:

- embeds explicit topic in prompt.

`/wiki research`:

- embeds boundary candidates if present;
- otherwise asks the Agent to ask the user for a topic.

- [ ] **Step 4: Decide address finalization behavior**

Research creates wiki pages, so it needs address assignment too.

Recommended narrow first implementation:

- add research intent to the post-turn finalizer detector only if `/wiki research` is expected to create pages;
- do not trigger finalizer for pure topic-selection turns where the Agent only asks the user to choose a topic.

Add tests for both cases.

- [ ] **Step 5: Run command and finalizer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-intent.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

---

### Task 6: Optional Natural-Language Research Routing Skill

**Files:**
- Optional create: `desktop/resources/knowledge-base/claude-plugin/skills/autoresearch/SKILL.md`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add plugin-resource test**

Assert the resource skill exists under Synapse resources and is not copied to the user vault.

- [ ] **Step 2: Add resource skill**

The skill should route natural-language research requests to the same Synapse behavior:

- prefer `/wiki research <topic>` for explicit topics;
- for topicless requests, ask the user to run `/wiki research` or proceed using the prompt context if Synapse has injected candidates;
- never mention or require vault scripts.

- [ ] **Step 3: Keep this optional**

If the SDK cannot reliably convert a skill activation into a Synapse command, keep explicit `/wiki research` as the first supported path and document natural-language routing as a follow-up.

---

### Task 7: Defer Wiki Fold Into A Separate Slice

**Files:**
- Optional doc update only.

- [ ] **Step 1: Do not implement fold in this plan**

Fold/log compaction is separate from the original manifest/DragonScale gap. Keep this plan focused on lint and research.

- [ ] **Step 2: Create a follow-up spec if needed**

Only after lint and research pass:

- `desktop/resources/knowledge-base/prompts/fold.md`
- `/wiki fold`
- optional `wiki/folds/` structure validation
- tests proving no user-vault Agent files.

---

### Task 8: Final Validation

**Files:**
- Existing knowledge-base tests and hard-constraint checks.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/lint-addresses.test.ts electron/services/knowledge-base/__tests__/lint-preflight.test.ts electron/services/knowledge-base/__tests__/research-preflight.test.ts electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts electron/services/knowledge-base/__tests__/ingest-intent.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

- [ ] **Step 2: Run DragonScale tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts
```

- [ ] **Step 3: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

- [ ] **Step 5: Verify templates remain clean**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | sort | rg "(scripts/|\\.claude|\\.agents|\\.codex|SKILL.md|tiling-check|boundary-score|allocate-address)" || true
```

Expected: no output.

---

## Completion Criteria

- `/wiki lint` uses Synapse deterministic preflight and includes internal address/tiling outputs in its prompt.
- Semantic tiling report is generated by `DragonScaleTilingService`, not by an Agent-run script.
- `/wiki research [topic]` works for explicit topics.
- `/wiki research` without topic uses `DragonScaleBoundaryService` candidates when available.
- Research-created pages receive deterministic address finalization where appropriate.
- No scripts or Agent capability files are added to user vault templates.
- Ordinary projects, Scheduler, and Workflow remain unaffected.
