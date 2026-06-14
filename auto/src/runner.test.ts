import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { BatchLogger } from './logger.js'
import { buildClaudeCodeArgs, buildCodexArgs, buildWorkerPrompt, classifyBatchStatus, createClaudeCodeEventAccumulator, createCodexEventAccumulator, runBatch, runWorker, type OutputLine } from './runner.js'
import type { UiConfig } from './config.js'
import { DEFAULT_UI_CONFIG } from './config.js'

test('buildWorkerPrompt prepends worker identity and git commit constraint', () => {
  const prompt = buildWorkerPrompt('原始任务', 2, 5)
  assert.match(prompt, /worker 2\/5/)
  assert.match(prompt, /只能 stage 和 commit 你本轮亲自修改的文件/)
  assert.match(prompt, /原始任务/)
})

test('buildCodexArgs maps never approval to exec bypass flag', () => {
  const args = buildCodexArgs({
    command: 'codex',
    model: '',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
  }, '/tmp/work')

  assert.deepEqual(args, [
    'exec',
    '--cd', '/tmp/work',
    '-c', 'mcp_servers={}',
    '--sandbox', 'danger-full-access',
    '--dangerously-bypass-approvals-and-sandbox',
    '--json',
    '-',
  ])
})

test('buildCodexArgs includes model when configured', () => {
  const args = buildCodexArgs({
    command: 'codex',
    model: 'gpt-test',
    sandbox: 'workspace-write',
    approvalPolicy: 'never',
    json: false,
    disableMcp: false,
  }, '/tmp/work')

  assert.deepEqual(args, [
    'exec',
    '--cd', '/tmp/work',
    '--model', 'gpt-test',
    '--sandbox', 'workspace-write',
    '--dangerously-bypass-approvals-and-sandbox',
    '-',
  ])
})

test('buildCodexArgs disables global MCP servers by default', () => {
  const args = buildCodexArgs({
    command: 'codex',
    model: 'gpt-test',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
    disableMcp: true,
  }, '/tmp/work')

  assert.deepEqual(args.slice(0, 9), [
    'exec',
    '--cd', '/tmp/work',
    '--model', 'gpt-test',
    '-c', 'mcp_servers={}',
    '--sandbox', 'danger-full-access',
  ])
})

test('buildClaudeCodeArgs builds correct args with all options', () => {
  const args = buildClaudeCodeArgs({
    command: 'claude',
    model: 'opus',
    dangerouslySkipPermissions: true,
    outputFormat: 'stream-json',
    maxTurns: 30,
    systemPrompt: 'be concise',
  }, '/tmp/work', 'fix the bug')

  assert.deepEqual(args, [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--max-turns', '30',
    '--model', 'opus',
    '--dangerously-skip-permissions',
    '--system-prompt', 'be concise',
    'fix the bug',
  ])
  // always stream-json regardless of config.outputFormat
  const textArgs = buildClaudeCodeArgs({
    command: 'claude', model: 'opus', dangerouslySkipPermissions: false,
    outputFormat: 'text', maxTurns: 10, systemPrompt: '',
  }, '/tmp/work', 'test')
  assert.ok(textArgs.includes('stream-json'))
  assert.ok(!textArgs.includes('text'))
})

test('buildClaudeCodeArgs omits optional flags when disabled', () => {
  const args = buildClaudeCodeArgs({
    command: 'claude',
    model: 'sonnet',
    dangerouslySkipPermissions: false,
    outputFormat: 'json',
    maxTurns: 10,
    systemPrompt: '',
  }, '/tmp/work', 'hello')

  assert.ok(!args.includes('--dangerously-skip-permissions'))
  assert.ok(!args.includes('--system-prompt'))
  assert.ok(args.includes('hello'))
})

test('classifyBatchStatus distinguishes success partial and error', () => {
  assert.equal(classifyBatchStatus([{ status: 'success' }]), 'success')
  assert.equal(classifyBatchStatus([{ status: 'success' }, { status: 'error' }]), 'partial')
  assert.equal(classifyBatchStatus([{ status: 'timeout' }, { status: 'error' }]), 'error')
})

test('createCodexEventAccumulator appends reasoning deltas for one item', () => {
  const accumulator = createCodexEventAccumulator()
  assert.equal(accumulator.read({
    type: 'item.delta',
    item_id: 'reason-1',
    delta: 'The',
    item_type: 'reasoning',
  }), '思考过程 The')
  assert.equal(accumulator.read({
    type: 'item.delta',
    item_id: 'reason-1',
    delta: ' greeting',
    item_type: 'reasoning',
  }), '思考过程 The greeting')
  assert.equal(accumulator.read({
    type: 'item.delta',
    item_id: 'reason-1',
    delta: ' in',
    item_type: 'reasoning',
  }), '思考过程 The greeting in')
})

test('createCodexEventAccumulator updates reasoning items instead of replacing with fragments', () => {
  const accumulator = createCodexEventAccumulator()
  assert.equal(accumulator.read({
    type: 'item.updated',
    item: {
      id: 'reason-2',
      type: 'reasoning',
      text: 'The',
    },
  }), '思考过程 The')
  assert.equal(accumulator.read({
    type: 'item.updated',
    item: {
      id: 'reason-2',
      type: 'reasoning',
      text: 'The greeting',
    },
  }), '思考过程 The greeting')
})

test('runWorker returns stderr as lastMessage when command fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-'))
  try {
    const command = join(dir, 'fail.sh')
    await writeFile(command, '#!/bin/sh\necho "bad model" >&2\nexit 2\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'codex',
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const result = await runWorker(config, 1, logger.createWorkerLogger(1))

    assert.equal(result.status, 'error')
    assert.equal(result.exitCode, 2)
    assert.match(result.lastMessage, /bad model/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runWorker reports stdout progress while command is running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-progress-'))
  try {
    const command = join(dir, 'progress.sh')
    await writeFile(command, '#!/bin/sh\necho "first line"\nsleep 0.1\necho "second line"\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'codex',
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const updates: string[] = []
    const result = await runWorker(config, 1, logger.createWorkerLogger(1), update => {
      updates.push(update.lastMessage)
    })

    assert.equal(result.status, 'success')
    assert.ok(updates.includes('first line'))
    assert.ok(updates.includes('second line'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runWorker uses claude-code provider when configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-claude-'))
  try {
    const command = join(dir, 'claude.sh')
    await writeFile(command, '#!/bin/sh\necho \'{"type":"result","result":"done"}\'\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'claude-code',
      claudeCode: {
        command,
        model: 'sonnet',
        dangerouslySkipPermissions: true,
        outputFormat: 'stream-json',
        maxTurns: 10,
        systemPrompt: '',
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const result = await runWorker(config, 1, logger.createWorkerLogger(1))

    assert.equal(result.status, 'success')
    assert.equal(result.exitCode, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createClaudeCodeEventAccumulator parses assistant messages', () => {
  const acc = createClaudeCodeEventAccumulator()
  assert.equal(acc.read({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'hello world' }] },
  }), 'hello world')
})

test('createClaudeCodeEventAccumulator parses tool_use events', () => {
  const acc = createClaudeCodeEventAccumulator()
  assert.equal(acc.read({ type: 'tool_use', name: 'Bash', input: { command: 'date' } }), '$ date')
  assert.equal(acc.read({ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/a.ts' } }), '[读取: /tmp/a.ts]')
})

test('createClaudeCodeEventAccumulator deduplicates result with last tool_result', () => {
  const acc = createClaudeCodeEventAccumulator()
  assert.equal(acc.read({ type: 'tool_result', content: 'hello' }), 'hello')
  assert.equal(acc.read({ type: 'result', result: 'hello' }), '')
  assert.equal(acc.read({ type: 'result', result: 'different' }), 'different')
})

test('createClaudeCodeEventAccumulator surfaces API retry system events', () => {
  const acc = createClaudeCodeEventAccumulator()
  assert.equal(acc.read({
    type: 'system',
    subtype: 'api_retry',
    attempt: 8,
    max_retries: 10,
    error_status: 401,
    error: 'authentication_failed',
  }), 'API 重试 8/10：authentication_failed (401)')
})

test('runWorker calls onOutput for each stdout line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-output-'))
  try {
    const command = join(dir, 'output.sh')
    await writeFile(command, '#!/bin/sh\necho "line one"\necho "line two"\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'codex',
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const outputLines: OutputLine[] = []
    await runWorker(config, 1, logger.createWorkerLogger(1), undefined, line => {
      outputLines.push(line)
    })

    assert.ok(outputLines.length >= 2)
    assert.ok(outputLines.some(l => l.stream === 'stdout' && l.text === 'line one'))
    assert.ok(outputLines.some(l => l.stream === 'stdout' && l.text === 'line two'))
    assert.ok(outputLines.every(l => l.workerId === 1))
    assert.ok(outputLines.every(l => typeof l.ts === 'number'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runWorker splits multi-line readable events before publishing output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-output-multiline-'))
  try {
    const command = join(dir, 'claude.sh')
    await writeFile(command, `#!/bin/sh
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"first line\\nsecond line"}]}}'
`, 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'claude-code',
      claudeCode: {
        command,
        model: 'sonnet',
        dangerouslySkipPermissions: true,
        outputFormat: 'stream-json',
        maxTurns: 10,
        systemPrompt: '',
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const outputLines: OutputLine[] = []
    await runWorker(config, 1, logger.createWorkerLogger(1), undefined, line => {
      outputLines.push(line)
    })

    assert.deepEqual(outputLines.map(line => line.text), ['first line', 'second line'])
    assert.ok(outputLines.every(line => line.stream === 'event'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runWorker redacts sensitive values in output and last message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-redact-'))
  try {
    const command = join(dir, 'secrets.sh')
    await writeFile(command, `#!/bin/sh
echo 'Authorization: Bearer stdout-secret'
echo '{"type":"tool_result","content":"{\\"apiKey\\":\\"event-secret\\",\\"file_path\\":\\"/Users/test/project/file.ts\\"}"}'
echo 'Cookie: sid=stderr-secret' >&2
`, 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'claude-code',
      claudeCode: {
        command,
        model: 'sonnet',
        dangerouslySkipPermissions: true,
        outputFormat: 'stream-json',
        maxTurns: 10,
        systemPrompt: '',
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const outputLines: OutputLine[] = []
    const result = await runWorker(config, 1, logger.createWorkerLogger(1), undefined, line => {
      outputLines.push(line)
    })
    const logContent = await readFile(result.logPath, 'utf-8')
    const renderedOutput = JSON.stringify(outputLines)

    assert.match(renderedOutput, /\[redacted\]/)
    assert.match(logContent, /\[redacted\]/)
    assert.match(logContent, /\/Users\/test\/project\/file.ts/)
    assert.doesNotMatch(renderedOutput, /stdout-secret|event-secret|stderr-secret/)
    assert.doesNotMatch(logContent, /stdout-secret|event-secret|stderr-secret/)
    assert.doesNotMatch(result.lastMessage, /stdout-secret|event-secret|stderr-secret/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runWorker force kills timed out workers that ignore SIGTERM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-timeout-'))
  try {
    const command = join(dir, 'ignore-term.js')
    await writeFile(command, `#!/usr/bin/env node
process.on('SIGTERM', () => {})
console.log('started')
setInterval(() => {}, 1000)
`, 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'codex',
      timeoutMinutes: 0.01,
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const startedAt = Date.now()
    const result = await runWorker(config, 1, logger.createWorkerLogger(1))
    const elapsedMs = Date.now() - startedAt
    const logContent = await readFile(result.logPath, 'utf-8')

    assert.equal(result.status, 'timeout')
    assert.equal(result.exitCode, null)
    assert.match(result.lastMessage, /SIGKILL/)
    assert.match(logContent, /SIGTERM/)
    assert.match(logContent, /SIGKILL/)
    assert.ok(elapsedMs < 5_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runBatch still runs one worker per configured concurrency for once mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-once-'))
  try {
    const command = join(dir, 'success.sh')
    await writeFile(command, '#!/bin/sh\necho "ok"\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      concurrency: 3,
      maxLogs: 10000,
      provider: 'codex',
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }

    const result = await runBatch(config)

    assert.equal(result.workers.length, 3)
    assert.equal(result.status, 'success')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
