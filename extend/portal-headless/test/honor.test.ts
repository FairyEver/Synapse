import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  HONOR_METHODS,
  HONOR_MODULE_TYPE,
  HONOR_PAGE_PATH,
  HONOR_PERMISSION,
  honorCapabilities,
  createHonorCapability,
  type HonorForm,
  type HonorRow,
} from '../src/capabilities/honor.js'
import { HONOR_AI_CONTRACTS as contracts } from '../src/catalog/contracts-honor.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createHonorCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: HonorForm = {
  organizationId: 8,
  isForever: 0,
  endTime: '2027-01-02',
  remindTime: 3,
  remindUser: ['1001', '1002'],
  name: '年度荣誉',
  awardedDate: '2026-01-02',
  issuingAuthority: '示例颁发机构',
  reportOrganizationId: 9,
  manageOrganizationId: 10,
  depositAddress: '档案室A柜',
  pdfUrl: ['https://oss.example/honor.pdf'],
  pdfName: ['honor.pdf'],
}

const detail: HonorRow = {
  id: 101,
  ...form,
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  remindUser: form.remindUser.join(','),
  endTime: form.endTime ?? null,
  remindTime: form.remindTime ?? null,
  organizationId: 8,
  organizationName: '示例组织',
  reportOrganizationName: '申报部门',
  manageOrganizationName: '管理部门',
  isForever: 0,
  status: 1,
  remindUserName: '员工一,员工二',
}

describe('Portal 风险防控 → 荣誉管理页面能力', () => {
  it('逐页锁定菜单、路由、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/certificate/honors.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/honors/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/honors/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${HONOR_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${HONOR_PERMISSION}'`)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "'/admin-api/hr/honor/page'", "'/admin-api/hr/honor/delete'", '共享设置', 'actionEdit', 'actionDelete',
      'name: null', 'organizationId: null', 'issuingAuthority: null', 'manageOrganizationId: null',
      'actionExport()',
    ]) expect(list).toContain(fragment)
    expect(list).toContain('<!-- <common-action-core')
    for (const fragment of [
      'hr/honor/get?id=${id}', "'/admin-api/hr/honor/update'", "'/admin-api/hr/honor/create'",
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null",
      "remindUser: form.remindUser ? form.remindUser.join(',') : null", '最多输入五位数', 'maxlength="1000"',
      'file.type === \'application/pdf\'', 'pdfUrl.length > 4',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(list).toContain('type: 10')
    expect(honorCapabilities.map(item => item.id)).toEqual(Object.keys(HONOR_METHODS))
    expect(honorCapabilities.every(item => item.pagePath === HONOR_PAGE_PATH && item.permission === HONOR_PERMISSION && item.moduleType === HONOR_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(HONOR_METHODS).not.toHaveProperty('honor-export')
  })

  it('逐页锁定 Java CRUD、Long 字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/honor/HonorController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/honor/vo/HonorSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/honor/vo/HonorRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/honor/HonorServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/honor/HonorDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/honor")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private LocalDate awardedDate', 'private Long organizationId', 'private Integer remindTime', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['HonorRespVO', 'organizationName', 'remindUserName']) expect(response).toContain(fragment)
    for (const fragment of ['getHonorPage', 'dealOrganizationName', 'createHonor', 'updateHonor', 'deleteHonor']) expect(service).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_honor")')
    expect(dataObject).toContain('extends TenantBaseDO')
    expect(shareEnum).toContain('HONOR(10, "荣誉")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '年度', organizationId: 8, issuingAuthority: '示例', manageOrganizationId: 10 })).resolves.toEqual({ list: [expect.objectContaining({ id: 101 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, pdfUrl: form.pdfUrl.join(','), remindUser: form.remindUser.join(',') }))
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '年度荣誉二', remindUser: ['1003'] } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual({ organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] })
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/honor/page', method: 'get', params: { order: '', orderField: '', name: '年度', organizationId: 8, issuingAuthority: '示例', manageOrganizationId: 10, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/honor/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/honor/create', method: 'post', data: { organizationId: 8, isForever: 0, endTime: '2027-01-02', remindTime: 3, remindUser: '1001,1002', name: '年度荣誉', awardedDate: '2026-01-02', issuingAuthority: '示例颁发机构', reportOrganizationId: 9, manageOrganizationId: 10, depositAddress: '档案室A柜', pdfUrl: 'https://oss.example/honor.pdf', pdfName: 'honor.pdf' } },
      { url: '/admin-api/hr/honor/update', method: 'put', data: { id: 101, organizationId: 8, isForever: 0, endTime: '2027-01-02', remindTime: 3, remindUser: '1003', name: '年度荣誉二', awardedDate: '2026-01-02', issuingAuthority: '示例颁发机构', reportOrganizationId: 9, manageOrganizationId: 10, depositAddress: '档案室A柜', pdfUrl: 'https://oss.example/honor.pdf', pdfName: 'honor.pdf' } },
      { url: '/admin-api/hr/honor/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 10, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 10, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单条件、附件配对、共享和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, isForever: 0, endTime: null })).toThrow('endTime')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, remindUser: [] })).toThrow('remindUser')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    expect(() => f.api.prepareCreate({ ...form, isForever: 1, endTime: null, remindTime: null, remindUser: [] })).not.toThrow()
    await expect(f.api.list({ organizationId: 0 })).rejects.toThrow('organizationId')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('荣誉ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })

  it('AI 说明覆盖表单、权限、导出可达性和共享回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(HONOR_METHODS).sort())
    expect(contracts['honor-create']?.boundaries.join(' ')).toContain('PDF')
    expect(contracts['honor-save-share']?.consume.join(' ')).toContain('type 固定为10')
    expect(contracts['honor-list']?.consume.join(' ')).toContain('注释')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
