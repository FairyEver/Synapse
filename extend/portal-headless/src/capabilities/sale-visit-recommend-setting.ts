import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「销售设置 → 推荐设置」；Portal acab69acc7、Java 0f1a55718e。 */
export const SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH = '/dashboard/sale/visit/recommend-setting/list'
export const SALE_VISIT_RECOMMEND_SETTING_PERMISSION = '/dashboard/sale/frame/visit/recommendSetting'
export const SALE_VISIT_RECOMMEND_SETTING_MODULE_TYPE = 60

const ROOT = '/admin-api/sales/recommend-setting'

export type SaleVisitRecommendSettingRatio = string | null

export type SaleVisitRecommendSettingDetail = {
  setting: {
    advancePushDays: number | null
    visitLateSubmitDays: number | null
    recommendRatio: number | null
    businessServiceRatio: string | null
  } | null
  keyAgeSettings: SaleVisitRecommendSettingKeyAge[]
}

export type SaleVisitRecommendSettingKeyAge = {
  keyAge: number | null
  pushPoint: string | null
}

export type SaleVisitRecommendSettingForm = {
  advancePushDays: number
  visitLateSubmitDays: number
  totalPercent: number
  businessServiceRatio?: SaleVisitRecommendSettingRatio | undefined
  keyDayItems: Array<{
    keyDay: number
    pushPoint: string
  }>
}

export type SaleVisitRecommendSettingSaveDraft = {
  setting: {
    id: 0
    advancePushDays: number
    visitLateSubmitDays: number
    recommendRatio: number
    businessServiceRatio: string
  }
  keyAgeSettings: Array<{
    id: 0
    keyAge: number
    pushPoint: string
  }>
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function integerInRangeOf (value: unknown, label: string, min: number, max?: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  const number = Number(value)
  if (number < min || (max !== undefined && number > max)) {
    throw new Error(`${label}必须在${min}至${max ?? '无上限'}之间`)
  }
  return number
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return integerInRangeOf(value, label, 0)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function detailOf (value: unknown): SaleVisitRecommendSettingDetail {
  const result = objectOf(value, '推荐设置详情响应')
  const settingValue = result.setting
  let setting: SaleVisitRecommendSettingDetail['setting'] = null
  if (settingValue !== undefined && settingValue !== null) {
    const source = objectOf(settingValue, '推荐设置详情.setting')
    setting = {
      advancePushDays: nullableIntegerOf(source.advancePushDays, 'advancePushDays'),
      visitLateSubmitDays: nullableIntegerOf(source.visitLateSubmitDays, 'visitLateSubmitDays'),
      recommendRatio: nullableIntegerOf(source.recommendRatio, 'recommendRatio'),
      businessServiceRatio: nullableTextOf(source.businessServiceRatio, 'businessServiceRatio'),
    }
  }

  const rawKeyAgeSettings = result.keyAgeSettings
  const keyAgeSettings = rawKeyAgeSettings === undefined || rawKeyAgeSettings === null
    ? []
    : rawKeyAgeSettings
  if (!Array.isArray(keyAgeSettings)) throw new Error('推荐设置详情.keyAgeSettings必须是数组或null')

  return {
    setting,
    keyAgeSettings: keyAgeSettings.map((item, index) => {
      const row = objectOf(item, `推荐设置详情.keyAgeSettings[${index}]`)
      return {
        keyAge: nullableIntegerOf(row.keyAge, `keyAgeSettings[${index}].keyAge`),
        pushPoint: nullableTextOf(row.pushPoint, `keyAgeSettings[${index}].pushPoint`),
      }
    }),
  }
}

function saveDraftOf (input: SaleVisitRecommendSettingForm): SaleVisitRecommendSettingSaveDraft {
  const form = objectOf(input, '推荐设置表单')
  const businessServiceRatio = form.businessServiceRatio
  if (businessServiceRatio !== undefined && businessServiceRatio !== null && typeof businessServiceRatio !== 'string') {
    throw new Error('businessServiceRatio必须为字符串或null')
  }

  const rawItems = form.keyDayItems
  if (!Array.isArray(rawItems) || rawItems.length < 1) throw new Error('keyDayItems至少需要一条')
  const keyAgeSettings = rawItems.map((item, index) => {
    const row = objectOf(item, `keyDayItems[${index}]`)
    const keyAge = integerInRangeOf(row.keyDay, `keyDayItems[${index}].keyDay`, 0)
    const pushPoint = row.pushPoint
    if (typeof pushPoint !== 'string' || pushPoint.trim() === '') {
      throw new Error(`keyDayItems[${index}].pushPoint不能为空`)
    }
    const normalizedPushPoint = pushPoint.trim()
    if (normalizedPushPoint.length > 100) throw new Error(`keyDayItems[${index}].pushPoint不能超过100个汉字`)
    return { id: 0 as const, keyAge, pushPoint: normalizedPushPoint }
  })
  if (new Set(keyAgeSettings.map(item => item.keyAge)).size !== keyAgeSettings.length) {
    throw new Error('关键日龄不允许完全相同，请修改重复项')
  }

  return {
    setting: {
      id: 0,
      advancePushDays: integerInRangeOf(form.advancePushDays, 'advancePushDays', 1, 29),
      visitLateSubmitDays: integerInRangeOf(form.visitLateSubmitDays, 'visitLateSubmitDays', 1, 29),
      recommendRatio: integerInRangeOf(form.totalPercent, 'totalPercent', 0, 100),
      businessServiceRatio: businessServiceRatio ?? '',
    },
    keyAgeSettings,
  }
}

function trueResult (value: unknown): true {
  if (value !== true) throw new Error('保存推荐设置响应不是true')
  return true
}

/** The injected request must be created for SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH. */
export function createSaleVisitRecommendSettingCapability (request: PortalRequest) {
  return {
    async get (): Promise<SaleVisitRecommendSettingDetail> {
      return detailOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get' }))
    },

    prepareSave (input: { form: SaleVisitRecommendSettingForm }): { draft: SaleVisitRecommendSettingSaveDraft } {
      return { draft: saveDraftOf(input.form) }
    },

    async save (input: { draft: SaleVisitRecommendSettingSaveDraft }): Promise<true> {
      const draft = saveDraftOf({
        advancePushDays: input.draft.setting.advancePushDays,
        visitLateSubmitDays: input.draft.setting.visitLateSubmitDays,
        totalPercent: input.draft.setting.recommendRatio,
        businessServiceRatio: input.draft.setting.businessServiceRatio,
        keyDayItems: input.draft.keyAgeSettings.map(item => ({ keyDay: item.keyAge, pushPoint: item.pushPoint })),
      })
      return trueResult(await request<unknown>({ url: `${ROOT}/save`, method: 'post', data: draft }))
    },
  }
}

export type SaleVisitRecommendSettingCapability = ReturnType<typeof createSaleVisitRecommendSettingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

export const SALE_VISIT_RECOMMEND_SETTING_METHODS = {
  'sale-visit-recommend-setting-get': 'get',
  'sale-visit-recommend-setting-prepare-save': 'prepareSave',
  'sale-visit-recommend-setting-save': 'save',
} as const

export const saleVisitRecommendSettingCapabilities: CapabilityDefinition[] = [
  { id: 'sale-visit-recommend-setting-get', title: '读取推荐设置', write: false, params: [] },
  { id: 'sale-visit-recommend-setting-prepare-save', title: '准备保存推荐设置', write: false, params: [p('form', 'text', true, '推荐设置页面表单；包含三个数值字段、动态字典占比值和至少一条关键日龄设置')] },
  { id: 'sale-visit-recommend-setting-save', title: '保存推荐设置', write: true, params: [p('draft', 'text', true, 'prepareSave返回的完整保存草稿；确认后原样提交')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH,
  permission: SALE_VISIT_RECOMMEND_SETTING_PERMISSION,
  moduleType: SALE_VISIT_RECOMMEND_SETTING_MODULE_TYPE,
  httpInstance: 'platform',
}))
