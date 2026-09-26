import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  QUALIFICATION_METHODS,
  QUALIFICATION_MODULE_TYPE,
  QUALIFICATION_PAGE_PATH,
  QUALIFICATION_PERMISSION,
  qualificationCapabilities,
  createQualificationCapability,
  type QualificationForm,
  type QualificationRow,
} from '../src/capabilities/qualification.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createQualificationCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: QualificationForm = {
  organizationId: 8,
  isForever: 0,
  endTime: '2027-01-02',
  remindTime: 3,
  remindUser: ['1001', '1002'],
  name: '年度资质',
  awardedDate: '2026-01-02',
  lastAwardedDate: '2026-06-02',
  issuingAuthority: '示例颁发机构',
  reportOrganizationId: 9,
  manageOrganizationId: 10,
  depositAddress: '档案室A柜',
  pdfUrl: ['https://oss.example/qualification.pdf'],
  pdfName: ['qualification.pdf'],
}

const detail: QualificationRow = {
  id: 101,
  ...form,
  endTime: form.endTime ?? null,
  remindTime: form.remindTime ?? null,
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  remindUser: form.remindUser.join(','),
  organizationName: '示例公司',
  reportOrganizationName: '申报部门',
  manageOrganizationName: '管理部门',
  remindUserName: '张三,李四',
  createTime: '2026-09-23 10:00:00',
  status: null,
}

describe('Portal 风险防控 → 资质管理页面能力', () => {
  it('逐页锁定菜单、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/qualifications/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/qualifications/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${QUALIFICATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${QUALIFICATION_PERMISSION}'`)
    for (const fragment of [
      "'/admin-api/hr/aptitude/page'", "'/admin-api/hr/aptitude/delete'", "name: null", 'organizationId: null', "issuingAuthority: null", 'manageOrganizationId: null',
      'actionEdit', 'actionDelete', '共享设置', 'type: 11',
    ]) expect(list).toContain(fragment)
    expect(list).toContain('<!-- <common-action-core icon="icon-park-outline:download-two" @click="() => actionExport()">导出</common-action-core> -->')
    for (const fragment of [
      "'/admin-api/hr/aptitude/create'", "'/admin-api/hr/aptitude/update'", 'customLoad', 'formatDay',
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null", "remindUser: form.remindUser ? form.remindUser.join(',') : null",
      'file.type === \'application/pdf\'', ':disabled="rrForm.formState.pdfUrl.length > 4"', ':precision="0"', '最多输入五位数',
      'lastAwardedDate', ':maxlength="1000"', 'staff-code-label',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(qualificationCapabilities.map(item => item.id)).toEqual(Object.keys(QUALIFICATION_METHODS))
    expect(qualificationCapabilities.every(item => item.pagePath === QUALIFICATION_PAGE_PATH && item.permission === QUALIFICATION_PERMISSION && item.moduleType === QUALIFICATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(QUALIFICATION_METHODS).not.toHaveProperty('qualification-export')
  })

  it('逐页锁定 Java CRUD、条件字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/aptitude/AptitudeController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/aptitude/vo/AptitudeSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/aptitude/vo/AptitudeRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/aptitude/AptitudeServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/aptitude/AptitudeDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/aptitude")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private LocalDate awardedDate', 'private LocalDate lastAwardedDate', 'private Long reportOrganizationId', 'private Integer isForever', 'private String remindUser', 'private LocalDate endTime', 'private Integer remindTime', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['AptitudeRespVO', 'remindUserName', 'organizationName', 'private Integer status']) expect(response).toContain(fragment)
    for (const fragment of ['getAptitudePage', 'dealOrganizationName', 'selectPage', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_aptitude")')
    expect(shareEnum).toContain('APTITUDE(11, "资质")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '资质', organizationId: 8, issuingAuthority: '机构', manageOrganizationId: 10 })).resolves.toEqual({ list: [expect.objectContaining({ id: 101, isForever: 0 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, lastAwardedDate: detail.lastAwardedDate, remindUser: detail.remindUser }))
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '更新后的资质', remindTime: 12 } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/aptitude/page', method: 'get', params: { order: '', orderField: '', name: '资质', organizationId: 8, issuingAuthority: '机构', manageOrganizationId: 10, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/aptitude/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/aptitude/create', method: 'post', data: { organizationId: 8, isForever: 0, endTime: '2027-01-02', remindTime: 3, remindUser: '1001,1002', name: '年度资质', awardedDate: '2026-01-02', lastAwardedDate: '2026-06-02', issuingAuthority: '示例颁发机构', reportOrganizationId: 9, manageOrganizationId: 10, depositAddress: '档案室A柜', pdfUrl: 'https://oss.example/qualification.pdf', pdfName: 'qualification.pdf' } },
      { url: '/admin-api/hr/aptitude/update', method: 'put', data: { id: 101, organizationId: 8, isForever: 0, endTime: '2027-01-02', remindTime: 12, remindUser: '1001,1002', name: '更新后的资质', awardedDate: '2026-01-02', lastAwardedDate: '2026-06-02', issuingAuthority: '示例颁发机构', reportOrganizationId: 9, manageOrganizationId: 10, depositAddress: '档案室A柜', pdfUrl: 'https://oss.example/qualification.pdf', pdfName: 'qualification.pdf' } },
      { url: '/admin-api/hr/aptitude/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 11, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 11, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、长期有效条件、附件配对和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, name: '' })).toThrow('name')
    expect(() => f.api.prepareCreate({ ...form, name: 'x'.repeat(51) })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...form, issuingAuthority: 'x'.repeat(1001) })).toThrow('最多1000')
    expect(() => f.api.prepareCreate({ ...form, lastAwardedDate: '2026-02-30' })).toThrow('lastAwardedDate')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, remindUser: [] })).toThrow('remindUser')
    expect(() => f.api.prepareCreate({ ...form, isForever: 1, endTime: null, remindTime: null, remindUser: [] })).not.toThrow()
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('资质ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })
})
