import type { Dirent } from "node:fs"
import { lstat, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DragonScaleAddress } from "./dragonscale/types"

export interface AddressedWikiPage {
  readonly relativePath: string
  readonly absolutePath: string
  readonly address?: DragonScaleAddress
  readonly eligible: boolean
}

const EXCLUDED_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])

const EXCLUDED_PREFIXES = ["wiki/folds/", "wiki/meta/"]
const ROLLOUT_DATE = "2026-04-23"

export async function readAddressedWikiPages(projectPath: string): Promise<readonly AddressedWikiPage[]> {
  const root = path.resolve(projectPath)
  const wikiPath = path.join(root, "wiki")
  const pages = await walkWiki(root, wikiPath)
  return pages
    .filter((page) => page.eligible)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function insertAddressIntoWikiPage(pagePath: string, address: DragonScaleAddress): Promise<void> {
  const content = await readFile(pagePath, "utf8")
  const parsed = parseFrontmatter(content)
  if (!parsed) {
    await writeFile(pagePath, `---\naddress: ${address}\n---\n\n${content}`, "utf8")
    return
  }
  if (/^address:\s+c-[0-9]{6}\s*$/m.test(parsed.frontmatter)) return
  const nextFrontmatter = `${parsed.frontmatter.trimEnd()}\naddress: ${address}`
  await writeFile(pagePath, `---\n${nextFrontmatter}\n---${parsed.body}`, "utf8")
}

async function walkWiki(root: string, directoryPath: string): Promise<AddressedWikiPage[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const pages: AddressedWikiPage[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      pages.push(...await walkWiki(root, absolutePath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink()) continue
    const content = await readFile(absolutePath, "utf8")
    const frontmatter = parseFrontmatter(content)?.frontmatter ?? ""
    const address = frontmatter.match(/^address:\s+(c-[0-9]{6})\s*$/m)?.[1] as DragonScaleAddress | undefined
    const eligible = isEligiblePage(relativePath, frontmatter)
    pages.push({ relativePath, absolutePath, ...(address ? { address } : undefined), eligible })
  }
  return pages
}

function isEligiblePage(relativePath: string, frontmatter: string): boolean {
  if (!relativePath.startsWith("wiki/")) return false
  if (EXCLUDED_FILENAMES.has(path.basename(relativePath))) return false
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false
  const type = frontmatter.match(/^type:\s*([^ \n]+)/m)?.[1]
  if (type === "meta" || type === "fold") return false
  const created = frontmatter.match(/^created:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m)?.[1]
  if (created && created < ROLLOUT_DATE) return false
  return true
}

function parseFrontmatter(content: string): { readonly frontmatter: string; readonly body: string } | null {
  if (!content.startsWith("---\n")) return null
  const end = content.indexOf("\n---", 4)
  if (end === -1) return null
  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + "\n---".length),
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
