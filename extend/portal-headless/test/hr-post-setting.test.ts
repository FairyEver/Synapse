import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import {
  createHrPostSettingCapability,
  HR_POST_SETTING_METHODS,
  HR_POST_SETTING_MODULE_TYPE,
  HR_POST_SETTING_PAGE_PATH,
  HR_POST_SETTING_PERMISSION,
  hrPostSettingCapabilities,
} from '../src/capabilities/hr-post-setting.js'
import { HR_POST_SETTING_AI_CONTRACTS as contracts, HR_POST_SETTING_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-hr-post-setting.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createHrPostSettingCapability(request), calls }
}

const levels = [
  { id: 20, name: 'P2', sort: 2 },
  { id: 10, name: 'P1', sort: 1 },
  { id: 30, name: 'P3', sort: null },
]

const form = {
  roleIdList: [],
  parent: 7,
  name: '财务岗位',
  postType: '10,20',
  dataType: 2,
  gender: 2,
  salaryLevelMin: 10,
  salaryLevelMax: 20,
  postAssignment: '负责财务工作',
  educationalRequirement: '',
  experienceRequirement: '',
  abilityRequirement: '',
  remark: '',
  salaryLevelMinName: 'P1',
  salaryLevelMaxName: 'P2',
  salaryLevelName: 'P1-P2',
} as const

const row = {
  id: '9007199254740993',
  name: '财务岗位',
  dataType: 2,
  parent: 7,
  postTypeName: '财务',
  salaryLevelMin: 10,
  salaryLevelMax: 20,
  children: [{ id: 99 }],
  ancestorPath: [{ id: 7, name: '财务中心', available: true }],
}

describe('人力→岗位设置页面能力', () => {
  it('逐页锁定菜单、权限、实例、module-type和页面动作清单', () => {
    expect(hrPostSettingCapabilities.map(item => item.id)).toEqual(Object.keys(HR_POST_SETTING_METHODS))
    expect(hrPostSettingCapabilities.every(item => item.pagePath === HR_POST_SETTING_PAGE_PATH)).toBe(true)
    expect(hrPostSettingCapabilities.every(item => item.permission === HR_POST_SETTING_PERMISSION)).toBe(true)
    expect(hrPostSettingCapabilities.every(item => item.moduleType === HR_POST_SETTING_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(Object.keys(HR_POST_SETTING_METHODS)).toContain('hr-post-setting-prepare-import-update')

    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/post/post-setting/list.vue'), 'utf8')
    const formPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/post/post-setting/[mode]/[id].vue'), 'utf8')
    const createImport = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/post/post-setting/components/create-multiple.vue'), 'utf8')
    const updateImport = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/post/post-setting/components/import-update.vue'), 'utf8')
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/post/controller/HrPostController.java'), 'utf8')
    const query = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/common/tree/HrBoundedTreeQueryDTO.java'), 'utf8')

    expect(menu).toContain("path: '/dashboard/post/post-setting/list'")
    expect(menu).toContain("permission: '/dashboard/post/post-setting'")
    expect(list).toContain("'/org/hrpost/' + (keyword ? 'searchPage' : 'treePage')")
    expect(list).toContain('selection: false')
    expect(list).toContain("'/org/hrpost/checkCanDelete'")
    expect(formPage).toContain("http.post('/org/hrpost/save'")
    expect(formPage).toContain("postType: form.postType?.split(',') || []")
    expect(createImport).toContain("'/org/hrpost/v1/import'")
    expect(updateImport).toContain("'/org/hrpost/updateByExcelFile'")
    expect(controller).toContain('@GetMapping("treePage")')
    expect(controller).toContain('@GetMapping("searchPage")')
    expect(controller).toContain('@PostMapping("/v1/import")')
    expect(controller).toContain('@PostMapping("updateByExcelFile")')
    expect(query).toContain('pageSize > 100')
  })

  it('列表逐字对齐树分页参数、端点选择和Portal去children', async () => {
    const root = setup({ list: [{ ...row }], total: 1 })
    const result = await root.api.list()
    expect(root.calls[0]).toEqual({
      url: '/org/hrpost/treePage',
      method: 'get',
      params: { parentId: 0, keyword: '', dataType: undefined, selection: false, pageNo: 1, pageSize: 20 },
    })
    expect(result.list[0]).not.toHaveProperty('children')
    expect(result.list[0]?.id).toBe(row.id)

    const search = setup({ list: [{ ...row }], total: 1 })
    await search.api.list({ parentId: '7', templateName: '  财务  ', pageNo: 2, pageSize: 150 })
    expect(search.calls[0]).toEqual({
      url: '/org/hrpost/searchPage',
      method: 'get',
      params: { parentId: '7', keyword: '财务', dataType: 2, selection: false, pageNo: 2, pageSize: 100 },
    })
  })

  it('详情和薪资等级选项复刻Portal表单状态与排序', async () => {
    const api = setup({ ...row, parent: '0', postType: [10, 20], postTypeNameList: ['财务'] }, levels)
    const detail = await api.api.get({ id: row.id })
    expect(api.calls[0]).toEqual({ url: `/org/hrpost/${row.id}`, method: 'get' })
    expect(detail).toMatchObject({ id: row.id, parent: null, postType: '10,20', roleIdList: [] })

    const salaryLevels = await api.api.salaryLevels()
    expect(api.calls[1]).toEqual({ url: '/org/hrsalarylevel/getAllSalaryLevel', method: 'get' })
    expect(salaryLevels.map(item => item.id)).toEqual([10, 20, 30])
  })

  it('创建和编辑都POST save，表单投影、postType split、UI字段删除和取消语义一致', async () => {
    const api = setup(undefined, undefined)
    const preparedCreate = api.api.prepareCreate({ form })
    expect(preparedCreate.draft).toEqual({
      roleIdList: [],
      parent: 7,
      name: '财务岗位',
      postType: ['10', '20'],
      dataType: 2,
      gender: 2,
      salaryLevelMin: 10,
      salaryLevelMax: 20,
      postAssignment: '负责财务工作',
      educationalRequirement: '',
      experienceRequirement: '',
      abilityRequirement: '',
      remark: '',
    })
    await api.api.create(preparedCreate)
    expect(api.calls[0]).toEqual({ url: '/org/hrpost/save', method: 'post', data: preparedCreate.draft })

    const preparedUpdate = api.api.prepareUpdate({ current: { ...form, id: row.id, status: 0 }, changes: { name: '修改后的岗位' } })
    expect(preparedUpdate.draft).toMatchObject({ id: row.id, name: '修改后的岗位', status: 0, postType: ['10', '20'] })
    expect(preparedUpdate.draft).not.toHaveProperty('salaryLevelName')
    await api.api.update(preparedUpdate)
    expect(api.calls[1]).toEqual({ url: '/org/hrpost/save', method: 'post', data: preparedUpdate.draft })

    const cancelled = api.api.prepareCreate({ form: { ...form, name: '取消的新岗位' } })
    expect(cancelled.draft.name).toBe('取消的新岗位')
    expect(api.calls).toHaveLength(2)
  })

  it('复刻薪资等级上下限顺序、文本和类型负例', () => {
    const api = setup()
    expect(() => api.api.prepareCreate({ form: { ...form, salaryLevelMin: 20, salaryLevelMax: 10 }, salaryLevels: levels })).toThrow('下限不能大于上限')
    expect(() => api.api.prepareCreate({ form: { ...form, name: '   ' } })).toThrow('name')
    expect(() => api.api.prepareCreate({ form: { ...form, remark: 'x'.repeat(201) } })).toThrow('remark')
    expect(() => api.api.prepareCreate({ form: { ...form, dataType: 3 } })).toThrow('dataType')
    expect(() => api.api.prepareUpdate({ current: { ...form, id: '' } })).toThrow('id')
    expect(() => api.api.prepareUpdate({ current: { ...form, id: 1 }, changes: { status: 1 } })).toThrow('不支持字段status')
    expect(api.calls).toHaveLength(0)
  })

  it('删除先检查占用和敏感配置，短信保护按Portal动作顺序执行', async () => {
    const noSensitive = setup('', { isDel: 1 }, '', { isDel: 1 }, undefined)
    await expect(noSensitive.api.prepareRemove({ ids: [1] })).resolves.toEqual({ ids: [1], verificationRequired: false, phone: null })
    await noSensitive.api.remove({ ids: [1] })
    expect(noSensitive.calls.map(call => ({ url: call.url, method: call.method, data: call.data }))).toEqual([
      { url: '/org/hrpost/checkCanDelete', method: 'post', data: [1] },
      { url: '/org/sensitive/info', method: 'get', data: undefined },
      { url: '/org/hrpost/checkCanDelete', method: 'post', data: [1] },
      { url: '/org/sensitive/info', method: 'get', data: undefined },
      { url: '/org/hrpost', method: 'delete', data: [1] },
    ])

    const sensitive = setup('', { mobile: '13800000000', isDel: 0 }, { requestId: 'sms-1' }, '', { mobile: '13800000000', isDel: 0 }, { ret: 'SUCCESS' }, undefined)
    await expect(sensitive.api.sendDeleteCode({ ids: [1] })).resolves.toEqual({ smsRequestId: 'sms-1' })
    await sensitive.api.remove({ ids: [1], smsRequestId: 'sms-1', code: '123456' })
    expect(sensitive.calls[2]).toMatchObject({ url: '/sys/sms/send', method: 'get', params: { phone: '13800000000', templateId: '17709' } })
    expect(sensitive.calls[5]).toMatchObject({ url: '/sys/sms/checkSms', method: 'get', sourceResponse: true })
    expect(sensitive.calls[6]).toMatchObject({ url: '/org/hrpost', method: 'delete', data: [1] })
  })

  it('导入模板和自定义导出走文件协议，两个上传入口只接受Portal的xlsx MIME', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const download = setup({ data: bytes, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment; filename*=UTF-8''%E5%B2%97%E4%BD%8D.xlsx" } })
    const file = await download.api.downloadTemplate()
    expect(download.calls[0]).toEqual({ url: '/org/hrpost/download', method: 'get', params: { fileName: '岗位信息模板' }, responseType: 'arraybuffer' })
    expect(file.fileName).toBe('岗位.xlsx')
    expect(file.base64).toBe('AQID')

    const exportApi = setup({ data: bytes, headers: {} })
    await exportApi.api.export({ id: '7' })
    expect(exportApi.calls[0]).toEqual({ url: '/org/hrpost/export', method: 'get', params: { id: '7' }, responseType: 'arraybuffer' })

    const content = { fileName: '岗位.xlsx', base64: 'AQID', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    const imports = setup(undefined, undefined)
    expect(imports.api.prepareImport({ file: content, parentId: 0 })).toEqual({ fileName: '岗位.xlsx', contentType: content.contentType, byteLength: 3 })
    await imports.api.importFile({ file: content, parentId: 0 })
    await imports.api.importUpdate({ file: content })
    expect(imports.calls[0]).toMatchObject({ url: '/org/hrpost/v1/import', method: 'post', params: { parentId: null }, headers: { 'Content-Type': 'multipart/form-data' } })
    expect(imports.calls[1]).toMatchObject({ url: '/org/hrpost/updateByExcelFile', method: 'post', headers: { 'Content-Type': 'multipart/form-data' } })
    expect(() => imports.api.prepareImport({ file: { ...content, contentType: 'application/pdf' } })).toThrow()
  })
})

describe('岗位设置AI契约', () => {
  it('每个页面能力都有结构化契约和可调用方法路径', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(HR_POST_SETTING_METHODS))
    expect(validateAiContracts(contracts, { definitions: hrPostSettingCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: hrPostSettingCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    expect(Object.keys(methodContracts)).toEqual(Object.values(HR_POST_SETTING_METHODS).map(method => `hrPostSetting.${method}`))
  })

  it('契约锁住表单保存规则、权限范围、删除保护和文件边界', () => {
    const text = Object.values(contracts).map(contract => `${contract.purpose} ${contract.boundaries.join(' ')} ${contract.consume.join(' ')}`).join('\n')
    expect(text).toContain('selection=false')
    expect(text).toContain('同一个 POST /org/hrpost/save')
    expect(text).toContain('checkCanDelete')
    expect(text).toContain('postType逗号字符串split')
    expect(text).toContain('敏感')
    expect(contracts['hr-post-setting-prepare-create']?.output.fields.find(field => field.path === 'draft.postType')?.meaning).toContain('[""]')
    expect(methodContracts['hrPostSetting.create']?.boundaries.join(' ')).toContain('prepare→submit')
  })
})
