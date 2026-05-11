import { loadConfig } from './config.js'
import { runOnce } from './runner.js'

const args = process.argv.slice(2)
const isOnce = args.includes('--once')

async function main(): Promise<void> {
  const config = await loadConfig()

  console.log('[auto] Config loaded:', {
    intervalMinutes: config.intervalMinutes,
    workingDirectory: config.workingDirectory,
    promptFile: config.promptFile,
    maxLogs: config.maxLogs,
  })

  if (isOnce) {
    console.log('[auto] Running once (--once)')
    await runOnce(config)
    return
  }

  const intervalMs = config.intervalMinutes * 60_000
  console.log(`[auto] Scheduler started — interval: ${config.intervalMinutes}m — Ctrl+C to stop`)

  let busy = false

  const tick = async (): Promise<void> => {
    if (busy) {
      console.log('[auto] Previous run still in progress, skipping this tick.')
      return
    }
    busy = true
    try {
      await runOnce(config)
    } finally {
      busy = false
      const next = new Date(Date.now() + intervalMs)
      console.log(`[auto] Next run at: ${next.toISOString()}`)
    }
  }

  await tick()

  const intervalId = setInterval(tick, intervalMs)

  const shutdown = (() => {
    let called = false
    return () => {
      if (called) return
      called = true
      clearInterval(intervalId)
      console.log('\n[auto] Scheduler stopped.')
      process.exit(0)
    }
  })()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[auto] Fatal error:', err)
  process.exit(1)
})
