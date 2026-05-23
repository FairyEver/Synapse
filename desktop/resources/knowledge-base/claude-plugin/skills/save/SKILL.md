---
name: save
description: "Save useful conversation content into the Synapse knowledge base. Use when the user says save this, file this, keep this, save to wiki, 保存, 记下来, or 把这个存到知识库."
---

# save

Save durable conversation value into the wiki.

Choose the target:

- `wiki/questions/` for synthesized answers.
- `wiki/concepts/` for reusable ideas or frameworks.
- `wiki/meta/` for decisions or session summaries.
- `wiki/sources/` only when the saved content summarizes a concrete source.

Write frontmatter with `type`, `title`, `created`, `updated`, `tags`, and `status`. Then update `wiki/index.md`, append to `wiki/log.md`, and refresh `wiki/hot.md`.
