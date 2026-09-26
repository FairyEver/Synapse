import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  PATENT_METHODS,
  PATENT_MODULE_TYPE,
  PATENT_PAGE_PATH,
  PATENT_PERMISSION,
  patentCapabilities,
  createPatentCapability,
  type PatentForm,
  type PatentRow,
} from '../src/capabilities/patent.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createPatentCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: PatentForm = {
  certificateNumber: 'CN-001',
  name: '一种示例发明',
  inventor: '张三',
  patentNumber: 'ZL202612345678.9',
  applyDate: '2026-01-02',
  patentee: '示例公司',
  address: '示例地址',
  announcementDate: '2026-06-02',
  announcementNumber: 'CN123456',
  organizationId: 8,
  endTime: '2036-06-02',
  remindTime: 6,
  remindUser: [1001, 1002],
  pdfUrl: ['https://oss.example/patent.pdf'],
  pdfName: ['patent.pdf'],
}

const detail: PatentRow = {
  id: 101,
  ...form,
  remindUser: form.remindUser.join(','),
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  organizationId: 8,
  organizationName: '示例公司',
  remindUserName: '张三,李四',
  createTime: '2026-09-23 10:00:00',
  status: 3,
}

describe('Portal 风险防控 → 专利管理页面能力', () => {
  it('逐页锁定菜单、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/patent/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/patent/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${PATENT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PATENT_PERMISSION}'`)
    for (const fragment of [
      "'/admin-api/hr/patent/page'", "'/admin-api/hr/patent/delete'", "name: ''", "patentNumber: ''", "inventor: ''", "status: ''",
      'actionEdit', 'actionDelete', '共享设置', 'type: 6',
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('export-excel')
    for (const fragment of [
      "'/admin-api/hr/patent/create'", "'/admin-api/hr/patent/update'", 'customLoad', 'formatDay',
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null", "remindUser: form.remindUser ? form.remindUser.join(',') : null",
      'file.type === \'application/pdf\'', ':disabled="rrForm.formState.pdfUrl.length > 4"', ':precision="0"', '最多输入五位数',
      'max: 20', 'max: 50', 'staff-code-label',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(patentCapabilities.map(item => item.id)).toEqual(Object.keys(PATENT_METHODS))
    expect(patentCapabilities.every(item => item.pagePath === PATENT_PAGE_PATH && item.permission === PATENT_PERMISSION && item.moduleType === PATENT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(PATENT_METHODS).not.toHaveProperty('patent-export')
  })

  it('逐页锁定 Java CRUD、日期/提醒/附件字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/patent/HrPatentController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/patent/vo/HrPatentSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/patent/vo/HrPatentRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/patent/HrPatentServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/patent/HrPatentDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/patent")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private LocalDate applyDate', 'private Long organizationId', 'private LocalDate endTime', 'private Integer remindTime', 'private String remindUser', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['HrPatentRespVO', 'remindUserName', 'organizationName', 'private Integer status']) expect(response).toContain(fragment)
    for (const fragment of ['getPatentPage', 'dealRemindUser', 'setRemindUserInfo', 'setPatentRemindUser', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_patent")')
    expect(shareEnum).toContain('PATENT(6, "专利")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '发明', patentNumber: 'ZL2026', inventor: '张' })).resolves.toEqual({ list: [expect.objectContaining({ id: 101, status: 3 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, remindUser: detail.remindUser, pdfUrl: detail.pdfUrl }))
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '一种更新后的发明', remindTime: 12 } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/patent/page', method: 'get', params: { order: '', orderField: '', name: '发明', patentNumber: 'ZL2026', inventor: '张', status: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/patent/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/patent/create', method: 'post', data: { certificateNumber: 'CN-001', name: '一种示例发明', inventor: '张三', patentNumber: 'ZL202612345678.9', applyDate: '2026-01-02', patentee: '示例公司', address: '示例地址', announcementDate: '2026-06-02', announcementNumber: 'CN123456', organizationId: 8, endTime: '2036-06-02', remindTime: 6, remindUser: '1001,1002', pdfUrl: 'https://oss.example/patent.pdf', pdfName: 'patent.pdf' } },
      { url: '/admin-api/hr/patent/update', method: 'put', data: { id: 101, certificateNumber: 'CN-001', name: '一种更新后的发明', inventor: '张三', patentNumber: 'ZL202612345678.9', applyDate: '2026-01-02', patentee: '示例公司', address: '示例地址', announcementDate: '2026-06-02', announcementNumber: 'CN123456', organizationId: 8, endTime: '2036-06-02', remindTime: 12, remindUser: '1001,1002', pdfUrl: 'https://oss.example/patent.pdf', pdfName: 'patent.pdf' } },
      { url: '/admin-api/hr/patent/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 6, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 6, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、附件配对、隐藏筛选和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, certificateNumber: '' })).toThrow('certificateNumber')
    expect(() => f.api.prepareCreate({ ...form, certificateNumber: 'x'.repeat(21) })).toThrow('最多20')
    expect(() => f.api.prepareCreate({ ...form, name: 'x'.repeat(51) })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...form, applyDate: '2026-02-30' })).toThrow('applyDate')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, remindUser: [] })).toThrow('remindUser')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    expect(() => f.api.prepareCreate({ ...form, pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, patentee: 'x'.repeat(51) })).toThrow('最多50')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('专利ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })
})
