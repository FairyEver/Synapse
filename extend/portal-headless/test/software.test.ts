import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  SOFTWARE_METHODS,
  SOFTWARE_MODULE_TYPE,
  SOFTWARE_PAGE_PATH,
  SOFTWARE_PERMISSION,
  SOFTWARE_SHARE_TYPE,
  createSoftwareCapability,
  softwareCapabilities,
  type SoftwareForm,
  type SoftwareRow,
} from '../src/capabilities/software.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSoftwareCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: SoftwareForm = {
  softwareNumber: 'RJ-001',
  name: '示例软件',
  inventor: '张三',
  developDate: '2026-01-02',
  firstPublishDate: null,
  way: 1,
  radius: '全部权利',
  signNumber: '登记-001',
  organizationId: 8,
  endTime: '2030-06-02',
  remindTime: 6,
  remindUser: ['1001', '1002'],
  pdfUrl: ['https://oss.example/software.pdf'],
  pdfName: ['software.pdf'],
}

const detail: SoftwareRow = {
  id: 101,
  ...form,
  developDate: form.developDate,
  firstPublishDate: form.firstPublishDate,
  remindUser: form.remindUser.join(','),
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  organizationId: 8,
  organizationName: '示例公司',
  wayStr: '原始取得',
  remindUserName: '张三,李四',
  createTime: '2026-09-23 10:00:00',
  status: 3,
}

describe('Portal 风险防控 → 软著管理页面能力', () => {
  it('逐页锁定菜单、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/softwork/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/softwork/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${SOFTWARE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SOFTWARE_PERMISSION}'`)
    for (const fragment of [
      "'/admin-api/hr/software/page'", "'/admin-api/hr/software/delete'", "name: ''", "softwareNumber: ''", "inventor: ''", "status: ''",
      'actionEdit', 'actionDelete', '共享设置', 'type: 8',
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('export-excel')
    for (const fragment of [
      "'/admin-api/hr/software/create'", "'/admin-api/hr/software/update'", 'customLoad', 'formatDay',
      "pdfUrl: form.pdfUrl?.join(',') || null", "pdfName: form.pdfName?.join(',') || null", "remindUser: form.remindUser ? form.remindUser.join(',') : null",
      "file.type === 'application/pdf'", ':disabled="rrForm.formState.pdfUrl.length > 4"', ':precision="0"', '最多输入五位数',
      'max: 20', 'max: 50', 'max: 100', 'staff-code-label', 'value: 1', 'value: 2',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(softwareCapabilities.map(item => item.id)).toEqual(Object.keys(SOFTWARE_METHODS))
    expect(softwareCapabilities.every(item => item.pagePath === SOFTWARE_PAGE_PATH && item.permission === SOFTWARE_PERMISSION && item.moduleType === SOFTWARE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(SOFTWARE_SHARE_TYPE).toBe(8)
    expect(SOFTWARE_METHODS).not.toHaveProperty('software-export')
  })

  it('逐页锁定 Java CRUD、软著字段、租户数据对象和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/software/HrSoftwareController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/software/vo/HrSoftwareSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/software/vo/HrSoftwareRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/software/HrSoftwareServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/software/HrSoftwareDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/software")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private LocalDate developDate', 'private LocalDate firstPublishDate', 'private Integer way', 'private Long organizationId', 'private LocalDate endTime', 'private Integer remindTime', 'private String remindUser', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['HrSoftwareRespVO', 'wayStr', 'remindUserName', 'organizationName', 'private Integer status']) expect(response).toContain(fragment)
    for (const fragment of ['getSoftwarePage', 'dealRemindUser', 'setRemindUserInfo', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_software")')
    expect(shareEnum).toContain('SOFTWARE(8, "软著")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '软件', softwareNumber: 'RJ', inventor: '张' })).resolves.toEqual({ list: [expect.objectContaining({ id: 101, status: 3 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, remindUser: detail.remindUser, pdfUrl: detail.pdfUrl }))
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '更新后的软件', remindTime: 12 } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/software/page', method: 'get', params: { order: '', orderField: '', name: '软件', softwareNumber: 'RJ', inventor: '张', status: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/software/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/software/create', method: 'post', data: { softwareNumber: 'RJ-001', name: '示例软件', inventor: '张三', developDate: '2026-01-02', firstPublishDate: null, way: 1, radius: '全部权利', signNumber: '登记-001', organizationId: 8, endTime: '2030-06-02', remindTime: 6, remindUser: '1001,1002', pdfUrl: 'https://oss.example/software.pdf', pdfName: 'software.pdf' } },
      { url: '/admin-api/hr/software/update', method: 'put', data: { id: 101, softwareNumber: 'RJ-001', name: '更新后的软件', inventor: '张三', developDate: '2026-01-02', firstPublishDate: null, way: 1, radius: '全部权利', signNumber: '登记-001', organizationId: 8, endTime: '2030-06-02', remindTime: 12, remindUser: '1001,1002', pdfUrl: 'https://oss.example/software.pdf', pdfName: 'software.pdf' } },
      { url: '/admin-api/hr/software/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 8, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 8, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、附件配对和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, softwareNumber: '' })).toThrow('softwareNumber')
    expect(() => f.api.prepareCreate({ ...form, softwareNumber: 'x'.repeat(21) })).toThrow('最多20')
    expect(() => f.api.prepareCreate({ ...form, name: 'x'.repeat(51) })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...form, radius: 'x'.repeat(101) })).toThrow('最多100')
    expect(() => f.api.prepareCreate({ ...form, developDate: '2026-02-30' })).toThrow('developDate')
    expect(() => f.api.prepareCreate({ ...form, way: 3 as never })).toThrow('way')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, remindUser: [] })).toThrow('remindUser')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: ['a'], pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('软著ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })
})
