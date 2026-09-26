import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  CERTIFICATE_LICENSE_METHODS,
  CERTIFICATE_LICENSE_MODULE_TYPE,
  CERTIFICATE_LICENSE_PAGE_PATH,
  CERTIFICATE_LICENSE_PERMISSION,
  certificateLicenseCapabilities,
  createCertificateLicenseCapability,
} from '../src/capabilities/certificate-license.js'
import { CERTIFICATE_LICENSE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-certificate-license.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createCertificateLicenseCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const folder = {
  id: 1, pid: null, parentId: null, type: 1, name: '证照目录', roleIds: [7], children: [],
}

const license = {
  id: 2, pid: 1, parentId: 1, type: 2, name: '营业执照', category: 3, categoryName: '营业执照', organizationId: 18,
  isOur: 1, legalName: '张三', legalCode: '1001', perpetual: 0, startTime: '2026-01-01', endTime: '2027-01-01',
  remindUserCode: '1001', remindUserList: ['张三'], fileUrl: 'https://oss/image.png', fileUrlList: ['https://oss/image.png'],
  pdfUrl: 'https://oss/license.pdf', pdfUrlList: ['https://oss/license.pdf'], pdfName: 'license.pdf', pdfNameList: ['license.pdf'],
  expireStatus: 0, creator: 9, creatorName: '管理员', createTime: '2026-01-01 10:00:00', roleIds: [],
}

const form = {
  category: 3, pid: 1, organizationId: 18, name: '营业执照', legalName: null,
  legalCode: [{ staffCode: '1001', name: '张三' }], isOur: 1 as const, perpetual: 0 as const,
  startTime: '2026-01-01', endTime: '2027-01-01', remindUserCode: [{ staffCode: '1001', name: '张三' }],
  fileUrl: ['https://oss/image.png'], pdfUrl: ['https://oss/license.pdf'], pdfName: ['license.pdf'],
}

describe('Portal 风险防控 → 证照管理页面能力', () => {
  it('逐页锁定菜单、目录树、证照表单、识别、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/certificate/certificate.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/certificate/list.vue')
    const folderForm = read(root, 'app/portal/views/dashboard/hr/certificate/certificate/[mode]/[id].vue')
    const licenseForm = read(root, 'app/portal/views/dashboard/hr/certificate/certificate/actions/upload-certificate.vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    for (const fragment of [`path: '${CERTIFICATE_LICENSE_PAGE_PATH}'`, `permission: '${CERTIFICATE_LICENSE_PERMISSION}'`]) expect(menu).toContain(fragment)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of ["'/admin-api/system/license/tree'", "`/admin-api/system/license/delete?id=${record.id}`", '新建文件夹', '新建证照', '共享设置', '下级目录', '下级证照']) expect(list).toContain(fragment)
    for (const fragment of ["'/admin-api/system/license/create-file'", 'roleList', 'type: 1', 'name: [', '最多50个字符']) expect(folderForm).toContain(fragment)
    for (const fragment of ["'/admin-api/system/license-category/simple-list'", "'/admin-api/system/license/create'", "'/admin-api/system/license/update'", 'fileUrl: form.fileUrl.join', 'pdfUrl: form.pdfUrl.join', "file.type === 'application/pdf'", '至少填写一个']) expect(licenseForm).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(certificateLicenseCapabilities.map(item => item.id)).toEqual(Object.keys(CERTIFICATE_LICENSE_METHODS))
    expect(certificateLicenseCapabilities.every(item => item.pagePath === CERTIFICATE_LICENSE_PAGE_PATH && item.permission === CERTIFICATE_LICENSE_PERMISSION && item.moduleType === CERTIFICATE_LICENSE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java 端点、租户/资源权限和文件夹删除边界', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const licenseController = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/HrLicenseController.java')
    const licenseService = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/license/HrLicenseServiceImpl.java')
    const licenseSave = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/vo/HrLicenseSaveReqVO.java')
    const shareController = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/share/HrShareUserController.java')
    for (const fragment of ['@RequestMapping("/system/license")', '@GetMapping("/tree")', '@GetMapping("/get")', '@PostMapping("/create")', '@PutMapping("/update")', '@PostMapping("/create-file")', '@DeleteMapping("/delete")', '@PostMapping("/pictureRecognition")']) expect(licenseController).toContain(fragment)
    for (const fragment of ['policyService.getLoginUserPermission', 'ShareTypeEnum.LICENSE', 'TenantContextHolder', '请先删除文件夹中的文件', 'validNameDuplicate', 'setRemindUser']) expect(licenseService).toContain(fragment)
    for (const fragment of ['private Long category', 'private Long pid', 'private Long organizationId', 'private String remindUserCode', 'private List<Long> roleList', 'private String pdfUrl']) expect(licenseSave).toContain(fragment)
    for (const fragment of ['@RequestMapping("/system/share-user")', '@GetMapping("/getShare")', '@PostMapping("/createShare")']) expect(shareController).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖树、文件夹、证照、识别、共享和删除', async () => {
    const share = { organization: [{ id: 18, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([[{ ...folder, children: [license] }], license, [{ id: 3, name: '营业执照', remindTime: 30, count: 1, tipTemplateId: 9 }], 10, true, true, true, true, true, { name: '营业执照', startTime: '2026-01-01', endTime: '2027-01-01', perpetual: '0' }, share, true])
    await expect(f.api.list({ name: '营业' })).resolves.toEqual([expect.objectContaining({ id: 1, children: [expect.objectContaining({ id: 2, childrenCount: '' })] })])
    await expect(f.api.get({ id: 2 })).resolves.toEqual(expect.objectContaining({ id: 2, fileUrlList: ['https://oss/image.png'], pdfNameList: ['license.pdf'] }))
    await expect(f.api.categoryList()).resolves.toEqual([{ id: 3, name: '营业执照', remindTime: 30, count: 1, tipTemplateId: 9 }])
    const folderPrepared = f.api.prepareCreateFolder({ name: '新目录', pid: null, roleList: [7] })
    await expect(f.api.createFolder({ draft: folderPrepared.draft })).resolves.toBe(10)
    const folderPreparedUpdate = f.api.prepareUpdateFolder({ current: { ...folder, children: undefined } as never, changes: { name: '新目录二' } })
    await expect(f.api.updateFolder({ draft: folderPreparedUpdate.draft })).resolves.toBe(true)
    const prepared = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: prepared.draft })).resolves.toBe(true)
    const updatePrepared = f.api.prepareUpdate({ current: license as never, changes: { name: '营业执照二' } })
    await expect(f.api.update({ draft: updatePrepared.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 2 })).resolves.toBe(true)
    await expect(f.api.tipTemplate({ categoryId: 3 })).resolves.toBe(true)
    await expect(f.api.pictureRecognition({ imgUrl: 'https://oss/image.png', type: 3 })).resolves.toEqual({ name: '营业执照', startTime: '2026-01-01', endTime: '2027-01-01', perpetual: '0' })
    await expect(f.api.getShare({ resourceId: 2 })).resolves.toEqual({ organization: [{ id: 18, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] })
    await expect(f.api.saveShare({ resourceId: 2, organization: [{ id: 18, managerType: 1 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/license/tree', method: 'get', params: { name: '营业' } },
      { url: '/admin-api/system/license/get', method: 'get', params: { id: 2 } },
      { url: '/admin-api/system/license-category/simple-list', method: 'get' },
      { url: '/admin-api/system/license/create-file', method: 'post', data: { name: '新目录', pid: 0, roleList: [7], type: 1 }, headers: { 'Content-Type': 'multipart/form-data' } },
      { url: '/admin-api/system/license/update', method: 'put', data: { id: 1, name: '新目录二', pid: 0, roleList: [7], type: 1 } },
      { url: '/admin-api/system/license/create', method: 'post', data: { category: 3, pid: 1, organizationId: 18, name: '营业执照', legalName: '张三', legalCode: '1001', isOur: 1, perpetual: 0, startTime: '2026-01-01', endTime: '2027-01-01', remindUserCode: '1001', fileUrl: 'https://oss/image.png', pdfUrl: 'https://oss/license.pdf', pdfName: 'license.pdf' } },
      { url: '/admin-api/system/license/update', method: 'put', data: { id: 2, category: 3, pid: 1, organizationId: 18, name: '营业执照二', legalName: '张三', legalCode: '1001', isOur: 1, perpetual: 0, startTime: '2026-01-01', endTime: '2027-01-01', remindUserCode: '1001', fileUrl: 'https://oss/image.png', pdfUrl: 'https://oss/license.pdf', pdfName: 'license.pdf' } },
      { url: '/admin-api/system/license/delete', method: 'delete', params: { id: 2 } },
      { url: '/admin-api/system/license/isHaveTipTemplate', method: 'get', params: { categoryId: 3 } },
      { url: '/admin-api/system/license/pictureRecognition', method: 'post', data: { imgUrl: 'https://oss/image.png', type: 3 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 2, resourceId: 2 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 2, resourceId: 2, organizationIds: [{ id: 18 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单、附件、删除和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ name: 1 as never })).rejects.toThrow('name')
    expect(() => f.api.prepareCreate({ ...form, endTime: null })).toThrow('endTime')
    expect(() => f.api.prepareCreate({ ...form, remindUserCode: [] })).toThrow('remindUserCode')
    expect(() => f.api.prepareCreate({ ...form, fileUrl: [], pdfUrl: [], pdfName: [] })).toThrow('至少填写一个')
    expect(() => f.api.prepareCreate({ ...form, pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, isOur: 0, legalCode: [], legalName: '' })).not.toThrow()
    expect(() => f.api.prepareCreate({ ...form, isOur: 0, legalCode: [], legalName: '超出十个字符的法人名称' })).toThrow('legalName')
    expect(() => f.api.prepareCreateFolder({ name: ' '.repeat(2) })).toThrow('name')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('证照ID')
    await expect(f.api.get({ id: 1 })).rejects.toThrow('证照详情')
    expect(f.calls).toEqual([{ url: '/admin-api/system/license/get', method: 'get', params: { id: 1 } }])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('数组')
    await expect(fixture([false]).api.tipTemplate({ categoryId: 3 })).resolves.toBe(false)
  })

  it('AI 说明覆盖表单转换、权限、删除和共享回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(CERTIFICATE_LICENSE_METHODS).sort())
    expect(contracts['certificate-license-create']?.boundaries.join(' ')).toContain('图片和 PDF')
    expect(contracts['certificate-license-remove']?.boundaries.join(' ')).toContain('文件夹内有证照')
    expect(contracts['certificate-license-save-share']?.steps).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'certificate-license-get-share' })]))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
