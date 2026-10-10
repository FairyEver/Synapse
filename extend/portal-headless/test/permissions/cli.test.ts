import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compilePermissionPolicy } from '../../src/permissions/policy.js'
import { fixture } from './fixture.js'

describe('permission compiler CLI', () => {
  it('uses the core compiler, preserves mixed coverage and rejects caller-supplied registries', () => {
    const input = fixture()
    const dir = mkdtempSync(join(tmpdir(), 'ph-compiler-'))
    const candidates = join(dir, 'candidates.ndjson'); const reviews = join(dir, 'reviews.ndjson'); const out = join(dir, 'policy.json')
    writeFileSync(candidates, input.candidates.map(row => JSON.stringify(row)).join('\n'))
    writeFileSync(reviews, input.reviews.map(row => JSON.stringify(row)).join('\n'))
    const args = [join(process.cwd(), 'tools/permissions/compile.mjs'), '--root', input.root, '--candidates', candidates, '--reviews', reviews, '--revision', input.sourceRevision, '--out', out]
    execFileSync('node', args)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(compilePermissionPolicy({ ...input, sourceRoot: input.root }))
    expect(() => execFileSync('node', [...args, '--capabilities', 'fake.json'], { stdio: 'pipe' })).toThrow()
    const accepted = input.reviews.find(row => row.status === 'accepted')!
    ;(accepted as unknown as { status: string }).status = 'unknown'
    writeFileSync(reviews, input.reviews.map(row => JSON.stringify(row)).join('\n'))
    expect(() => execFileSync('node', args, { stdio: 'pipe' })).toThrow()
  })
})
