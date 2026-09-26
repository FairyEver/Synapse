import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import { createTrademarkCapability, TRADEMARK_SHARE_TYPE, type TrademarkForm, type TrademarkRow } from '../src/capabilities/trademark.js'

const portalRoot = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const javaRoot = '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
const portal = (path: string) => readFileSync(resolve(portalRoot, path), 'utf8')
const java = (path: string) => readFileSync(resolve(javaRoot, path), 'utf8')

const listSource = portal('app/portal/views/dashboard/hr/certificate/trademark/list.vue')
const formSource = portal('app/portal/views/dashboard/hr/certificate/trademark/[mode]/[id].vue')
const renewalSource = portal('app/portal/views/dashboard/hr/certificate/trademark/components/renewal-form.vue')
const recordsSource = portal('app/portal/views/dashboard/hr/certificate/trademark/components/renewal-records.vue')
const menuSource = portal('app/portal/menus/hr.js')
const controllerSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/trademark/controller/TrademarkController.java')
const saveSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/trademark/vo/TrademarkSaveReqVO.java')
const renewalSaveSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/trademark/vo/TrademarkRenewalBatchReqVO.java')
const renewalAttachmentSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/trademark/vo/TrademarkRenewalAttachmentVO.java')
const renewalServiceSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/trademark/TrademarkRenewalServiceImpl.java')
const doSource = java('erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/tardemark/TrademarkDO.java')
const shareEnumSource = java('erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')

const form: TrademarkForm = {
  validStatus: 1,
  signNumber: 123456,
  name: '示例商标',
  fileUrl: ['https://example.test/logo.png'],
  category: 12,
  type: 1,
  loginTime: '2024-01-01',
  endTime: '2030-01-01',
  remindTime: 6,
  remindUser: ['1001', 1002],
  organizationId: '2001',
  address: '示例注册地址',
  pdfUrl: ['https://example.test/a.pdf'],
  pdfName: ['a.pdf'],
  product: '核定商品',
}

const row: TrademarkRow = {
  id: '3001', name: form.name, signNumber: String(form.signNumber), fileUrl: form.fileUrl.join(','), category: form.category, type: form.type,
  loginTime: form.loginTime, endTime: form.endTime, remindTime: form.remindTime, remindUser: form.remindUser.join(','), remindUserName: '张三', product: form.product,
  createTime: '2026-09-23 10:00:00', status: 3, pdfUrl: form.pdfUrl.join(','), pdfName: form.pdfName.join(','), organizationId: form.organizationId,
  organizationName: '示例组织', address: form.address, validStatus: form.validStatus, renewalRecordCount: 1, renewable: true,
}

function createRequest (responses: Record<string, unknown> = {}) {
  const calls: Array<Parameters<PortalRequest>[0]> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config)
    const url = config.url ?? ''
    const exact = responses[url]
    if (exact instanceof Error) throw exact
    if (exact !== undefined) return exact as T
    if (url.endsWith('/page')) return { list: [row], total: 1 } as T
    if (url.endsWith('/get')) return row as T
    if (url.endsWith('/create')) return '3001' as T
    if (url.endsWith('/update') || url.endsWith('/delete') || url.endsWith('/createShare')) return true as T
    if (url.endsWith('/getShare')) return { organization: [{ id: '8', name: '组织', managerType: 1 }], post: [], duty: [], user: [] } as T
    if (url.endsWith('/renewal/records')) return { trademark: { id: '3001', name: '示例商标', signNumber: '123456', category: 12, endTime: '2030-01-01' }, records: [] } as T
    if (url.endsWith('/renewal/batch')) return '9001' as T
    throw new Error(`未设置测试响应: ${url}`)
  }
  return { calls, api: createTrademarkCapability(request) }
}

describe('商标管理 Portal/Java/SDK 逐页对齐', () => {
  it('锁定菜单、页面可达动作、筛选、权限、导出和续展入口', () => {
    expect(menuSource).toContain("path: '/dashboard/certificate/trademark/list', permission: '/dashboard/certificate/trademark', title: '商标管理'")
    for (const value of ['signNumber', 'name', 'category', 'type', 'organizationId']) expect(listSource).toContain(`v-model:value="rrList.formState.${value}"`)
    for (const endpoint of ['/admin-api/hr/risk/trademark/page', '/admin-api/hr/risk/trademark/delete', '/admin-api/hr/risk/trademark/export-excel', '/admin-api/hr/risk/trademark/renewal/records', '/admin-api/hr/risk/trademark/renewal/batch']) expect(listSource + renewalSource + recordsSource).toContain(endpoint)
    expect(listSource).toContain('actionBatchRenewal')
    expect(listSource).toContain('actionRenewalRecords')
    expect(listSource).toContain('contentProps: {')
    expect(listSource).toContain('type: 3')
  })

  it('锁定表单提交规则、上传限制和日期约束', () => {
    for (const endpoint of ['/admin-api/hr/risk/trademark/get?id=${id}', '/admin-api/hr/risk/trademark/update', '/admin-api/hr/risk/trademark/create']) expect(formSource).toContain(endpoint)
    for (const field of ['validStatus', 'signNumber', 'name', 'category', 'loginTime', 'endTime', 'remindTime', 'remindUser', 'organizationId', 'address', 'pdfUrl']) expect(formSource).toContain(`${field}: [`)
    expect(formSource).toContain("{ max: 10, message: '最多10个字符'")
    expect(formSource).toContain(':max="3"')
    expect(formSource).toContain(':max="10"')
    expect(formSource).toContain("file.type === 'application/pdf'")
    expect(formSource).toContain('pdfUrl: form.pdfUrl?.join(\',\') || null')
    expect(formSource).toContain('fileUrl: form.fileUrl && form.fileUrl?.length ? form.fileUrl.join(\',\') : null')
    expect(formSource).toContain('loginTimeDisabledDate')
    expect(formSource).toContain('endTimeDisabledDate')
    expect(renewalSource).toContain('最多10个')
    expect(renewalSource).toContain('20 * 1024 * 1024')
    expect(renewalSource).toContain("/admin-api/hr/risk/trademark/renewal/batch")
  })

  it('锁定 Java CRUD、导出、续展校验和租户/共享类型', () => {
    for (const endpoint of ['/create', '/update', '/delete', '/get', '/page', '/renewal/batch', '/renewal/records', '/export-excel']) expect(controllerSource).toContain(endpoint)
    for (const field of ['name', 'signNumber', 'fileUrl', 'category', 'type', 'loginTime', 'endTime', 'remindTime', 'remindUser', 'pdfUrl', 'pdfName', 'organizationId', 'address', 'validStatus']) expect(saveSource).toContain(`private ${field === 'category' || field === 'type' || field === 'remindTime' || field === 'validStatus' ? 'Integer' : field === 'organizationId' ? 'Long' : field === 'loginTime' || field === 'endTime' ? 'LocalDate' : 'String'} ${field};`)
    expect(renewalSaveSource).toContain('@NotEmpty')
    expect(renewalSaveSource).toContain('@Size(max = 10')
    expect(renewalAttachmentSource).toContain('@Positive')
    expect(renewalServiceSource).toContain('20L * 1024 * 1024')
    expect(renewalServiceSource).toContain('ALLOWED_FILE_EXTENSIONS')
    expect(doSource).toContain('extends TenantBaseDO')
    expect(shareEnumSource).toContain('TRADEMARK(3, "商标")')
  })

  it('发送 Portal 相同的列表、详情、CRUD、共享和导出请求', async () => {
    const binary = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-disposition': 'attachment; filename="商标.xls"', 'content-type': 'application/vnd.ms-excel' } }
    const { api, calls } = createRequest({ '/admin-api/hr/risk/trademark/export-excel': binary })
    await api.list()
    await api.get({ id: '3001' })
    await api.create({ draft: form })
    await api.update({ draft: { ...form, id: '3001' } })
    await api.remove({ id: '3001' })
    await api.getShare({ resourceId: '3001' })
    await api.saveShare({ resourceId: '3001', organization: [{ id: '8', name: '展示名', managerType: 2 }], user: [{ id: '9' }] })
    const exported = await api.export({ name: '示例' })
    expect(calls[0]).toEqual({ url: '/admin-api/hr/risk/trademark/page', method: 'get', params: { order: '', orderField: '', signNumber: '', name: '', category: '', type: '', organizationId: '', pageNo: 1, pageSize: 20 } })
    expect(calls[1]).toEqual({ url: '/admin-api/hr/risk/trademark/get', method: 'get', params: { id: '3001' } })
    expect(calls[2]).toMatchObject({ url: '/admin-api/hr/risk/trademark/create', method: 'post', data: { ...form, fileUrl: 'https://example.test/logo.png', remindUser: '1001,1002', pdfUrl: 'https://example.test/a.pdf', pdfName: 'a.pdf' } })
    expect(calls[3]).toMatchObject({ url: '/admin-api/hr/risk/trademark/update', method: 'put', data: { id: '3001', fileUrl: 'https://example.test/logo.png', remindUser: '1001,1002' } })
    expect(calls[4]).toEqual({ url: '/admin-api/hr/risk/trademark/delete', method: 'delete', params: { id: '3001' } })
    expect(calls[5]).toEqual({ url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: TRADEMARK_SHARE_TYPE, resourceId: '3001' } })
    expect(calls[6]).toEqual({ url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 3, resourceId: '3001', organizationIds: [{ id: '8' }], postIds: [], dutyIds: [], userIds: [{ id: '9' }] } })
    expect(calls[7]).toMatchObject({ url: '/admin-api/hr/risk/trademark/export-excel', method: 'get', responseType: 'arraybuffer', params: { order: '', orderField: '', name: '示例', signNumber: '', category: '', type: '', organizationId: '' } })
    expect(exported).toMatchObject({ fileName: '商标.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
  })

  it('续展必须走 prepare 后提交，记录响应按 Portal 形状解析', async () => {
    const { api, calls } = createRequest()
    const prepared = api.prepareRenewal({ trademarkIds: ['3001', 3002], content: '  续展说明  ', attachments: [{ name: 'proof.pdf', url: 'https://example.test/proof.pdf', size: 10 }] })
    expect(prepared.draft.content).toBe('续展说明')
    await api.renewal(prepared)
    const records = await api.getRenewalRecords({ trademarkId: '3001' })
    expect(calls[0]).toEqual({ url: '/admin-api/hr/risk/trademark/renewal/batch', method: 'post', data: { trademarkIds: ['3001', 3002], content: '续展说明', attachments: [{ name: 'proof.pdf', url: 'https://example.test/proof.pdf', size: 10 }] } })
    expect(calls[1]).toEqual({ url: '/admin-api/hr/risk/trademark/renewal/records', method: 'get', params: { trademarkId: '3001' } })
    expect(records.trademark.id).toBe('3001')
    expect(records.records).toEqual([])
  })

  it('坏表单、坏响应、错误回执和非法续展附件都会反证为失败', async () => {
    const { api } = createRequest()
    expect(() => api.prepareCreate({ ...form, endTime: '2023-01-01' })).toThrow(/endTime/)
    expect(() => api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 11 }, (_, i) => `${i}.pdf`), pdfName: Array.from({ length: 11 }, (_, i) => `${i}.pdf`) })).toThrow(/最多10/)
    expect(() => api.prepareRenewal({ trademarkIds: ['1', '1'], content: 'x', attachments: [{ name: 'x.exe', url: 'x', size: 1 }] })).toThrow(/不能重复/)
    const bad = createRequest({ '/admin-api/hr/risk/trademark/update': false })
    await expect(bad.api.update({ draft: { ...form, id: '3001' } })).rejects.toThrow(/不是true/)
    const malformed = createRequest({ '/admin-api/hr/risk/trademark/page': { list: [], total: '1' } })
    await expect(malformed.api.list()).rejects.toThrow(/分页响应/)
    const emptyFile = createRequest({ '/admin-api/hr/risk/trademark/export-excel': { data: new ArrayBuffer(0), headers: {} } })
    await expect(emptyFile.api.export()).rejects.toThrow(/空文件/)
  })
})
