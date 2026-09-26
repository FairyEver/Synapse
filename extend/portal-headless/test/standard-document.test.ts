import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  STANDARD_DOCUMENT_METHODS,
  STANDARD_DOCUMENT_MODULE_TYPE,
  STANDARD_DOCUMENT_PAGE_PATH,
  STANDARD_DOCUMENT_PERMISSION,
  STANDARD_DOCUMENT_SHARE_TYPE,
  createStandardDocumentCapability,
  standardDocumentCapabilities,
  type StandardDocumentForm,
  type StandardDocumentRow,
} from '../src/capabilities/standard-document.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createStandardDocumentCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: StandardDocumentForm = {
  organizationId: 8,
  isForever: 0,
  endTime: '2030-01-02',
  remindTime: 6,
  remindUser: ['1001', '1002'],
  name: '示例标准',
  scope: '适用于示例组织',
  type: 1,
  code: 'STD-001',
  initiationDate: '2026-01-02',
  releaseDate: '2026-03-02',
  implementationDate: '2026-04-02',
  publishingUnit: '发布单位',
  leadUnit: '牵头单位',
  participatingUnit: '参与单位',
  drafter: '张三',
  standardStatus: 2,
  version: 'V1.0',
  pdfUrl: ['https://oss.example/standard.pdf'],
  pdfName: ['standard.pdf'],
}

const detail: StandardDocumentRow = {
  id: 101,
  ...form,
  endTime: form.endTime ?? null,
  remindTime: form.remindTime ?? null,
  remindUser: form.remindUser.join(','),
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  organizationId: 8,
  organizationName: '示例公司',
  remindUserName: '张三,李四',
  createTime: '2026-09-23 10:00:00',
  status: null,
}

describe('Portal 风险防控 → 标准管理页面能力', () => {
  it('逐页锁定菜单、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/standard-document/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/standard-document/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${STANDARD_DOCUMENT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${STANDARD_DOCUMENT_PERMISSION}'`)
    for (const fragment of [
      "'/admin-api/hr/standard-document/page'", "'/admin-api/hr/standard-document/delete'", 'name: null', 'code: null', 'type: null', 'standardStatus: null', 'organizationId: null',
      'actionEdit', 'actionDelete', '共享设置', 'type: 9',
    ]) expect(list).toContain(fragment)
    expect(list).toContain('<!-- <common-action-core icon="icon-park-outline:download-two" @click="() => actionExport()">导出</common-action-core> -->')
    for (const fragment of [
      "'/admin-api/hr/standard-document/create'", "'/admin-api/hr/standard-document/update'", 'customLoad', 'formatDay', 'disabledDate',
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null", "remindUser: form.remindUser ? form.remindUser.join(',') : null",
      "file.type === 'application/pdf'", ':disabled="rrForm.formState.pdfUrl.length > 4"', ':precision="0"', '最多输入五位数',
      'max: 50', ':maxlength="1000"', ':maxlength="500"', 'isForever', 'standardStatus', 'staff-code-label',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(standardDocumentCapabilities.map(item => item.id)).toEqual(Object.keys(STANDARD_DOCUMENT_METHODS))
    expect(standardDocumentCapabilities.every(item => item.pagePath === STANDARD_DOCUMENT_PAGE_PATH && item.permission === STANDARD_DOCUMENT_PERMISSION && item.moduleType === STANDARD_DOCUMENT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(STANDARD_DOCUMENT_SHARE_TYPE).toBe(9)
    expect(STANDARD_DOCUMENT_METHODS).not.toHaveProperty('standard-document-export')
  })

  it('逐页锁定 Java CRUD、长期有效字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/standarddocument/StandardDocumentController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/standarddocument/vo/StandardDocumentSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/standarddocument/vo/StandardDocumentRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/standarddocument/StandardDocumentServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/standarddocument/StandardDocumentDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/standard-document")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")', '@GetMapping("/getInfoByApp")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private LocalDate initiationDate', 'private LocalDate releaseDate', 'private LocalDate implementationDate', 'private Integer isForever', 'private Long organizationId', 'private LocalDate endTime', 'private Integer remindTime', 'private String remindUser', 'private String pdfUrl', 'private Integer standardStatus']) expect(save).toContain(fragment)
    for (const fragment of ['StandardDocumentRespVO', 'organizationName', 'remindUserName', 'private Integer status', 'private Integer standardStatus']) expect(response).toContain(fragment)
    for (const fragment of ['getStandardDocumentPage', 'dealOrganizationName', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_standard_document")')
    expect(shareEnum).toContain('STANDARD_DOCUMENT(9, "标准类文档")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '标准', code: 'STD', type: 1, standardStatus: 2, organizationId: 8 })).resolves.toEqual({ list: [expect.objectContaining({ id: 101, standardStatus: 2 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, remindUser: detail.remindUser, pdfUrl: detail.pdfUrl }))
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '更新后的标准', remindTime: 12 } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/standard-document/page', method: 'get', params: { order: '', orderField: '', name: '标准', code: 'STD', type: 1, standardStatus: 2, organizationId: 8, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/standard-document/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/standard-document/create', method: 'post', data: { organizationId: 8, isForever: 0, endTime: '2030-01-02', remindTime: 6, remindUser: '1001,1002', name: '示例标准', scope: '适用于示例组织', type: 1, code: 'STD-001', initiationDate: '2026-01-02', releaseDate: '2026-03-02', implementationDate: '2026-04-02', publishingUnit: '发布单位', leadUnit: '牵头单位', participatingUnit: '参与单位', drafter: '张三', standardStatus: 2, version: 'V1.0', pdfUrl: 'https://oss.example/standard.pdf', pdfName: 'standard.pdf' } },
      { url: '/admin-api/hr/standard-document/update', method: 'put', data: { id: 101, organizationId: 8, isForever: 0, endTime: '2030-01-02', remindTime: 12, remindUser: '1001,1002', name: '更新后的标准', scope: '适用于示例组织', type: 1, code: 'STD-001', initiationDate: '2026-01-02', releaseDate: '2026-03-02', implementationDate: '2026-04-02', publishingUnit: '发布单位', leadUnit: '牵头单位', participatingUnit: '参与单位', drafter: '张三', standardStatus: 2, version: 'V1.0', pdfUrl: 'https://oss.example/standard.pdf', pdfName: 'standard.pdf' } },
      { url: '/admin-api/hr/standard-document/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 9, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 9, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、长期有效条件、附件配对和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, name: '' })).toThrow('name')
    expect(() => f.api.prepareCreate({ ...form, code: 'x'.repeat(51) })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...form, publishingUnit: 'x'.repeat(1001) })).toThrow('最多1000')
    expect(() => f.api.prepareCreate({ ...form, drafter: 'x'.repeat(501) })).toThrow('最多500')
    expect(() => f.api.prepareCreate({ ...form, initiationDate: '2026-02-30' })).toThrow('initiationDate')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, isForever: 1, endTime: null, remindTime: null, remindUser: [] })).not.toThrow()
    expect(() => f.api.prepareCreate({ ...form, isForever: 0, endTime: null })).toThrow('endTime')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: ['a'], pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('标准管理ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })
})
