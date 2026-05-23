---
name: wiki-query
description: "Answer questions using the Synapse knowledge base. Use when the user asks what the wiki knows, asks based on the knowledge base, or asks to summarize, explain, compare, or find something in the wiki."
---

# wiki-query

Answer from the local wiki before using outside knowledge.

Query order:

1. Read `wiki/hot.md`.
2. Read `wiki/index.md`.
3. Read the most relevant pages under `wiki/`.
4. Follow important wikilinks only when they are needed for the answer.

Answer with concise citations using wikilinks such as `(Source: [[Page Name]])`.

If the wiki does not contain enough information, say what is missing and suggest ingesting a source. If the answer is valuable and reusable, offer to save it with the `save` workflow.
