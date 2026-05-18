import { startServer, runSavedConfigOnce } from './server.js'
import { c } from './ui.js'

const args = process.argv.slice(2)
const isOnce = args.includes('--once')

async function main(): Promise<void> {
  if (isOnce) {
    await runSavedConfigOnce()
    return
  }

  const { server } = await startServer()

  const shutdown = (() => {
    let called = false
    return () => {
      if (called) return
      called = true
      server.close(() => {
        console.log(`\n${c.boldRed('●')} ${c.bold('server stopped')}`)
        process.exit(0)
      })
    }
  })()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error(`${c.boldRed('✗')} fatal error:`, err)
  process.exit(1)
})
