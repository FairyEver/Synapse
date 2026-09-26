import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingSystemAccountingParametersCapability,
  SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS,
  SETTING_SYSTEM_ACCOUNTING_PARAMETERS_MODULE_TYPE,
  SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH,
  SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PERMISSION,
  settingSystemAccountingParametersCapabilities,
} from '../src/capabilities/setting-system-accounting-parameters.js'
import { SETTING_SYSTEM_ACCOUNTING_PARAMETERS_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-system-accounting-parameters.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingSystemAccountingParametersCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = {
  id: '9007199254740993', name: '考勤扣款', source: 1, remark: '组织数据',
  tableName: 'hr_staff', columnName: 'deduction', staffCodeName: 'staff_code', filterSql: 'is_del = 0',
  isDel: 0, creator: '11', createTime: '2026-09-23 10:00:00', updater: 12, updateTime: '2026-09-23 10:20:00',
}

describe('Portal 系统设置 → 系统核算参数页面能力', () => {
  it('逐页锁定菜单、路由、列表字段、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/hr/setting/system-accounting-parameters.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/system-accounting-parameters/list.vue')
    for (const fragment of [`path: '${SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH}'`, `permission: '${SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PERMISSION}'`]) expect(menu).toContain(fragment)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "getDataListURL: '/salary/parameter/page'", 'getDataListIsPage: true', 'query1: \'\'',
      "dataIndex: 'name'", "column.dataIndex === 'source'", "column.dataIndex === 'remark'", 'rrList.logicFetch()',
    ]) expect(list).toContain(fragment)
    expect(settingSystemAccountingParametersCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS))
    expect(settingSystemAccountingParametersCapabilities.every(item => item.pagePath === SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH && item.permission === SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PERMISSION && item.moduleType === SETTING_SYSTEM_ACCOUNTING_PARAMETERS_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java page 端点、查询DTO、返回DTO和服务字段', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main')
    const controller = read(base, 'java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalarySysCalculateParameterController.java')
    const select = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalarySysCalculateParameterSelectDTO.java')
    const dto = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalarySysCalculateParameterDTO.java')
    const service = read(base, 'java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalarySysCalculateParameterServiceImpl.java')
    for (const fragment of ['@RequestMapping("/salary/parameter")', '@GetMapping("page")', 'salarySysCalculateParameterService.getPageData(dto)', 'PageData<SalarySysCalculateParameterDTO>']) expect(controller).toContain(fragment)
    for (const fragment of ['private String name', 'private Integer source', 'private Integer pageNo', 'private Integer pageSize']) expect(select).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private Integer source', 'private String remark', 'private String tableName', 'private String columnName', 'private String staffCodeName', 'private String filterSql', 'private Integer isDel', 'private LocalDateTime createTime', 'private LocalDateTime updateTime']) expect(dto).toContain(fragment)
    for (const fragment of ['getPageData(SalarySysCalculateParameterSelectDTO dto)', 'new Page<>(dto.getPageNo(), dto.getPageSize())', 'salarySysCalculateParameterDao.getPageData(page, dto)']) expect(service).toContain(fragment)
  })

  it('按 Portal 实际请求形状读取分页并保留 Java DTO 完整字段', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{ url: '/salary/parameter/page', method: 'get', params: { order: '', orderField: '', query1: '', pageNo: 1, pageSize: 20 } }])

    const second = fixture([{ list: [], total: 0 }])
    await expect(second.api.list({ query1: '工资', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(second.calls[0]?.params).toEqual({ order: '', orderField: '', query1: '工资', pageNo: 2, pageSize: 50 })
  })

  it('坏参数、坏分页响应和权限/网络错误在边界显式失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ query1: 1 as unknown as string })).rejects.toThrow('query1')
    await expect(f.api.list({ pageNo: 0 })).rejects.toThrow('pageNo')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toEqual([])

    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...row, creator: 'bad' }], total: 1 }]).api.list()).rejects.toThrow('creator')
    await expect(fixture([new Error('权限不足')]).api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖 query1 与 name/source 边界、完整返回字段和只读范围，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS).sort())
    expect(contracts['setting-system-accounting-parameters-list']?.boundaries.join(' ')).toContain('query1')
    expect(contracts['setting-system-accounting-parameters-list']?.boundaries.join(' ')).toContain('不发布为本页能力')
    expect(contracts['setting-system-accounting-parameters-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].tableName', 'list[].filterSql']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
