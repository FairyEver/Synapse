# Knowledge Base AI Chat MVP Check

Date: 2026-05-24

## Purpose

This check defines the Synapse-only Knowledge Base MVP the user wants now.

The target is not a full `claude-obsidian` vault/plugin clone. The target is a Synapse desktop experience where:

- users create or open a normal Obsidian-compatible Markdown vault;
- users can inspect that vault in Obsidian as ordinary files;
- all AI maintenance behavior is available only inside Synapse Agent chat;
- the user vault does not receive `.claude`, `.agents`, `.codex`, skills, commands, hooks, scripts, full prompts, Obsidian setup, CSS snippets, Dataview/Bases dashboards, Templater files, or automatic Git behavior.

This document supersedes earlier broad completion checks for the current scope. Older checks remain useful as background, but their Obsidian ecosystem gaps are not blockers for this MVP.

## Upstream Behaviors Checked

Relevant upstream `AgriciDaniel/claude-obsidian` behaviors:

- `skills/wiki-ingest/SKILL.md`: image ingestion reads image files with Claude vision, extracts text/concepts/entities, saves an image description source, then runs normal wiki ingest.
- `skills/autoresearch/SKILL.md`: autoresearch chooses an explicit topic or boundary-first candidate, runs up to three WebSearch/WebFetch rounds, writes wiki source/concept/entity/question pages, then updates index, log, and hot cache.
- `hooks/hooks.json`: SessionStart and PostCompact silently reload `wiki/hot.md`; PostToolUse optionally auto-commits; Stop reminds the agent to refresh hot cache after wiki changes.

Synapse must preserve the useful AI-chat behavior while replacing upstream hooks/scripts/files with Synapse-owned project contributions and Electron services.

## Non-Goals

- No `/wiki` six-mode scaffold.
- No Obsidian configuration, CSS snippets, custom callout visual setup, Dataview/Bases dashboard, Templater templates, or Obsidian Git setup.
- No URL ingestion in this MVP.
- No canvas support.
- No wiki-fold or log folding in this MVP.
- No automatic Git commit behavior.
- No runnable Agent assets written to user vaults.
- No ordinary Scheduler, Workflow, or non-Knowledge Base Agent behavior should load Knowledge Base-only context.

## Current Baseline

Already present in code:

- Knowledge Base project creation/repair writes only data assets from `desktop/resources/knowledge-base/templates`.
- Knowledge Base Agent contribution injects Synapse-owned Claude SDK plugin and prompt commands for local renderer Knowledge Base turns.
- `prepareMessage()` prepends bootstrap and `wiki/hot.md` for new live sessions.
- `/wiki ingest` and natural-language source ingest share `KnowledgeBaseIngestCoordinator` source preflight.
- Ingest finalization validates the Agent report and writes `.raw/.manifest.json` through Synapse.
- `/wiki lint` has deterministic preflight, address validation, and semantic tiling status through Synapse services.
- `/wiki research` exists with explicit-topic and boundary-candidate preflight, but the full upstream autoresearch loop is not yet locked as a verified orchestration contract.

## Acceptance Contract

### 1. Hot Cache Rehydration

Goal: Knowledge Base chat should regain recent context when a user resumes later, not only when a brand-new live SDK session is created.

Required behavior:

- For Knowledge Base local renderer conversations, Synapse reads `wiki/hot.md` through the project contribution path.
- Hot cache is injected on new live sessions.
- Hot cache is also injected on resume when either:
  - the previous hot-cache injection for that conversation is older than the configured stale interval; or
  - `wiki/hot.md` changed since the last injection; or
  - the SDK session was recreated after process/app restart.
- Injection remains silent and does not create visible chat noise.
- Ordinary projects and non-local-renderer Agent paths do not receive Knowledge Base hot cache.
- User vaults do not receive SessionStart hooks.

Recommended default stale interval: 4 hours.

Verification:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "hot cache"
```

### 2. Image / Vision Source Ingestion

Goal: match the useful upstream image behavior without relying on an Obsidian plugin or writing runnable vault files.

Upstream behavior:

- The Agent reads an image path using Claude vision.
- The Agent extracts visible text, diagrams, entities, concepts, and data.
- The image is copied to attachments.
- The extracted description enters the normal wiki ingest path.

Synapse mapping:

- The source manager and Knowledge Base IPC accept image files: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`.
- Staging copies the original image to `_attachments/images/YYYY/MM/DD/`.
- Staging creates an immutable intake record under `.raw/images/YYYY/MM/DD/<slug>.md`.
- The intake record contains frontmatter with:
  - `source_type: image`
  - `original_file`
  - `attachment`
  - `staged_at`
  - `source_format`
- The intake record does not need to contain the OCR text before ingest.
- `/wiki ingest` detects image intake records and instructs the Agent to read the attachment image, extract visual/text content, and create the durable description in `wiki/sources/`.
- Synapse must not ask the Agent to rewrite `.raw/images/*.md`; raw source records remain immutable after staging.
- The ingest report still uses `.raw/images/...md` as the processed source path, so existing manifest finalization works.

Fallback behavior:

- If the active Agent/provider cannot read images, the ingest prompt must return a clear failure and leave manifest `sources` unchanged.
- If a file path is not readable, staging skips it with a structured reason.

Verification:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging-image.test.ts electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts
```

### 3. Autoresearch Loop Alignment

Goal: Synapse `/wiki research` should match upstream `/autoresearch` logic while staying Synapse-owned.

Required behavior:

- `/wiki research <topic>` uses the explicit topic verbatim.
- `/wiki research` without a topic runs Synapse `DragonScaleBoundaryService` and offers the top five boundary candidates.
- If boundary candidates are unavailable, the Agent asks the user for a topic.
- Boundary candidates are suggestions only; the user can choose one, type an override, or cancel.
- Once a topic is resolved, the Agent runs an iterative research loop:
  - round 1 broad search;
  - round 2 gap fill;
  - optional round 3 contradiction/synthesis check;
  - max rounds defaults to 3.
- WebSearch and WebFetch use the existing Agent permission flow; Synapse must not silently bypass network permissions.
- Research outputs are wiki pages, not only a chat answer:
  - `wiki/sources/` for major references;
  - `wiki/concepts/` for reusable concepts;
  - `wiki/entities/` for important people, organizations, products, or places;
  - `wiki/questions/Research - <topic>.md` as the synthesis page.
- The Agent updates `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`.
- Synapse runs the existing post-turn address finalizer for successful research turns.
- Research should emit a structured `synapse_kb_research_report` fenced JSON block so Synapse can validate created/updated wiki pages and surface warnings.

Non-requirements:

- No URL source staging pipeline.
- No user-editable `program.md` in the vault. Research constraints live in Synapse resources.

Verification:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-preflight.test.ts electron/services/knowledge-base/__tests__/research-coordinator.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "research"
```

### 4. Vault Cleanliness

Goal: the vault remains a normal Markdown project that Obsidian can open.

Verification:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script|\\.obsidian|dashboard\\.base|\\.base|templates/)" || true
```

Expected: no matches.

### 5. Ordinary Project Isolation

Goal: Knowledge Base behavior is only available to Knowledge Base local renderer chat sessions.

Verification:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
rg -n "knowledge-base|KnowledgeBase|wiki/hot|wiki research|source-staging" desktop/electron/services/task-scheduler desktop/electron/services/workflow desktop/action-packages || true
```

Expected: tests pass; no production coupling from Scheduler, Workflow, or action packages to Knowledge Base chat behavior.

## Definition Of Done

The MVP is done when:

- hot cache rehydrates on new sessions and stale/changed resumed conversations;
- image files can be staged from the source manager and ingested through AI vision into wiki pages;
- `/wiki research` performs an upstream-aligned research loop and files results into the wiki;
- all new behavior is Synapse-owned and session/project-scoped;
- user vault templates remain clean data-only Markdown assets;
- focused tests plus isolation scans pass.
