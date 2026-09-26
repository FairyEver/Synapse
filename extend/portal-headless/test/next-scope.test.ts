import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson (file: string): any {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
}

describe('pnpm next —— 只对保留 Portal 范围排队', () => {
  it('JSON 输出以 portal-scope 为分母，并且本批页面都在可调用范围内', () => {
    const catalog = readJson('generated/page-catalog.json')
    const scope = readJson('generated/portal-scope.json')
    const scopedPaths = new Set(
      scope.items
        .filter((item: { included: boolean; menuPath: string | null }) => item.included && item.menuPath !== null)
        .map((item: { menuPath: string }) => item.menuPath),
    )
    const result = JSON.parse(execFileSync(process.execPath, ['tools/generate/next.mjs', '--json'], { cwd: ROOT, encoding: 'utf8' }))

    expect(result.总数).toBe(catalog.items.length)
    expect(result.范围页面总数).toBe(scopedPaths.size)
    expect(result.范围页面总数).toBeGreaterThan(0)
    expect(result.本批.every((item: { menuPath: string }) => scopedPaths.has(item.menuPath))).toBe(true)
  })

  it('文字输出明确区分范围进度与范围外排除项', () => {
    const output = execFileSync(process.execPath, ['tools/generate/next.mjs', '--why'], { cwd: ROOT, encoding: 'utf8' })
    expect(output).toContain('范围进度：')
    expect(output).toContain('范围外目录项已从队列排除')
  })
})
