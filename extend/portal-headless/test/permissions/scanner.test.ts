import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scanner = join(process.cwd(), 'tools/permissions/scan.mjs')
describe('permission candidate scanner', () => {
  it('ties registered pages to parent routes, aliases and complete import trails, recording unresolved calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-permission-'))
    const page = 'app/portal/views/dashboard/hr/post/post-type/list.vue'
    mkdirSync(join(dir, 'app/portal/views/dashboard/hr/post/post-type'), { recursive: true })
    mkdirSync(join(dir, 'common'), { recursive: true })
    writeFileSync(join(dir, page), "<script setup>\nimport { doIt } from 'common/a0'\npermissionCheck('page')\nhttp({ method: 'post', url: `/org/hrposttype/save` })\nhttp.get(dynamicUrl)\n</script>")
    writeFileSync(join(dir, 'app/portal/views/dashboard/hr/post/post-type.vue'), "<route>{meta:{permission:'page'}}</route>")
    for (let index = 0; index < 40; index++) writeFileSync(join(dir, `common/a${index}.js`), index === 39 ? "http.post('/other/endpoint', body)" : `export * from './a${index + 1}'`)
    const out = join(dir, 'candidates.ndjson')
    execFileSync('node', [scanner, '--root', dir, '--out', out])
    const records = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const record = records.find(row => row.capabilityIds.includes('hr-post-type-create'))
    expect(record).toMatchObject({ pagePath: '/dashboard/post/post-type/list', routeFile: page })
    expect(record.importTrail).toContain('common/a39.js')
    expect(record.actionFiles).toContain('app/portal/views/dashboard/hr/post/post-type.vue')
    expect(record.endpointRefs).toContainEqual({ method: 'post', path: '/org/hrposttype/save', sourceFile: page, line: 4 })
    expect(record.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'endpoint', expression: 'dynamicUrl' })]))
    expect(new Set(records.flatMap(row => row.capabilityIds)).size).toBeGreaterThan(2000)
    expect(JSON.stringify(record)).not.toMatch(/"allow"|"deny"|需要哪些权限/)
  })
})
