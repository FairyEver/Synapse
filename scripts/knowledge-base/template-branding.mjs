import { existsSync } from "node:fs"
import { readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export const SYNAPSE_KB_TEMPLATE_NAME = "synapse-knowledge-base"
export const SYNAPSE_KB_TEMPLATE_DIR = "desktop/resources/knowledge-base/synapse-knowledge-base-template"
export const LEGACY_KB_TEMPLATE_DIR = "desktop/resources/knowledge-base/claude-obsidian-template"

const ALLOWED_BRAND_PATHS = [
  /^SOURCE\.json$/,
  /^LICENSE(?:\.md)?$/,
  /^NOTICE(?:\.md)?$/,
  /^ATTRIBUTION(?:\.md)?$/,
]

const TEXT_REPLACEMENTS = [
  [/\bclaude-obsidian@claude-obsidian-marketplace\b/gi, "synapse-knowledge-base"],
  [/\bclaude-obsidian-marketplace\b/gi, "synapse-knowledge-base"],
  [/\bclaude-obsidian\b/gi, "Synapse Knowledge Base"],
  [/Claude \+ Obsidian/gi, "Synapse Knowledge Base"],
  [/Claude Code plugin and an Obsidian vault/gi, "Synapse-managed Knowledge Base runtime"],
  [/Obsidian Wiki Vault/gi, "Synapse Knowledge Base"],
]

const SAVE_WORKFLOW_REPLACEMENTS = [
  [
    /When the conversation contains long pasted source material, preserve that material under `\.raw\/saves\/` and cite the `\.raw\/\.\.\.` path from the saved wiki note\./g,
    "The save workflow writes structured wiki notes only. Do not create `.raw/` source files from the save workflow; source ingestion must go through explicit Knowledge Base source-management flows.",
  ],
  [
    /5\. \*\*Preserve raw source when applicable\*\*: if the user provided long pasted material, source notes, transcript text, or external material in the chat, write the original material unchanged to `\.raw\/saves\/\[YYYY-MM-DD\]-\[slug\]\.md` before creating the wiki page\. Do not overwrite or rewrite existing `\.raw\/` source files\./g,
    "5. **Keep save separate from source ingest**: create or update a structured wiki note from the conversation. Do not create `.raw/` source files from the save workflow; only explicit source-management or `/wiki-ingest` flows should add raw sources.",
  ],
  [
    /6\. \*\*Create\*\* the note in the correct folder with full frontmatter\. If a raw source was saved, include that `\.raw\/\.\.\.` path in `sources`\./g,
    "6. **Create** the note in the correct folder with full frontmatter. Use `sources` only for existing wiki/source references that were already part of the knowledge base.",
  ],
  [
    /\n\s*- Raw source: `\.raw\/saves\/\[YYYY-MM-DD\]-\[slug\]\.md` \(if saved\)/g,
    "",
  ],
]

export function rewritePluginManifest(manifest) {
  return {
    ...manifest,
    name: SYNAPSE_KB_TEMPLATE_NAME,
    description: "Synapse Knowledge Base managed runtime. Provides wiki, source ingestion, query, save, lint, research, canvas, and maintenance skills for Synapse-managed knowledge bases.",
    homepage: undefined,
    repository: undefined,
    keywords: ["knowledge-base", "wiki", "markdown", "synapse"],
  }
}

export function brandTemplateText(content) {
  const branded = TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    content,
  )
  return SAVE_WORKFLOW_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    branded,
  )
}

export function findDisallowedBrandHits(files) {
  const hits = []
  for (const file of files) {
    if (ALLOWED_BRAND_PATHS.some((pattern) => pattern.test(file.relativePath))) {
      continue
    }
    const match = `${file.relativePath}\n${file.content}`.match(/claude-obsidian|Claude \+ Obsidian/i)
    if (match?.[0]) {
      hits.push({ relativePath: file.relativePath, match: match[0] })
    }
  }
  return hits
}

export async function rewriteTemplateFiles(templateDir) {
  await rewritePluginFile(path.join(templateDir, ".claude-plugin", "plugin.json"))
  await writeRuntimeInstructionFiles(templateDir)
  await rewriteTextFiles(templateDir)
  await renameBrandedPaths(templateDir)
}

export async function validateTemplateBranding(templateDir) {
  const files = await readTextFiles(templateDir)
  const hits = findDisallowedBrandHits(files)
  if (hits.length > 0) {
    const summary = hits.map((hit) => `${hit.relativePath}: ${hit.match}`).join("\n")
    throw new Error(`Synapse Knowledge Base template contains upstream branding outside allowed files:\n${summary}`)
  }
}

async function rewritePluginFile(pluginPath) {
  const parsed = JSON.parse(await readFile(pluginPath, "utf8"))
  const rewritten = rewritePluginManifest(parsed)
  const withoutUndefined = Object.fromEntries(Object.entries(rewritten).filter(([, value]) => value !== undefined))
  await writeFile(pluginPath, `${JSON.stringify(withoutUndefined, null, 2)}\n`, "utf8")
}

async function writeRuntimeInstructionFiles(templateDir) {
  const runtimeInstructions = `# Synapse Knowledge Base Runtime

This directory is a Synapse-managed Knowledge Base runtime.

Use the wiki, source ingestion, query, save, lint, research, and canvas skills only for this managed knowledge base. Source files live in .raw, maintained knowledge lives in wiki, and runtime metadata lives in .vault-meta.

Do not expose the backing directory path to users. Do not treat ordinary projects as Knowledge Base runtimes.
`
  await writeFile(path.join(templateDir, "CLAUDE.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "AGENTS.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "GEMINI.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "README.md"), `# Synapse Knowledge Base Template

Developer-synced runtime template for managed Synapse Knowledge Base projects.

This directory is packaged with Synapse and copied into app-managed Knowledge Base runtime directories. It is not a user-selected project folder.
`, "utf8")
}

async function rewriteTextFiles(templateDir) {
  for (const file of await readTextFiles(templateDir)) {
    if (ALLOWED_BRAND_PATHS.some((pattern) => pattern.test(file.relativePath))) {
      continue
    }
    const branded = brandTemplateText(file.content)
    if (branded !== file.content) {
      await writeFile(path.join(templateDir, file.relativePath), branded, "utf8")
    }
  }
}

async function readTextFiles(rootDir) {
  const files = []
  await walk(rootDir, async (filePath) => {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/")
    if (!isTextFile(relativePath)) return
    const content = await readFile(filePath, "utf8")
    files.push({ relativePath, content })
  })
  return files
}

async function renameBrandedPaths(rootDir) {
  const paths = []
  await walk(rootDir, async (filePath) => {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/")
    if (/claude-obsidian/i.test(relativePath)) {
      paths.push(filePath)
    }
  })
  paths.sort((a, b) => b.length - a.length)
  for (const currentPath of paths) {
    const targetPath = path.join(
      path.dirname(currentPath),
      path.basename(currentPath).replace(/claude-obsidian/gi, SYNAPSE_KB_TEMPLATE_NAME),
    )
    if (currentPath !== targetPath && !existsSync(targetPath)) {
      await rename(currentPath, targetPath)
    }
  }
}

async function walk(dir, visit) {
  if (!existsSync(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(entryPath, visit)
    } else if (entry.isFile()) {
      await visit(entryPath)
    }
  }
}

function isTextFile(relativePath) {
  return /(^|\/)(Makefile|AGENTS|CLAUDE|GEMINI|README)$/.test(relativePath)
    || /\.(json|md|mdc|txt|sh|py|base|canvas|css|yml|yaml)$/.test(relativePath)
}
