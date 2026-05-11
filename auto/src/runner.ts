import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFile } from 'fs/promises'
import type { Config } from './config.js'
import { RunLogger, pruneOldLogs } from './logger.js'

const DIVIDER = '─'.repeat(60)

export async function runOnce(config: Config): Promise<void> {
  const prompt = await readFile(config.promptFile, 'utf-8')
  const runAt = new Date()
  const logger = new RunLogger(runAt)

  console.log(`\n${DIVIDER}`)
  console.log(`[auto] Run started  ${runAt.toISOString()}`)
  console.log(`[auto] Prompt       ${config.promptFile}`)
  console.log(`[auto] Working dir  ${config.workingDirectory}`)
  console.log(`${DIVIDER}\n`)

  const start = Date.now()
  let result = 'unknown'

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: config.workingDirectory,
        permissionMode: 'bypassPermissions',
      },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if ('text' in block && block.text) {
            logger.write(block.text)
          } else if ('name' in block) {
            logger.write(`\n> **Tool:** ${(block as { name: string }).name}\n`)
          }
        }
      } else if (message.type === 'result') {
        result = (message as { subtype?: string }).subtype ?? 'done'
      }
    }
  } catch (err) {
    result = `error: ${err instanceof Error ? err.message : String(err)}`
    logger.write(`\n\n**Error:** ${result}\n`)
    console.error('[auto] Error during run:', err)
  }

  await logger.close(Date.now() - start, result)
  await pruneOldLogs(config.maxLogs)
}
