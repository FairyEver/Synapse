---
name: wiki-lint
description: "Health check the Synapse knowledge base. Use when the user says lint, health check, clean up wiki, check the wiki, wiki audit, 找孤儿页, 检查知识库, or 清理知识库."
---

# wiki-lint

Scan the wiki and write a lint report under `wiki/meta/`.

Check:

- Missing or malformed frontmatter.
- Dead wikilinks.
- Orphan pages.
- Stale `wiki/index.md` entries.
- Empty sections.
- Repeated concepts or entities that should be linked or merged.
- `.raw/.manifest.json` entries that do not match existing wiki pages.

Do not auto-fix destructive changes. Report findings with suggested fixes and update `wiki/log.md` with the lint run.
