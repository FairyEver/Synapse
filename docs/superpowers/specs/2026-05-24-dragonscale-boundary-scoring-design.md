# DragonScale Boundary Scoring Internalization Design

## Goal

Implement DragonScale boundary scoring as a Synapse-owned TypeScript service so knowledge-base projects can surface frontier pages without copying or running `scripts/boundary-score.py` from the user's vault.

This is the third DragonScale implementation slice after:

1. internal upstream-script vendoring plus `DragonScaleAddressService`;
2. post-turn ingest address finalization.

The production path for this phase is read-only. It scans `wiki/`, computes the same boundary scores as upstream, and returns structured results to Synapse callers.

## Source Baseline

The upstream behavior baseline remains `AgriciDaniel/claude-obsidian` commit `75d3b6f`.

Relevant upstream files:

- `scripts/boundary-score.py`
- `skills/autoresearch/SKILL.md`
- `skills/wiki-lint/SKILL.md`

The vendored local oracle is:

- `desktop/resources/knowledge-base/dragonscale/upstream/boundary-score.py`

## Hard Rules

- Do not copy boundary scoring scripts, skills, commands, hooks, agents, or a full `CLAUDE.md` into the user vault.
- Do not invoke a shell script for the production boundary score path.
- Boundary scoring must be available only to knowledge-base project contributions or knowledge-base services.
- Ordinary Agent conversations, Scheduler runs, Workflow runs, and non-knowledge-base projects must not load boundary scoring behavior.
- This phase must not write to user vault files. Reports, dashboards, autoresearch pages, and lint output remain out of scope unless an existing caller writes them explicitly.
- The service must reject or skip symlinked pages and paths that escape the project root before reading page bodies.
- Semantic tiling and embedding/Ollama behavior remain out of scope for this phase.

## Upstream Behavior To Preserve

Boundary scoring identifies frontier pages:

```text
boundary_score(page) = (out_degree(page) - in_degree(page)) * recency_weight(page)
recency_weight(page) = exp(-days_since_updated_or_created / 30)
```

High scores mean the page links outward to many scoreable pages, receives few inbound links, and was touched recently.

Scoreable page rules:

- scan `wiki/**/*.md`;
- skip files above `256 KiB` when encoded as UTF-8;
- skip symlinked files;
- skip paths resolving outside the project root;
- skip filenames `_index.md`, `index.md`, `log.md`, `hot.md`, `overview.md`, `dashboard.md`, `Wiki Map.md`, and `getting-started.md`;
- skip paths under `wiki/folds/` and `wiki/meta/`;
- skip frontmatter `type: meta` and `type: fold`.

Frontmatter parsing:

- only the first YAML-style block delimited by `---` is parsed;
- recognized keys are `type`, `updated`, `created`, and `title`;
- `updated` wins over `created` for recency;
- missing or invalid dates count as `10000` days old.

Wikilink parsing:

- count Obsidian links shaped like `[[Target]]`, `[[Target|Alias]]`, and `[[Target#Heading]]`;
- resolve folder-qualified links such as `[[notes/Foo]]` by filename stem `Foo`;
- do not parse frontmatter aliases;
- ignore duplicate links from the same source to the same target;
- ignore self-links;
- ignore links whose target stem does not match a scoreable page;
- ignore wikilinks inside fenced code blocks using backticks or tildes, with same-character and same-or-longer closing fence rules;
- do not filter indented code blocks.

Result behavior:

- default result returns the top 10 positive-score pages;
- `top` must be `>= 1`;
- callers may include zero or negative scores;
- callers may request one page by relative path or filename stem;
- sorting is by score descending, then `title_key` ascending;
- scores and recency weights are rounded to four decimals, matching upstream JSON output.

## Target Architecture

```text
desktop/electron/services/knowledge-base/dragonscale/
  boundary-service.ts
  boundary-types.ts
  types.ts

desktop/electron/services/knowledge-base/__tests__/
  dragonscale-boundary-service.test.ts
  dragonscale-boundary-compat.test.ts
```

`DragonScaleBoundaryService` is a pure main-process service:

```ts
class DragonScaleBoundaryService {
  score(projectPath: string, options?: DragonScaleBoundaryScoreOptions): Promise<DragonScaleBoundaryScoreReport>
}
```

It should not depend on Agent runtime, Scheduler, Workflow, renderer code, or a shell runner.

## Public Types

```ts
export interface DragonScaleBoundaryScoreOptions {
  readonly top?: number
  readonly includeScoreZero?: boolean
  readonly page?: string
  readonly today?: string
}

export interface DragonScaleBoundaryScoreResult {
  readonly title: string
  readonly titleKey: string
  readonly path: string
  readonly outDegree: number
  readonly inDegree: number
  readonly ageDays: number
  readonly recencyWeight: number
  readonly score: number
}

export interface DragonScaleBoundaryScoreReport {
  readonly generated: string
  readonly halflifeDays: 30
  readonly pageCountScoreable: number
  readonly results: readonly DragonScaleBoundaryScoreResult[]
}
```

The `today` option exists for deterministic tests. Production callers omit it.

## Integration Scope

This phase exposes the service from `desktop/electron/services/knowledge-base/index.ts` for future knowledge-base callers.

No new user-facing command is required in this phase.

The intended future integration is:

- autoresearch topic selection can ask this service for top frontier pages when no explicit topic is provided;
- wiki lint can include a read-only "frontier pages" section if the product chooses to expose it;
- semantic tiling remains a separate future service.

## Error Handling

- Missing `wiki/` returns a valid empty report.
- Invalid `top` rejects with a structured `Error`.
- Unmatched `page` rejects with a structured `Error`.
- Unreadable or invalid UTF-8 files are skipped.
- Symlinked or escaping files are skipped before content is read.
- Duplicate filename stems should follow upstream's effective behavior: later sorted paths overwrite earlier entries in the page map. Add a test that documents this compatibility quirk.

## Testing Strategy

Required tests:

- empty or missing `wiki/` returns no results;
- service call does not create `.vault-meta/`, `wiki/meta/`, reports, or any other vault file;
- excludes meta/fold/system pages and symlinks;
- parses `title`, `created`, and `updated` frontmatter;
- computes out-degree, in-degree, recency weight, and score;
- sorts by score descending then title key;
- filters non-positive scores by default;
- supports `includeScoreZero`;
- supports `page` by stem and by relative path;
- ignores links in fenced code blocks but counts indented links;
- resolves aliases, headings, and folder-qualified links by stem;
- rejects invalid `top`;
- exports service and types from the knowledge-base barrel.

Compatibility tests:

- fixture output should match upstream `boundary-score.py --json --include-score-zero --top N` after normalizing timestamp and snake_case/camelCase keys;
- for script compatibility, omit the service `today` override so both the Python oracle and TypeScript service use the same wall-clock date during the test run; use the `today` override only in unit tests with hard-coded expected scores.

## Non-Goals

- Do not implement autoresearch in this phase.
- Do not create or update `wiki/meta/` reports.
- Do not implement semantic tiling or embedding cache behavior.
- Do not expose boundary scoring to generic Agent, Scheduler, or Workflow runs.
- Do not change knowledge-base prompt copy unless a caller is wired in a later phase.

## Acceptance Criteria

- `DragonScaleBoundaryService` computes upstream-compatible boundary scores without shelling out.
- The service is read-only and does not create or modify files under the vault.
- Tests cover algorithm behavior, path safety, and upstream compatibility.
- Knowledge-base barrel exports the service for future internal callers.
- Existing knowledge-base ingest/address tests continue to pass.
