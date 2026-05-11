import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFile } from 'fs/promises'
import type { Config } from './config.js'
import { RunLogger, pruneOldLogs } from './logger.js'
import { c, box, Spinner, formatToolCall, ts, dur } from './ui.js'

export async function runOnce(config: Config): Promise<void> {
  const prompt = await readFile(config.promptFile, 'utf-8')
  const runAt = new Date()
  const logger = new RunLogger(runAt)
  const spinner = new Spinner()

  process.stdout.write('\n')
  console.log(box([
    `${c.boldCyan('◆ Auto Agent')}   ${ts(runAt)}`,
    `${c.dim('working dir:')}  ${c.yellow(config.workingDirectory)}`,
    `${c.dim('prompt:     ')}  ${c.dim(config.promptFile)}`,
  ]))
  process.stdout.write('\n')

  const start = Date.now()
  let result = 'unknown'
  let toolCount = 0

  spinner.start('Thinking…')

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
            spinner.stop()
            process.stdout.write(block.text)
            logger.writeFile(block.text)
          } else if ('name' in block) {
            spinner.stop()
            toolCount++
            const tb = block as { name: string; input?: Record<string, unknown> }
            const formatted = formatToolCall(tb.name, tb.input ?? {})
            process.stdout.write(formatted)
            logger.writeFile(`\n> **Tool:** ${tb.name}\n`)
            spinner.start(`Running ${tb.name}…`)
          }
        }
      } else if (message.type === 'result') {
        result = (message as { subtype?: string }).subtype ?? 'done'
      }
    }
  } catch (err) {
    spinner.stop()
    result = `error: ${err instanceof Error ? err.message : String(err)}`
    const errLine = `\n${c.boldRed('✗')} ${c.red(result)}\n`
    process.stdout.write(errLine)
    logger.writeFile(`\n\n**Error:** ${result}\n`)
  }

  spinner.stop()

  const elapsed = Date.now() - start
  const isError = result.startsWith('error')
  const icon = isError ? c.boldRed('✗') : c.boldGreen('✓')
  const resultText = isError ? c.red(result) : c.green(result)
  const tools = toolCount > 0 ? `  ${c.dim('tools:')} ${c.cyan(String(toolCount))}` : ''

  process.stdout.write('\n')
  console.log(`${icon} ${c.bold('done')}  ${dur(elapsed)}${tools}  ${c.dim('result:')} ${resultText}`)

  await logger.close(elapsed, result)
  await pruneOldLogs(config.maxLogs)
}
