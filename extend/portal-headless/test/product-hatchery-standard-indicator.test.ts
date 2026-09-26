import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import type { AiContract } from '../src/catalog/ai-contract.js'
import { baseDeptDictPermissionCapabilities } from '../src/capabilities/base-dept-dict-permission.js'
import {
  createProductHatcheryStandardIndicatorCapability,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION,
  productHatcheryStandardIndicatorCapabilities,
} from '../src/capabilities/product-hatchery-standard-indicator.js'
import {
  PRODUCT_HATCHERY_STANDARD_INDICATOR_AI_CONTRACTS as contracts,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-hatchery-standard-indicator.js'
import { BASE_AI_CONTRACTS } from '../src/catalog/contracts-base.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form = {
  suiteCode: 'suite-1',
  traitType: 22,
  traitCode: 'egg_weight',
  contentType: 3 as const,
  unit: 'g',
  scale: 2,
  age: 12,
  min: 1.2,
  max: 2.4,
  txt: '1.2-2.4',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHatcheryStandardIndicatorCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 孵化预案 → 标准库 → 查看标准隐藏指标页能力', () => {
  it('锁定入口包装、隐藏路径、product请求、权限和Java链路', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/lib.vue')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatchery-manage/lib/list.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/indicator/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/product/setting/hatch-manage/lib/indicator/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/programNew/StandardLibController.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/simu/ProgramLibMapper.xml')
    const unitController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/program/ProgramUnitLayController.java')

    expect(menu).toContain("path: '/dashboard/product/setting/hatchery-manage/lib/list'")
    expect(menu).toContain(`permission: '${PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION}'`)
    expect(route).toContain(PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION)
    expect(wrapper).toContain("import HatchManageLibList from 'app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue'")
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "http.get('/programNew/standardLib/getTraitPage'",
      "http.get('/programUnit/getTraitList'",
      "http.post('/programNew/standardLib/createTrait'",
      "http.post('/programNew/standardLib/editTrait'",
      "http.get('/programNew/standardLib/deleteTrait'",
      'program:suite-indicator:query',
      'program:suite-indicator:submit',
      'program:suite-indicator:delete',
      'responseType: \'blob\'',
      "standardLib/exportStandardLib",
    ]) expect(list).toContain(fragment)
    for (const fragment of ['traitType', 'traitCode', 'contentType', 'unit', 'scale', 'age', 'min', 'max', 'txt']) expect(modal).toContain(fragment)
    for (const endpoint of ['/getTraitPage', '/createTrait', '/editTrait', '/deleteTrait', '/exportStandardLib']) expect(controller).toContain(endpoint)
    for (const fragment of ['spl.age_type = #{ageType}', 'spu.classification in (22, 23)', 'spl.code = #{traitCode}', 'spl.age = #{age}', 'spl.suite_code = #{suiteCode}']) expect(mapper).toContain(fragment)
    expect(unitController).toContain('@GetMapping(value = "/getTraitList")')
    expect(productHatcheryStandardIndicatorCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS))
    expect(productHatcheryStandardIndicatorCapabilities.every(item => item.pagePath === PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH && item.permission === PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION && item.httpInstance === 'product' && item.moduleType === null)).toBe(true)
  })

  it('按Portal请求形状查询动态指标候选和分页数据', async () => {
    const f = fixture([
      [{ code: 'egg_weight', name: '蛋重', contentType: 3, unit: 'g', scale: 2 }],
      { page: { list: [{ id: 'indicator-1', suiteCode: 'suite-1', traitCode: 'egg_weight', traitName: '蛋重', traitType: 22, age: 12, contentType: 3, scale: 2, unit: 'g', min: 1.2, max: 2.4, txt: '1.2-2.4' }], total: 1 } },
    ])
    await expect(f.api.traitOptions({ traitType: 22 })).resolves.toEqual([{ code: 'egg_weight', name: '蛋重', contentType: 3, unit: 'g', scale: 2, label: '蛋重', value: 'egg_weight' }])
    await expect(f.api.list({ traitType: 22, traitCode: 'egg_weight', age: 12, suiteCode: 'suite-1', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [{ id: 'indicator-1', traitCode: 'egg_weight', age: 12 }] })
    expect(f.calls).toEqual([
      { url: '/programUnit/getTraitList', method: 'get', params: { classification: 22 } },
      { url: '/programNew/standardLib/getTraitPage', method: 'get', params: { order: '', orderField: '', traitType: 22, traitCode: 'egg_weight', age: 12, suiteCode: 'suite-1', scope: 1, pageNo: 2, pageSize: 50 } },
    ])
  })

  it('按页面字段执行新建冲突覆盖、编辑和删除', async () => {
    const f = fixture([1, {}, {}, {}])
    const create = f.api.prepareCreate(form)
    await expect(f.api.create(create)).resolves.toEqual({ status: 'conflict', flag: 1 })
    await expect(f.api.create({ ...create, flag: 1 })).resolves.toEqual({ status: 'submitted' })
    const update = f.api.prepareUpdate({ ...form, id: 'indicator-1' })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove(f.api.prepareRemove({ id: 'indicator-1' }))).resolves.toBe(true)
    expect(f.calls[0]).toEqual({ url: '/programNew/standardLib/createTrait', method: 'post', data: { ...form, id: undefined, flag: 0 } })
    expect(f.calls[1]).toEqual({ url: '/programNew/standardLib/createTrait', method: 'post', data: { ...form, id: undefined, flag: 1 } })
    expect(f.calls[2]).toEqual({ url: '/programNew/standardLib/editTrait', method: 'post', data: { ...form, id: 'indicator-1', flag: 1 } })
    expect(f.calls[3]).toEqual({ url: '/programNew/standardLib/deleteTrait', method: 'get', params: { id: 'indicator-1' } })
  })

  it('导出返回二进制文件描述并只带页面筛选字段', async () => {
    const f = fixture([{ data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="标准库标准.xlsx"' } }])
    await expect(f.api.exportData({ suiteCode: 'suite-1', traitType: 22, traitCode: 'egg_weight', age: 12 })).resolves.toEqual({ fileName: '标准库标准.xlsx', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    expect(f.calls).toEqual([{ url: '/programNew/standardLib/exportStandardLib', method: 'get', params: { traitType: 22, traitCode: 'egg_weight', age: 12, suiteCode: 'suite-1', scope: 1 }, responseType: 'arraybuffer' }])
  })

  it('AI契约覆盖公开方法、动态候选、写入步骤和权限，并用坏映射做反证', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS).map(method => `productHatcheryStandardIndicator.${method}`).sort())
    expect(contracts['product-hatchery-standard-indicator-trait-options']?.inputs.traitType!.lookup).toEqual({ capabilityId: 'base-dict-get', args: { dictType: 'standard_class' }, valueField: 'entries[].value', labelField: 'entries[].label' })
    expect(contracts['product-hatchery-standard-indicator-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].suiteCode', 'list[].traitCode', 'list[].age', 'list[].min', 'list[].max', 'total']))
    expect(contracts['product-hatchery-standard-indicator-prepare-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['product-hatchery-standard-indicator-create']?.steps.some(step => step.capabilityId === 'product-hatchery-standard-indicator-list')).toBe(true)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl)
    const baseDictDefinition = baseDeptDictPermissionCapabilities.find(item => item.id === 'base-dict-get')!
    const validationDefinitions = [baseDictDefinition, ...productHatcheryStandardIndicatorCapabilities]
    const validationContracts: Record<string, AiContract> = { 'base-dict-get': BASE_AI_CONTRACTS['base-dict-get']!, ...contracts }
    for (const [id, contract] of Object.entries(contracts)) {
      expect(validateAiContract(id, contract, { definitions: validationDefinitions, contracts: validationContracts })).toEqual([])
    }

    const broken = structuredClone(validationContracts)
    broken['product-hatchery-standard-indicator-prepare-create']!.steps[0]!.capabilityId = 'missing-capability'
    expect(validateAiContract('product-hatchery-standard-indicator-prepare-create', broken['product-hatchery-standard-indicator-prepare-create']!, { definitions: validationDefinitions, contracts: broken })).not.toEqual([])
  })

  it('Portal表单边界不被静默放宽', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, age: 701 })).toThrow('1到700')
    expect(() => f.api.prepareCreate({ ...form, min: 3, max: 2 })).toThrow('最小值不能超过最大值')
    expect(() => f.api.prepareCreate({ ...form, contentType: 1, min: undefined, max: undefined, txt: '' })).toThrow('标准内容')
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('标准指标ID')
    await expect(f.api.exportData({ suiteCode: '' })).rejects.toThrow('suiteCode')
    expect(f.calls).toEqual([])
  })
})
