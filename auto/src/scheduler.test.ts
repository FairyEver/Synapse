import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_UI_CONFIG, type UiConfig } from './config.js'
import { AutoScheduler, type BatchRunner } from './scheduler.js'
import type { OutputLine } from './runner.js'

function config(): UiConfig {
  return {
    ...DEFAULT_UI_CONFIG,
    prompt: 'hello',
    workingDirectory: '/tmp/work',
    concurrency: 2,
    intervalMinutes: 1,
    timeoutMinutes: 1,
    maxLogs: 10,
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

test('subscribeOutput receives output lines from batch runner', async () => {
  const collectedLines: OutputLine[] = []
  const fakeLine: OutputLine = { workerId: 1, stream: 'stdout', text: 'hello', ts: Date.now() }

  const deferred: { finishRun?: () => void } = {}
  const runner: BatchRunner = async (_config, _onUpdate, onOutput) => {
    onOutput?.(fakeLine)
    await new Promise<void>(resolve => { deferred.finishRun = resolve })
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
  scheduler.subscribeOutput(line => collectedLines.push(line))
  void scheduler.start(config())
  await scheduler.waitForStatus('running')
  scheduler.stopAfterCurrent()
  assert.ok(deferred.finishRun)
  deferred.finishRun()
  await scheduler.waitForStatus('stopped')

  assert.equal(collectedLines.length, 1)
  assert.deepEqual(collectedLines[0], fakeLine)
})
