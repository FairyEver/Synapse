import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  LEGAL_DISPUTE_METHODS,
  LEGAL_DISPUTE_MODULE_TYPE,
  LEGAL_DISPUTE_PAGE_PATH,
  LEGAL_DISPUTE_PERMISSION,
  legalDisputeCapabilities,
  createLegalDisputeCapability,
  type LegalDisputeForm,
  type LegalDisputeRow,
} from '../src/capabilities/legal-dispute.js'
import { LEGAL_DISPUTE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-legal-dispute.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createLegalDisputeCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: LegalDisputeForm = {
  organizationId: 8,
  year: '2026',
  disputeType: 1,
  litigationType: 2,
  caseReason: '合同纠纷',
  caseNumber: '(2026)示例字1号',
  prosecutor: '甲公司',
  defendant: '乙公司',
  thirdPerson: '丙公司',
  requestItem: '请求支付合同款并承担诉讼费用',
  amount: 10000.5,
  solution: '1',
  result: '判决被告履行合同义务',
  causeLoss: 2000,
  recoverLoss: 1500.25,
  pdfUrl: ['https://oss.example/legal.pdf'],
  pdfName: ['legal.pdf'],
}

const detail: LegalDisputeRow = {
  id: 101,
  organizationId: 8,
  organizationName: '示例组织',
  year: 2026,
  disputeType: 1,
  disputeTypeName: '民事纠纷',
  litigationType: 2,
  litigationTypeName: '诉讼',
  caseReason: form.caseReason,
  caseNumber: form.caseNumber,
  prosecutor: form.prosecutor,
  defendant: form.defendant,
  thirdPerson: form.thirdPerson,
  requestItem: form.requestItem,
  amount: form.amount,
  solution: form.solution,
  result: form.result,
  causeLoss: form.causeLoss,
  recoverLoss: form.recoverLoss,
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  createTime: '2026-09-23 10:00:00',
  creator: 1001,
  creatorName: '测试用户',
}

describe('Portal 风险防控 → 纠纷信息页面能力', () => {
  it('逐页锁定菜单、列表、导出、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/legalDisputes/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/legalDisputes/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${LEGAL_DISPUTE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${LEGAL_DISPUTE_PERMISSION}'`)
    for (const fragment of [
      "'/admin-api/hr/legal-dispute/page'", "'/admin-api/hr/legal-dispute/delete'", '/admin-api/hr/legal-dispute/export-excel',
      'caseReason: \'\'', 'caseNumber: \'\'', 'prosecutor: \'\'', 'defendant: \'\'', 'actionEdit', 'actionDelete', '共享设置',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "'/admin-api/hr/legal-dispute/create'", "'/admin-api/hr/legal-dispute/update'", 'customLoad',
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null", ':max="10"',
      "file.type === 'application/pdf'", 'max: 20', 'max: 50', ':maxlength="100"', ':maxlength="5000"',
      "value: '1'", "value: '2'", "value: '3'",
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(list).toContain('type: 4')
    expect(legalDisputeCapabilities.map(item => item.id)).toEqual(Object.keys(LEGAL_DISPUTE_METHODS))
    expect(legalDisputeCapabilities.every(item => item.pagePath === LEGAL_DISPUTE_PAGE_PATH && item.permission === LEGAL_DISPUTE_PERMISSION && item.moduleType === LEGAL_DISPUTE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java CRUD、金额/年份字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/legaldispute/LegalDisputeController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/legaldispute/vo/LegalDisputeSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/legaldispute/vo/LegalDisputeRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/legaldispute/LegalDisputeServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/legaldispute/LegalDisputeDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/legal-dispute")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long organizationId', 'private BigDecimal amount', 'private BigDecimal causeLoss', 'private BigDecimal recoverLoss', 'private Integer year', 'private Integer disputeType', 'private Integer litigationType', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['LegalDisputeRespVO', 'organizationName', 'disputeTypeName', 'litigationTypeName']) expect(response).toContain(fragment)
    for (const fragment of ['getLegalDisputePage', 'createLegalDispute', 'updateLegalDispute', 'deleteLegalDispute']) expect(service).toContain(fragment)
    expect(dataObject).toContain('extends TenantBaseDO')
    expect(shareEnum).toContain('LEGALDISPUTE(4, "法律纠纷")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、导出、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, name: '示例组织', managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const response = { data: bytes, headers: { 'content-type': 'application/vnd.ms-excel' } }
    const f = fixture([{ list: [detail], total: 1 }, detail, response, 102, true, true, share, true])
    await expect(f.api.list({ caseReason: '合同', caseNumber: '(2026)', prosecutor: '甲', defendant: '乙' })).resolves.toEqual({ list: [expect.objectContaining({ id: 101 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, pdfUrl: detail.pdfUrl, year: 2026 }))
    await expect(f.api.export({ caseReason: '合同' })).resolves.toEqual({ fileName: '法律纠纷.xlsx', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { result: '已调解结案', solution: '2' } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual({ organization: [{ id: 8, name: '示例组织', managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] })
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, name: '示例组织', managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/legal-dispute/page', method: 'get', params: { order: '', orderField: '', caseReason: '合同', caseNumber: '(2026)', prosecutor: '甲', defendant: '乙', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/legal-dispute/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/legal-dispute/export-excel', method: 'get', params: { caseReason: '合同', caseNumber: '', prosecutor: '', defendant: '' }, responseType: 'arraybuffer' },
      { url: '/admin-api/hr/legal-dispute/create', method: 'post', data: { organizationId: 8, year: '2026', disputeType: 1, litigationType: 2, caseReason: '合同纠纷', caseNumber: '(2026)示例字1号', prosecutor: '甲公司', defendant: '乙公司', thirdPerson: '丙公司', requestItem: '请求支付合同款并承担诉讼费用', amount: 10000.5, solution: '1', result: '判决被告履行合同义务', causeLoss: 2000, recoverLoss: 1500.25, pdfUrl: 'https://oss.example/legal.pdf', pdfName: 'legal.pdf' } },
      { url: '/admin-api/hr/legal-dispute/update', method: 'put', data: { id: 101, organizationId: 8, year: '2026', disputeType: 1, litigationType: 2, caseReason: '合同纠纷', caseNumber: '(2026)示例字1号', prosecutor: '甲公司', defendant: '乙公司', thirdPerson: '丙公司', requestItem: '请求支付合同款并承担诉讼费用', amount: 10000.5, solution: '2', result: '已调解结案', causeLoss: 2000, recoverLoss: 1500.25, pdfUrl: 'https://oss.example/legal.pdf', pdfName: 'legal.pdf' } },
      { url: '/admin-api/hr/legal-dispute/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 4, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 4, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、附件配对、权限形状和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, organizationId: 0 })).toThrow('organizationId')
    expect(() => f.api.prepareCreate({ ...form, year: '26' })).toThrow('year')
    expect(() => f.api.prepareCreate({ ...form, caseReason: '' })).toThrow('caseReason')
    expect(() => f.api.prepareCreate({ ...form, caseReason: 'x'.repeat(21) })).toThrow('最多20')
    expect(() => f.api.prepareCreate({ ...form, requestItem: 'x'.repeat(5001) })).toThrow('最多5000')
    expect(() => f.api.prepareCreate({ ...form, amount: -1 })).toThrow('amount')
    expect(() => f.api.prepareCreate({ ...form, amount: 1.234 })).toThrow('最多保留2位小数')
    expect(() => f.api.prepareCreate({ ...form, solution: '4' as never })).toThrow('solution')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 11 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 11 }, (_, i) => `n${i}`) })).toThrow('最多10')
    expect(() => f.api.prepareCreate({ ...form, pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [], pdfName: [] })).not.toThrow()
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('法律纠纷ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([new ArrayBuffer(0)]).api.export()).rejects.toThrow('空文件')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })

  it('AI 说明覆盖表单、权限、导出、共享回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(LEGAL_DISPUTE_METHODS).sort())
    expect(contracts['legal-dispute-create']?.boundaries.join(' ')).toContain('最多10项')
    expect(contracts['legal-dispute-save-share']?.consume.join(' ')).toContain('type 固定为4')
    expect(contracts['legal-dispute-export']?.output.fields.map(item => item.path)).toContain('base64')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
