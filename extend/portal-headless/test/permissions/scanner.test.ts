import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scanner = join(process.cwd(), 'tools/permissions/scan.mjs')
describe('permission candidate scanner', () => {
  it('reports evidence and endpoint references without permission conclusions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-permission-'))
    writeFileSync(join(dir, 'page.vue'), "permissionCheck('menu:create')\nhttp.post('/admin-api/sys/menu/create', body)")
    const out = join(dir, 'candidates.ndjson')
    execFileSync('node', [scanner, '--root', dir, '--out', out, '--revision', 'rev-test'])
    const record = JSON.parse(readFileSync(out, 'utf8').trim()) as Record<string, unknown>
    expect(record).toMatchObject({ pagePath: '/page.vue', sourceRevision: 'rev-test' })
    expect(record).toHaveProperty('keywordHits')
    expect(record).toHaveProperty('endpointRefs')
    expect(JSON.stringify(record)).not.toMatch(/allow|deny|需要哪些权限/)
  })
})
