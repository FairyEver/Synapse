export interface TokenBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

export interface UnifiedMessage {
  client: string
  modelId: string
  providerId: string
  sessionId: string
  workspaceKey?: string
  workspaceLabel?: string
  timestamp: number
  date: string
  tokens: TokenBreakdown
  cost: number
  messageCount: number
  agent?: string
  dedupKey?: string
  isTurnStart: boolean
}

export interface AgentParser {
  parseFile(filePath: string): Promise<UnifiedMessage[]>
}

export type PathRoot = "home" | "xdgData" | "config" | "envVar"

export interface ClientDef {
  id: string
  name: string
  root: PathRoot
  envVar?: string
  fallbackRelative?: string
  relativePath: string
  filePattern: string
  parseLocal: boolean
}

export interface ScanResult {
  clientId: string
  files: string[]
}

export interface FileFingerprint {
  filePath: string
  clientId: string
  size: number
  mtimeMs: number
  bytesParsed: number
}

export interface DailyContribution {
  date: string
  totals: { tokens: number; cost: number; messages: number }
  intensity: 0 | 1 | 2 | 3 | 4
  tokenBreakdown: TokenBreakdown
  clients: ClientContribution[]
}

export interface ClientContribution {
  client: string
  modelId: string
  providerId: string
  tokens: TokenBreakdown
  cost: number
  messages: number
}

export interface DataSummary {
  totalTokens: number
  totalCost: number
  totalDays: number
  activeDays: number
  averagePerDay: number
  maxCostInSingleDay: number
  clients: string[]
  models: string[]
}

export interface ModelUsage {
  client: string
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  cost: number
}

export interface HourlyUsage {
  hour: string
  clients: string[]
  models: string[]
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  turnCount: number
  cost: number
}

export interface GraphResult {
  meta: { generatedAt: string; processingTimeMs: number }
  summary: DataSummary
  years: { year: string; totalTokens: number; totalCost: number }[]
  contributions: DailyContribution[]
}

export interface ScanProgress {
  totalClients: number
  scannedClients: number
  totalFiles: number
  parsedFiles: number
  newMessages: number
  elapsedMs: number
}

export function emptyBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

export function totalTokens(b: TokenBreakdown): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
}
