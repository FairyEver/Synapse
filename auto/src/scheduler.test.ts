import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_UI_CONFIG, type UiConfig } from './config.js'
import { AutoScheduler, type WorkerRunner } from './scheduler.js'
import type { WorkerResult } from './runner.js'

function config(): UiConfig {
  return {
    ...DEFAULT_UI_CONFIG,
    prompt: 'hello',
    workingDirectory: '/tmp/work',
    concurrency: 2,
    timeoutMinutes: 1,
    maxLogs: 10,
  }
}

function result(slotId: number, sequence: number, status: WorkerResult['status'] = 'success'): WorkerResult {
  return {
    id: slotId,
    status,
    durationMs: 1,
    exitCode: status === 'success' ? 0 : 1,
    logPath: `/tmp/slot-${slotId}-run-${sequence}.md`,
    lastMessage: `slot ${slotId} run ${sequence}`,
  }
}

test('start fills all configured slots', async () => {
  const started: Array<{ slotId: number; sequence: number }> = []
  const runner: WorkerRunner = async (_config, run, _onUpdate, _onOutput) => {
    started.push({ slotId: run.slotId, sequence: run.sequence })
    await new Promise<void>(() => {})
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForStatus('running')

  assert.deepEqual(started, [
    { slotId: 1, sequence: 1 },
    { slotId: 2, sequence: 2 },
  ])
  assert.equal(scheduler.getSnapshot().session?.slots.length, 2)
})

test('finished slot is refilled without waiting for sibling slots', async () => {
  const deferred = new Map<number, () => void>()
  const started: Array<{ slotId: number; sequence: number }> = []
  const runner: WorkerRunner = async (_config, run) => {
    started.push({ slotId: run.slotId, sequence: run.sequence })
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  deferred.get(1)?.()
  await scheduler.waitForRunCount(3)

  assert.deepEqual(started, [
    { slotId: 1, sequence: 1 },
    { slotId: 2, sequence: 2 },
    { slotId: 1, sequence: 3 },
  ])

  scheduler.stopAfterCurrent()
  deferred.get(2)?.()
  deferred.get(3)?.()
  await scheduler.waitForStatus('stopped')
})

test('stop drains active slots without replacement', async () => {
  const deferred = new Map<number, () => void>()
  const runner: WorkerRunner = async (_config, run) => {
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  scheduler.stopAfterCurrent()
  await scheduler.waitForStatus('draining')
  deferred.get(1)?.()
  deferred.get(2)?.()
  await scheduler.waitForStatus('stopped')

  const snapshot = scheduler.getSnapshot()
  assert.equal(snapshot.status, 'stopped')
  assert.equal(snapshot.session?.totals.started, 2)
})

test('worker failure increments totals and continues the slot', async () => {
  const deferred = new Map<number, () => void>()
  const runner: WorkerRunner = async (_config, run) => {
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence, run.sequence === 1 ? 'error' : 'success')
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  deferred.get(1)?.()
  await scheduler.waitForRunCount(3)

  const snapshot = scheduler.getSnapshot()
  assert.equal(snapshot.session?.totals.error, 1)
  assert.equal(snapshot.session?.totals.started, 3)

  scheduler.stopAfterCurrent()
  deferred.get(2)?.()
  deferred.get(3)?.()
  await scheduler.waitForStatus('stopped')
})
