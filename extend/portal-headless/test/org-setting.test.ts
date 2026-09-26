import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  buildHrOrganizationSettingPayload,
  createHrOrganizationSettingCapability,
  HR_ORGANIZATION_SETTING_METHODS,
  HR_ORGANIZATION_SETTING_MODULE_TYPE,
  HR_ORGANIZATION_SETTING_PAGE_PATH,
  HR_ORGANIZATION_SETTING_PERMISSION,
  hrOrganizationSettingCapabilities,
} from '../src/capabilities/org-setting.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createHrOrganizationSettingCapability(request), calls }
}

const pageRow = {
  id: '9007199254740993',
  name: '集团总部',
  code: 'HQ01',
  type: '总部',
  level: 1,
  parentOrg: null,
  director: '张三',
  foundDate: '2026-01-01 00:00:00',
  isCorporation: 1,
  legalName: '总部法人',
  mainInvest: '集团',
  isStandardUnit: 1,
  standardUnit: '标准单元',
  standardLine: '标准线',
  fullPath: '集团总部',
  containJob: '财务岗',
  createTime: '2026-01-01 10:00:00',
  country: '中国',
  address: '北京',
  officeAddress: '总部大楼',
  remark: null,
  status: 1,
  hiddenBackendField: 'not returned',
}

const baseForm = {
  name: '总部',
  code: 'ab12',
  typeList: [2],
  propertyList: ['3'],
  directorList: '7',
  pid: 1,
  foundDate: '2026-09-22 00:00:00',
  jobList: [{ postId: 8, postName: '内部岗位', isExternal: 0 as const, needNumber: 2, existNumber: 1, remark: '岗位备注' }],
  partTimeJobList: [{ postId: 9, postName: '兼职岗位' }],
  checkedIdList: ['11'],
  hrOrganizationLicenseDTOList: [{ label: '证照', typeId: '11', typeNum: 2 }],
  containJob: '内部岗位',
  country: '中国',
  city: '110101',
  officeAddress: '办公地址',
  isCorporation: 1 as const,
  corporation: 10,
  hrLegalPersonDTO: { superOrganizationName: '上级法人', mainInvest: '投资主体' },
  isStandardUnit: 1 as const,
  standardUnit: 'standard-cell',
  standardLine: 'standard-line',
  belongLegalPersonId: '12',
  belongLegalPersonName: '只读法人名称',
  isCostCenter: 1 as const,
  costCenter: 'CC-01',
  remark: '备注',
  directorPostName: '只读岗位名称',
}

describe('人力组织设置页面动作', () => {
  it('列表复刻 styleV2 默认分页、全部筛选字段和页面字段投影', async () => {
    const { api, calls } = setup({ list: [pageRow], total: 1 }, { list: [pageRow], total: 1 })
    await expect(api.list()).resolves.toEqual({
      list: [{
        id: '9007199254740993', name: '集团总部', code: 'HQ01', type: '总部', level: 1,
        parentOrg: null, director: '张三', foundDate: '2026-01-01 00:00:00', isCorporation: 1,
        legalName: '总部法人', mainInvest: '集团', isStandardUnit: 1, standardUnit: '标准单元',
        standardLine: '标准线', fullPath: '集团总部', containJob: '财务岗', createTime: '2026-01-01 10:00:00',
        country: '中国', address: '北京', officeAddress: '总部大楼', remark: null, status: 1,
      }],
      total: 1,
    })
    expect(calls[0]?.url).toBe('/org/organization/page')
    expect(calls[0]?.method).toBe('get')
    expect(calls[0]?.params).toEqual({
      order: '', orderField: '', name: '', pName: '', code: '', typeId: '', level: '', status: 1, pageNo: 1, pageSize: 20,
    })
    expect(Object.keys(calls[0]?.params as object)).toEqual([
      'order', 'orderField', 'name', 'pName', 'code', 'typeId', 'level', 'status', 'pageNo', 'pageSize',
    ])
    expect((await api.list({ code: 'HQ', name: '总部', pName: '集团', typeId: '2', level: 1, status: 0, pageNo: 2, pageSize: 100 })).total).toBe(1)
    expect(calls[1]?.params).toEqual({
      order: '', orderField: '', name: '总部', pName: '集团', code: 'HQ', typeId: '2', level: 1, status: 0, pageNo: 2, pageSize: 100,
    })
  })

  it('详情、标准化单元校验和停用前检查使用真实路径与返回类型', async () => {
    const { api, calls } = setup({ ...pageRow, id: 7, pid: 3 }, true, '该组织还有下级')
    await expect(api.detail(7)).resolves.toMatchObject({ id: 7, pid: 3, name: '集团总部' })
    await expect(api.checkHaveStandardUnit(3)).resolves.toBe(true)
    await expect(api.checkCanDisable(7)).resolves.toBe('该组织还有下级')
    expect(calls).toEqual([
      { url: '/org/organization/7', method: 'get' },
      { url: '/org/organization/checkHaveStandardUnit', method: 'get', params: { pid: 3 } },
      { url: '/org/organization/checkCanDisable/7', method: 'post' },
    ])
  })

  it('创建/编辑保持页面的条件字段、岗位编制与 omit 投影', async () => {
    const { api, calls } = setup(undefined, undefined)
    const prepared = api.prepareCreate(baseForm).payload
    expect(prepared).toMatchObject({
      name: '总部', code: 'AB12', typeList: [2], propertyList: ['3'], directorList: ['7'], pid: 1,
      foundDate: '2026-09-22 00:00:00', partTimeJobList: [{ postId: 9 }],
      isCorporation: 1, corporation: 10, hrLegalPersonDTO: { superOrganizationName: '上级法人', mainInvest: '投资主体' },
      hrOrganizationLicenseDTOList: [{ typeId: '11', typeNum: 2 }], isStandardUnit: 1,
      standardUnit: 'standard-cell', standardLine: 'standard-line', isCostCenter: 1, costCenter: 'CC-01',
    })
    expect(prepared).not.toHaveProperty('checkedIdList')
    expect(prepared).not.toHaveProperty('belongLegalPersonName')
    expect(prepared).not.toHaveProperty('directorPostName')
    await api.create(baseForm)
    const updateInput = { ...baseForm, id: '8', status: 1, parentOrg: '上级组织' }
    const updated = api.prepareUpdate(updateInput).payload
    expect(updated).toHaveProperty('status', 1)
    expect(updated).toHaveProperty('parentOrg', '上级组织')
    expect(updated).toHaveProperty('hrLegalPersonDTO')
    await api.update(updateInput)
    expect(calls[0]).toEqual({ url: '/org/organization', method: 'post', data: prepared })
    expect(calls[1]).toEqual({ url: '/org/organization', method: 'put', data: updated })
  })

  it('页面表单负例在请求前失败：必填、条件必填、编码、岗位编制和备注', async () => {
    const cases = [
      { name: '   ' },
      { code: 'AB-' },
      { typeList: [] },
      { pid: '' },
      { foundDate: '' },
      { isCorporation: 1, corporation: '' },
      { isStandardUnit: 1, standardUnit: '' },
      { isStandardUnit: 1, standardLine: '' },
      { isCostCenter: 1, costCenter: '' },
      { remark: '   ' },
      { jobList: [{ postId: 8, isExternal: 0 as const, needNumber: '' }] },
      { jobList: [{ postId: 8, isExternal: 2 as never, needNumber: 1 }] },
      { hrOrganizationLicenseDTOList: [{ typeId: '11', typeNum: -1 }] },
    ]
    const { api, calls } = setup({ mobile: '', isDel: 0 })
    for (const change of cases) {
      expect(() => api.prepareCreate({ ...baseForm, ...change } as never)).toThrow()
    }
    await expect(api.disable({ id: 8, currentStatus: 0 })).rejects.toThrow('status为1')
    await expect(api.enable({ id: 8, currentStatus: 1 })).rejects.toThrow('status为0')
    await expect(api.list({ pageSize: 200 })).rejects.toThrow('10、20、50或100')
    await expect(api.list({ status: 2 as never })).rejects.toThrow('status')
    expect(calls).toEqual([])
  })

  it('启用/停用不替代 checkCanDisable，且按当前行状态保护写请求', async () => {
    const { api, calls } = setup(undefined, undefined)
    await api.disable({ id: '7', currentStatus: 1 })
    await api.enable({ id: 7, currentStatus: 0 })
    expect(calls).toEqual([
      { url: '/org/organization/disable/7', method: 'post' },
      { url: '/org/organization/enable/7', method: 'post' },
    ])
  })

  it('关系变更先读取敏感门控；免验证时 PUT body 仅为 id/pid', async () => {
    const { api, calls } = setup({}, undefined)
    await expect(api.changeRelation({ id: 7, pid: 3 })).resolves.toBeUndefined()
    expect(calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/org/organization/updateBelongRelation', method: 'put', data: { id: 7, pid: 3 } },
    ])
  })

  it('敏感关系变更没有验证码时阻断，验证码分支锁定发送/校验顺序', async () => {
    const blocked = setup({ mobile: '13800000000', isDel: 0 })
    await expect(blocked.api.changeRelation({ id: 7, pid: 3 })).rejects.toThrow('敏感验证')
    expect(blocked.calls).toEqual([{ url: '/org/sensitive/info', method: 'get' }])

    const verified = setup({ mobile: '13800000000', isDel: 0 }, { ret: 'SUCCESS' }, undefined)
    await expect(verified.api.changeRelation({ id: 7, pid: 3, verification: { requestId: 'r1', code: '123456' } })).resolves.toBeUndefined()
    expect(verified.calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/sys/sms/checkSms', method: 'get', params: { code: '123456', requestId: 'r1' }, sourceResponse: true },
      { url: '/org/organization/updateBelongRelation', method: 'put', data: { id: 7, pid: 3 } },
    ])
  })

  it('导入模板严格复刻xlsx上传、导出只带筛选条件、模板先取URL再二次下载', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const base64 = Buffer.from(bytes).toString('base64')
    const exported = { data: bytes.buffer, headers: { 'content-type': 'application/vnd.ms-excel' } } as AxiosResponse<ArrayBuffer>
    const { api, calls } = setup(null, exported, 'https://oss.example/导入组织岗位编制.xlsx?x=1', { data: bytes.buffer, headers: {} } as AxiosResponse<ArrayBuffer>)
    expect(api.prepareImport({ fileName: '岗位.xlsx', base64 })).toEqual({ fileName: '岗位.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await expect(api.importFile({ fileName: '岗位.xlsx', base64 })).resolves.toBeNull()
    const formData = calls[0]?.data as FormData
    const upload = formData.get('file') as File
    expect(upload.name).toBe('岗位.xlsx')
    expect(upload.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(calls[0]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })

    await expect(api.export({ name: '总部', status: 0 })).resolves.toMatchObject({ fileName: '组织.xlsx', contentType: 'application/vnd.ms-excel', base64, byteLength: 4 })
    expect(calls[1]).toEqual({
      url: '/org/organization/export', method: 'get',
      params: { name: '总部', pName: '', code: '', typeId: '', level: '', status: 0 }, responseType: 'arraybuffer',
    })

    await expect(api.downloadTemplate({ orgId: 7 })).resolves.toMatchObject({ fileName: '导入组织岗位编制.xlsx', base64, byteLength: 4 })
    expect(calls[2]).toEqual({ url: '/org/organization/downloadTemplate', method: 'get', params: { orgId: 7 } })
    expect(calls[3]).toEqual({ url: 'https://oss.example/导入组织岗位编制.xlsx?x=1', method: 'get', responseType: 'arraybuffer' })

    await expect(api.importFile({ fileName: '岗位.xls', base64 })).rejects.toThrow('.xlsx')
    await expect(api.importFile({ fileName: '岗位.xlsx', base64, contentType: 'application/vnd.ms-excel' })).rejects.toThrow('contentType')
    expect(calls).toHaveLength(4)
  })

  it('历史列表格式化时间范围并返回详情逐字段差异', async () => {
    const { api, calls } = setup({ list: [{ id: 19, orgId: 7, orgName: '总部', changeTypeDesc: '编辑', changeFieldCount: 1, changeTime: '2026-09-22T12:00:00', operatorName: '管理员' }], total: 1 }, {
      id: 19, orgId: 7, orgName: '总部', changeTypeDesc: '编辑', changeFieldCount: 1, changeTime: '2026-09-22T12:00:00', operatorName: '管理员',
      changeItems: [{ field: '组织名称', oldValue: '旧名称', newValue: '总部', changeDesc: null }],
    })
    await expect(api.historyList({ orgName: '总', operatorName: '管', startTime: '2026-09-01 00:00:00', endTime: '2026-09-30 23:59:59' })).resolves.toMatchObject({ total: 1, list: [{ id: 19, orgId: 7, changeFieldCount: 1 }] })
    await expect(api.historyDetail(19)).resolves.toEqual({
      id: 19, orgId: 7, orgName: '总部', changeTypeDesc: '编辑', changeFieldCount: 1, changeTime: '2026-09-22T12:00:00', operatorName: '管理员',
      changeItems: [{ field: '组织名称', oldValue: '旧名称', newValue: '总部', changeDesc: null }],
    })
    expect(calls[0]).toEqual({
      url: '/hr/org/organization/changeLog/page', method: 'get',
      params: { order: '', orderField: '', orgName: '总', operatorName: '管', startTime: '2026-09-01 00:00:00', endTime: '2026-09-30 23:59:59', pageNo: 1, pageSize: 20 },
    })
    expect(calls[1]).toEqual({ url: '/hr/org/organization/changeLog/19', method: 'get' })
    await expect(api.historyList({ startTime: '2026-09-01' })).rejects.toThrow('YYYY-MM-DD HH:mm:ss')
  })

  it('查看兼职人员复刻岗位汇总与固定20条人员分页', async () => {
    const { api, calls } = setup(
      { partTimePosts: [{ postId: 8, postName: '兼职岗位', partTimeStaffCount: 2, existNumber: 3 }] },
      { list: [{ relationId: 91, name: '李四', staffCode: 'L4', organizationName: '分部', postName: '兼职岗位', status: 1 }], total: 1 },
    )
    await expect(api.partTimePosts(7)).resolves.toEqual([{ postId: 8, postName: '兼职岗位', partTimeStaffCount: 2, existNumber: 3 }])
    await expect(api.partTimeStaffPage({ organizationId: 7, postId: 8, keyword: ' 李 ', pageNo: 2 })).resolves.toMatchObject({ total: 1, list: [{ relationId: 91, name: '李四', staffCode: 'L4' }] })
    expect(calls).toEqual([
      { url: '/hr/organization-scene/post-scene/list', method: 'get', params: { organizationId: 7 } },
      {
        url: '/hr/organization-scene/post-level/staff-page', method: 'get',
        params: { organizationId: 7, postKind: 'PART_TIME', postId: 8, keyword: '李', pageNo: 2, pageSize: 20 },
      },
    ])
    await expect(api.partTimeStaffPage({ organizationId: 7, postId: 8, pageNo: 0 })).rejects.toThrow('pageNo')
  })

  it('表单候选请求保留 Portal 的分页、关键字和数组序列化约束', async () => {
    const { api, calls } = setup(
      [{ id: 1, name: '总部类型' }],
      { list: [{ id: 2, name: '法人属性' }], total: 1 },
      [{ id: 3, name: '营业执照' }],
      { list: [{ id: 4, name: '财务岗', dataType: 2 }], total: 1 },
      [{ id: 4, name: '财务岗', dataType: 2 }],
      { list: [{ id: 5, realName: '张三', username: 'zhangsan', staffId: 6 }], total: 1 },
      [{ id: 5, realName: '张三', username: 'zhangsan', staffId: 6 }],
      [{ id: 7, name: '法人单位', superOrganizationName: null, mainInvest: '集团' }],
      [{ code: 'CC01', name: '成本中心' }],
    )
    await expect(api.organizationTypes()).resolves.toEqual([{ id: 1, name: '总部类型' }])
    await expect(api.organizationProperties()).resolves.toEqual([{ label: '法人属性', value: '2' }])
    await expect(api.licenseCategories()).resolves.toEqual([{ label: '营业执照', typeId: '3', typeNum: null }])
    await expect(api.searchPostOptions({ keyword: '财务' })).resolves.toMatchObject({ total: 1, list: [{ id: 4, name: '财务岗' }] })
    await expect(api.postNodeDetails({ ids: [4] })).resolves.toEqual([{ id: 4, name: '财务岗', dataType: 2 }])
    await expect(api.searchUsers({ keyword: '张三' })).resolves.toMatchObject({ total: 1, list: [{ id: 5, realName: '张三' }] })
    await expect(api.usersByIds({ ids: [5] })).resolves.toMatchObject([{ id: 5, username: 'zhangsan' }])
    await expect(api.legalPersons()).resolves.toEqual([{ id: 7, name: '法人单位', superOrganizationName: null, mainInvest: '集团' }])
    await expect(api.costCenters()).resolves.toEqual([{ code: 'CC01', name: '成本中心' }])
    expect(calls[3]?.params).toEqual({ parentId: 0, keyword: '财务', pageNo: 1, pageSize: 20, selection: true, dataType: 2 })
    expect(calls[4]).toEqual({ url: '/org/hrpost/nodeDetails', method: 'post', data: { ids: [4], selection: true } })
    expect(calls[6]).toMatchObject({ params: { userIdList: [5] }, paramsArrayFormat: 'comma' })
    await expect(api.searchUsers({ keyword: ' ' })).rejects.toThrow('关键字')
  })
})

describe('组织设置页面边界与能力骨架', () => {
  it('固定 Portal 页面权限、菜单路径、关键动作和 Java 路径锚点', () => {
    const listSource = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js/app/portal/views/dashboard/hr/org/org-setting/list.vue', 'utf8')
    const relationSource = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js/app/portal/views/dashboard/hr/org/org-setting/components/change-relation.vue', 'utf8')
    const formSource = readFileSync('/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js/app/portal/views/dashboard/hr/org/org-setting/[mode]/[id].vue', 'utf8')
    expect(listSource).toContain('permission: /dashboard/org/org-setting/list')
    expect(listSource).toContain("getDataListURL: '/org/organization/page'")
    expect(listSource).toContain("/org/organization/checkCanDisable/${record.id}")
    expect(relationSource).toContain("/org/organization/updateBelongRelation")
    expect(formSource).toContain("omit(form, ['directorPostName', 'checkedIdList', 'belongLegalPersonName'])")
    expect(formSource).toContain("'/admin-api/org/organization'")
    expect(HR_ORGANIZATION_SETTING_PAGE_PATH).toBe('/dashboard/org/org-setting/list')
    expect(HR_ORGANIZATION_SETTING_PERMISSION).toBe('/dashboard/org/org-setting/list')
    expect(resolveModuleType(HR_ORGANIZATION_SETTING_PAGE_PATH).moduleType).toBe(HR_ORGANIZATION_SETTING_MODULE_TYPE)
  })

  it('能力 ID、方法映射和写入标记完整，且没有把 chart sibling 页面混入', () => {
    const ids = hrOrganizationSettingCapabilities.map(item => item.id)
    expect(ids).toEqual(Object.keys(HR_ORGANIZATION_SETTING_METHODS))
    expect(new Set(ids).size).toBe(ids.length)
    expect(hrOrganizationSettingCapabilities.every(item => item.pagePath === HR_ORGANIZATION_SETTING_PAGE_PATH)).toBe(true)
    expect(hrOrganizationSettingCapabilities.every(item => item.permission === HR_ORGANIZATION_SETTING_PERMISSION)).toBe(true)
    expect(hrOrganizationSettingCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(ids).not.toContain('hr-organization-setting-chart')
    expect(hrOrganizationSettingCapabilities.find(item => item.id.endsWith('check-can-disable'))?.write).toBe(false)
    expect(hrOrganizationSettingCapabilities.find(item => item.id.endsWith('prepare-create'))?.write).toBe(false)
    expect(hrOrganizationSettingCapabilities.find(item => item.id === 'hr-organization-setting-create')?.write).toBe(true)
    expect(hrOrganizationSettingCapabilities.find(item => item.id.endsWith('history-detail'))?.write).toBe(false)
  })

  it('关键反证：状态、敏感门控、条件 omit 和文件类型变异都会在恢复前失败', async () => {
    const { api, calls } = setup({ mobile: '', isDel: 0 })
    await expect(api.disable({ id: 1, currentStatus: 0 })).rejects.toThrow()
    await expect(api.enable({ id: 1, currentStatus: 1 })).rejects.toThrow()
    await expect(api.changeRelation({ id: 1, pid: 2 })).rejects.toThrow()
    expect(calls).toHaveLength(1)
    const noCorporation = buildHrOrganizationSettingPayload({ ...baseForm, isCorporation: 0, corporation: '' }, 'create')
    expect(noCorporation).not.toHaveProperty('hrLegalPersonDTO')
    expect(noCorporation).not.toHaveProperty('hrOrganizationLicenseDTOList')
    expect(() => buildHrOrganizationSettingPayload({ ...baseForm, isCorporation: 1, corporation: '' }, 'create')).toThrow('法人名称必填')
    expect(() => api.prepareImport({ fileName: '岗位.xls', base64: 'AQID' })).toThrow('.xlsx')
  })
})
