# Knowledge Base Final Integration Check

## Purpose

This check records the remaining gap between Synapse's internalized DragonScale services and the user-visible `claude-obsidian` behavior.

The immediate question is whether the original problem is fully solved after DragonScale phase 4. The answer is:

- The core storage and runtime-boundary problem is solved.
- The final user-visible orchestration layer is still missing.

This document is the code-analysis checkpoint for that last layer.

## Sources Checked

Local Synapse code:

- `desktop/electron/services/knowledge-base/agent-contribution.ts`
- `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- `desktop/electron/services/knowledge-base/ingest-finalizer.ts`
- `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`
- `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`
- `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
- `desktop/resources/knowledge-base/prompts/lint.md`
- `desktop/resources/knowledge-base/prompts/bootstrap.md`
- `desktop/resources/knowledge-base/claude-plugin/skills/wiki-lint/SKILL.md`
- `desktop/electron/services/agent-runtime/project-contributions.ts`
- `desktop/electron/services/agent-runtime/conversation-router.ts`
- `desktop/electron/services/agent-runtime/session-manager.ts`
- `desktop/electron/services/agent-runtime/claude-sdk-session.ts`

Upstream `AgriciDaniel/claude-obsidian` references:

- `skills/wiki-lint/SKILL.md`
- `skills/autoresearch/SKILL.md`
- `skills/wiki-fold/SKILL.md`
- `skills/wiki-ingest/SKILL.md`
- vendored local script copies under `desktop/resources/knowledge-base/dragonscale/upstream/`

## Current Synapse State

### Runtime Boundary

Pass.

Knowledge-base Agent capabilities are loaded from Synapse resources:

- `createKnowledgeBaseAgentContribution()` contributes a local SDK plugin path resolved outside the user vault.
- `prepareMessage()` injects bootstrap and `wiki/hot.md` only for knowledge-base projects.
- `afterTurn()` runs only through project contributions.
- Ordinary projects receive no knowledge-base contribution.

The SDK session still loads normal Claude Code settings sources:

```ts
settingSources: ["user", "project", "local"]
skills: "all"
settings: { disableAllHooks: true, ... }
```

This is acceptable only because user vault templates do not contain `.claude`, `.agents`, `.codex`, scripts, or Agent skills. Knowledge-base-specific Synapse behavior must continue to be added through project contributions, not user-vault files.

### Ingest And Manifest

Pass for the original bug.

Implemented path:

1. `/wiki ingest` or natural-language ingest is routed to the knowledge-base Agent behavior.
2. The Agent writes or updates wiki pages and source manifest entries.
3. `KnowledgeBaseIngestFinalizer` runs after the turn.
4. Synapse inserts missing `address:` frontmatter and updates `.raw/.manifest.json` `address_map`.

This means "汲取知识" no longer depends on the model remembering to update `address_map`.

### DragonScale Internal Services

Pass at service level.

Internal services exist for the formerly script-backed mechanisms:

- `DragonScaleAddressService`
- `DragonScaleBoundaryService`
- `DragonScaleTilingService`

Production code does not need to copy or execute `scripts/allocate-address.sh`, `scripts/boundary-score.py`, or `scripts/tiling-check.py` inside the user vault.

### `/wiki lint`

Partial.

Current code:

```ts
case "lint":
  return { kind: "prompt", content: await input.readPrompt("lint.md") }
```

`lint.md` asks the Agent to scan the vault and write `wiki/meta/lint-report-YYYY-MM-DD.md`, including manifest/address checks.

Missing:

- No deterministic Synapse lint preflight.
- No address validation service/report.
- No automatic call to `DragonScaleTilingService.peek()` or `check()`.
- No summary of tiling status is embedded into the lint prompt.
- No deterministic `wiki/meta/tiling-report-YYYY-MM-DD.md` write during lint.

Upstream `wiki-lint` includes two DragonScale sections:

- Address Validation (Mechanism 2)
- Semantic Tiling (Mechanism 3)

Synapse has the lower-level services but has not wired them into `/wiki lint`.

### Autoresearch

Missing.

Current Synapse command set exposes:

- `/wiki ingest`
- `/wiki query`
- `/wiki hot`
- `/wiki save`
- `/wiki lint`
- `/wiki status`

There is no `autoresearch` or `/wiki research` command.

Upstream `autoresearch` supports:

- explicit topic research;
- no-topic boundary-first topic selection;
- fallback prompt when boundary mode is unavailable;
- research loop using `WebSearch` and `WebFetch`;
- filing results into `wiki/sources/`, `wiki/concepts/`, `wiki/entities/`, and `wiki/questions/`;
- updating `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`.

Synapse has `DragonScaleBoundaryService`, but no user-facing research command uses it.

### Wiki Fold / Log Folding

Missing.

Synapse has no equivalent of upstream `wiki-fold` behavior.

The user vault may contain `wiki/log.md` and future `wiki/folds/`, but there is currently no Synapse-owned fold service, no prompt command, and no natural-language routing for folding large logs or clusters of pages.

## Root Cause Of The Remaining Gap

The implementation so far internalized deterministic mechanisms but did not add a composition layer.

Current split:

| Capability | Current owner | Status |
| --- | --- | --- |
| Natural-language ingest routing | Synapse SDK plugin skill | Works |
| Address assignment | Synapse post-turn finalizer | Works |
| Boundary scoring | Synapse service | Works |
| Semantic tiling | Synapse service | Works |
| Lint report orchestration | Agent prompt only | Incomplete |
| Autoresearch topic selection | Not wired | Missing |
| Autoresearch filing | Not wired | Missing |
| Wiki fold/log folding | Not wired | Missing |

The services are present, but the Agent is not being given their outputs at the right time.

## Recommended Final-Layer Design

Use Synapse-owned command/preflight services, not user-vault scripts and not a broad generic SDK tool framework.

The pattern should be:

1. Slash command or natural-language intent enters the knowledge-base contribution.
2. Synapse detects the command/intent only for knowledge-base projects.
3. Synapse runs deterministic internal services before or after the Agent turn.
4. Synapse passes a compact structured appendix to the Agent prompt.
5. The Agent performs semantic writing only where human-language judgment is useful.

This keeps all hard rules intact:

- no scripts or skills in user vault;
- no knowledge-base logic in ordinary Agent conversations;
- no Scheduler/Workflow pollution;
- no shell execution as production behavior;
- only knowledge-base data files are written to the vault.

## Final-Layer Units Needed

### 1. `KnowledgeBaseLintPreflight`

Main-process service that gathers deterministic lint facts:

- wiki page inventory;
- dead wikilinks;
- orphan pages;
- frontmatter gaps;
- empty sections;
- stale index links;
- manifest source/address-map issues;
- DragonScale address validation;
- optional semantic tiling status and report summary.

It should not try to detect stale claims or missing concepts with language judgment. Those remain Agent tasks.

### 2. `KnowledgeBaseAddressLintService`

Focused deterministic validator:

- validate `address:` format;
- detect duplicate addresses;
- compare pages against `manifest.address_map`;
- check counter consistency using `DragonScaleAddressService.peek()`;
- identify post-rollout pages missing address;
- list legacy pages without address as informational.

This service must observe only. It must not assign addresses.

### 3. `KnowledgeBaseTilingLintService`

Thin wrapper around `DragonScaleTilingService` for lint:

- run `peek()` first;
- if ready, run `check()` with report path `wiki/meta/tiling-report-YYYY-MM-DD.md`;
- return a compact lint appendix:
  - status;
  - error pair count;
  - review pair count;
  - calibrated true/false;
  - report path;
  - user-facing next steps if Ollama/model/cache is unavailable.

### 4. `/wiki lint` Integration

Change `buildKnowledgeBaseCommandOutput()` for `lint`:

- run the deterministic preflight;
- build prompt content from `lint.md` plus a Synapse preflight appendix;
- instruct the Agent not to rerun scripts or invent DragonScale outputs;
- ask the Agent to write the final lint report using preflight facts plus semantic review.

### 5. Boundary-First Research Integration

Add a knowledge-base research command:

- recommended command name: `/wiki research [topic]`;
- optional UI action can be added later;
- if topic is provided, use it directly;
- if topic is missing, run `DragonScaleBoundaryService.score(projectPath, { top: 5 })`;
- include candidates in the prompt and ask the user to choose, override, or cancel;
- if no candidates, ask the user for a topic.

Natural-language research requests can be routed by a Synapse plugin skill, but deterministic boundary candidates must be computed by Synapse before the prompt is sent.

### 6. Wiki Fold Integration

Add only after lint and research are stable.

Recommended first slice:

- internal prompt resource `fold.md`;
- `/wiki fold` command;
- no deterministic fold service at first unless upstream `wiki-fold` semantics require state files;
- keep writes under `wiki/folds/`, `wiki/log.md`, and index/hot updates.

## Acceptance Check For "Solved"

The original issue should be considered fully solved only when these are true:

- Natural-language ingest updates wiki pages and `.raw/.manifest.json` address map deterministically.
- `/wiki lint` uses Synapse internal address and tiling services instead of asking the Agent to reproduce script behavior.
- Boundary-first autoresearch is available without `scripts/boundary-score.py` in the vault.
- Any optional fold behavior uses Synapse resources and writes only knowledge-base data.
- User-created knowledge-base folders remain free of `.claude`, `.agents`, `.codex`, `scripts/`, `SKILL.md`, hooks, commands, and full operational prompts.
- Ordinary projects, Scheduler, and Workflow do not load knowledge-base-only behavior.
