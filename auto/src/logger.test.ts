import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { BatchLogger, pruneOldBatchLogs } from './logger.js'

test('BatchLogger writes summary and worker logs in one batch directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-logs-'))
  try {
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const worker = logger.createWorkerLogger(1)
    worker.writeStdout('hello')
    worker.writeStderr('warn')
    await worker.close({ status: 'success', durationMs: 12, exitCode: 0 })
    await logger.writeSummary({
      status: 'success',
      durationMs: 12,
      workers: [{ id: 1, status: 'success', durationMs: 12, exitCode: 0, logPath: worker.path }],
    })

    const files = await readdir(logger.path)
    assert.deepEqual(files.sort(), ['summary.md', 'worker-1.md'])
    assert.match(await readFile(worker.path, 'utf-8'), /hello/)
    assert.match(await readFile(join(logger.path, 'summary.md'), 'utf-8'), /success/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('BatchLogger writes sequence-aware slot run logs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-slot-logs-'))
  try {
    const logger = new BatchLogger(new Date('2026-05-26T12:00:00Z'), dir)
    const worker = logger.createWorkerLogger(2, 7)
    worker.writeStdout('hello')
    await worker.close({ status: 'success', durationMs: 12, exitCode: 0 })
    await logger.writeSummary({
      status: 'success',
      durationMs: 12,
      workers: [{ id: 2, status: 'success', durationMs: 12, exitCode: 0, logPath: worker.path }],
      totals: { started: 7, success: 5, error: 1, timeout: 1 },
    })

    const files = await readdir(logger.path)
    assert.deepEqual(files.sort(), ['slot-2-run-0007.md', 'summary.md'])
    assert.match(await readFile(worker.path, 'utf-8'), /Slot 2 Run 7/)
    assert.match(await readFile(join(logger.path, 'summary.md'), 'utf-8'), /Started:\*\* 7/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pruneOldBatchLogs removes oldest batch directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-prune-'))
  try {
    await new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir).writeSummary({
      status: 'success',
      durationMs: 1,
      workers: [],
    })
    await new BatchLogger(new Date('2026-05-13T12:01:00Z'), dir).writeSummary({
      status: 'success',
      durationMs: 1,
      workers: [],
    })

    await pruneOldBatchLogs(1, dir)
    const entries = await readdir(dir)
    assert.deepEqual(entries, ['2026-05-13T12-01-00'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
