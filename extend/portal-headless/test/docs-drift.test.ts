import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function fixture (withRules: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'portal-docs-drift-'))
  mkdirSync(join(root, 'tools/generate'), { recursive: true })
  mkdirSync(join(root, 'generated'))
  copyFileSync(new URL('../tools/generate/drift-check.mjs', import.meta.url), join(root, 'tools/generate/drift-check.mjs'))
  writeFileSync(join(root, 'generated/page-catalog.json'), JSON.stringify({ items: [] }))
  writeFileSync(join(root, 'generated/openapi.json'), JSON.stringify({ description: '契约'.repeat(700_000) }))
  writeFileSync(join(root, 'generated/scope-audit.json'), JSON.stringify({ pages: [] }))
  if (withRules) writeFileSync(join(root, 'generated/module-type-rules.json'), '{}')
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '--quiet'])
  git(['add', 'generated/page-catalog.json', 'generated/openapi.json', ...(withRules ? ['generated/module-type-rules.json'] : [])])
  git(['add', 'generated/scope-audit.json'])
  git(['-c', 'user.name=Contract Test', '-c', 'user.email=contract-test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
  return root
}
const run = (root: string) => spawnSync(process.execPath, ['tools/generate/drift-check.mjs'], { cwd: root, encoding: 'utf8' })

describe('文档漂移门禁不会因读取失败假通过', () => {
  it('读取超过默认1MiB缓冲的真实Git文档并验证相同内容', () => {
    const result = run(fixture(true))
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('不存在')
    expect(result.stdout).toContain('4 项生成物与 HEAD 一致')
  })
  it('任一受检文件缺失即返回非零，不能同时打印一致', () => {
    const result = run(fixture(false))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('generated/module-type-rules.json')
    expect(result.stdout).not.toContain('与 HEAD 一致')
  })
  it('大文件存在实际内容漂移时必须拒绝', () => {
    const root = fixture(true)
    writeFileSync(join(root, 'generated/openapi.json'), JSON.stringify({ description: '变更后的契约' }))
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('generated/openapi.json')
    expect(result.stdout).not.toContain('与 HEAD 一致')
  })
})
