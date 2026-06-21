---
name: defuddle
description: "Strip clutter from already available web-page content before ingesting into the wiki. Removes ads, navigation, headers, footers, and boilerplate: leaving clean readable markdown that saves 40-60% tokens. Triggers on: defuddle, clean this page, strip this page, clean web content before ingesting, strip ads, remove clutter, readable markdown from an existing source."
---

# defuddle: Web Page Cleaner

Defuddle extracts the meaningful content from a web page and drops everything else: ads, cookie banners, nav bars, related articles, footers, social sharing buttons. What remains is the article body as clean markdown.

Use this only on content that already exists as an approved Knowledge Base source or local HTML file. Do not use this skill to fetch remote URLs or write new `.raw/` files. URL source creation must go through Synapse Knowledge Base source management first, then `/wiki-ingest` can process the resulting real `.raw` source.

---

## Install

```bash
npm install -g defuddle-cli
```

Verify: `defuddle --version`

---

## Usage

### Clean a local HTML file
```bash
defuddle page.html
```

Outputs clean markdown to stdout. Use the output as read-only analysis context for the current ingest turn unless the user explicitly asks to save a structured wiki note. Do not redirect it into `.raw/`.

---

## When to Use

**Use defuddle when:**
- Processing an already-added news article, blog post, or documentation page source
- The page has a lot of surrounding content (most web pages do)
- You want to stay within token budget on a long article

**Skip defuddle when:**
- The source is already a clean markdown or PDF file
- The page is a dashboard, app, or structured data (defuddle expects article-style content)
- The URL has not been added through Synapse source management yet

---

## Fallback

If defuddle is not installed, check:

```bash
which defuddle 2>/dev/null || echo "not installed"
```

If not installed: process the existing source content directly. Do not use WebFetch as a replacement source-acquisition path.

---

## Integration with /wiki-ingest

The `/wiki-ingest` skill can use defuddle only after Synapse has already created a real `.raw` source. You do not need to run defuddle manually before ingesting a URL.

For a new remote URL:
1. Add the URL through Synapse Knowledge Base source management.
2. Run `/wiki-ingest` after Synapse reports the new `.raw` source.
