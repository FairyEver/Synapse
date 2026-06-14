import { createWriteStream, mkdirSync } from 'fs'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WriteStream } from 'fs'
import { stripAnsi, c } from './ui.js'
import { redactSensitiveText } from './redact.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const LOGS_DIR = resolve(__dirname, '../logs')

export type WorkerLogResult = {
  status: string
  durationMs: number
  exitCode?: number | null
}

export type SummaryWorker = WorkerLogResult & {
  id: number
  logPath: string
}

export type BatchSummary = {
  status: string
  durationMs: number
  workers: SummaryWorker[]
  totals?: {
    started: number
    success: number
    error: number
    timeout: number
  }
}

function formatTs(date: Date): string {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '')
}

export class WorkerLogger {
  private stream: WriteStream
  readonly path: string

  constructor(batchPath: string, workerId: number, sequence?: number) {
    const fileName = sequence === undefined
      ? `worker-${workerId}`
      : `slot-${workerId}-run-${String(sequence).padStart(4, '0')}`
    this.path = join(batchPath, `${fileName}.md`)
    this.stream = createWriteStream(this.path, { flags: 'w' })
    this.stream.write(sequence === undefined
      ? `# Worker ${workerId}\n\n`
      : `# Slot ${workerId} Run ${sequence}\n\n`)
  }

  writeStdout(text: string): void {
    this.stream.write(redactSensitiveText(stripAnsi(text)))
  }

  writeStderr(text: string): void {
    this.stream.write(`\n\n**stderr**\n\n${redactSensitiveText(stripAnsi(text))}\n`)
  }

  writeEvent(event: unknown): void {
    this.stream.write(`\n\n\`\`\`json\n${redactSensitiveText(JSON.stringify(event, null, 2))}\n\`\`\`\n`)
  }

  async close(result: WorkerLogResult): Promise<void> {
    this.stream.write(
      `\n\n---\n**Duration:** ${(result.durationMs / 1000).toFixed(1)}s | ` +
      `**Status:** ${result.status} | **Exit:** ${result.exitCode ?? 'n/a'}\n`
    )
    await new Promise<void>((res, rej) => {
      this.stream.end((err: Error | null | undefined) => (err ? rej(err) : res()))
    })
  }
}

export class BatchLogger {
  readonly path: string

  constructor(runAt: Date, logsDir = LOGS_DIR) {
    this.path = join(logsDir, formatTs(runAt))
    mkdirSync(this.path, { recursive: true })
  }

  createWorkerLogger(workerId: number, sequence?: number): WorkerLogger {
    return new WorkerLogger(this.path, workerId, sequence)
  }

  async writeSummary(summary: BatchSummary): Promise<string> {
    const lines = [
      '# Batch Summary',
      '',
      `**Status:** ${summary.status}`,
      `**Duration:** ${(summary.durationMs / 1000).toFixed(1)}s`,
      '',
      ...(summary.totals ? [
        `**Started:** ${summary.totals.started}`,
        `**Success:** ${summary.totals.success}`,
        `**Error:** ${summary.totals.error}`,
        `**Timeout:** ${summary.totals.timeout}`,
        '',
      ] : []),
      '| Worker | Status | Duration | Exit | Log |',
      '|---:|---|---:|---:|---|',
      ...summary.workers.map(worker =>
        `| ${worker.id} | ${worker.status} | ${(worker.durationMs / 1000).toFixed(1)}s | ${worker.exitCode ?? ''} | ${worker.logPath} |`
      ),
      '',
    ]
    const path = join(this.path, 'summary.md')
    await writeFile(path, lines.join('\n'), 'utf-8')
    return path
  }
}

export async function pruneOldBatchLogs(maxLogs: number, logsDir = LOGS_DIR): Promise<void> {
  await mkdir(logsDir, { recursive: true })
  const entries = await readdir(logsDir, { withFileTypes: true })
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const excess = dirs.length - maxLogs
  if (excess <= 0) return
  for (const dir of dirs.slice(0, excess)) {
    await rm(join(logsDir, dir), { recursive: true, force: true })
  }
  console.log(`${c.dim('→')} pruned ${excess} old batch log(s)`)
}
