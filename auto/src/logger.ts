import { createWriteStream, mkdirSync } from 'fs'
import { readdir, unlink, mkdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WriteStream } from 'fs'
import { stripAnsi, c } from './ui.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const LOGS_DIR = resolve(__dirname, '../logs')

function formatTs(date: Date): string {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '').replace('T', 'T')
}

export class RunLogger {
  private stream: WriteStream
  readonly path: string

  constructor(runAt: Date) {
    const ts = formatTs(runAt)
    this.path = join(LOGS_DIR, `${ts}.md`)
    mkdirSync(LOGS_DIR, { recursive: true })
    this.stream = createWriteStream(this.path, { flags: 'w' })
    this.stream.write(`# Run ${runAt.toISOString()}\n\n`)
  }

  /** Write text to log file only (ANSI codes stripped). stdout is managed by caller. */
  writeFile(text: string): void {
    this.stream.write(stripAnsi(text))
  }

  async close(durationMs: number, result: string): Promise<void> {
    const footer = `\n\n---\n**Duration:** ${(durationMs / 1000).toFixed(1)}s | **Result:** ${result}\n`
    this.stream.write(footer)
    await new Promise<void>((res, rej) => {
      this.stream.end((err: Error | null | undefined) => (err ? rej(err) : res()))
    })
    console.log(`${c.dim('→')} log saved  ${c.dim(this.path)}`)
  }
}

export async function pruneOldLogs(maxLogs: number): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true })
  const files = (await readdir(LOGS_DIR))
    .filter(f => f.endsWith('.md'))
    .sort()
  const excess = files.length - maxLogs
  if (excess > 0) {
    for (const f of files.slice(0, excess)) {
      await unlink(join(LOGS_DIR, f))
    }
    console.log(`[auto] Pruned ${excess} old log(s).`)
  }
}
