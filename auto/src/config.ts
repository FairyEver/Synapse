import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ensurePromptLibrary, listPromptNames, writePrompt, PROMPTS_DIR } from './prompt-library.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(__dirname, '..')
export const STATE_DIR = resolve(PACKAGE_ROOT, 'state')
export const UI_CONFIG_PATH = resolve(STATE_DIR, 'ui-config.json')
export const PROMPT_PATH = resolve(PACKAGE_ROOT, 'prompt.md')
export const MAX_CONCURRENCY = 20
export const MAX_TIMEOUT_MINUTES = 240
export const MAX_LOGS = 500

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'
export type Provider = 'codex' | 'claude-code'

export interface CodexConfig {
  command: string
  model: string
  sandbox: SandboxMode
  approvalPolicy: ApprovalPolicy
  json: boolean
  disableMcp?: boolean
}

export interface ClaudeCodeConfig {
  command: string
  model: string
  dangerouslySkipPermissions: boolean
  outputFormat: 'json' | 'stream-json' | 'text'
  maxTurns: number
  systemPrompt: string
}

export interface UiConfig {
  prompt: string
  activePromptName: string
  prompts: string[]
  workingDirectory: string
  concurrency: number
  timeoutMinutes: number
  maxLogs: number
  provider: Provider
  codex: CodexConfig
  claudeCode: ClaudeCodeConfig
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  prompt: '',
  activePromptName: 'default',
  prompts: [],
  workingDirectory: PACKAGE_ROOT,
  concurrency: 1,
  timeoutMinutes: 30,
  maxLogs: 50,
  provider: 'codex',
  codex: {
    command: 'codex',
    model: 'gpt-5.6-sol',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
    disableMcp: true,
  },
  claudeCode: {
    command: 'claude',
    model: 'sonnet',
    dangerouslySkipPermissions: true,
    outputFormat: 'stream-json',
    maxTurns: 30,
    systemPrompt: '',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown, name: string, max?: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be an integer >= 1`)
  }
  const nextValue = Number(value)
  if (max !== undefined && nextValue > max) {
    throw new Error(`${name} must be <= ${max}`)
  }
  return nextValue
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

function providerValue(value: unknown): Provider {
  if (value === 'codex' || value === 'claude-code') return value
  return 'codex'
}

function outputFormatValue(value: unknown): ClaudeCodeConfig['outputFormat'] {
  if (value === 'json' || value === 'stream-json' || value === 'text') return value
  return 'stream-json'
}

export function validateUiConfig(raw: unknown): UiConfig {
  if (!isRecord(raw)) throw new Error('config must be an object')
  const codexRaw = isRecord(raw.codex) ? raw.codex : {}
  const claudeCodeRaw = isRecord(raw.claudeCode) ? raw.claudeCode : {}
  const merged = {
    ...DEFAULT_UI_CONFIG,
    ...raw,
    codex: {
      ...DEFAULT_UI_CONFIG.codex,
      ...codexRaw,
    },
    claudeCode: {
      ...DEFAULT_UI_CONFIG.claudeCode,
      ...claudeCodeRaw,
    },
  }

  const prompt = stringValue(merged.prompt, 'prompt')
  const activePromptName = stringValue(merged.activePromptName, 'activePromptName').trim() || DEFAULT_UI_CONFIG.activePromptName
  const prompts = Array.isArray(merged.prompts)
    ? merged.prompts.filter((name): name is string => typeof name === 'string')
    : []
  const workingDirectory = stringValue(merged.workingDirectory, 'workingDirectory')
  const provider = providerValue(merged.provider)
  const codexCommand = stringValue(merged.codex.command, 'codex.command').trim()
  if (!codexCommand) throw new Error('codex.command is required')
  const claudeCommand = stringValue(merged.claudeCode.command, 'claudeCode.command').trim()
  if (!claudeCommand) throw new Error('claudeCode.command is required')

  return {
    prompt,
    activePromptName,
    prompts,
    workingDirectory: resolveFromPackageRoot(workingDirectory),
    concurrency: positiveInteger(merged.concurrency, 'concurrency', MAX_CONCURRENCY),
    timeoutMinutes: positiveInteger(merged.timeoutMinutes, 'timeoutMinutes', MAX_TIMEOUT_MINUTES),
    maxLogs: positiveInteger(merged.maxLogs, 'maxLogs', MAX_LOGS),
    provider,
    codex: {
      command: codexCommand,
      model: stringValue(merged.codex.model, 'codex.model').trim() || DEFAULT_UI_CONFIG.codex.model,
      sandbox: sandboxValue(merged.codex.sandbox),
      approvalPolicy: approvalValue(merged.codex.approvalPolicy),
      json: booleanValue(merged.codex.json, 'codex.json'),
      disableMcp: booleanValue(merged.codex.disableMcp, 'codex.disableMcp'),
    },
    claudeCode: {
      command: claudeCommand,
      model: stringValue(merged.claudeCode.model, 'claudeCode.model').trim() || DEFAULT_UI_CONFIG.claudeCode.model,
      dangerouslySkipPermissions: typeof merged.claudeCode.dangerouslySkipPermissions === 'boolean'
        ? merged.claudeCode.dangerouslySkipPermissions
        : DEFAULT_UI_CONFIG.claudeCode.dangerouslySkipPermissions,
      outputFormat: outputFormatValue(merged.claudeCode.outputFormat),
      maxTurns: typeof merged.claudeCode.maxTurns === 'number' && merged.claudeCode.maxTurns >= 1
        ? merged.claudeCode.maxTurns
        : DEFAULT_UI_CONFIG.claudeCode.maxTurns,
      systemPrompt: typeof merged.claudeCode.systemPrompt === 'string'
        ? merged.claudeCode.systemPrompt
        : DEFAULT_UI_CONFIG.claudeCode.systemPrompt,
    },
  }
}

function uiConfigFile(config: UiConfig): Omit<UiConfig, 'prompt' | 'prompts'> {
  return {
    activePromptName: config.activePromptName,
    workingDirectory: config.workingDirectory,
    concurrency: config.concurrency,
    timeoutMinutes: config.timeoutMinutes,
    maxLogs: config.maxLogs,
    provider: config.provider,
    codex: config.codex,
    claudeCode: config.claudeCode,
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

export async function loadUiConfig(
  path = UI_CONFIG_PATH,
  promptPath = PROMPT_PATH,
  promptsDir = PROMPTS_DIR
): Promise<UiConfig> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'))
    const activePromptName = isRecord(raw) && typeof raw.activePromptName === 'string' ? raw.activePromptName : ''
    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath: promptPath }, activePromptName)
    return validateUiConfig({
      ...raw,
      prompt: library.prompt,
      activePromptName: library.activePromptName,
      prompts: library.prompts,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath: promptPath })
    return validateUiConfig({
      ...DEFAULT_UI_CONFIG,
      prompt: library.prompt,
      activePromptName: library.activePromptName,
      prompts: library.prompts,
    })
  }
}

export async function saveUiConfig(
  config: unknown,
  path = UI_CONFIG_PATH,
  promptPath = PROMPT_PATH,
  promptsDir = PROMPTS_DIR
): Promise<UiConfig> {
  const validated = validateUiConfig(config)
  const existingPrompts = await listPromptNames(promptsDir)
  if (!existingPrompts.includes(validated.activePromptName)) {
    throw new Error('Active prompt not found')
  }
  await mkdir(dirname(path), { recursive: true })
  await writePrompt(validated.activePromptName, validated.prompt, { promptsDir, legacyPromptPath: promptPath })
  const prompts = await listPromptNames(promptsDir)
  const saved = validateUiConfig({ ...validated, prompts })
  await writeFileIfChanged(path, `${JSON.stringify(uiConfigFile(saved), null, 2)}\n`)
  return saved
}

export const loadConfig = loadUiConfig
