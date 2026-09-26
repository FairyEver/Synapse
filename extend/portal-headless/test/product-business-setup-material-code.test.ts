import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductBusinessSetupMaterialCodeCapability,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LIST_URL,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LIST_URL,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION,
  productBusinessSetupMaterialCodeCapabilities,
} from '../src/capabilities/product-business-setup-material-code.js'
import { PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-product-business-setup-material-code.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductBusinessSetupMaterialCodeCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function materialForm (extra: Record<string, unknown> = {}) {
  return {
    farmId: 'farm-1', gen: 'G1', variety: 'V1', line: 'L1',
    ...Object.fromEntries(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS.flatMap((item, index) => [
      [`${item.prop}RowId`, `row-${index}`],
      [`${item.prop}MaterialId`, `material-${index}`],
    ])),
    ...extra,
  }
}

describe('Portal 设置蛋鸡场物料号页面能力', () => {
  it('逐页锁定路由、权限、两个Tab、product实例和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/setup-material-code.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/setup-material-code/list.vue')
    const farm = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/setup-material-code/setup-material-code-farm.vue')
    const batch = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/setup-material-code/setup-material-code-batch.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/setup-material-code/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/SetupMaterialCodeController.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/base/SetupMaterialCodeListDTO.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/vo/SetupMaterialCodeListVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/SetupMaterialCodeServiceImpl.java')
    expect(menu).toContain(`path: '${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION}'`)
    expect(route).toContain(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION)
    expect(`${list}\n${farm}\n${batch}`).toContain("label: '批量设置物料号'")
    expect(`${list}\n${farm}\n${batch}`).toContain("label: '批次设置物料号'")
    for (const source of [farm, batch, modal]) expect(source).toContain("from 'app/portal/utils/http/product.js'")
    for (const endpoint of [
      '/base/setupMaterialCode/farmMaterialList', '/base/setupMaterialCode/batchMaterialList',
      '/base/setupMaterialCode/farmMaterial', '/base/setupMaterialCode/batchMaterial',
      '/base/setupMaterialCode/farmMaterialSubmit', '/base/setupMaterialCode/getFlockBatch',
      '/config/building/getByFarmId', '/consumeMaterial/getMaterialList',
    ]) expect(`${farm}\n${batch}\n${modal}`).toContain(endpoint)
    for (const endpoint of ['/farmMaterialList', '/farmMaterial', '/farmMaterialSubmit', '/getFlockBatch', '/batchMaterialList', '/batchMaterial']) expect(controller).toContain(endpoint)
    for (const prop of ['eliminate', 'seedEgg', 'male', 'female', 'growing', 'moulting', 'commodityEgg', 'soupEgg']) {
      expect(dto).toContain(`${prop}MaterialId`)
      expect(dto).toContain(`${prop}RowId`)
    }
    for (const prop of ['farm', 'building', 'flockGroupId', 'batch', 'variety', 'gen', 'line', 'startDate', 'endDate']) expect(vo).toContain(`private ${prop === 'flockGroupId' ? 'Long' : prop === 'startDate' || prop === 'endDate' ? 'LocalDate' : 'String'} ${prop}`)
    expect(service).toContain('setupMaterialCodeListDTO.setVariety("0")')
    expect(service).toContain('setupMaterialCodeListDTO.setLine("0")')
    expect(service).toContain('setupMaterialCodeListDTO.setGen("0")')
    expect(service).toContain('materialFarmInsert(setupMaterialCodeListDTO)')
    expect(productBusinessSetupMaterialCodeCapabilities.every(item => item.pagePath === PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH && item.permission === PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION && item.httpInstance === 'product' && item.moduleType === null)).toBe(true)
    expect(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS).not.toHaveProperty('product-business-setup-material-code-delete')
  })

  it('按Portal逐字段发送批量列表、联动候选和批次列表参数', async () => {
    const f = fixture([
      { page: { list: [{ farmId: 'farm-1', farmName: '场区一' }], total: 1 } },
      [{ id: 'building-1', shortName: '1栋' }],
      [{ groupId: 'group-1', batch: 'B1' }],
      [{ farmId: 'farm-1', batch: 'B1' }],
    ])
    await expect(f.api.farmList({ farm: 'farm-1', variety: 'V1', line: 'L1', gen: 'G1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ farmId: 'farm-1', farmName: '场区一' }], total: 1 })
    await expect(f.api.buildingOptions({ farmId: 'farm-1' })).resolves.toEqual([{ id: 'building-1', shortName: '1栋', label: '1栋', value: 'building-1' }])
    await expect(f.api.batchOptions({ farm: 'farm-1', building: 'building-1', startDate: '2026-09-01', endDate: '2026-09-30' })).resolves.toEqual([{ groupId: 'group-1', batch: 'B1', label: 'B1', value: 'B1' }])
    await expect(f.api.batchList({ flockGroupId: 'group-1', batch: 'B1' })).resolves.toEqual([{ farmId: 'farm-1', batch: 'B1' }])
    expect(f.calls).toEqual([
      { url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_LIST_URL, method: 'get', params: { order: '', orderField: '', farm: 'farm-1', variety: 'V1', line: 'L1', gen: 'G1', pageNo: 2, pageSize: 50 } },
      { url: '/config/building/getByFarmId', method: 'get', params: { farmId: 'farm-1' } },
      { url: '/base/setupMaterialCode/getFlockBatch', method: 'get', params: { farm: 'farm-1', building: 'building-1', startDate: '2026-09-01', endDate: '2026-09-30' } },
      { url: PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_LIST_URL, method: 'get', params: { flockGroupId: 'group-1', batch: 'B1' } },
    ])
  })

  it('保留Portal的14类物料候选与弹窗回填边界', async () => {
    const f = fixture([[{ id: 'm1', materialDescription: '淘汰鸡' }], { SetupMaterialCodeListDTO: { id: 'config-1', farmId: 'farm-1', eliminateMaterialId: 'm1', eliminateRowId: 'row-1' } }, null])
    await expect(f.api.materialOptions({ description: '淘汰鸡' })).resolves.toEqual([{ id: 'm1', materialDescription: '淘汰鸡', label: '淘汰鸡', value: 'm1' }])
    await expect(f.api.farmMaterial({ farm: 'farm-1' })).resolves.toMatchObject({ id: 'config-1', farmId: 'farm-1', eliminateMaterialId: 'm1', eliminateRowId: 'row-1' })
    await expect(f.api.batchMaterial({ flockGroupId: 'group-1', batch: 'B1' })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/consumeMaterial/getMaterialList', method: 'get', params: { description: '淘汰鸡' } },
      { url: '/base/setupMaterialCode/farmMaterial', method: 'get', params: { farm: 'farm-1', variety: '', line: '', gen: '' } },
      { url: '/base/setupMaterialCode/batchMaterial', method: 'get', params: { flockGroupId: 'group-1', batch: 'B1' } },
    ])
  })

  it('批量和批次提交体严格区分上下文，并支持取消前的prepare', async () => {
    const f = fixture([undefined, undefined])
    const farmPrepared = f.api.prepareFarmSubmit(materialForm({ id: 'config-1' }))
    expect(farmPrepared.draft).toMatchObject({ id: 'config-1', farmId: 'farm-1', gen: 'G1', variety: 'V1', line: 'L1', eliminateName: '淘汰鸡', eliminateRowId: 'row-0', eliminateMaterialId: 'material-0' })
    expect(farmPrepared.draft).not.toHaveProperty('flockGroupId')
    await expect(f.api.farmSubmit(farmPrepared)).resolves.toBe(true)
    const batchPrepared = f.api.prepareBatchSubmit(materialForm({ flockGroupId: 'group-1', farmId: undefined, gen: undefined, variety: undefined, line: undefined }))
    expect(batchPrepared.draft).toMatchObject({ flockGroupId: 'group-1', eliminateName: '淘汰鸡' })
    expect(batchPrepared.draft).not.toHaveProperty('farmId')
    await expect(f.api.batchSubmit(batchPrepared)).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/base/setupMaterialCode/farmMaterialSubmit', method: 'post', data: farmPrepared.draft })
    expect(f.calls[1]).toEqual({ url: '/base/setupMaterialCode/farmMaterialSubmit', method: 'post', data: batchPrepared.draft })
  })

  it('坏分页、坏候选、非法ID不会静默发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareBatchSubmit({ flockGroupId: '', ...materialForm() })).toThrow('flockGroupId')
    expect(() => f.api.prepareFarmSubmit({ ...materialForm(), eliminateMaterialId: {} })).toThrow('物料ID')
    await expect(f.api.farmList({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.materialOptions({ description: '' })).rejects.toThrow('物料描述')
    await expect(f.api.buildingOptions({ farmId: '' })).rejects.toThrow('farmId')
    expect(f.calls).toEqual([])
  })

  it('AI契约覆盖所有公开方法、提交映射、取消和不登记删除边界', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS).sort())
    expect(contracts['product-business-setup-material-code-prepare-farm-submit']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-business-setup-material-code-prepare-batch-submit']?.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    expect(contracts['product-business-setup-material-code-farm-submit']?.boundaries.join('\n')).toContain('14类物料')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productBusinessSetupMaterialCodeCapabilities, contracts })).toEqual([])
  })
})
