import test from "node:test"
import assert from "node:assert/strict"

import {
  SYNAPSE_KB_TEMPLATE_NAME,
  brandTemplateText,
  findDisallowedBrandHits,
  rewritePluginManifest,
} from "../lib/synapse-knowledge-base-template-branding.mjs"

test("rewritePluginManifest gives the runtime a Synapse identity", () => {
  const rewritten = rewritePluginManifest({
    name: "claude-obsidian",
    version: "1.6.0",
    description: "Claude + Obsidian knowledge companion.",
    homepage: "https://github.com/AgriciDaniel/claude-obsidian",
    repository: "https://github.com/AgriciDaniel/claude-obsidian",
    keywords: ["obsidian", "knowledge-base", "wiki"],
  })

  assert.equal(rewritten.name, SYNAPSE_KB_TEMPLATE_NAME)
  assert.equal(rewritten.version, "1.6.0")
  assert.match(rewritten.description, /Synapse Knowledge Base/)
  assert.equal(rewritten.homepage, undefined)
  assert.equal(rewritten.repository, undefined)
  assert.deepEqual(rewritten.keywords, ["knowledge-base", "wiki", "markdown", "synapse"])
})

test("brandTemplateText replaces upstream runtime branding", () => {
  const input = [
    "# claude-obsidian - Claude + Obsidian Wiki Vault",
    "Install with claude-obsidian@claude-obsidian-marketplace.",
    "The claude-obsidian runtime keeps wiki notes.",
  ].join("\n")

  const output = brandTemplateText(input)

  assert.match(output, /# Synapse Knowledge Base/)
  assert.match(output, /Synapse Knowledge Base runtime keeps wiki notes/)
  assert.doesNotMatch(output, /claude-obsidian/)
  assert.doesNotMatch(output, /Claude \+ Obsidian/)
})

test("findDisallowedBrandHits ignores source and license files only", () => {
  const hits = findDisallowedBrandHits([
    {
      relativePath: "SOURCE.json",
      content: "https://github.com/AgriciDaniel/claude-obsidian",
    },
    {
      relativePath: "LICENSE",
      content: "claude-obsidian attribution",
    },
    {
      relativePath: "skills/wiki/SKILL.md",
      content: "Use claude-obsidian here",
    },
    {
      relativePath: "wiki/sources/claude-obsidian-ecosystem.md",
      content: "Synapse Knowledge Base",
    },
    {
      relativePath: "CLAUDE.md",
      content: "Synapse Knowledge Base",
    },
  ])

  assert.deepEqual(hits, [{
    relativePath: "skills/wiki/SKILL.md",
    match: "claude-obsidian",
  }, {
    relativePath: "wiki/sources/claude-obsidian-ecosystem.md",
    match: "claude-obsidian",
  }])
})
