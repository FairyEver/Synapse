import { spawn } from 'child_process'
import type { CodexConfig, UiConfig } from './config.js'
import { BatchLogger, pruneOldBatchLogs, type WorkerLogger, type SummaryWorker } from './logger.js'

export type WorkerStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout'
export type BatchStatus = 'running' | 'success' | 'partial' | 'error'

export interface WorkerResult {
  id: number
  status: WorkerStatus
  durationMs: number
  exitCode: number | null
  logPath: string
  lastMessage: string
}

export interface BatchSnapshot {
  id: string
  status: BatchStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number
  workers: WorkerResult[]
  summaryPath: string
}

export type BatchResult = BatchSnapshot & {
  status: Exclude<BatchStatus, 'running'>
  finishedAt: string
  summaryPath: string
}

export type BatchUpdate = (snapshot: BatchSnapshot) => void
export type WorkerUpdate = (worker: WorkerResult) => void

export function buildWorkerPrompt(prompt: string, workerId: number, totalWorkers: number): string {
  return [
    `你是 Codex 并行 worker ${workerId}/${totalWorkers}。`,
    '',
    '运行约束：',
    '- 你和其他 worker 正在同一个工作目录中并行执行同一个任务。',
    '- 你可以正常修改代码、运行允许的命令、按任务要求完成工作。',
    '- 不要回滚或覆盖你没有明确创建/修改的内容。',
    '- 如果你决定执行 git commit，只能 stage 和 commit 你本轮亲自修改的文件。',
    '- 不要使用 git add .。',
    '- 提交前必须检查 git diff / git status，确认没有包含其他 worker 或用户的改动。',
    '',
    '下面是用户任务：',
    '',
    prompt,
  ].join('\n')
}

export function buildCodexArgs(config: CodexConfig, workingDirectory: string): string[] {
  const args = [
    'exec',
    '--cd', workingDirectory,
  ]
  if (config.model) args.push('--model', config.model)
  args.push('--sandbox', config.sandbox)
  if (config.approvalPolicy === 'never') {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  }
  if (config.json) args.push('--json')
  args.push('-')
  return args
}

export function classifyBatchStatus(results: Array<{ status: WorkerStatus }>): Exclude<BatchStatus, 'running'> {
  if (results.every(result => result.status === 'success')) return 'success'
  if (results.some(result => result.status === 'success')) return 'partial'
  return 'error'
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string') return value
  }
  return ''
}

function itemId(record: Record<string, unknown>): string {
  const direct = stringField(record, ['item_id', 'id'])
  if (direct) return direct
  const item = record.item
  return isRecord(item) ? stringField(item, ['id']) : ''
}

function eventItemType(record: Record<string, unknown>): string {
  const direct = stringField(record, ['item_type', 'role'])
  if (direct) return direct
  const item = record.item
  return isRecord(item) ? stringField(item, ['type', 'role']) : ''
}

function isReasoningType(type: string): boolean {
  const normalized = type.toLowerCase()
  return normalized.includes('reason') || normalized.includes('thinking') || normalized.includes('thought')
}

function eventText(record: Record<string, unknown>): string {
  const direct = stringField(record, ['delta', 'text', 'message'])
  if (direct) return direct
  const item = record.item
  if (isRecord(item)) {
    return stringField(item, ['delta', 'text', 'message', 'summary'])
  }
  return ''
}

export function createCodexEventAccumulator(): { read(event: unknown): string } {
  const reasoningById = new Map<string, string>()

  return {
    read(event: unknown): string {
      if (!isRecord(event)) return ''
      const type = stringField(event, ['type'])
      const text = eventText(event)
      const kind = eventItemType(event)

      if (isReasoningType(type) || isReasoningType(kind)) {
        const id = itemId(event) || 'reasoning'
        const previous = reasoningById.get(id) ?? ''
        const next = type.includes('delta') ? previous + text : text || previous
        reasoningById.set(id, next)
        return next ? `思考过程 ${next}` : '思考过程'
      }

      if (text) return text
      if (type === 'turn.completed') return '回合完成'
      return type
    },
  }
}

function runningWorker(workerId: number, logger: WorkerLogger, startedAt: number, lastMessage: string): WorkerResult {
  return {
    id: workerId,
    status: 'running',
    durationMs: Date.now() - startedAt,
    exitCode: null,
    logPath: logger.path,
    lastMessage,
  }
}

export async function runWorker(
  config: UiConfig,
  workerId: number,
  logger: WorkerLogger,
  onUpdate?: WorkerUpdate
): Promise<WorkerResult> {
  const startedAt = Date.now()
  const args = buildCodexArgs(config.codex, config.workingDirectory)
  const child = spawn(config.codex.command, args, {
    cwd: config.workingDirectory,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let timedOut = false
  let lastMessage = ''
  let stdoutBuffer = ''
  let stderrBuffer = ''
  const eventAccumulator = createCodexEventAccumulator()

  const emitProgress = (): void => {
    onUpdate?.(runningWorker(workerId, logger, startedAt, lastMessage))
  }

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, config.timeoutMinutes * 60_000)

  child.stdin.write(buildWorkerPrompt(config.prompt, workerId, config.concurrency))
  child.stdin.end()

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    logger.writeStdout(text)
    stdoutBuffer += text
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = parseJsonLine(line)
      if (event) {
        logger.writeEvent(event)
        lastMessage = eventAccumulator.read(event) || lastMessage
      } else {
        lastMessage = line
      }
      emitProgress()
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    logger.writeStderr(text)
    stderrBuffer += text
    const lines = stderrBuffer.split(/\r?\n/)
    stderrBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) lastMessage = line
      emitProgress()
    }
  })

  const exitCode = await new Promise<number | null>(resolve => {
    child.on('error', err => {
      const message = err instanceof Error ? err.message : String(err)
      lastMessage = message
      emitProgress()
      logger.writeStderr(message)
      resolve(1)
    })
    child.on('close', code => resolve(code))
  })

  clearTimeout(timeout)
  if (!lastMessage && stderrBuffer.trim()) lastMessage = stderrBuffer.trim()
  const durationMs = Date.now() - startedAt
  const status: WorkerStatus = timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'error'
  await logger.close({ status, durationMs, exitCode })

  return {
    id: workerId,
    status,
    durationMs,
    exitCode,
    logPath: logger.path,
    lastMessage,
  }
}

function pendingWorker(id: number): WorkerResult {
  return {
    id,
    status: 'pending',
    durationMs: 0,
    exitCode: null,
    logPath: '',
    lastMessage: '',
  }
}

export async function runBatch(config: UiConfig, onUpdate?: BatchUpdate): Promise<BatchResult> {
  const started = new Date()
  const batchLogger = new BatchLogger(started)
  const workers = Array.from({ length: config.concurrency }, (_, index) => pendingWorker(index + 1))
  const snapshot = (): BatchSnapshot => ({
    id: started.toISOString(),
    status: 'running',
    startedAt: started.toISOString(),
    finishedAt: null,
    durationMs: Date.now() - started.getTime(),
    workers: workers.map(worker => ({ ...worker })),
    summaryPath: '',
  })

  onUpdate?.(snapshot())

  await Promise.all(workers.map(async (worker, index) => {
    const workerLogger = batchLogger.createWorkerLogger(worker.id)
    workers[index] = {
      ...worker,
      status: 'running',
      logPath: workerLogger.path,
    }
    onUpdate?.(snapshot())
    const result = await runWorker(config, worker.id, workerLogger, update => {
      workers[index] = update
      onUpdate?.(snapshot())
    })
    workers[index] = result
    onUpdate?.(snapshot())
  }))

  const finished = new Date()
  const status = classifyBatchStatus(workers)
  const durationMs = finished.getTime() - started.getTime()
  const summaryWorkers: SummaryWorker[] = workers.map(worker => ({
    id: worker.id,
    status: worker.status,
    durationMs: worker.durationMs,
    exitCode: worker.exitCode,
    logPath: worker.logPath,
  }))
  const summaryPath = await batchLogger.writeSummary({ status, durationMs, workers: summaryWorkers })
  await pruneOldBatchLogs(config.maxLogs)
  return {
    id: started.toISOString(),
    status,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs,
    workers,
    summaryPath,
  }
}
