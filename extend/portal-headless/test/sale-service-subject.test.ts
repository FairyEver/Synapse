import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSaleServiceSubjectCapability,
  SALE_SERVICE_SUBJECT_CREATE_PERMISSION,
  SALE_SERVICE_SUBJECT_DELETE_PERMISSION,
  SALE_SERVICE_SUBJECT_EDIT_PERMISSION,
  SALE_SERVICE_SUBJECT_METHODS,
  SALE_SERVICE_SUBJECT_MODULE_TYPE,
  SALE_SERVICE_SUBJECT_PAGE_PATH,
  SALE_SERVICE_SUBJECT_PERMISSION,
  saleServiceSubjectCapabilities,
} from '../src/capabilities/sale-service-subject.js'
import { SALE_SERVICE_SUBJECT_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-service-subject.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleServiceSubjectCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = { id: 7, name: '示例服务主体', parentId: 3, customerType: '1', updateTime: '2026-09-24 10:00:00', updateDate: null }
const form = { parentId: 3, name: '示例服务主体', customerType: '1' }

describe('Portal 系统设置 → 销售设置 → 设置服务主体', () => {
  it('逐页锁定菜单、列表、表单字段、分页键、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/service-subject/list.vue')
    const formPage = read(portalRoot, 'app/portal/views/dashboard/sale/setting/service-subject/[mode]/[id].vue')

    expect(menu).toContain(`path: '${SALE_SERVICE_SUBJECT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_SERVICE_SUBJECT_PERMISSION}'`)
    for (const fragment of [
      "import { http as platformHttp } from 'app/portal/utils/http/platform.js'",
      "platformHttp('/admin-api/system/hr-role/page', { params })",
      "platformHttp.delete('/admin-api/system/hr-role/delete', { params: { id: record.id } })",
      "sales:setting:service-subject:create",
      "sales:setting:service-subject:edit",
      "sales:setting:service-subject:delete",
      'getDataListIsPage: true',
      "dataIndex: 'name'",
      "dataIndex: 'customerType'",
      "dataIndex: 'updateTime'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "objectURL: '/admin/dict/type'",
      "platformHttp.post('/admin/customerType', form)",
      'parentId: null',
      'name: null',
      'customerType: null',
      'label="上级组织"',
      'label="服务主体名称"',
      'label="客户分类"',
      "name: [\n      { required: true, message: '必填', trigger: 'blur' }",
    ]) expect(formPage).toContain(fragment)
    expect(formPage).not.toContain("/admin-api/system/hr-role/update")
    expect(saleServiceSubjectCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_SERVICE_SUBJECT_METHODS))
    expect(saleServiceSubjectCapabilities.every(item => item.pagePath === SALE_SERVICE_SUBJECT_PAGE_PATH && item.permission === SALE_SERVICE_SUBJECT_PERMISSION && item.moduleType === SALE_SERVICE_SUBJECT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALE_SERVICE_SUBJECT_PAGE_PATH).moduleType).toBe(SALE_SERVICE_SUBJECT_MODULE_TYPE)
    expect(saleServiceSubjectCapabilities.find(item => item.id === 'sale-service-subject-create')?.params.map(item => item.name)).toEqual(['parentId', 'name', 'customerType'])
    expect(saleServiceSubjectCapabilities.find(item => item.id === 'sale-service-subject-update')?.params.map(item => item.name)).toEqual(['id', 'parentId', 'name', 'customerType'])
  })

  it('逐页锁定现有hr-role读删路由和表单保存链的Java证据边界', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/permission/HrRoleController.java')
    const saveReq = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/permission/vo/role/HrRoleSaveReqVO.java')
    for (const fragment of ['@RequestMapping("/system/hr-role")', '@GetMapping("page")', '@GetMapping("/get")', '@DeleteMapping("/delete")']) expect(controller).toContain(fragment)
    expect(saveReq).toContain('private Long parentId')
    expect(saveReq).not.toContain('customerType')
  })

  it('按Portal请求形状覆盖分页、编辑加载、同一POST表单提交和单条删除', async () => {
    const f = fixture([{ list: [row], total: 1 }, row, undefined, undefined, undefined])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/system/hr-role/page',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, limit: 20 },
    })
    await expect(f.api.get({ id: '7' })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/admin-api/dict/type/7', method: 'get' })
    expect(f.api.prepareCreate(form)).toEqual({ draft: form })
    expect(f.calls).toHaveLength(2)
    await expect(f.api.create(form)).resolves.toBeUndefined()
    expect(f.calls[2]).toEqual({ url: '/admin-api/customerType', method: 'post', data: form })
    const update = { id: 7, ...form, name: '修改后的服务主体' }
    expect(f.api.prepareUpdate(update)).toEqual({ draft: update })
    await expect(f.api.update(update)).resolves.toBeUndefined()
    expect(f.calls[3]).toEqual({ url: '/admin-api/customerType', method: 'post', data: { id: 7, parentId: 3, name: '修改后的服务主体', customerType: '1' } })
    expect(f.api.prepareRemove({ id: 7 })).toEqual({ id: 7 })
    await expect(f.api.remove({ id: 7 })).resolves.toBeUndefined()
    expect(f.calls[4]).toEqual({ url: '/admin-api/system/hr-role/delete', method: 'delete', params: { id: 7 } })
  })

  it('表单三项必填、ID和分页在请求前失败，并保留后端错误', async () => {
    const f = fixture([])
    await expect(f.api.create({ ...form, parentId: '' })).rejects.toThrow('parentId')
    await expect(f.api.create({ ...form, name: '' })).rejects.toThrow('name')
    await expect(f.api.create({ ...form, customerType: null as never })).rejects.toThrow('customerType')
    await expect(f.api.list({ limit: 30 })).rejects.toThrow('limit')
    await expect(f.api.get({ id: '0' })).rejects.toThrow('服务主体ID')
    expect(() => f.api.prepareUpdate({ id: 1, ...form, parentId: null as never })).toThrow('parentId')
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('服务主体ID')
    expect(f.calls).toHaveLength(0)
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖全部能力、实际字段和同一POST提交链，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_SERVICE_SUBJECT_METHODS).sort())
    expect(contracts['sale-service-subject-list']?.inputs.limit?.meaning).toContain('limit')
    expect(contracts['sale-service-subject-update']?.boundaries.join(' ')).toContain('customerType')
    expect(contracts['sale-service-subject-update']?.steps[0]).toMatchObject({ capabilityId: 'sale-service-subject-list' })
    expect(contracts['sale-service-subject-prepare-update']?.steps[1]).toMatchObject({
      capabilityId: 'sale-service-subject-update',
      mapping: { id: 'result.draft.id' },
    })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
