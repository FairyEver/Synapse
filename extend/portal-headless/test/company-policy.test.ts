import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  COMPANY_POLICY_METHODS,
  COMPANY_POLICY_MODULE_TYPE,
  COMPANY_POLICY_PAGE_PATH,
  COMPANY_POLICY_PERMISSION,
  COMPANY_POLICY_POWER_CONTENT_ID,
  COMPANY_POLICY_SHARE_TYPE,
  companyPolicyCapabilities,
  createCompanyPolicyCapability,
  type CompanyPolicyDocumentCreateInput,
  type CompanyPolicyRow,
} from '../src/capabilities/company-policy.js'
import { COMPANY_POLICY_AI_CONTRACTS as contracts } from '../src/catalog/contracts-company-policy.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createCompanyPolicyCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

afterEach(() => vi.useRealTimers())

const directoryList = [{
  directoryName: '第一章',
  directoryContent: '总则',
  chapterList: [{ chapterName: '第一节', chapterContent: '范围' }],
}]

const folder: CompanyPolicyRow = {
  id: 10,
  pid: null,
  category: null,
  categoryName: null,
  type: 1,
  name: '制度目录',
  fileUrl: null,
  roleIds: [8],
  creator: 7,
  creatorName: '管理员',
  statics: null,
  isRead: null,
  isNeedRead: null,
  createTime: '2026-09-24 10:00:00',
  childrenCount: 1,
  organizationId: null,
  organizationName: null,
  directoryList: [],
  studentsNumber: null,
}

const policy: CompanyPolicyRow = {
  id: 11,
  pid: 10,
  category: 7,
  categoryName: '人事制度',
  type: 2,
  name: '员工手册.pdf',
  fileUrl: 'http://oss.example/employee.pdf',
  roleIds: [8],
  creator: 7,
  creatorName: '管理员',
  statics: 2,
  isRead: 1,
  isNeedRead: 0,
  createTime: '2026-09-24 10:01:00',
  childrenCount: 0,
  organizationId: 9,
  organizationName: '示例组织',
  directoryList,
  studentsNumber: '2/5',
}

const documentForm: CompanyPolicyDocumentCreateInput = {
  pid: 10,
  category: 7,
  organizationId: 9,
  files: [{
    name: '制度.pdf',
    fileUrl: 'https://oss.example/policy.pdf',
    mimeType: 'application/pdf',
  }],
  directoryList: [{
    directoryContent: '总则',
    chapterList: [{ chapterContent: '范围' }],
  }],
}

const powerContent = {
  id: COMPANY_POLICY_POWER_CONTENT_ID,
  dictTypeId: 77,
  dictLabel: '无权限时显示的内容',
  dictValue: 'policy-no-permission',
  remark: null,
  sort: 1,
  createDate: '2026-01-01 00:00:00',
  updateDate: '2026-09-24 10:00:00',
}

describe('Portal 风险防控 → 公司制度页面能力', () => {
  it('逐页锁定菜单、路由、树列表、两类表单、统计、权限内容、下载和共享', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/institution/company.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/institution/company/list.vue')
    const folderPage = read(root, 'app/portal/views/dashboard/hr/institution/company/[mode]/[id].vue')
    const uploadPage = read(root, 'app/portal/views/dashboard/hr/institution/company/actions/upload-institution.vue')
    const statics = read(root, 'app/portal/views/dashboard/hr/institution/company/statics.vue')
    const power = read(root, 'app/portal/views/dashboard/hr/institution/company/components/power-content.vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')

    expect(menu).toContain(`path: '${COMPANY_POLICY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${COMPANY_POLICY_PERMISSION}'`)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "'/admin-api/system/policy/tree'", "url: `/admin-api/system/policy/delete?id=${record.id}`",
      'actionUploadInstitution', 'actionPowerContent', 'openStaticsView', 'actionDownload',
      'actionShareSetting', '新建文件夹', '上传制度', '无权限内容',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "/admin-api/system/policy/get?id=${id}", "'/admin-api/system/policy/create-file'",
      "method: form.id ? 'put' : 'post'", "'/admin-api/system/policy/update'",
      "type: 1", 'roleIds', 'pid: form.pid || 0', 'multipart/form-data',
    ]) expect(folderPage).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/policy-category/simple-list'", "'/admin-api/system/policy/update'",
      "'/admin-api/system/policy/create'", 'directoryList', 'type: 2',
      "file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
      "file.type === 'application/pdf'", "file.type === 'application/msword'", '最多上传10个文件',
    ]) expect(uploadPage).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/policy/getStudent'", 'policyId', 'pageNo', 'pageSize', 'isRead',
    ]) expect(statics).toContain(fragment)
    for (const fragment of [
      "const id = '1225814271879340854'", "'/sys/dict/data'", 'updateDate',
    ]) expect(power).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'",
      'organizationIds', 'postIds', 'dutyIds', 'userIds',
    ]) expect(share).toContain(fragment)

    expect(list).toContain('type: 1')
    expect(list).toContain('record.type === 2')
    expect(companyPolicyCapabilities.map(item => item.id)).toEqual(Object.keys(COMPANY_POLICY_METHODS))
    expect(companyPolicyCapabilities.every(item => item.pagePath === COMPANY_POLICY_PAGE_PATH && item.permission === COMPANY_POLICY_PERMISSION && item.moduleType === COMPANY_POLICY_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java 制度、分类、统计、目录章节和共享端点', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/HrPolicyController.java')
    const categoryController = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/HrPolicyCategoryController.java')
    const shareController = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/share/HrShareUserController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrPolicySaveReqVO.java')
    const upload = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrUploadFilesSaveReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrPolicyRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/policy/HrPolicyServiceImpl.java')
    for (const fragment of [
      '@RequestMapping("/system/policy")', '@GetMapping("/tree")', '@GetMapping("/get")',
      '@GetMapping("/simple-list")', '@PostMapping("/create")', '@PutMapping("/update")',
      '@PostMapping("/create-file")', '@DeleteMapping("/delete")', '@GetMapping("/getStudent")',
    ]) expect(controller).toContain(fragment)
    expect(categoryController).toContain('@RequestMapping("/system/policy-category")')
    expect(categoryController).toContain('@GetMapping("/simple-list")')
    for (const fragment of ['getShare', 'createShare', 'type', 'resourceId']) expect(shareController).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long pid', 'private Integer type', 'directoryList', 'roleIds']) expect(save).toContain(fragment)
    for (const fragment of ['private Long pid', 'private Long category', 'private List', 'organizationId']) expect(upload).toContain(fragment)
    for (const fragment of ['extends TreeNode<Long>', 'private Long pid', 'private Integer type', 'directoryList', 'studentsNumber']) expect(response).toContain(fragment)
    for (const fragment of ['createPolicyFile', 'createPolicy', 'updatePolicy', 'delete', 'getTree', 'getStudent']) expect(service).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖树、分类、文件夹/制度表单、学习人员、字典、下载和共享', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-24T12:00:00+08:00') })
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const share = { organization: [{ id: 8, name: '组织', managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 2 }] }
    const response = { data: bytes, headers: { 'content-type': 'application/pdf' } } as unknown as AxiosResponse<ArrayBuffer>
    const f = fixture([
      [{ ...folder, children: [{ ...policy, children: [] }] }],
      [{ ...folder, children: [] }],
      [{ id: 7, name: '人事制度', sort: 1, size: 2 }],
      folder,
      12,
      true,
      true,
      true,
      { list: [{ realName: '员工一', mobile: '13800000000', isRead: 1 }], total: 1 },
      powerContent,
      true,
      share,
      true,
      response,
    ])

    await expect(f.api.list({ name: '员工' })).resolves.toEqual([{ ...folder, children: [policy] }])
    await expect(f.api.parentList()).resolves.toEqual([folder])
    await expect(f.api.categoryList()).resolves.toEqual([{ id: 7, name: '人事制度', sort: 1, size: 2 }])
    await expect(f.api.get({ id: 10 })).resolves.toEqual(folder)

    const folderDraft = f.api.prepareCreateFolder({ name: ' 新目录 ', pid: null, roleIds: ['8'] }).draft
    await expect(f.api.createFolder({ draft: folderDraft })).resolves.toBe(12)
    await expect(f.api.updateFolder({ draft: { ...folderDraft, id: 10, name: '新目录' } })).resolves.toBe(true)

    const documentDraft = f.api.prepareCreate(documentForm).draft
    await expect(f.api.create({ draft: documentDraft })).resolves.toBe(true)
    const updateDraft = f.api.prepareUpdate({ current: policy, changes: { name: '员工手册-修订版' } }).draft
    await expect(f.api.update({ draft: updateDraft })).resolves.toBe(true)
    await expect(f.api.studentList({ policyId: 11 })).resolves.toEqual({ list: [{ realName: '员工一', mobile: '13800000000', isRead: 1 }], total: 1 })
    await expect(f.api.getPowerContent()).resolves.toEqual(powerContent)
    await expect(f.api.updatePowerContent({ draft: powerContent })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 11 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 11, organization: [{ id: 8, name: '组织', managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    await expect(f.api.download({ fileUrl: 'http://oss.example/policy.pdf' })).resolves.toEqual({ fileName: 'policy.pdf', contentType: 'application/pdf', base64: 'AQID', byteLength: 3 })

    expect(f.calls).toEqual([
      { url: '/admin-api/system/policy/tree', method: 'get', params: { order: '', orderField: '', name: '员工' } },
      { url: '/admin-api/system/policy/simple-list', method: 'get' },
      { url: '/admin-api/system/policy-category/simple-list', method: 'get' },
      { url: '/admin-api/system/policy/get', method: 'get', params: { id: 10 } },
      { url: '/admin-api/system/policy/create-file', method: 'post', data: { name: '新目录', pid: 0, roleIds: ['8'], type: 1 }, headers: { 'Content-Type': 'multipart/form-data' } },
      { url: '/admin-api/system/policy/update', method: 'put', data: { name: '新目录', pid: 0, roleIds: ['8'], id: 10, type: 1 }, headers: { 'Content-Type': 'multipart/form-data' } },
      { url: '/admin-api/system/policy/create', method: 'post', data: { pid: 10, category: 7, organizationId: 9, list: [{ name: '制度.pdf', fileUrl: 'https://oss.example/policy.pdf', type: 2, directoryList }] } },
      { url: '/admin-api/system/policy/update', method: 'put', data: { id: 11, name: '员工手册-修订版', fileUrl: 'http://oss.example/employee.pdf', pid: 10, type: 2, category: 7, organizationId: 9, directoryList } },
      { url: '/admin-api/system/policy/getStudent', method: 'get', params: { order: '', orderField: '', name: '', mobile: '', isRead: 0, pageNo: 1, pageSize: 20, policyId: 11 } },
      { url: `/sys/dict/data/${COMPANY_POLICY_POWER_CONTENT_ID}`, method: 'get' },
      { url: '/sys/dict/data', method: 'put', data: expect.objectContaining({ ...powerContent, updateDate: expect.stringMatching(/^2026-09-24/) }) },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: COMPANY_POLICY_SHARE_TYPE, resourceId: 11 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 1, resourceId: 11, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
      { url: 'https://oss.example/policy.pdf', method: 'get', responseType: 'arraybuffer' },
    ])
  })

  it('表单、目录章节、权限和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreateFolder({ name: '   ', pid: null, roleIds: [] })).toThrow('不能为空')
    expect(() => f.api.prepareCreateFolder({ name: 'x'.repeat(51), pid: null, roleIds: [] })).toThrow('最多50')
    expect(() => f.api.prepareCreateFolder({ name: '目录', pid: 0, roleIds: [0] })).toThrow('正整数ID')
    expect(() => f.api.prepareCreate({ ...documentForm, files: [] })).toThrow('至少上传一个')
    expect(() => f.api.prepareCreate({ ...documentForm, files: Array.from({ length: 11 }, (_, index) => ({ name: `f${index}.pdf`, fileUrl: `https://oss.example/${index}.pdf` })) })).toThrow('最多10')
    expect(() => f.api.prepareCreate({ ...documentForm, files: [{ name: 'bad.exe', fileUrl: 'https://oss.example/bad.exe', mimeType: 'application/octet-stream' }] })).toThrow('不是Portal允许')
    expect(() => f.api.prepareCreate({ ...documentForm, directoryList: [{ directoryContent: 'x'.repeat(51) }] })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...documentForm, directoryList: [{ directoryContent: '总则', chapterList: [{ chapterContent: '   ' }] }] })).toThrow('不能为空')
    expect(() => f.api.prepareUpdate({ current: policy, changes: { name: 'x'.repeat(51) } })).toThrow('最多50')
    await expect(f.api.saveShare({ resourceId: 11, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(f.api.download({ fileUrl: 'ftp://oss.example/policy.pdf' })).rejects.toThrow('http或https')
    await expect(fixture([[{}]]).api.list()).rejects.toThrow('children必须是数组')
    await expect(fixture([{ ...powerContent, dictLabel: '' }]).api.getPowerContent()).rejects.toThrow('不能为空')
    await expect(fixture([]).api.updatePowerContent({ draft: { ...powerContent, dictLabel: 'x'.repeat(201) } })).rejects.toThrow('最多200')
    await expect(fixture([false]).api.update({ draft: { ...policy, name: policy.name ?? '员工手册.pdf', type: 2, pid: 10, category: 7, organizationId: 9 } })).rejects.toThrow('不是true')
    await expect(fixture([{ organization: {} }]).api.getShare({ resourceId: 11 })).rejects.toThrow('共享响应')
  })

  it('AI 说明覆盖权限、表单提交和逐步回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(COMPANY_POLICY_METHODS).sort())
    expect(contracts['company-policy-create']?.boundaries.join(' ')).toContain('至少1个')
    expect(contracts['company-policy-update']?.consume.join(' ')).toContain('目录章节名称')
    expect(contracts['company-policy-save-share']?.consume.join(' ')).toContain('type固定为1')
    expect(contracts['company-policy-list']?.gaps?.join(' ')).toContain('真实测试环境')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
