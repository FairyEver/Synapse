import { describe, expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { BASE_AI_CONTRACTS, BASE_METHOD_CONTRACTS } from '../src/catalog/contracts-base.js'
import { baseDeptDictPermissionCapabilities, createBaseDeptDictPermission, DEPT_LIST_URL, DICT_GROUPED_URL } from '../src/capabilities/base-dept-dict-permission.js'
import { baseShellCapabilities, createBaseShell, BPM_TASK_URL, USER_INFO_URL } from '../src/capabilities/base-shell.js'
import { baseTenantCapabilities } from '../src/capabilities/base-tenant.js'
import { baseSaleCapabilities, createBaseSale, SALE_SHOP_URL, SALE_AREA_URL } from '../src/capabilities/base-sale.js'
import { baseUploadCapabilities } from '../src/capabilities/base-upload.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
const definitions = [...baseDeptDictPermissionCapabilities, ...baseShellCapabilities, ...baseTenantCapabilities, ...baseSaleCapabilities, ...baseUploadCapabilities]
function description(id: string) {
  const result = catalog.describe(id)
  if (!result.ok) throw new Error(`Missing description ${id}`)
  if (!result.ai) throw new Error(`Missing AI contract ${id}`)
  return result as typeof result & { ai: NonNullable<typeof result.ai> }
}
function outputField(id: string, path: string) {
  const result = description(id).returns.fields?.find(field => field.path === path)
  if (!result) throw new Error(`Missing output semantics: ${id}.${path}`)
  return result
}

describe('基础能力实际 SDK AI 描述', () => {
  it('注册范围完整且每个实际参数有语义；下游能力确实可描述执行', () => {
    expect(Object.keys(BASE_AI_CONTRACTS).sort()).toEqual(definitions.map(d => d.id).sort())
    for (const definition of definitions) {
      const result = description(definition.id)
      expect(result.invoke).not.toBeNull()
      for (const param of definition.params) expect(result.params.find(p => p.name === param.name)?.contract).toEqual(result.ai.inputs[param.name])
      for (const step of result.ai.steps) if (step.capabilityId) {
        const downstream = catalog.describe(step.capabilityId)
        if (!downstream.ok) throw new Error(`Missing downstream ${step.capabilityId}`)
        expect(downstream.invoke).not.toBeNull()
      }
    }
  })
  it('部门ID接人员筛选，字典业务值不误用条目ID', async () => {
    const base = createBaseDeptDictPermission({ request: async <T>(request: { url: string }) => (request.url === DEPT_LIST_URL ? [{ id: 7, parentId: 0, name: '研发' }] : request.url === DICT_GROUPED_URL ? [{ dictType: 'approval', dataList: [{ id: 'entry-9', value: '4', label: '通过' }] }] : []) as T })
    const departments = await base.searchDepartments({ keyword: '研发' })
    expect(departments.list[0]?.id).toBe(7)
    expect(description('base-dept-search').ai.steps.find(s => s.capabilityId === 'base-user-search')?.mapping).toEqual({ deptId: 'list[].id' })
    const translated = await base.translateDict({ dictType: 'approval', value: 4 })
    expect(translated).toMatchObject({ found: true, label: '通过', value: 4 })
    expect(outputField('base-dict-get', 'entries[].id').meaning).toContain('不是表单枚举值')
    expect(description('base-dict-translate').ai.boundaries.join(' ')).toContain('String()')
    expect(outputField('base-dict-translate', 'label').nullable).toBe(true)
  })
  it('任务与流程ID映射及3/4反直觉结果枚举与实际返回一致', async () => {
    const shell = createBaseShell({ request: async <T>(request: { url: string }) => (request.url === BPM_TASK_URL ? { list: [{ id: 'task-2', processInstance: { id: 'instance-5', result: 4 } }], total: 1 } : {}) as T })
    const response = await shell.listTodos()
    expect(response.list[0]).toMatchObject({ id: 'task-2', processInstanceId: 'instance-5', result: 4 })
    const result = outputField('base-todo-list', 'list[].result')
    expect(result.values).toEqual({ '1': '待提交', '2': '待签订/待审核', '3': '不通过', '4': '通过', '8': '已取消' })
    expect(description('base-todo-list').ai.steps[0]?.mapping).toEqual({ processInstanceId: 'list[].processInstanceId' })
    expect(description('base-todo-list').ai.inputs.scope?.meaning).toContain('all 不发 finished')
  })
  it('用户与租户状态不能套用同一枚举，身份字段白名单返回', async () => {
    const shell = createBaseShell({ request: async <T>(request: { url: string }) => (request.url === USER_INFO_URL ? { id: 2, status: 1, gender: 1, superAdmin: 0, tenantAdmin: 1, password2: 'private' } : {}) as T })
    const user = await shell.getUserInfo()
    expect(user).toMatchObject({ id: '2', status: 1, gender: 1, superAdmin: false, tenantAdmin: true })
    expect(user).not.toHaveProperty('password2')
    expect(outputField('base-user-info', 'status').values?.['1']).toBe('正常')
    expect(outputField('base-tenant-get', 'status').values?.['1']).toBe('关闭')
    expect(outputField('base-user-info', 'gender').values?.['1']).toBe('女')
  })
  it('角标null、菜单截断、卡片标识均不能读成业务事实', () => {
    expect(description('base-todo-counts').ai.boundaries.join(' ')).toContain('null 不是 0')
    expect(outputField('base-todo-counts', 'todo').nullable).toBe(true)
    expect(description('base-menu-nav').ai.consume.join(' ')).toContain('truncated=false')
    expect(outputField('base-menu-nav', 'tree[].permissions').meaning).toContain('不是 url')
    expect(description('base-home-widgets').ai.boundaries.join(' ')).toContain('不是 /dashboard/')
  })
  it('销售shopArea原串接ids且名称为value，输出绝非分页list', async () => {
    const sale = createBaseSale({ saleRequest: async <T>(request: { url: string }) => (request.url === SALE_SHOP_URL ? { shopId: 7, shopArea: '110000,110100' } : request.url === SALE_AREA_URL ? [{ id: 110000, value: '省', children: [{ id: 110100, value: '市', children: null }] }] : {}) as T })
    const shop = await sale.getShopInfo()
    const areas = await sale.describeAreas({ ids: shop.shopArea! })
    expect(areas.path).toBe('省/市')
    expect(description('base-sale-shop-info').ai.steps[0]?.mapping).toEqual({ ids: 'shopArea' })
    expect(outputField('base-sale-area-describe', 'areas[].value').meaning).toContain('不是 name')
    expect(description('base-sale-area-search').returns.shape).toContain('areas:')
    expect(description('base-sale-area-children').ai.output.empty).toContain('parentFound=false')
    expect(description('base-sale-home-tip').ai.boundaries.join(' ')).toContain('不是数量')
  })
  it('上传实际写入而prepare仅本地；回执与清理链指向objectKey', () => {
    expect(description('base-upload-file').ai.effect).toBe('write')
    expect(description('base-upload-file').ai.steps.find(s => s.role === 'cancel')?.mapping).toEqual({ objectKey: 'objectKey' })
    expect(outputField('base-upload-file', 'size').meaning).toContain('byte')
    expect(description('base-upload-acl-set').returns.shape).toContain('undefined')
    expect(description('base-upload-delete').ai.boundaries.join(' ')).toContain('不存在对象也返回成功')
    expect(description('base-upload-delete-multi').ai.output.fields.map(f => f.path)).toContain('errors[].code')
    const prepared = catalog.describeMethod('baseUpload.prepare')
    if (!prepared.ok) throw new Error('prepare method missing')
    expect(prepared.ai.effect).toBe('local')
    expect(prepared.ai.boundaries.join(' ')).toContain('重新生成随机名')
  })
  it('6个未注册基础方法均从SDK动态描述入口可取得完整契约', () => {
    expect(Object.keys(BASE_METHOD_CONTRACTS)).toHaveLength(6)
    for (const sdkPath of Object.keys(BASE_METHOD_CONTRACTS)) {
      const value = catalog.describeMethod(sdkPath)
      if (!value.ok) throw new Error(sdkPath)
      expect(value.ai).toEqual(BASE_METHOD_CONTRACTS[sdkPath])
      expect(value.capabilityId).toBeNull()
    }
    const config = catalog.describeMethod('baseUpload.describeConfig')
    if (!config.ok) throw new Error('config missing')
    expect(config.ai.output.fields.find(f => f.path === 'accessKeyId')?.meaning).toContain('前4位')
    expect(config.ai.output.fields.map(f => f.path)).toContain('cname')
  })
})

// Read-only surface inventory: construction does not dispatch HTTP or read real credentials.
it('基础公开门面只剩登记的业务方法与6个有下钻契约的方法', async () => {
  const { createPortalHeadless } = await import('../src/index.js')
  const { CAPABILITY_BINDINGS } = await import('../src/capabilities/invoke.js')
  const sdk = createPortalHeadless({ baseUrl: 'https://example.invalid', credential: { token: 'fixture-only', tenantId: 1 } })
  const registered = new Set(CAPABILITY_BINDINGS.map(b => b.sdkPath))
  const extra: string[] = []
  for (const group of ['baseData', 'baseShell', 'baseTenant', 'baseSale', 'baseUpload'] as const) {
    for (const [method, value] of Object.entries(sdk[group])) if (typeof value === 'function' && !registered.has(`${group}.${method}`)) extra.push(`${group}.${method}`)
  }
  expect(extra.sort()).toEqual(Object.keys(BASE_METHOD_CONTRACTS).sort())
})
