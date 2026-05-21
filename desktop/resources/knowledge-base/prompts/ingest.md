Run Knowledge Base ingest for this Synapse project.

Process source files under `.raw/` that are missing from `.raw/.manifest.json` or whose hash changed. Do not edit source files. For each changed source, create or update a source page in `wiki/sources/`, relevant concept pages in `wiki/concepts/`, relevant entity pages in `wiki/entities/`, then update `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`.

Only process the sources listed in the preflight source list. Do not scan all of `.raw/` unless the prompt explicitly says this is a force ingest.

After writing wiki pages, update `.raw/.manifest.json` for every processed source with its provided sha256 hash, an ISO `ingested_at`, `pages_created`, and `pages_updated`.

Use Markdown frontmatter with `type`, `title`, `status`, and `tags`. Use wikilinks for cross references. Report created pages, updated pages, skipped unchanged sources, and any conflicts.
