import { readFile, writeFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from './config.js'
import { runOnce } from './runner.js'
import { c, ts } from './ui.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STOP_FILE = resolve(__dirname, '..', 'state', 'stop')

async function checkStopSignal(): Promise<boolean> {
  try {
    const content = (await readFile(STOP_FILE, 'utf-8')).trim()
    if (!content) return false
    console.log(`\n${c.boldRed('●')} ${c.bold('stopped by signal:')} ${content}`)
    await writeFile(STOP_FILE, '', 'utf-8')
    return true
  } catch {
    return false
  }
}

const args = process.argv.slice(2)
const isOnce = args.includes('--once')

async function main(): Promise<void> {
  const config = await loadConfig()

  console.log(
    `${c.boldCyan('◆')} ${c.bold('auto')}  ` +
    `${c.dim('interval:')} ${c.cyan(config.intervalMinutes + 'm')}  ` +
    `${c.dim('maxLogs:')} ${c.dim(String(config.maxLogs))}`
  )

  if (isOnce) {
    console.log(`${c.dim('→')} running once ${c.dim('(--once)')}`)
    await runOnce(config)
    return
  }

  const intervalMs = config.intervalMinutes * 60_000
  console.log(
    `${c.dim('→')} scheduler started  ` +
    `${c.dim('interval after completion:')} ${c.cyan(config.intervalMinutes + 'm')}  ` +
    `${c.dim('Ctrl+C to stop')}`
  )

  let stopped = false
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  const shutdown = (() => {
    let called = false
    return () => {
      if (called) return
      called = true
      stopped = true
      if (pendingTimer) clearTimeout(pendingTimer)
      console.log(`\n${c.boldRed('●')} ${c.bold('scheduler stopped')}`)
      process.exit(0)
    }
  })()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const loop = async (): Promise<void> => {
    if (stopped) return
    if (await checkStopSignal()) return shutdown()
    await runOnce(config)
    if (stopped) return
    if (await checkStopSignal()) return shutdown()
    const next = new Date(Date.now() + intervalMs)
    console.log(`${c.dim('→')} next run at ${ts(next)}\n`)
    pendingTimer = setTimeout(loop, intervalMs)
  }

  await loop()
}

main().catch(err => {
  console.error(`${c.boldRed('✗')} fatal error:`, err)
  process.exit(1)
})
