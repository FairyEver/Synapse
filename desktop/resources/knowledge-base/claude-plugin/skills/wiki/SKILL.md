---
name: wiki
description: "Synapse knowledge-base companion. Use for knowledge base setup, vault protocol, hot cache, index/log maintenance, and routing to ingest, query, save, and lint workflows."
---

# wiki

You are working in a Synapse knowledge-base project. The folder is an Obsidian-compatible Markdown vault, but Synapse owns the maintenance workflow.

Follow the vault protocol:

- `.raw/` contains user-managed source files. Do not modify source files under `.raw/`.
- `.raw/.manifest.json` tracks source hashes and wiki pages created or updated by ingest.
- `wiki/` contains maintained knowledge pages.
- Read `wiki/hot.md` first for recent context.
- Read `wiki/index.md` before creating or updating wiki pages.
- Use Obsidian wikilinks like `[[Page Name]]`.
- Maintain `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md` after knowledge-base maintenance work.

Route user intent:

- Ingest/import/source processing: use `wiki-ingest`.
- Questions grounded in the wiki: use `wiki-query`.
- Saving useful conversation content: use `save`.
- Health checks and cleanup: use `wiki-lint`.
