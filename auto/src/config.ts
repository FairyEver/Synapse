import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(__dirname, '..')
export const STATE_DIR = resolve(PACKAGE_ROOT, 'state')
export const UI_CONFIG_PATH = resolve(STATE_DIR, 'ui-config.json')
export const PROMPT_PATH = resolve(PACKAGE_ROOT, 'prompt.md')

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CodexConfig {
  command: string
  model: string
  sandbox: SandboxMode
  approvalPolicy: ApprovalPolicy
  json: boolean
  disableMcp?: boolean
}

export interface UiConfig {
  prompt: string
  workingDirectory: string
  concurrency: number
  intervalMinutes: number
  timeoutMinutes: number
  maxLogs: number
  codex: CodexConfig
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  prompt: '',
  workingDirectory: PACKAGE_ROOT,
  concurrency: 1,
  intervalMinutes: 30,
  timeoutMinutes: 30,
  maxLogs: 50,
  codex: {
    command: 'codex',
    model: 'gpt-5.5',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
    disableMcp: true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be an integer >= 1`)
  }
  return Number(value)
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

function sandboxValue(value: unknown): SandboxMode {
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') {
    return value
  }
  throw new Error('codex.sandbox must be read-only, workspace-write, or danger-full-access')
}

function approvalValue(value: unknown): ApprovalPolicy {
  if (value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never') {
    return value
  }
  throw new Error('codex.approvalPolicy must be untrusted, on-failure, on-request, or never')
}

function resolveFromPackageRoot(pathValue: string): string {
  return resolve(PACKAGE_ROOT, pathValue)
}

export function validateUiConfig(raw: unknown): UiConfig {
  if (!isRecord(raw)) throw new Error('config must be an object')
  const codexRaw = isRecord(raw.codex) ? raw.codex : {}
  const merged = {
    ...DEFAULT_UI_CONFIG,
    ...raw,
    codex: {
      ...DEFAULT_UI_CONFIG.codex,
      ...codexRaw,
    },
  }

  const prompt = stringValue(merged.prompt, 'prompt')
  const workingDirectory = stringValue(merged.workingDirectory, 'workingDirectory')
  const command = stringValue(merged.codex.command, 'codex.command').trim()
  if (!command) throw new Error('codex.command is required')

  return {
    prompt,
    workingDirectory: resolveFromPackageRoot(workingDirectory),
    concurrency: positiveInteger(merged.concurrency, 'concurrency'),
    intervalMinutes: positiveInteger(merged.intervalMinutes, 'intervalMinutes'),
    timeoutMinutes: positiveInteger(merged.timeoutMinutes, 'timeoutMinutes'),
    maxLogs: positiveInteger(merged.maxLogs, 'maxLogs'),
    codex: {
      command,
      model: stringValue(merged.codex.model, 'codex.model').trim() || DEFAULT_UI_CONFIG.codex.model,
      sandbox: sandboxValue(merged.codex.sandbox),
      approvalPolicy: approvalValue(merged.codex.approvalPolicy),
      json: booleanValue(merged.codex.json, 'codex.json'),
      disableMcp: booleanValue(merged.codex.disableMcp, 'codex.disableMcp'),
    },
  }
}

async function readPromptFile(path = PROMPT_PATH): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

function uiConfigFile(config: UiConfig): Omit<UiConfig, 'prompt'> {
  return {
    workingDirectory: config.workingDirectory,
    concurrency: config.concurrency,
    intervalMinutes: config.intervalMinutes,
    timeoutMinutes: config.timeoutMinutes,
    maxLogs: config.maxLogs,
    codex: config.codex,
  }
}

async function writeFileIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, 'utf-8') === content) return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await writeFile(path, content, 'utf-8')
}

export async function loadUiConfig(path = UI_CONFIG_PATH, promptPath = PROMPT_PATH): Promise<UiConfig> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'))
    const legacyPrompt = isRecord(raw) && typeof raw.prompt === 'string' ? raw.prompt : ''
    return validateUiConfig({
      ...raw,
      prompt: await readPromptFile(promptPath) || legacyPrompt,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return validateUiConfig({ ...DEFAULT_UI_CONFIG, prompt: await readPromptFile(promptPath) })
  }
}

export async function saveUiConfig(config: unknown, path = UI_CONFIG_PATH, promptPath = PROMPT_PATH): Promise<UiConfig> {
  const validated = validateUiConfig(config)
  await mkdir(dirname(path), { recursive: true })
  await mkdir(dirname(promptPath), { recursive: true })
  await writeFileIfChanged(path, `${JSON.stringify(uiConfigFile(validated), null, 2)}\n`)
  await writeFileIfChanged(promptPath, validated.prompt)
  return validated
}

export const loadConfig = loadUiConfig
