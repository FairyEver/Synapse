---
name: wiki-ingest
description: "Ingest existing Synapse-managed sources into the Synapse Knowledge Base. Reads a real .raw source, extracts entities and concepts, creates or updates wiki pages, cross-references, and logs the operation. Supports files, Synapse-managed URL/image sources, and batch mode. Triggers on: ingest, process this source, add this to the wiki, read and file this, batch ingest, ingest all of these, ingest this url."
---

# wiki-ingest: Source Ingestion

Read the source. Write the wiki. Cross-reference everything. A single source typically touches 8-15 wiki pages.

**Syntax standard**: Write all Obsidian Markdown using proper Obsidian Flavored Markdown. Wikilinks as `[[Note Name]]`, callouts as `> [!type] Title`, embeds as `![[file]]`, properties as YAML frontmatter. If the kepano/obsidian-skills plugin is installed, prefer its canonical obsidian-markdown skill for Obsidian syntax reference. Otherwise, follow the guidance in this skill.

---

## Delta Tracking

Before ingesting any file, list the actual files under `.raw/` and check `.raw/.manifest.json` only as read-only context. Process only source files that really exist under `.raw/`; never invent source paths or manifest entries for files that are not present.

When Synapse injects an ingest preflight with a bounded list of changed `.raw/` sources, process only the listed sources in this turn. If the preflight says additional changed sources were omitted, finish the current batch and let the user or Synapse run `/wiki-ingest` again for the next batch.

Synapse owns the SHA-256 comparison between `.raw/` files and `.raw/.manifest.json`, and Synapse writes the final manifest after your turn. Do not compute your own source hash or use a shell hash command to decide whether a source changed.

```bash
# Check if manifest exists
[ -f .raw/.manifest.json ] && echo "exists" || echo "no manifest yet"
```

**Manifest format** (read-only context; Synapse writes the final manifest after your turn):
```json
{
  "sources": {
    ".raw/articles/article-slug-2026-04-08.md": {
      "hash": "abc123",
      "ingested_at": "2026-04-08",
      "pages_created": ["wiki/sources/article-slug.md", "wiki/entities/Person.md"],
      "pages_updated": ["wiki/index.md"]
    }
  }
}
```

**Before ingesting a file:**
1. Verify the file exists under `.raw/` and is not `.raw/.manifest.json`.
2. If Synapse injected an ingest preflight, process only source paths in that preflight list.
3. If a source is not in the preflight list, treat it as already filtered out for this turn unless the user explicitly requested `force` or named that exact source.
4. If no preflight is present, use the manifest only to understand prior pages and address mappings; do not edit it or infer hash mismatches yourself.

**After ingesting a file:**
1. Do not edit `.raw/.manifest.json`.
2. Emit the `synapse_kb_ingest_report` block described below. Synapse records `{hash, ingested_at, pages_created, pages_updated}` for accepted real source paths and preserves unrelated manifest entries and `address_map`.

Skip delta checking if the user says "force ingest" or "re-ingest".

---

## URL Ingestion

Trigger: user passes a URL starting with `https://`.

Synapse owns URL acquisition for Knowledge Base sources. Do not fetch a remote URL yourself and do not write a new `.raw/` file from Agent tools, shell redirects, or manual frontmatter. URL source creation must go through Synapse source management so network permission checks, audit, filename safety, conflict handling, and manifest tracking remain consistent.

Steps:

1. If Synapse injected an ingest preflight that already contains the URL's real `.raw/` source path, process that file with **Single Source Ingest**.
2. If no real `.raw/` source exists yet, ask the user to add the URL through the Synapse Knowledge Base source manager first, then run `/wiki-ingest` again.
3. Never invent `.raw/articles/...` paths for URLs and never edit `.raw/.manifest.json` yourself.

---

## Image / Vision Ingestion

Trigger: user passes an image file path (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`).

Synapse owns raw source creation for local files and images. Do not copy external image files into `.raw/`, do not create `.raw/images/...` descriptions from Agent tools, and do not write `_attachments/` as a substitute for source management.

Steps:

1. If Synapse injected an ingest preflight with a real `.raw/` image or image-description source, process that source path.
2. If the user supplied an external image path that is not already a `.raw/` source, ask them to upload it through Synapse Knowledge Base source management first, then run `/wiki-ingest` again.
3. When processing an approved image source, describe the contents in the resulting wiki source summary: extract visible text, identify key concepts, entities, diagrams, and data.

Use cases: whiteboard photos, screenshots, diagrams, infographics, document scans.

---

## Single Source Ingest

Trigger: user drops a file into `.raw/` or pastes content.

Steps:

1. **Read** the source completely. Do not skim.
2. **Discuss** key takeaways with the user. Ask: "What should I emphasize? How granular?" Skip this if the user says "just ingest it."
3. **Create** source summary in `wiki/sources/`. Use the source frontmatter schema from `references/frontmatter.md`. Assign an address per the **Address Assignment** section below.
4. **Create or update** entity pages for every person, org, product, and repo mentioned. One page per entity. Assign addresses to new entity pages.
5. **Create or update** concept pages for significant ideas and frameworks. Assign addresses to new concept pages.
6. **Update** relevant domain page(s) and their `_index.md` sub-indexes.
7. **Update** `wiki/overview.md` if the big picture changed.
8. **Update** `wiki/index.md`. Add entries for all new pages.
9. **Update** `wiki/hot.md` with this ingest's context.
10. **Append** to `wiki/log.md` (new entries at the TOP):
    ```markdown
    ## [YYYY-MM-DD] ingest | Source Title
    - Source: `.raw/articles/filename.md`
    - Summary: [[Source Title]]
    - Pages created: [[Page 1]], [[Page 2]]
    - Pages updated: [[Page 3]], [[Page 4]]
    - Key insight: One sentence on what is new.
    ```
11. **Check for contradictions.** If new info conflicts with existing pages, add `> [!contradiction]` callouts on both pages.

---

## Batch Ingest

Trigger: user drops multiple files or says "ingest all of these."

Steps:

1. List all files to process. Confirm with user before starting.
2. Process each source following the single ingest flow. Defer cross-referencing between sources until step 3.
3. After all sources: do a cross-reference pass. Look for connections between the newly ingested sources.
4. Update index, hot cache, and log once at the end (not per-source).
5. Report: "Processed N sources. Created X pages, updated Y pages. Here are the key connections I found."

Batch ingest is less interactive. For 30+ sources, expect significant processing time. Check in with the user after every 10 sources.

---

## Context Window Discipline

Token budget matters. Follow these rules during ingest:

- Read `wiki/hot.md` first. If it contains the relevant context, don't re-read full pages.
- Read `wiki/index.md` to find existing pages before creating new ones.
- Read only 3-5 existing pages per ingest. If you need 10+, you are reading too broadly.
- Use PATCH for surgical edits. Never re-read an entire file just to update one field.
- Keep wiki pages short. 100-300 lines max. If a page grows beyond 300 lines, split it.
- Use search (`/search/simple/`) to find specific content without reading full pages.

---

## Contradictions

> [!note] Custom callout dependency
> The `[!contradiction]` callout type used below is a **custom callout** defined in `.obsidian/snippets/vault-colors.css` (auto-installed by `/wiki` scaffold). It renders with reddish-brown styling and an alert-triangle icon when the snippet is enabled. If the snippet is missing, Obsidian falls back to default callout styling, so the page still works without the visual flourish. See [[skills/wiki/references/css-snippets.md]] for the four custom callouts (`contradiction`, `gap`, `key-insight`, `stale`).

When new info contradicts an existing wiki page:

On the existing page, add:
```markdown
> [!contradiction] Conflict with [[New Source]]
> [[Existing Page]] claims X. [[New Source]] says Y.
> Needs resolution. Check dates, context, and primary sources.
```

On the new source summary, reference it:
```markdown
> [!contradiction] Contradicts [[Existing Page]]
> This source says Y, but existing wiki says X. See [[Existing Page]] for details.
```

Do not silently overwrite old claims. Flag and let the user decide.

---

## What Not to Do

- **Source files under `.raw/` are immutable.** Do not modify the files that users drop there (articles, transcripts, images). Do not edit `.raw/.manifest.json`; Synapse owns final manifest writes after the turn. Treat every other file under `.raw/` as read-only source content.
- Do not create duplicate pages. Always check the index and search before creating.
- Do not skip the log entry. Every ingest must be recorded.
- Do not skip the hot cache update. It is what keeps future sessions fast.

---

## Address Assignment (DragonScale Mechanism 2 MVP)

**Opt-in feature**. DragonScale address assignment runs only if `.vault-meta/` exists. In Synapse-managed Knowledge Base sessions, Synapse finalizes missing addresses after the turn with its cross-platform allocator. The Bash helper remains an optional compatibility tool for POSIX/manual vault workflows.

**Feature detection (run at start of every ingest)**:

```bash
if [ -d ./.vault-meta ]; then
  DRAGONSCALE_ADDRESSES=1
else
  DRAGONSCALE_ADDRESSES=0
fi
```

When `DRAGONSCALE_ADDRESSES=0`, pages are created without an `address:` frontmatter field, and `wiki-lint`'s Address Validation section is skipped entirely (missing addresses are not flagged in any severity). This preserves default plugin behavior for vaults that have not adopted DragonScale.

When `DRAGONSCALE_ADDRESSES=1`, proceed with the rest of this section.

---

Every **newly created non-meta wiki page** gets a stable address in its frontmatter:

```yaml
address: c-000042
```

Format: `c-<6-digit-counter>`. The `c-` prefix stands for "creation-order counter." Zero-padded.

Rollout baseline: **2026-04-23** (Phase 2 ship date). Pages with `created:` >= this date are post-rollout and MUST have an address (unless excluded below). Pages with `created:` earlier are legacy-exempt until a deliberate backfill pass assigns `l-NNNNNN` addresses.

### Address allocator

In Synapse-managed Knowledge Base sessions, you may create a new page without `address:` if the local Bash helper is unavailable. The Synapse ingest finalizer will allocate a stable `c-NNNNNN` address and update `.raw/.manifest.json` after this turn, as long as the new page path appears in the ingest report.

On POSIX/manual vault workflows, address allocation can be delegated to the Bash helper. The helper uses the project-local `.vault-meta/.address.lock.d` directory lock to prevent read-use-increment races and recovers the counter by scanning existing frontmatter if the counter file is missing.

```bash
ADDR=$(./scripts/allocate-address.sh)
# ADDR is now e.g. "c-000042"; counter is already incremented
```

**CRITICAL**: never use the Write or Edit tool on `.vault-meta/address-counter.txt`. That would fire the PostToolUse hook, which runs `git add wiki/ .raw/` and can accidentally commit unrelated pending wiki changes under a generic message. Counter mutation is only permitted through Synapse finalization or the helper script.

### Helper modes

- `./scripts/allocate-address.sh` — atomically reserves and returns the next address.
- `./scripts/allocate-address.sh --peek` — prints the next value without reserving (safe, read-only).
- `./scripts/allocate-address.sh --rebuild` — recomputes the counter from the highest observed `c-NNNNNN` in existing frontmatter. Never resets to 1 silently if pages already have addresses. Run this if the counter file is suspected corrupt.

### Assignment procedure (per new page)

1. Before writing a new non-meta page, call `./scripts/allocate-address.sh` and capture the output only when the helper is available and works in the current OS shell.
2. Include `address: c-XXXXXX` in the page's frontmatter when you successfully reserved one. In Synapse-managed sessions, if the helper is unavailable, omit `address:` and let Synapse finalization assign it.
3. Do not edit `.raw/.manifest.json`. Keep the address in page frontmatter and include the page path in the ingest report.

### `address_map` in `.raw/.manifest.json`

```json
{
  "sources": { ... },
  "address_map": {
    "wiki/concepts/Example.md": "c-000042",
    "wiki/entities/Another.md": "c-000043"
  }
}
```

On re-ingest of the same source (whether by `--force` or a changed hash), always consult `address_map` first. If the target page path has a prior address, REUSE it. Do not allocate a new one.

On a page rename, preserve the page's `address:` frontmatter and include the new path in the ingest report. Do not edit `address_map` directly.

## Synapse Ingest Report

At the end of every successful ingest, include exactly one fenced block tagged `synapse_kb_ingest_report`:

```synapse_kb_ingest_report
{
  "schema": "synapse.kb.ingest.report.v1",
  "processed_sources": [
    {
      "source": ".raw/example.md",
      "pages_created": ["wiki/sources/example.md"],
      "pages_updated": ["wiki/index.md", "wiki/hot.md", "wiki/log.md"]
    }
  ]
}
```

Only list real `.raw/` source paths you processed and wiki `.md` pages you created or updated. Synapse ignores paths outside `.raw/` and `wiki/`.

### Exclusions (do NOT assign an address to)

- Meta files: `_index.md`, `index.md`, `log.md`, `hot.md`, `overview.md`, `dashboard.md`, `dashboard.base`, `Wiki Map.md`, `getting-started.md`.
- Fold pages under `wiki/folds/` (they use their own deterministic `fold_id`).
- Pre-rollout legacy pages (`created:` < 2026-04-23). Legacy pages get `l-NNNNNN` addresses only via a deliberate backfill operation.

### Idempotency rules

- If a page being (re)written already has an `address:` field in its current content, REUSE it. Do not allocate a new one.
- If a source is re-ingested and `address_map` has a mapping for the target path, reuse that mapping.
- If the source has been ingested before AND the target page has no address AND the page `created:` date is post-rollout, allocate an address and record it. This covers the case where an older ingest produced a page before Phase 2 rollout; the rollout cutoff still applies (pages dated pre-2026-04-23 stay legacy).

### Concurrency policy

- **Single-writer only** in Phase 2. Do not run parallel ingests from multiple Claude sessions or sub-agents that assign addresses. The address lock prevents counter corruption but does not serialize page writes themselves.
- Sub-agents (codex, general-purpose) that are dispatched for research or review MUST NOT call the allocator. They are read-only in this respect.
- Multi-writer support is a deferred feature.

### Batch ingest

Assign addresses sequentially during single-source-ingest for each source. Do not pre-reserve a block of counter values. The helper is cheap (one lock, one integer read/write).
