import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as scopeAuditModule from '../tools/generate/scope-audit.mjs'

const { catalogContentHash, inspectBuildFreshness, sourceSupportsEndpoint } = scopeAuditModule as unknown as {
  catalogContentHash: (...args: any[]) => string
  inspectBuildFreshness: (...args: any[]) => { status: string; reason?: string; method?: string }
  sourceSupportsEndpoint: (...args: any[]) => boolean
}

type ScopeAudit = {
  schema: string
  summary: {
    retainedCallablePages: number
    issueCount: number
    newIssueCount: number
    structuralIssueCount: number
    evidenceGapCount: number
    pagesWithEvidenceGaps: number
    functionalCoverageUnverified: number
    testedCapabilityCount: number
    untestedCapabilityCount: number
  }
  pages: Array<{
    menuPath: string
    status: string
    issues: string[]
    testEvidence: string | null
    testedCapabilityIds: string[]
    untestedCapabilityIds: string[]
    testEvidenceByCapability: Record<string, string[]>
    evidenceGaps: string[]
  }>
  issues: Array<{ key: string; kind: string; detail: string }>
  structuralIssues: Array<{ key: string; kind: string; detail: string }>
  evidenceGaps: Array<{ key: string; kind: string; detail: string }>
  outsideScopeCapabilityIds: string[]
}

const audit = JSON.parse(readFileSync(new URL('../generated/scope-audit.json', import.meta.url), 'utf8')) as ScopeAudit

describe('保留菜单逐页审计矩阵', () => {
  it('逐项记录所有可调用保留页面，且问题键唯一', () => {
    expect(audit.schema).toBe('portal-scope-audit/v1')
    expect(audit.pages).toHaveLength(audit.summary.retainedCallablePages)
    expect(new Set(audit.pages.map((page) => page.menuPath)).size).toBe(audit.pages.length)
    expect(new Set(audit.issues.map((item) => item.key)).size).toBe(audit.issues.length)
    expect(audit.summary.issueCount).toBe(audit.issues.length)
    expect(audit.summary.structuralIssueCount).toBe(audit.structuralIssues.length)
    expect(audit.summary.evidenceGapCount).toBe(audit.evidenceGaps.length)
    expect(audit.summary.pagesWithEvidenceGaps).toBe(audit.pages.filter((page) => page.evidenceGaps.length > 0).length)
    expect(audit.summary.functionalCoverageUnverified).toBe(audit.pages.length)
    expect(audit.summary.testedCapabilityCount + audit.summary.untestedCapabilityCount).toBe(
      audit.pages.reduce((count, page) => count + page.testedCapabilityIds.length + page.untestedCapabilityIds.length, 0),
    )
  })

  it('问题必须挂到矩阵页面或明确的范围外 capability 候选', () => {
    const pageKeys = new Set(audit.pages.flatMap((page) => page.issues))
    const outside = new Set(audit.outsideScopeCapabilityIds.map((id) => `outside-scope-capability:${id}`))
    for (const item of audit.issues) {
      expect(pageKeys.has(item.key) || outside.has(item.key), item.key).toBe(true)
    }
  })

  it('新问题计数不会超过当前问题总数', () => {
    expect(audit.summary.newIssueCount).toBeLessThanOrEqual(audit.summary.issueCount)
  })

  it('权限漂移必须进入结构问题，而不是被证据缺口掩盖', () => {
    expect(audit.structuralIssues.filter((item) => item.kind.includes('permission'))).toEqual([])
    expect(audit.pages.every((page) => page.issues.every((key) => !key.startsWith('permission-')))).toBe(true)
  })

  it('逐 capability 的测试证据不会被单个页面文件命中掩盖', () => {
    for (const page of audit.pages) {
      expect(Object.keys(page.testEvidenceByCapability).sort()).toEqual([...page.testedCapabilityIds, ...page.untestedCapabilityIds].sort())
      expect(page.testedCapabilityIds.filter(id => page.untestedCapabilityIds.includes(id))).toEqual([])
      if (page.untestedCapabilityIds.length > 0) expect(page.evidenceGaps.some(gap => gap.startsWith('capability-test-missing:'))).toBe(true)
    }
  })

  it('catalog generatedAt 变化不会改变语义内容哈希', () => {
    const base = { generatedAt: '2026-09-25T00:00:00.000Z', items: [{ menuPath: '/dashboard/example/list' }] }
    expect(catalogContentHash({ ...base, generatedAt: '2026-09-25T01:00:00.000Z' })).toBe(catalogContentHash(base))
    expect(catalogContentHash({ ...base, items: [{ menuPath: '/dashboard/changed/list' }] })).not.toBe(catalogContentHash(base))
  })

  it('构建门禁按源码与产物内容哈希核对，而不是按时间戳猜测新鲜度', () => {
    const build = inspectBuildFreshness()
    expect(build.method).toBe('content-hash-v1')
    expect(build.status).toBe('fresh')
  })

  it('动作匹配覆盖动态ID和Portal/SDK网关前缀', () => {
    expect(sourceSupportsEndpoint(
      "const ROOT = '/hr/meeting-room'\nrequest({ url: `${ROOT}/delete/${id}` })",
      { verb: 'DELETE', path: '/admin-api/hr/meeting-room/delete/${record.id}' },
    )).toBe(true)
    expect(sourceSupportsEndpoint(
      "const ROOT = '/mall-manage-api/sys/mailSms'\nrequest({ url: `${ROOT}/setAccount` })",
      { verb: 'PUT', path: '/sys/mailSms/setAccount' },
    )).toBe(true)
    expect(sourceSupportsEndpoint(
      "const DELETE_URL_PREFIX = '/egg/standardAgeStage/'\nrequest({ url: `${DELETE_URL_PREFIX}${id}` })",
      { verb: 'DELETE', path: '/egg/standardAgeStage/${record.id}' },
    )).toBe(true)
    expect(sourceSupportsEndpoint(
      "const ROOT = '/inventory/stock-location'\nrequest({ url: `${ROOT}/${draft.status ? 'open' : 'close'}` })",
      { verb: 'PUT', path: '/admin-api/inventory/stock-location/open' },
    )).toBe(true)
  })

  it('相似能力ID不会让相邻页面串用回归测试证据', () => {
    expect(audit.pages.find(page => page.menuPath === '/dashboard/manage/salary/list')?.testEvidence).toBe('test/salary-item.test.ts')
    expect(audit.pages.find(page => page.menuPath === '/dashboard/report/salary-item/list')?.testEvidence).toBe('test/report-salary-item.test.ts')
  })
})
