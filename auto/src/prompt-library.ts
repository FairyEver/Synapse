import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, extname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(__dirname, '..')
export const PROMPTS_DIR = resolve(PACKAGE_ROOT, 'prompts')
export const LEGACY_PROMPT_PATH = resolve(PACKAGE_ROOT, 'prompt.md')

export interface PromptLibraryPaths {
  promptsDir?: string
  legacyPromptPath?: string
}

export interface PromptLibraryState {
  activePromptName: string
  prompts: string[]
  prompt: string
}

const INVALID_PROMPT_NAME = /[\\/:*?"<>|]/

function promptsRoot(paths: PromptLibraryPaths = {}): string {
  return paths.promptsDir ?? PROMPTS_DIR
}

function legacyPrompt(paths: PromptLibraryPaths = {}): string {
  return paths.legacyPromptPath ?? LEGACY_PROMPT_PATH
}

function assertInside(root: string, path: string): void {
  const relativePath = relative(root, path)
  if (relativePath.startsWith('..') || resolve(path) === resolve(root)) {
    throw new Error('Invalid prompt path')
  }
}

export function validatePromptName(name: string, existingNames: string[] = []): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Prompt name is required')
  if (trimmed === '.' || trimmed === '..') throw new Error('Prompt name is invalid')
  if (trimmed.endsWith('.md')) throw new Error('Prompt name must not end with .md')
  if (INVALID_PROMPT_NAME.test(trimmed)) throw new Error('Prompt name contains invalid characters')
  if (existingNames.includes(trimmed)) throw new Error('Prompt name already exists')
  return trimmed
}

function promptPath(name: string, paths: PromptLibraryPaths = {}, existingNames: string[] = []): string {
  const safeName = validatePromptName(name, existingNames)
  const root = resolve(promptsRoot(paths))
  const path = resolve(root, `${safeName}.md`)
  assertInside(root, path)
  return path
}

async function readLegacyPrompt(paths: PromptLibraryPaths = {}): Promise<string> {
  try {
    return await readFile(legacyPrompt(paths), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

async function ensurePromptsDir(paths: PromptLibraryPaths = {}): Promise<void> {
  await mkdir(promptsRoot(paths), { recursive: true })
}

export async function listPromptNames(promptsDir = PROMPTS_DIR): Promise<string[]> {
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && extname(entry.name) === '.md')
      .map(entry => basename(entry.name, '.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function readPrompt(name: string, paths: PromptLibraryPaths = {}): Promise<string> {
  return readFile(promptPath(name, paths), 'utf-8')
}

export async function writePrompt(name: string, content: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  await writeFile(promptPath(name, paths), content, 'utf-8')
}

export async function createPrompt(name: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  const existing = await listPromptNames(promptsRoot(paths))
  await writeFile(promptPath(name, paths, existing), '', 'utf-8')
}

export async function renamePrompt(fromName: string, toName: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  const existing = await listPromptNames(promptsRoot(paths))
  if (!existing.includes(fromName)) throw new Error('Prompt not found')
  await rename(promptPath(fromName, paths), promptPath(toName, paths, existing))
}

export async function deletePrompt(name: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await rm(promptPath(name, paths), { force: false })
}

export async function ensurePromptLibrary(
  paths: PromptLibraryPaths = {},
  preferredPromptName = ''
): Promise<PromptLibraryState> {
  await ensurePromptsDir(paths)
  let prompts = await listPromptNames(promptsRoot(paths))

  if (prompts.length === 0) {
    const legacy = await readLegacyPrompt(paths)
    await writePrompt('default', legacy, paths)
    prompts = ['default']
  }

  const activePromptName = preferredPromptName && prompts.includes(preferredPromptName)
    ? preferredPromptName
    : prompts[0]

  return {
    activePromptName,
    prompts,
    prompt: await readPrompt(activePromptName, paths),
  }
}
