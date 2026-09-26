import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  buildProductPlanPreviewParams,
  createProductPlanPreviewCapability,
  PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID,
  PRODUCT_PLAN_PREVIEW_METHODS,
  PRODUCT_PLAN_PREVIEW_MODULE_TYPE,
  PRODUCT_PLAN_PREVIEW_PAGE_PATH,
  PRODUCT_PLAN_PREVIEW_PERMISSION,
  PRODUCT_PLAN_PREVIEW_URL,
  productPlanPreviewCapabilities,
  type ProductPlanPreviewQuery,
} from '../src/capabilities/product-plan-preview.js'
import { productSettingSeasonCapabilities } from '../src/capabilities/product-setting-season.js'
import {
  PRODUCT_PLAN_PREVIEW_AI_CONTRACTS as contracts,
  PRODUCT_PLAN_PREVIEW_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-plan-preview.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductPlanPreviewCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const query: ProductPlanPreviewQuery = {
  generation: ' 商品代 ',
  variety: ' 京红1号 ',
  provinceCode: '360000',
  cityCode: '360100',
  districtCode: '360102',
  region: ' 江西 / 南昌 / 东湖 ',
  entryDate: '2026-05-01',
  dayAge: '133',
}

describe('系统设置 → 生产设置 → 养殖预案 → 预案预览-新', () => {
  it('逐页锁定Portal路径、权限、platform实例、表单联动和Java请求/响应证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const page = read(portalRoot, 'app/portal/views/dashboard/product/setting/plan-preview/list.vue')
    const utils = read(portalRoot, 'app/portal/views/dashboard/product/setting/plan-preview/utils.js')
    const detail = read(portalRoot, 'app/portal/views/dashboard/product/setting/plan-preview/components/PlanPreviewDetail.vue')
    const seasonUtils = read(portalRoot, 'app/portal/views/dashboard/product/setting/season/utils.js')
    const javaDoc = read(javaRoot, 'erp-module-fm/docs/新版预案/预案预览-PC端接口对接文档.md')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/RearingPlanPreviewController.java')
    const requestDto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanPreviewReqVO.java')
    const responseDto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/rearingplan/vo/RearingPlanPreviewRespVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/rearingplan/impl/RearingPlanPreviewServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_PLAN_PREVIEW_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_PLAN_PREVIEW_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      'const areaCode = computed(() => getAreaCode(formState))',
      'const selectedRegion = computed',
      'formState.variety = \'\'',
      'formState.cityCode = \'\'',
      'formState.districtCode = \'\'',
      'if (!/^\\d{6}$/.test(areaCode.value))',
      'if (!formState.entryDate)',
      'http.get(PREVIEW_GET_API',
      'http.get(AREA_TREE_API',
    ]) expect(page).toContain(fragment)
    expect(utils).toContain("export const PREVIEW_GET_API = `${PREVIEW_API}/get`")
    for (const fragment of ['generation', 'areaCode', 'entryDate', 'params.dayAge = Number(dayAge)', 'list']) expect(utils).toContain(fragment)
    for (const fragment of ['const EMPTY_HOUSE_AGE = -1', 'const DAY_AGE_MAX = 700', 'normalizedDayAge === 0', 'ageList = [']) expect(detail).toContain(fragment)
    expect(seasonUtils).toContain("export const AREA_TREE_API = '/system/area/tree'")
    for (const fragment of [
      'GET', '/admin-api/flockSimu/rearingPlan/preview/get',
      '`generation`', '`variety`', '`areaCode`', '`entryDate`', '`dayAge`',
      '不能为 `0`', '`list`', '`list[].feed`', '`programPointList`', '只读',
    ]) expect(javaDoc).toContain(fragment)
    expect(controller).toContain('@GetMapping("/get")')
    for (const fragment of ['private String generation', 'private String variety', 'private String areaCode', 'private LocalDate entryDate', 'private Integer dayAge', '@Pattern(regexp = "^\\\\d{6}$"', '@Max(value = 700']) expect(requestDto).toContain(fragment)
    for (const fragment of ['private List<PreviewDay> list', 'private PreviewSection feed', 'private PreviewSection nutrition', 'private PreviewSection prevention', 'programIndexList', 'programPointList', 'programKeyPointList']) expect(responseDto).toContain(fragment)
    expect(service).toContain('Integer.valueOf(0).equals(reqVO.getDayAge())')
    expect(productSettingSeasonCapabilities.some(item => item.id === PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID)).toBe(true)
  })

  it('按Portal buildPreviewParams投影省市区、日期、地区回显和日龄，不发送未使用字段', async () => {
    const f = fixture([{ list: [] }])
    await expect(f.api.preview(query)).resolves.toEqual({ list: [] })
    expect(f.calls).toEqual([{
      url: PRODUCT_PLAN_PREVIEW_URL,
      method: 'get',
      params: {
        generation: '商品代',
        areaCode: '360102',
        entryDate: '2026-05-01',
        variety: '京红1号',
        region: '江西 / 南昌 / 东湖',
        dayAge: 133,
      },
    }])
    expect(f.calls[0]).not.toHaveProperty('data')
    expect(f.calls[0]?.params).not.toHaveProperty('provinceCode')
    expect(f.calls[0]?.params).not.toHaveProperty('cityCode')
    expect(f.calls[0]?.params).not.toHaveProperty('districtCode')
    expect(f.calls[0]?.params).not.toHaveProperty('previewDate')
    expect(buildProductPlanPreviewParams({
      generation: '祖代', variety: '品种', provinceCode: '360000', entryDate: '2026-05-01', region: '  ', dayAge: null,
    })).toEqual({ generation: '祖代', areaCode: '360000', entryDate: '2026-05-01', variety: '品种' })
  })

  it('逐字段归一Portal data包络、list和feed/nutrition/prevention嵌套数组并保留扩展字段', async () => {
    const f = fixture([{
      data: {
        trace: 'keep-for-compatibility',
        list: [{
          delFlag: 0,
          age: -1,
          feed: {
            programIndexList: [{ name: '日耗量', age: -5 }],
            programPointList: [{ name: '空场', videoList: undefined, dayAgeRange: '-5--3' }],
          },
          nutrition: {},
          prevention: { programPointList: [{ name: '免疫', videoList: null }] },
        }],
      },
    }])
    const result = await f.api.preview(query)
    expect(result.trace).toBe('keep-for-compatibility')
    expect(result.list).toHaveLength(1)
    expect(result.list[0]?.age).toBe(-1)
    expect(result.list[0]?.feed.programIndexList).toEqual([{ name: '日耗量', age: -5 }])
    expect(result.list[0]?.feed.programPointList[0]).toMatchObject({ name: '空场', dayAgeRange: '-5--3', videoList: [] })
    expect(result.list[0]?.feed.programKeyPointList).toEqual([])
    expect(result.list[0]?.nutrition).toMatchObject({ programIndexList: [], programPointList: [], programKeyPointList: [] })
    expect(result.list[0]?.prevention.programPointList[0]?.videoList).toEqual([])
  })

  it('复刻Portal表单/Java失败规则：非法值在请求前失败且禁止日龄0及其它负数', async () => {
    const cases: Array<[string, ProductPlanPreviewQuery, string]> = [
      ['generation', { ...query, generation: ' ' }, '代次'],
      ['variety', { ...query, variety: '' }, '品种'],
      ['city-without-province', { ...query, provinceCode: '', cityCode: '360100' }, '选择市前'],
      ['bad-area-code', { ...query, provinceCode: '36000' }, '6位数字'],
      ['bad-date', { ...query, entryDate: '2026-02-30' }, '有效日期'],
      ['day-age-zero', { ...query, dayAge: 0 }, '不能为0'],
      ['day-age-other-negative', { ...query, dayAge: -2 }, '必须是-1或1至700'],
      ['day-age-too-large', { ...query, dayAge: 701 }, '必须是-1或1至700'],
      ['day-age-fraction', { ...query, dayAge: 1.5 }, '必须是整数'],
    ]
    for (const [, invalid, message] of cases) {
      const f = fixture([])
      await expect(f.api.preview(invalid)).rejects.toThrow(message)
      expect(f.calls).toEqual([])
    }
    const f = fixture([])
    await expect(f.api.preview({ ...query, districtCode: '', cityCode: '360100' })).resolves.toEqual({ list: [] })
    expect(f.calls[0]?.params).toMatchObject({ areaCode: '360100' })
  })

  it('能力定义、公共地区树复用和AI契约结构通过；破坏关键契约时检查器会报错', async () => {
    expect(productPlanPreviewCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_PLAN_PREVIEW_METHODS))
    expect(productPlanPreviewCapabilities).toHaveLength(1)
    expect(productPlanPreviewCapabilities[0]).toMatchObject({
      pagePath: PRODUCT_PLAN_PREVIEW_PAGE_PATH,
      permission: PRODUCT_PLAN_PREVIEW_PERMISSION,
      httpInstance: 'platform',
      moduleType: PRODUCT_PLAN_PREVIEW_MODULE_TYPE,
      write: false,
    })
    expect(PRODUCT_PLAN_PREVIEW_METHODS).not.toHaveProperty('product-plan-preview-area-tree')
    expect(contracts['product-plan-preview-preview']?.inputs).toEqual(expect.objectContaining({
      generation: expect.objectContaining({ required: true }),
      variety: expect.objectContaining({ required: true }),
      provinceCode: expect.objectContaining({ required: true }),
      cityCode: expect.objectContaining({ required: false, nullable: true }),
      districtCode: expect.objectContaining({ required: false, nullable: true }),
      entryDate: expect.objectContaining({ required: true, format: 'YYYY-MM-DD且必须是有效日历日期' }),
      dayAge: expect.objectContaining({ required: false, constraints: expect.arrayContaining(['页面可达值为-1或1至700；0禁止，-2至-365虽被Java接口接受但不属于本Portal页面可达行为；SDK在请求前拒绝它们。']) }),
    }))
    const paths = new Set(contracts['product-plan-preview-preview']?.output.fields.map(item => item.path))
    for (const section of ['feed', 'nutrition', 'prevention']) {
      expect(paths).toContain(`list[].${section}`)
      expect(paths).toContain(`list[].${section}.programIndexList`)
      expect(paths).toContain(`list[].${section}.programPointList`)
      expect(paths).toContain(`list[].${section}.programKeyPointList`)
      expect(paths).toContain(`list[].${section}.programPointList[].videoList[].fileUrl`)
    }
    expect(methodContracts['productPlanPreview.preview']?.boundaries.join('\n')).toContain('没有prepare、submit或cancel写链')

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl) as {
      validateAiContract: (id: string, value: unknown, options?: { definitions?: unknown[] }) => Array<{ code: string }>
    }
    const definitions = [...productPlanPreviewCapabilities, ...productSettingSeasonCapabilities]
    expect(validateAiContract('product-plan-preview-preview', contracts['product-plan-preview-preview'], { definitions })).toEqual([])
    const broken = { ...contracts['product-plan-preview-preview']!, purpose: ' ' }
    expect(validateAiContract('product-plan-preview-preview', broken, { definitions })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'empty-text' })]))
  })
})
