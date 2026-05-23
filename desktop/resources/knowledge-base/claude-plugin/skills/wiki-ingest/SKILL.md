---
name: wiki-ingest
description: "Ingest sources into the Synapse knowledge base. Use when the user says ingest, process this source, add this to the wiki, read and file this, batch ingest, 汲取知识, 提取知识, 入库, 导入, 处理这些来源, 把这些资料整理进知识库."
---

# wiki-ingest

Use the Synapse knowledge-base ingest protocol.

Before ingest:

1. Read `.raw/.manifest.json` if it exists.
2. Read `wiki/hot.md` and `wiki/index.md`.
3. Prefer processing changed or untracked sources from `.raw/`.
4. Do not modify source files under `.raw/` except `.raw/.manifest.json`.

During ingest:

- Create or update source summaries under `wiki/sources/`.
- Create or update concepts under `wiki/concepts/`.
- Create or update entities under `wiki/entities/`.
- Use frontmatter with `type`, `title`, `status`, and `tags`.
- Use Obsidian wikilinks for cross-references.
- Resolve existing pages through `wiki/index.md`, `Glob`, or `Grep` before assuming file paths.

After ingest:

- Update `wiki/index.md`.
- Update `wiki/hot.md`.
- Append a new entry near the top of `wiki/log.md`.
- Update `.raw/.manifest.json` using the claude-obsidian compatible shape: `version`, `created`, `description`, `sources`, and `address_map`.
- For each processed source, record `hash`, `ingested_at`, `pages_created`, and `pages_updated` when those facts are available.

If Synapse prepends an internal `/wiki ingest` prompt with prechecked source hashes, follow that prompt exactly.
