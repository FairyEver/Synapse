import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createCatalog } from '../src/catalog/index.js'
import type { AiContract } from '../src/catalog/ai-contract.js'
import {
  createSalaryAccountingCapability,
  salaryAccountingCapabilities,
} from '../src/capabilities/salary-accounting.js'
import {
  createSalaryPackageCapability,
  salaryPackageCapabilities,
} from '../src/capabilities/salary-package.js'
import {
  fundSalaryFundCostsCapabilities,
} from '../src/capabilities/fund-salary-fund-costs.js'
import {
  insuranceSalaryInsuranceCostsCapabilities,
} from '../src/capabilities/insurance-salary-insurance-costs.js'
import { SALARY_ACCOUNTING_AI_CONTRACTS } from '../src/catalog/contracts-salary-accounting.js'
import { SALARY_PACKAGE_AI_CONTRACTS } from '../src/catalog/contracts-salary-package.js'
import { FUND_SALARY_FUND_COST_AI_CONTRACTS } from '../src/catalog/contracts-fund-salary-fund-costs.js'
import { INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS } from '../src/catalog/contracts-insurance-salary-insurance-costs.js'

type RequestConfig = Parameters<PortalRequest>[0]

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })

// Keep these IDs literal: scope-audit uses the test source as capability evidence.
const salaryAccountingIds = [
  'salary-accounting-list', 'salary-accounting-get', 'salary-accounting-step-info', 'salary-accounting-ledger-item-list',
  'salary-accounting-prepare-create', 'salary-accounting-create', 'salary-accounting-prepare-save-staff', 'salary-accounting-save-staff',
  'salary-accounting-prepare-calculate', 'salary-accounting-calculate', 'salary-accounting-prepare-remove', 'salary-accounting-remove',
  'salary-accounting-prepare-checkout', 'salary-accounting-checkout', 'salary-accounting-cancel-checkout', 'salary-accounting-document-users',
  'salary-accounting-history-users', 'salary-accounting-organization-tree', 'salary-accounting-staff-list', 'salary-accounting-last-staff',
  'salary-accounting-prepare-staff-import', 'salary-accounting-staff-import', 'salary-accounting-second-template', 'salary-accounting-external-items',
  'salary-accounting-existing-external-items', 'salary-accounting-prepare-external-import', 'salary-accounting-external-account-result', 'salary-accounting-import-result',
  'salary-accounting-external-template', 'salary-accounting-detail', 'salary-accounting-detail-users', 'salary-accounting-detail-export',
  'salary-accounting-prepare-pay', 'salary-accounting-pay', 'salary-accounting-prepare-rename', 'salary-accounting-rename', 'salary-accounting-cancel-rename',
  'salary-accounting-prepare-split', 'salary-accounting-split', 'salary-accounting-temporary-detail-list', 'salary-accounting-prepare-temporary-detail-update',
  'salary-accounting-temporary-detail-update',
] as const

const fundArchiveIds = [
  'fund-archive-list', 'fund-archive-organization-tree', 'fund-archive-prepare-unarchive', 'fund-archive-unarchive', 'fund-archive-export',
] as const

const insuranceArchiveIds = [
  'insurance-archive-list', 'insurance-archive-organization-tree', 'insurance-archive-prepare-unarchive', 'insurance-archive-unarchive', 'insurance-archive-export',
] as const

const salaryPackageIds = [
  'salary-package-list', 'salary-package-get', 'salary-package-prepare-create', 'salary-package-create', 'salary-package-prepare-update',
  'salary-package-update', 'salary-package-prepare-copy', 'salary-package-copy', 'salary-package-prepare-remove', 'salary-package-remove',
  'salary-package-organization-tree', 'salary-package-organization-page', 'salary-package-role-options', 'salary-package-item-list',
  'salary-package-item-get', 'salary-package-item-formula-options', 'salary-package-item-check-formula', 'salary-package-item-prepare-update',
  'salary-package-item-update', 'salary-package-item-available', 'salary-package-item-prepare-import', 'salary-package-item-import',
  'salary-package-item-prepare-remove', 'salary-package-item-remove',
] as const

type PageAudit = {
  pagePath: string
  permission: string
  httpInstance: string
  moduleType: number | null
  capabilityIds: readonly string[]
  capabilities: Array<{ id: string; pagePath?: string; permission?: string; httpInstance?: string; moduleType?: number | null }>
  contracts: Record<string, AiContract>
}

const pageAudits: PageAudit[] = [
  { pagePath: '/dashboard/salary/salary-accounting/list', permission: '/dashboard/salary/salary-accounting', httpInstance: 'platform', moduleType: 14, capabilityIds: salaryAccountingIds, capabilities: salaryAccountingCapabilities, contracts: SALARY_ACCOUNTING_AI_CONTRACTS },
  { pagePath: '/dashboard/fund/archive/list', permission: '/dashboard/fund/archive', httpInstance: 'platform', moduleType: 14, capabilityIds: fundArchiveIds, capabilities: fundSalaryFundCostsCapabilities, contracts: FUND_SALARY_FUND_COST_AI_CONTRACTS },
  { pagePath: '/dashboard/insurance/archive/list', permission: '/dashboard/insurance/archive', httpInstance: 'platform', moduleType: 14, capabilityIds: insuranceArchiveIds, capabilities: insuranceSalaryInsuranceCostsCapabilities, contracts: INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS },
  { pagePath: '/dashboard/manage/salary-package/list', permission: '/dashboard/manage/salary-package', httpInstance: 'platform', moduleType: 14, capabilityIds: salaryPackageIds, capabilities: salaryPackageCapabilities, contracts: SALARY_PACKAGE_AI_CONTRACTS },
]

function sorted (values: readonly string[]): string[] {
  return [...values].sort()
}

function requireDescription (id: string, contract: AiContract) {
  const result = catalog.describe(id)
  expect(result).toMatchObject({ ok: true, invoke: { capabilityId: id } })
  if (!result.ok) throw new Error(`能力描述缺失：${id}`)
  expect(result.ai).toEqual(contract)

  const llm = catalog.describe(`${id}-llm`)
  expect(llm).toMatchObject({ ok: true, ai: result.ai, invoke: { capabilityId: id } })
}

function requestFixture () {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    return undefined as T
  }
  return { calls, request }
}

describe('scope audit：人力四个保留薪资页面', () => {
  it('逐页锁定 pagePath、完整能力集合，并逐个描述AI契约和执行绑定', () => {
    for (const pageAudit of pageAudits) {
      const expectedIds = sorted(pageAudit.capabilityIds)
      const registeredIds = sorted(pageAudit.capabilities.filter(capability => capability.pagePath === pageAudit.pagePath).map(capability => capability.id))
      const globalIds = sorted(ALL_CAPABILITY_DEFINITIONS.filter(capability => capability.pagePath === pageAudit.pagePath).map(capability => capability.id))
      expect(registeredIds).toEqual(expectedIds)
      expect(globalIds).toEqual(expectedIds)
      const registered = pageAudit.capabilities.filter(capability => capability.pagePath === pageAudit.pagePath)
      expect(registered).toHaveLength(expectedIds.length)
      for (const capability of registered) {
        expect(capability).toMatchObject({
          pagePath: pageAudit.pagePath,
          permission: pageAudit.permission,
          httpInstance: pageAudit.httpInstance,
          moduleType: pageAudit.moduleType,
        })
      }

      const page = catalog.describePage(pageAudit.pagePath)
      expect(page.ok).toBe(true)
      if (!page.ok) throw new Error(`页面描述缺失：${pageAudit.pagePath}`)
      expect(page.page.menuPath).toBe(pageAudit.pagePath)
      expect(sorted(page.capabilities.map(capability => capability.capabilityId))).toEqual(expectedIds)

      for (const id of pageAudit.capabilityIds) {
        const contract = pageAudit.contracts[id]
        expect(contract, `缺少 ${id} 的静态AI契约`).toBeDefined()
        if (contract === undefined) throw new Error(`缺少 ${id} 的静态AI契约`)
        requireDescription(id, contract)
      }
    }
  })

  it('薪资核算的第一步表单、人员保存和结账动作保持字段映射', () => {
    const accounting = createSalaryAccountingCapability(requestFixture().request)
    expect(accounting.prepareCreate({ organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '九月工资' })).toEqual({
      draft: { organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '九月工资' },
    })

    const createStep = SALARY_ACCOUNTING_AI_CONTRACTS['salary-accounting-prepare-create']?.steps.find(step => step.capabilityId === 'salary-accounting-create')
    expect(createStep?.mapping).toEqual({
      organizationId: 'result.draft.organizationId', ledgerId: 'result.draft.ledgerId',
      salaryMonth: 'result.draft.salaryMonth', costMonth: 'result.draft.costMonth', name: 'result.draft.name',
    })
    expect(SALARY_ACCOUNTING_AI_CONTRACTS['salary-accounting-prepare-save-staff']?.steps.find(step => step.capabilityId === 'salary-accounting-save-staff')?.mapping).toEqual({
      documentId: 'result.draft.documentId', staffList: 'result.draft.staffList',
    })
    expect(SALARY_ACCOUNTING_AI_CONTRACTS['salary-accounting-prepare-checkout']?.steps.find(step => step.capabilityId === 'salary-accounting-checkout')?.mapping).toEqual({
      ids: 'result.ids', status: 'result.status', currentStatuses: 'args.currentStatuses',
    })
    expect(SALARY_ACCOUNTING_AI_CONTRACTS['salary-accounting-create']).toMatchObject({ effect: 'write', steps: expect.any(Array) })
    expect(SALARY_ACCOUNTING_AI_CONTRACTS['salary-accounting-cancel-checkout']?.steps[0]).toMatchObject({ capabilityId: 'salary-accounting-list' })
  })

  it('公积金和社保归档撤销都只把草稿ID交给写能力，并回查归档列表', () => {
    for (const [contracts, prefix] of [
      [FUND_SALARY_FUND_COST_AI_CONTRACTS, 'fund-archive'],
      [INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS, 'insurance-archive'],
    ] as const) {
      expect(contracts[`${prefix}-prepare-unarchive`]?.steps.find(step => step.capabilityId === `${prefix}-unarchive`)).toMatchObject({
        role: 'required', mapping: { ids: 'result.draft[].id' },
      })
      expect(contracts[`${prefix}-unarchive`]?.effect).toBe('write')
      expect(contracts[`${prefix}-unarchive`]?.steps).toEqual(expect.any(Array))
      expect(contracts[`${prefix}-unarchive`]?.steps[0]).toMatchObject({ capabilityId: `${prefix}-list`, mapping: {} })
      expect(contracts[`${prefix}-unarchive`]?.consume.join(' ')).toContain('archiveStatus')
    }
  })

  it('薪资账套表单保留组织、计税区间和角色ID，并按Portal动作提交', async () => {
    const fixture = requestFixture()
    const salaryPackage = createSalaryPackageCapability(fixture.request)
    const form = {
      name: '月薪账套', organizationId: 101, organizationName: '总部', type: 'salary', countRange: 'monthly', roleIdList: [7],
    }
    const prepared = salaryPackage.prepareCreate(form)
    expect(prepared.draft).toEqual(form)

    const updated = salaryPackage.prepareUpdate({ current: { id: 11, ...form }, changes: { name: '月薪账套-调整' } })
    expect(updated.draft).toMatchObject({ id: 11, organizationId: 101, organizationName: '总部', type: 'salary', countRange: 'monthly', roleIdList: [7], name: '月薪账套-调整' })

    await expect(salaryPackage.create({ draft: prepared.draft })).resolves.toBe(true)
    expect(fixture.calls).toEqual([{ url: '/salary/ledger', method: 'post', data: form }])
    expect(SALARY_PACKAGE_AI_CONTRACTS['salary-package-prepare-create']?.steps.find(step => step.capabilityId === 'salary-package-create')?.mapping).toEqual({ draft: 'result.draft' })
    expect(SALARY_PACKAGE_AI_CONTRACTS['salary-package-update']?.steps.find(step => step.capabilityId === 'salary-package-get')?.mapping).toEqual({ id: 'args.draft.id' })
  })
})
