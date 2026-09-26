import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createHistoryArchiveCapability,
  HISTORY_ARCHIVE_METHODS,
  HISTORY_ARCHIVE_MODULE_TYPE,
  HISTORY_ARCHIVE_PAGE_PATH,
  HISTORY_ARCHIVE_PERMISSION,
  historyArchiveCapabilities,
} from '../src/capabilities/history-archive.js'
import {
  HISTORY_ARCHIVE_AI_CONTRACTS as contracts,
  HISTORY_ARCHIVE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-history-archive.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'

type RequestConfig = Parameters<PortalRequest>[0]

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createHistoryArchiveCapability(request), calls }
}

const archive = { id: '1001', archiveDate: '2026-08-31', archiveTime: '2026-09-01 00:00:00', archiveType: 1, orgCount: 2, operator: '管理员' }
const snapshot = { id: '2001', snapshotMonth: '2026-08', snapshotTime: '2026-09-01 00:00:00', staffCount: 3, operator: '管理员' }
const staff = { id: '3001', name: '张三', staffCode: '300001', status: 2, mobile: '13800000000', fullPath: '集团/研发中心', postName: '工程师', organization: null, post: null }
const treeNode = { id: '4001', parentId: null, name: '集团', code: 'HQ', managerId: null, managerName: null, hasChildren: true, sort: '4001' }

describe('Portal 人力 → 历史归档记录页面能力', () => {
  it('逐页核对菜单、权限、表单、分页字段和页面内可达动作', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/hr.js')
    const entry = read(portal, 'app/portal/views/dashboard/hr/history-archive/list.vue')
    const organizationList = read(portal, 'app/portal/views/dashboard/hr/history-archive/components/ListViewOrg.vue')
    const peopleList = read(portal, 'app/portal/views/dashboard/hr/history-archive/components/ListViewPeople.vue')
    const staffList = read(portal, 'app/portal/views/dashboard/hr/history-archive/people/record-list.vue')
    const staffDetail = read(portal, 'app/portal/views/dashboard/hr/history-archive/people/detail.vue')
    const organizationChart = read(portal, 'app/portal/views/dashboard/hr/history-archive/org/chart.vue')
    const treeState = read(portal, 'app/portal/views/dashboard/hr/history-archive/org/archive-tree-state.js')

    expect(menu).toContain(`path: '${HISTORY_ARCHIVE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${HISTORY_ARCHIVE_PERMISSION}'`)
    expect(entry).toContain("const activeTab = ref('org')")
    expect(entry).toContain("{ label: '人员', value: 'people' }")
    for (const fragment of [
      "getDataListURL: '/admin-api/hr/org/organization/archive/page'",
      "getDataListURL: '/admin-api/hr/org/staff/snapshot/page'",
      "fieldNamePageNo: 'page'",
      'archiveDate: null',
      'snapshotMonth: null',
      'value-format="YYYY-MM-DD"',
      'picker="month"',
      "path: '/dashboard/history-archive/org/chart'",
      "path: '/dashboard/history-archive/people/record-list'",
    ]) expect(organizationList + peopleList).toContain(fragment)
    for (const fragment of [
      'staffName: \'\'',
      'staffCode: \'\'',
      'status: \'\'',
      'mobile: \'\'',
      'postName: \'\'',
      'orgId: \'\'',
      'staffPage/${snapshotId}',
      "http.get('/org/staff/getCustomInfo'",
      "query: { snapshotId, staffId: record.id, snapshotMonth }",
      'styleV2: true',
      'getDataListIsPage: true',
    ]) expect(staffList).toContain(fragment)
    for (const fragment of [
      'detail/${snapshotId}/${staffId}',
      '未找到该员工的历史详情',
      '基本信息',
      '组织信息',
      '薪酬信息',
      '兼职信息',
      '联系方式',
      '学历信息',
      '其它信息',
    ]) expect(staffDetail).toContain(fragment)
    for (const fragment of [
      'orgTreePage/${archiveId}',
      'orgTreeSearch/${archiveId}',
      'orgTreeExport/${archiveId}',
      'projectionToken: state.token',
      'pageSize = 20',
      'drawio-vertical',
      'drawio-horizontal',
      "key === 'text'",
      '总节点数: \\d+',
      '</mxfile>',
    ]) expect(organizationChart + treeState).toContain(fragment)
    expect(historyArchiveCapabilities.map(item => item.id)).toEqual(Object.keys(HISTORY_ARCHIVE_METHODS))
    expect(historyArchiveCapabilities.every(item => item.pagePath === HISTORY_ARCHIVE_PAGE_PATH && item.permission === HISTORY_ARCHIVE_PERMISSION && item.moduleType === HISTORY_ARCHIVE_MODULE_TYPE && item.httpInstance === 'platform' && !item.write)).toBe(true)
  })

  it('逐页核对Java控制器、DTO和投影规则，排除页面未调用的执行接口', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const hrBiz = 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization'
    const archiveController = read(java, `${hrBiz}/org/controller/HrOrganizationArchiveController.java`)
    const snapshotController = read(java, `${hrBiz}/staff/controller/HrStaffSnapshotController.java`)
    const staffController = read(java, `${hrBiz}/staff/controller/HrStaffController.java`)
    const projectionService = read(java, `${hrBiz}/org/service/impl/HrArchiveProjectionService.java`)
    const treeQuery = read(java, `${hrBiz}/org/dto/HrArchiveTreeQuery.java`)
    const treeNode = read(java, `${hrBiz}/org/dto/HrArchiveTreeNode.java`)
    const staffDto = read(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrNewStaffPageDTO.java')

    for (const fragment of [
      '@RequestMapping("/hr/org/organization/archive")',
      '@GetMapping("page")',
      '@GetMapping("orgTreePage/{archiveId}")',
      '@GetMapping("orgTreeSearch/{archiveId}")',
      '@GetMapping("orgTreeExport/{archiveId}")',
      'projectionToken',
      'format',
    ]) expect(archiveController).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("/hr/org/staff/snapshot")',
      '@GetMapping("page")',
      '@GetMapping("staffPage/{snapshotId}")',
      '@GetMapping("detail/{snapshotId}/{staffId}")',
      '@PostMapping("execute")',
      'pageNo',
      'staffCode',
      'orgId',
    ]) expect(snapshotController).toContain(fragment)
    for (const fragment of ['@GetMapping("getCustomInfo")', 'customColumnsInfo', 'customExportColumns', 'customQueryColumns']) expect(staffController).toContain(fragment)
    for (const fragment of ['projectionToken', 'pageNo', 'pageSize', 'keyword', '过期', 'drawio-vertical', 'drawio-horizontal', 'text']) expect(projectionService + treeQuery).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long organization', 'private Long post', 'private Integer status', 'private String fullPath', 'private String postName']) expect(staffDto).toContain(fragment)
    expect(Object.keys(HISTORY_ARCHIVE_METHODS)).not.toContain('history-archive-staff-snapshot-execute')
    expect(Object.keys(HISTORY_ARCHIVE_METHODS)).not.toContain('history-archive-staff-custom-export')
    expect(archiveController).toContain('orgTree/{archiveId}')
    expect(Object.keys(HISTORY_ARCHIVE_METHODS)).not.toContain('history-archive-organization-tree-legacy')
  })

  it('复现两个顶部列表的page字段、历史员工pageNo字段和所有默认筛选值', async () => {
    const f = fixture([{ list: [archive], total: 1 }, { list: [snapshot], total: 1 }, { list: [staff], total: 1 }])
    await expect(f.api.listOrganizationArchives()).resolves.toEqual({ list: [archive], total: 1 })
    await expect(f.api.listStaffSnapshots({ snapshotMonth: '2026-08', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [snapshot], total: 1 })
    await expect(f.api.listStaff({ snapshotId: snapshot.id, staffName: '张', staffCode: '300001', status: 2, mobile: '138', postName: '工程', orgId: '4001', pageNo: 3, pageSize: 100 })).resolves.toEqual({ list: [staff], total: 1 })
    expect(f.calls).toEqual([
      { url: '/hr/org/organization/archive/page', method: 'get', params: { order: '', orderField: '', archiveDate: null, page: 1, pageSize: 20 } },
      { url: '/hr/org/staff/snapshot/page', method: 'get', params: { order: '', orderField: '', snapshotMonth: '2026-08', page: 2, pageSize: 50 } },
      { url: '/hr/org/staff/snapshot/staffPage/2001', method: 'get', params: { order: '', orderField: '', staffName: '张', staffCode: '300001', status: 2, mobile: '138', postName: '工程', orgId: '4001', pageNo: 3, pageSize: 100 } },
    ])
  })

  it('复现详情、自定义列、组织投影搜索和二进制导出', async () => {
    const content = Buffer.from('总节点数: 1\n')
    const binary = { data: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength), headers: { 'content-type': 'text/plain;charset=UTF-8', 'content-disposition': "attachment; filename*=UTF-8''%E5%8E%86%E5%8F%B2%E7%BB%84%E7%BB%87.txt" } }
    const searchNode = { ...treeNode, id: '4002', parentId: '4001', name: '研发中心', hasChildren: false, ancestorPath: [treeNode] }
    const treePage = { list: [treeNode], total: 1, projectionToken: 'projection-1', archiveDate: '2026-08-31' }
    const searchPage = { list: [searchNode], total: 1, projectionToken: 'projection-1', archiveDate: '2026-08-31' }
    const f = fixture([null, { tableName: 'hr_staff', customColumnsInfo: [], customExportColumns: [], customQueryColumns: [] }, treePage, searchPage, binary])
    await expect(f.api.getStaffDetail({ snapshotId: snapshot.id, staffId: staff.id })).resolves.toBeNull()
    await expect(f.api.getCustomInfo()).resolves.toEqual({ tableName: 'hr_staff', customColumnsInfo: [], customExportColumns: [], customQueryColumns: [] })
    await expect(f.api.organizationTreePage({ archiveId: archive.id })).resolves.toEqual(treePage)
    await expect(f.api.searchOrganizationTree({ archiveId: archive.id, keyword: '  研发  ', projectionToken: 'projection-1' })).resolves.toEqual(searchPage)
    await expect(f.api.exportOrganizationTree({ archiveId: archive.id, rootId: treeNode.id, format: 'text', projectionToken: 'projection-1' })).resolves.toMatchObject({ fileName: '历史组织.txt', contentType: 'text/plain;charset=UTF-8', base64: content.toString('base64'), byteLength: content.byteLength })
    expect(f.calls).toEqual([
      { url: '/hr/org/staff/snapshot/detail/2001/3001', method: 'get' },
      { url: '/org/staff/getCustomInfo', method: 'get', params: { tableName: 'hr_staff' } },
      { url: '/hr/org/organization/archive/orgTreePage/1001', method: 'get', params: { pageNo: 1, pageSize: 20, projectionToken: null } },
      { url: '/hr/org/organization/archive/orgTreeSearch/1001', method: 'get', params: { pageNo: 1, pageSize: 20, projectionToken: 'projection-1', keyword: '研发' } },
      { url: '/hr/org/organization/archive/orgTreeExport/1001', method: 'get', params: { rootId: '4001', format: 'text', projectionToken: 'projection-1' }, responseType: 'arraybuffer' },
    ])
  })

  it('表单和分页边界在请求前失败，避免把非法值交给后端猜测', async () => {
    const f = fixture()
    await expect(f.api.listOrganizationArchives({ archiveDate: '2026-02-30' })).rejects.toThrow('有效日期')
    await expect(f.api.listStaffSnapshots({ snapshotMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.listOrganizationArchives({ pageSize: 25 })).rejects.toThrow('页面支持')
    await expect(f.api.listStaff({ snapshotId: 1, status: 6 })).rejects.toThrow('job_status')
    await expect(f.api.organizationTreePage({ archiveId: 1, projectionToken: 'x'.repeat(65) })).rejects.toThrow('1至64')
    await expect(f.api.searchOrganizationTree({ archiveId: 1, keyword: '  ', projectionToken: 'token' })).rejects.toThrow('keyword不能为空')
    await expect(f.api.exportOrganizationTree({ archiveId: 1, rootId: 1, format: 'xlsx' as never, projectionToken: 'token' })).rejects.toThrow('format')
    expect(f.calls).toHaveLength(0)
  })

  it('AI契约逐方法登记，并用反证锁定ID、投影令牌和真实执行映射', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: historyArchiveCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(HISTORY_ARCHIVE_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(HISTORY_ARCHIVE_METHODS).map(method => `historyArchive.${method}`))
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['history-archive-organization-list']?.output.fields.some(item => item.path === 'list[].id')).toBe(true)
    expect(contracts['history-archive-organization-tree-page']?.output.fields.some(item => item.path === 'projectionToken')).toBe(true)
    expect(contracts['history-archive-staff-list']?.steps.some(step => step.mapping?.staffId === 'result.list[].id')).toBe(true)
    const broken = structuredClone(contracts)
    broken['history-archive-organization-list']!.output.fields = broken['history-archive-organization-list']!.output.fields.filter(item => item.path !== 'list[].id')
    expect(validateAiContracts(broken, { definitions: historyArchiveCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
