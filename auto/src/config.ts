import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..')

export interface Config {
  intervalMinutes: number
  timeoutMinutes: number
  workingDirectory: string
  promptFile: string
  maxLogs: number
}

const DEFAULTS: Config = {
  intervalMinutes: 30,
  timeoutMinutes: 30,
  workingDirectory: PACKAGE_ROOT,
  promptFile: './prompt.md',
  maxLogs: 50,
}

export async function loadConfig(): Promise<Config> {
  const configPath = resolve(PACKAGE_ROOT, 'config.json')
  let raw: Partial<Config> = {}
  try {
    raw = JSON.parse(await readFile(configPath, 'utf-8'))
  } catch {
    throw new Error(`Failed to load config from ${configPath}`)
  }

  const config: Config = { ...DEFAULTS, ...raw }

  if (config.intervalMinutes < 1) throw new Error('intervalMinutes must be >= 1')
  if (config.timeoutMinutes < 1) throw new Error('timeoutMinutes must be >= 1')
  if (!config.workingDirectory) throw new Error('workingDirectory is required')
  if (!config.promptFile) throw new Error('promptFile is required')

  config.workingDirectory = resolve(PACKAGE_ROOT, config.workingDirectory)
  config.promptFile = resolve(PACKAGE_ROOT, config.promptFile)

  return config
}
