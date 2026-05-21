Run Knowledge Base ingest for this Synapse project.

Process source files under `.raw/` that are missing from `.raw/.manifest.json` or whose hash changed. Do not edit source files. For each changed source, create or update a source page in `wiki/sources/`, relevant concept pages in `wiki/concepts/`, relevant entity pages in `wiki/entities/`, then update `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`.

Use Markdown frontmatter with `type`, `title`, `status`, and `tags`. Use wikilinks for cross references. Report created pages, updated pages, skipped unchanged sources, and any conflicts.
