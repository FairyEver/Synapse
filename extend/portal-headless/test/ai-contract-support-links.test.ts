import { describe, expect, it } from 'vitest'
import { createPortalHeadless } from '../src/index.js'
const sdk = createPortalHeadless({ baseUrl: 'https://example.invalid', credential: { token: 'offline', tenantId: '1' } })
function ai(id: string) {
  const result = sdk.catalog.describe(id)
  if (!result.ok || !result.ai) throw new Error(`No contract: ${id}`)
  return result.ai
}
describe('source confirmed candidate links in actual SDK descriptions', () => {
  it('separates old/new role trees and single/multiple organization inputs', () => {
    expect(ai('perf-month-agreement-others-list').inputs.organizationCode?.lookup?.capabilityId).toBe('contract-support-role-organization-new-search')
    expect(ai('perf-year-agreement-others-list').inputs.organizationCode?.lookup?.capabilityId).toBe('contract-support-role-organization-search')
    for (const [id, field] of [['perf-salary-main-list', 'orgIdList'], ['perf-salary-adjust-list', 'orgIdList'], ['perf-salary-examine-result-list', 'organizationIdList'], ['perf-analysis-department-summary', 'organizationIdList']]) {
      expect(ai(id!).inputs[field!]?.lookup).toMatchObject({capabilityId:'contract-support-role-organization-search',valueField:'list[].id'})
    }
    expect(ai('attendance-team-schedule-save').inputs.organizationIdList?.lookup?.args.scope).toBe('attendance')
    expect(ai('attendance-team-schedule-save').inputs.postIdList?.lookup?.capabilityId).toBe('contract-support-post-search')
    expect(ai('attendance-team-schedule-save').inputs.dutyIdList?.lookup?.capabilityId).toBe('contract-support-duty-search')
  })
  it('keeps external course and contract classification identifiers in their source domain', () => {
    expect(ai('study-statistics-learning-summary').inputs.lessonId?.lookup?.capabilityId).toBe('contract-support-learning-course-search')
    expect(ai('study-statistics-learning-summary').inputs.organizationId?.lookup?.capabilityId).toBe('contract-support-learning-organization-search')
    for (const id of ['contract-template-list','contract-template-create','contract-template-update']) expect(ai(id).inputs.typeId?.lookup?.capabilityId).toBe('contract-support-contract-type-search')
    const direct = sdk.catalog.describeMethod('contractTemplate.create')
    expect(direct.ok && direct.ai.inputs.content?.source).toContain('describeSchema')
    expect(direct.ok && direct.ai.inputs.typeId?.lookup?.valueField).toBe('list[].id')
  })
  it('maps budget detail and internal corporation to the actual nested draft fields', () => {
    for (const id of ['travel-expense-prepare','travel-expense-submit']) {
      const c = ai(id)
      expect(c.inputs['travelEntryList[].budgetDetailId']?.source).toContain('paymentDate前7字符')
      expect(c.inputs['travelEntryList[].budgetDetailId']?.constraints?.join(' ')).toContain('availableBalance')
      expect(c.inputs['payeeInfo.receivingCorporationId']?.lookup?.capabilityId).toBe('contract-support-corporation-search')
      expect(c.inputs['payeeInfo.payeeId']?.lookup?.capabilityId).not.toBe('contract-support-corporation-search')
      expect(c.inputs.relatedRevenueSubjectId?.source).toContain('relatedRevenueSubjectName')
    }
    const corporation = ai('contract-support-corporation-search').steps[0]!
    expect(corporation.mapping).toEqual({corporationId:'result.list[].id'})
    expect(corporation.capabilityId).toBe('contract-support-corporation-payee-get')
    const payee = ai('contract-support-corporation-payee-get')
    expect(payee.steps[0]?.mapping?.['payeeInfo.receivingAccount']).toBe('result.receivingAccount')
    expect(payee.consume.join(' ')).toContain('清空')
    expect(ai('contract-support-travel-budget-search').inputs.applyAmount?.source).toContain('inputTaxAmount')
  })
  it('adds roles without pretending ambiguous permission echo proves cross-account access', () => {
    if (!sdk.capabilities.some(c=>c.id==='ai-knowledge-workspace-set-permission')) return
    const permission = ai('ai-knowledge-workspace-set-permission')
    expect(permission.inputs.authRoleIds?.lookup?.capabilityId).toBe('contract-support-role-search')
    expect(permission.gaps).toBeUndefined()
    expect(permission.failures.join(' ')).toContain('回显仍有歧义')
    expect(permission.completion).toContain('完成 Portal 权限弹窗的保存动作')
    expect(permission.boundaries.join(' ')).toContain('不能将根节点快照当作整个子树')
  })
})
