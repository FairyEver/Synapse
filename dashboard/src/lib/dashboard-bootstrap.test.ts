import { describe, expect, it } from 'vitest'
import { bootstrapDashboard } from './dashboard-bootstrap'

describe('dashboard bootstrap ordering', () => {
  it.each(['/share/root', '/share/root/items/file', '/share/root/?password=secret'])('starts %s without waiting for the session', async (href) => {
    const calls: string[] = []
    let ready!: () => void
    const session = new Promise<void>((resolve) => { ready = resolve })
    const work = bootstrapDashboard(href, () => { calls.push('session'); return session }, () => { calls.push('render') })
    expect(calls).toEqual(['session', 'render'])
    ready(); await work
    expect(calls).toHaveLength(2)
  })
  it.each(['/console/', '/drive/items/file', '/share/root/render', '/share/root/reader', '/sites/site/'])('preserves session-first startup for %s', async (href) => {
    const calls: string[] = []
    let ready!: () => void
    const session = new Promise<void>((resolve) => { ready = resolve })
    const work = bootstrapDashboard(href, () => { calls.push('session'); return session }, () => { calls.push('render') })
    expect(calls).toEqual(['session'])
    ready(); await work
    expect(calls).toEqual(['session', 'render'])
  })
})
