import test from 'node:test'
import assert from 'node:assert/strict'
import type { UiConfig } from './config.js'
import { AutoScheduler, type BatchRunner } from './scheduler.js'

function config(): UiConfig {
  return {
    prompt: 'hello',
    activePromptName: 'default',
    prompts: ['default'],
    workingDirectory: '/tmp/work',
    concurrency: 2,
    intervalMinutes: 1,
    timeoutMinutes: 1,
    maxLogs: 10,
    codex: {
      command: 'codex',
      model: '',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      json: true,
    },
  }
}

test('stopAfterCurrent prevents another batch after the active batch finishes', async () => {
  let runs = 0
  const deferred: { finishRun?: () => void } = {}
  const runner: BatchRunner = async () => {
    runs++
    await new Promise<void>(resolve => {
      deferred.finishRun = resolve
    })
    return {
      id: 'batch-1',
      status: 'success',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      workers: [],
      summaryPath: '/tmp/summary.md',
    }
  }

  const scheduler = new AutoScheduler(runner, { wait: () => Promise.resolve() })
  void scheduler.start(config())
  await scheduler.waitForStatus('running')
  scheduler.stopAfterCurrent()
  assert.ok(deferred.finishRun)
  deferred.finishRun()
  await scheduler.waitForStatus('stopped')

  assert.equal(runs, 1)
  assert.equal(scheduler.getSnapshot().status, 'stopped')
})

test('stopAfterCurrent aborts the wait before the next batch', async () => {
  let runs = 0
  let waitAborted = false
  const runner: BatchRunner = async () => {
    runs++
    return {
      id: `batch-${runs}`,
      status: 'success',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      workers: [],
      summaryPath: '/tmp/summary.md',
    }
  }

  const scheduler = new AutoScheduler(runner, {
    wait: (_ms, signal) => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => {
        waitAborted = true
        resolve()
      }, { once: true })
    }),
  })
  void scheduler.start(config())
  await scheduler.waitForStatus('waiting')
  scheduler.stopAfterCurrent()
  await scheduler.waitForStatus('stopped')

  assert.equal(waitAborted, true)
  assert.equal(runs, 1)
})
