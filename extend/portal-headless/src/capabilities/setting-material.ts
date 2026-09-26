import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 物料管理」及其可达的详情、平台物料选择和单位换算页。 */
export const SETTING_MATERIAL_PAGE_PATH = '/dashboard/setting/material/list'
export const SETTING_MATERIAL_PERMISSION = '/dashboard/setting/material'
export const SETTING_MATERIAL_MODULE_TYPE = null

const ROOT = '/admin-api/system/sys-materiel'
const UNIT_ROOT = '/admin-api/system/sys-materiel-unit'
const CONVERSION_ROOT = '/admin-api/system/sys-materiel-unit-conversion'
const VIEW_SALES_ROOT = '/admin-api/system/materiel-view-sales'
const SUPPLIER_PAGE_URL = '/admin-api/system/sys-supplier/page'
const SUPPLIER_PAGE_SIZE = 500
const SUPPLIER_MAX_PAGES = 100

export type SettingMaterialId = string | number

export type SettingMaterialQuery = {
  matName?: string | null
  matDescribe?: string | null
  supplierId?: SettingMaterialId | null
  categoryId?: SettingMaterialId | null
  pageNo?: number
  pageSize?: number
}

export type SettingMaterialRow = Record<string, unknown> & {
  id: SettingMaterialId
  supplierId: SettingMaterialId | null
  matCode: string | null
  matName: string | null
  matDescribe: string | null
  img: string | null
  unit: string | null
  type: number | null
  categoryId: SettingMaterialId | null
  price: number | string | null
  purMethod: string | null
  status: number | null
  salesSystemId: number | null
  isEntry: boolean | null
  entryTime: string | number | null
  giveScale: string | null
  qualityStandards: string | null
  specDes: string | null
  internalUnitPrice: number | string | null
  levelOfAttention: number | null
  sysBrandId: SettingMaterialId | null
  sysBrandName: string | null
  supplierName: string | null
  supplierCode: string | null
  supplierAbbreviation: string | null
  createTime: string | number | null
  updateTime: string | number | null
  updaterName: string | null
  addedByTenant: number | null
  selectable: boolean | null
  categoryName: string | null
  viewSalesList: Array<Record<string, unknown>> | null
  typeName: string | null
}

export type SettingMaterialCreateItem = Record<string, unknown> & {
  matName: string
  matDescribe: string
  categoryId: SettingMaterialId
  unit: string
  supplierId: SettingMaterialId
  matCode?: string | null
  supplierCode?: string | null
  specDes?: string | null
  isEntry?: boolean | null
  entryTime?: string | null
}

export type SettingMaterialCreateInput = { materials: SettingMaterialCreateItem[] }

export type SettingMaterialPlatformQuery = {
  matName?: string
  matDescribe?: string
  supplierId?: SettingMaterialId | ''
  categoryId?: SettingMaterialId | ''
  pageNo?: number
  pageSize?: number
}

export type SettingMaterialAddPlatformInput = {
  materielIds: SettingMaterialId[]
  tenantId: SettingMaterialId
}

export type SettingMaterialReceiveConfigQuery = {
  materielId: SettingMaterialId
  orgId?: SettingMaterialId | null
  pageNo?: number
  pageSize?: number
}

export type SettingMaterialConversionRule = Record<string, unknown> & {
  id: SettingMaterialId
  relUnit: string | null
  baseUnit: string | null
  coefficient: number | string | null
  targetUnit: string | null
  targetCoefficient: number | string | null
  materielId: SettingMaterialId | null
  propValueIds: string | null
}

export type SettingMaterialConversionGroup = Record<string, unknown> & {
  propValueIds: string | null
  propId: number | null
  list: SettingMaterialConversionRule[]
}

export type SettingMaterialConversionContext = {
  materiel: SettingMaterialRow
  specGroups: Array<Record<string, unknown>>
  rules: SettingMaterialConversionGroup[]
  units: Array<Record<string, unknown>>
}

export type SettingMaterialConversionItemInput = {
  id?: SettingMaterialId | null
  targetUnit: string
  targetCoefficient: number
}

export type SettingMaterialConversionGroupInput = {
  propValueIds?: string | null
  coefficient?: number
  items: SettingMaterialConversionItemInput[]
}

export type SettingMaterialConversionSaveInput = {
  materielId: SettingMaterialId
  baseUnit: string
  groups: SettingMaterialConversionGroupInput[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingMaterialId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SettingMaterialId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function idOrUndefinedOf (value: unknown, label: string): SettingMaterialId | null | undefined {
  if (value === undefined) return undefined
  return nullableIdOf(value, label)
}

function textOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || (required && value.trim().length === 0)) throw new Error(`${label}必须为${required ? '非空' : ''}字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const result = textOf(value, label, true)
  return result as string
}

function numericOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、数字字符串或null`)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function booleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function pageParamsOf (query: SettingMaterialQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    matName: textOf(query.matName, '物料名称'),
    matDescribe: textOf(query.matDescribe, '物料描述'),
    supplierId: nullableIdOf(query.supplierId, '供应商ID'),
    categoryId: nullableIdOf(query.categoryId, '物料分类ID'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function platformPageParamsOf (query: SettingMaterialPlatformQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    matName: textOf(query.matName, '物料名称') ?? '',
    matDescribe: textOf(query.matDescribe, '物料描述') ?? '',
    supplierId: query.supplierId === undefined ? '' : nullableIdOf(query.supplierId, '供应商ID') ?? '',
    categoryId: query.categoryId === undefined ? '' : nullableIdOf(query.categoryId, '物料分类ID') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label: string): SettingMaterialRow {
  const row = objectOf(value, label)
  const viewSalesList = row.viewSalesList === undefined || row.viewSalesList === null ? null : row.viewSalesList
  if (viewSalesList !== null && !Array.isArray(viewSalesList)) throw new Error(`${label}.viewSalesList必须为数组或null`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    supplierId: nullableIdOf(row.supplierId, `${label}.supplierId`),
    matCode: textOf(row.matCode, `${label}.matCode`),
    matName: textOf(row.matName, `${label}.matName`),
    matDescribe: textOf(row.matDescribe, `${label}.matDescribe`),
    img: textOf(row.img, `${label}.img`),
    unit: textOf(row.unit, `${label}.unit`),
    type: integerOf(row.type, `${label}.type`),
    categoryId: nullableIdOf(row.categoryId, `${label}.categoryId`),
    price: numericOf(row.price, `${label}.price`),
    purMethod: textOf(row.purMethod, `${label}.purMethod`),
    status: integerOf(row.status, `${label}.status`),
    salesSystemId: integerOf(row.salesSystemId, `${label}.salesSystemId`),
    isEntry: booleanOf(row.isEntry, `${label}.isEntry`),
    entryTime: dateOf(row.entryTime, `${label}.entryTime`),
    giveScale: textOf(row.giveScale, `${label}.giveScale`),
    qualityStandards: textOf(row.qualityStandards, `${label}.qualityStandards`),
    specDes: textOf(row.specDes, `${label}.specDes`),
    internalUnitPrice: numericOf(row.internalUnitPrice, `${label}.internalUnitPrice`),
    levelOfAttention: integerOf(row.levelOfAttention, `${label}.levelOfAttention`),
    sysBrandId: nullableIdOf(row.sysBrandId, `${label}.sysBrandId`),
    sysBrandName: textOf(row.sysBrandName, `${label}.sysBrandName`),
    supplierName: textOf(row.supplierName, `${label}.supplierName`),
    supplierCode: textOf(row.supplierCode, `${label}.supplierCode`),
    supplierAbbreviation: textOf(row.supplierAbbreviation, `${label}.supplierAbbreviation`),
    createTime: dateOf(row.createTime, `${label}.createTime`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
    updaterName: textOf(row.updaterName, `${label}.updaterName`),
    addedByTenant: integerOf(row.addedByTenant, `${label}.addedByTenant`),
    selectable: booleanOf(row.selectable, `${label}.selectable`),
    categoryName: textOf(row.categoryName, `${label}.categoryName`),
    viewSalesList: viewSalesList as Array<Record<string, unknown>> | null,
    typeName: textOf(row.typeName, `${label}.typeName`),
  }
}

function pageOf (value: unknown, label: string): PageResult<SettingMaterialRow> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: page.total as number }
}

async function supplierPageOf (request: PortalRequest): Promise<PageResult<SettingMaterialRow>> {
  const first = pageOf(await request({ url: SUPPLIER_PAGE_URL, method: 'get', params: { pageNo: 1, pageSize: SUPPLIER_PAGE_SIZE } }), '物料创建供应商分页响应')
  const list = [...first.list]
  const totalPages = Math.min(Math.ceil(first.total / SUPPLIER_PAGE_SIZE), SUPPLIER_MAX_PAGES)
  for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
    const page = pageOf(await request({ url: SUPPLIER_PAGE_URL, method: 'get', params: { pageNo, pageSize: SUPPLIER_PAGE_SIZE } }), `物料创建供应商第${pageNo}页响应`)
    list.push(...page.list)
  }
  return { list, total: first.total }
}

function arrayOfObjects (value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => ({ ...objectOf(item, `${label}[${index}]`) }))
}

function unitsOf (value: unknown): Array<Record<string, unknown>> {
  return arrayOfObjects(value, '物料单位列表').map((item, index) => {
    if (textOf(item.unitName, `物料单位列表[${index}].unitName`, true) === null) throw new Error(`物料单位列表[${index}].unitName不能为空`)
    return item
  })
}

function categoryTreeOf (value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('物料分类树必须为数组')
  const visit = (item: unknown, label: string): Record<string, unknown> => {
    const row = objectOf(item, label)
    const children = row.children === undefined || row.children === null ? [] : row.children
    if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组`)
    return { ...row, children: children.map((child, index) => visit(child, `${label}.children[${index}]`)) }
  }
  return value.map((item, index) => visit(item, `物料分类树[${index}]`))
}

function materialPayloadOf (input: SettingMaterialCreateInput): JsonObject[] {
  const value = objectOf(input, '物料批量创建参数')
  if (!Array.isArray(value.materials) || value.materials.length === 0) throw new Error('materials必须为非空数组')
  return value.materials.map((item, index) => {
    const material = objectOf(item, `materials[${index}]`)
    const matName = requiredTextOf(material.matName, `materials[${index}].matName`)
    const matDescribe = requiredTextOf(material.matDescribe, `materials[${index}].matDescribe`)
    const unit = requiredTextOf(material.unit, `materials[${index}].unit`)
    const supplierId = idOf(material.supplierId, `materials[${index}].supplierId`)
    const categoryId = idOf(material.categoryId, `materials[${index}].categoryId`)
    const matCode = material.matCode === undefined || material.matCode === null ? '' : requiredTextOf(material.matCode, `materials[${index}].matCode`)
    const supplierCode = textOf(material.supplierCode, `materials[${index}].supplierCode`) ?? ''
    const specDes = textOf(material.specDes, `materials[${index}].specDes`) ?? ''
    if (specDes.length > 20) throw new Error(`materials[${index}].specDes不能超过20个字符`)
    const isEntry = material.isEntry === undefined || material.isEntry === null ? false : material.isEntry
    if (typeof isEntry !== 'boolean') throw new Error(`materials[${index}].isEntry必须为布尔值`)
    const entryTime = material.entryTime === undefined || material.entryTime === null ? null : requiredTextOf(material.entryTime, `materials[${index}].entryTime`)
    return { ...material, matName, matCode, matDescribe, categoryId, unit, supplierId, supplierCode, specDes, isEntry, entryTime }
  })
}

function idListOf (value: unknown, label: string): SettingMaterialId[] {
  return idArrayOf(value, label, false)
}

function idArrayOf (value: unknown, label: string, allowEmpty: boolean): SettingMaterialId[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label}必须为${allowEmpty ? '' : '非空'}ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function conversionRuleOf (value: unknown, label: string): SettingMaterialConversionRule {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    relUnit: textOf(row.relUnit, `${label}.relUnit`),
    baseUnit: textOf(row.baseUnit, `${label}.baseUnit`),
    coefficient: numericOf(row.coefficient, `${label}.coefficient`),
    targetUnit: textOf(row.targetUnit, `${label}.targetUnit`),
    targetCoefficient: numericOf(row.targetCoefficient, `${label}.targetCoefficient`),
    materielId: nullableIdOf(row.materielId, `${label}.materielId`),
    propValueIds: textOf(row.propValueIds, `${label}.propValueIds`),
  }
}

function conversionGroupsOf (value: unknown): SettingMaterialConversionGroup[] {
  if (!Array.isArray(value)) throw new Error('物料单位换算分组必须为数组')
  return value.map((item, index) => {
    const group = objectOf(item, `物料单位换算分组[${index}]`)
    if (!Array.isArray(group.list)) throw new Error(`物料单位换算分组[${index}].list必须为数组`)
    return {
      ...group,
      propValueIds: textOf(group.propValueIds, `物料单位换算分组[${index}].propValueIds`),
      propId: integerOf(group.propId, `物料单位换算分组[${index}].propId`),
      list: group.list.map((rule, ruleIndex) => conversionRuleOf(rule, `物料单位换算分组[${index}].list[${ruleIndex}]`)),
    }
  })
}

function conversionPayloadOf (input: SettingMaterialConversionSaveInput): JsonObject[] {
  const value = objectOf(input, '物料单位换算保存参数')
  const materielId = idOf(value.materielId, 'materielId')
  const baseUnit = requiredTextOf(value.baseUnit, 'baseUnit')
  if (!Array.isArray(value.groups) || value.groups.length === 0) throw new Error('groups必须为非空数组')
  const seenSpecs = new Set<string>()
  let emptySpecCount = 0
  const payload: JsonObject[] = []
  value.groups.forEach((rawGroup, groupIndex) => {
    const group = objectOf(rawGroup, `groups[${groupIndex}]`)
    const propValueIds = group.propValueIds === undefined || group.propValueIds === null || group.propValueIds === '' ? '' : requiredTextOf(group.propValueIds, `groups[${groupIndex}].propValueIds`)
    if (propValueIds) {
      if (seenSpecs.has(propValueIds)) throw new Error(`groups[${groupIndex}].propValueIds不能与其他换算组重复`)
      seenSpecs.add(propValueIds)
    } else {
      emptySpecCount += 1
      if (emptySpecCount >= 2) throw new Error('最多只能有一个未选择规格的换算组')
    }
    const coefficient = group.coefficient ?? 1
    if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient <= 0) throw new Error(`groups[${groupIndex}].coefficient必须为正数`)
    if (!Array.isArray(group.items)) throw new Error(`groups[${groupIndex}].items必须为数组`)
    const units = new Set<string>()
    group.items.forEach((rawItem, itemIndex) => {
      const item = objectOf(rawItem, `groups[${groupIndex}].items[${itemIndex}]`)
      const targetUnit = requiredTextOf(item.targetUnit, `groups[${groupIndex}].items[${itemIndex}].targetUnit`)
      const targetCoefficient = item.targetCoefficient
      if (typeof targetCoefficient !== 'number' || !Number.isFinite(targetCoefficient) || targetCoefficient <= 0) throw new Error(`groups[${groupIndex}].items[${itemIndex}].targetCoefficient必须为正数`)
      if (targetUnit === baseUnit) throw new Error(`groups[${groupIndex}].items[${itemIndex}].targetUnit不能是基本单位`)
      if (units.has(targetUnit)) throw new Error(`groups[${groupIndex}]不能重复选择辅助单位`)
      units.add(targetUnit)
      const id = item.id === undefined || item.id === null || item.id === '' ? null : idOf(item.id, `groups[${groupIndex}].items[${itemIndex}].id`)
      payload.push({
        ...item,
        relUnit: baseUnit,
        baseUnit,
        coefficient,
        targetUnit,
        targetCoefficient,
        materielId,
        id,
        groupId: `group_${groupIndex}`,
        propId: null,
        propValueIds,
      })
    })
  })
  return payload
}

function receiveParamsOf (query: SettingMaterialReceiveConfigQuery): JsonObject {
  return {
    order: '',
    orderField: '',
    orgId: idOrUndefinedOf(query.orgId, '组织ID'),
    materielId: idOf(query.materielId, 'materielId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function conversionContextResponse (materiel: unknown, specGroups: unknown, rules: unknown, units: unknown): SettingMaterialConversionContext {
  return {
    materiel: rowOf(materiel, '物料详情'),
    specGroups: arrayOfObjects(specGroups, '物料规格组'),
    rules: conversionGroupsOf(rules),
    units: unitsOf(units),
  }
}

export function createSettingMaterialCapability (request: PortalRequest) {
  return {
    async list (query: SettingMaterialQuery = {}): Promise<PageResult<SettingMaterialRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: pageParamsOf(query) }), '物料分页响应')
    },
    async prepareCreate (): Promise<{ units: Array<Record<string, unknown>>; suppliers: PageResult<SettingMaterialRow>; categories: Array<Record<string, unknown>> }> {
      const [units, suppliers, categories] = await Promise.all([
        request({ url: `${UNIT_ROOT}/simple-list`, method: 'get' }),
        supplierPageOf(request),
        request({ url: '/admin-api/system/sys-materiel-category/tree', method: 'get' }),
      ])
      return { units: unitsOf(units), suppliers: suppliers as PageResult<SettingMaterialRow>, categories: categoryTreeOf(categories) }
    },
    async create (input: SettingMaterialCreateInput): Promise<SettingMaterialId[]> {
      const result = await request<unknown>({ url: `${ROOT}/batch-create`, method: 'post', data: materialPayloadOf(input) })
      return idListOf(result, '物料批量创建响应')
    },
    async remove (input: { id: SettingMaterialId }): Promise<true> {
      const id = idOf(input?.id, '物料ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '物料删除')
    },
    async platformList (query: SettingMaterialPlatformQuery = {}): Promise<PageResult<SettingMaterialRow>> {
      return pageOf(await request({ url: `${ROOT}/select-platform-page`, method: 'get', params: platformPageParamsOf(query) }), '平台物料分页响应')
    },
    async addPlatform (input: SettingMaterialAddPlatformInput): Promise<true> {
      const materielIds = idListOf(input?.materielIds, 'materielIds')
      const tenantId = idOf(input?.tenantId, 'tenantId')
      return trueOf(await request({ url: `${ROOT}/update-use-tenant`, method: 'post', data: { materielIds, tenantId } }), '添加平台物料')
    },
    async get (input: { id: SettingMaterialId }): Promise<SettingMaterialRow> {
      const id = idOf(input?.id, '物料ID')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '物料详情')
    },
    async viewLookups (input: { materielId: SettingMaterialId }): Promise<{ shops: Array<Record<string, unknown>>; brands: Array<Record<string, unknown>>; categories: Array<Record<string, unknown>>; specGroups: Array<Record<string, unknown>> }> {
      const materielId = idOf(input?.materielId, 'materielId')
      const [shops, brands, categories, specGroups] = await Promise.all([
        request({ url: '/admin-api/sales/shop/current-tenant-shops', method: 'get' }),
        request({ url: '/admin-api/supply/materiel/brand-list', method: 'get', params: { materielId } }),
        request({ url: '/sys/categoryCat/getTree', method: 'get', httpInstance: 'platform-mall-admin' }),
        request({ url: `${VIEW_SALES_ROOT}/spec-groups-with-names`, method: 'get', params: { materielId } }),
      ])
      return { shops: arrayOfObjects(shops, '店铺列表'), brands: arrayOfObjects(brands, '物料品牌列表'), categories: arrayOfObjects(categories, '销售品类树'), specGroups: arrayOfObjects(specGroups, '物料规格组') }
    },
    async receiveConfigList (query: SettingMaterialReceiveConfigQuery): Promise<PageResult<Record<string, unknown>>> {
      const page = objectOf(await request({ url: '/admin-api/supply/materiel-receive-info/page', method: 'get', params: receiveParamsOf(query) }), '物料收货配置分页响应')
      if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('物料收货配置分页响应缺少有效list或total')
      return { list: page.list.map((item, index) => objectOf(item, `物料收货配置列表[${index}]`)), total: page.total as number }
    },
    async conversionContext (input: { materielId: SettingMaterialId }): Promise<SettingMaterialConversionContext> {
      const materielId = idOf(input?.materielId, 'materielId')
      const [materiel, specGroups, rules, units] = await Promise.all([
        request({ url: `${ROOT}/get`, method: 'get', params: { id: materielId } }),
        request({ url: `${VIEW_SALES_ROOT}/spec-groups-with-names`, method: 'get', params: { materielId } }),
        request({ url: `${CONVERSION_ROOT}/list-by-materiel-id-group-by-prop`, method: 'get', params: { materielId } }),
        request({ url: `${UNIT_ROOT}/simple-list`, method: 'get' }),
      ])
      return conversionContextResponse(materiel, specGroups, rules, units)
    },
    async conversionSave (input: SettingMaterialConversionSaveInput): Promise<SettingMaterialId[]> {
      const payload = conversionPayloadOf(input)
      const result = await request<unknown>({ url: `${CONVERSION_ROOT}/batch-create`, method: 'post', data: payload })
      return result === undefined || result === null ? [] : idArrayOf(result, '物料单位换算保存响应', true)
    },
    async conversionRemove (input: { id: SettingMaterialId }): Promise<true> {
      const id = idOf(input?.id, '单位换算规则ID')
      return trueOf(await request({ url: `${CONVERSION_ROOT}/delete`, method: 'delete', params: { id } }), '单位换算规则删除')
    },
  }
}

export type SettingMaterialCapability = ReturnType<typeof createSettingMaterialCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const idParam = (name: string, description: string): ParamSpec => p(name, 'text', true, description)

export const SETTING_MATERIAL_METHODS = {
  'setting-material-list': 'list',
  'setting-material-prepare-create': 'prepareCreate',
  'setting-material-create': 'create',
  'setting-material-remove': 'remove',
  'setting-material-platform-list': 'platformList',
  'setting-material-add-platform': 'addPlatform',
  'setting-material-get': 'get',
  'setting-material-view-lookups': 'viewLookups',
  'setting-material-receive-config-list': 'receiveConfigList',
  'setting-material-conversion-context': 'conversionContext',
  'setting-material-conversion-save': 'conversionSave',
  'setting-material-conversion-remove': 'conversionRemove',
} as const

const materialQueryParams = [p('matName', 'text', false, '物料名称筛选；默认null'), p('matDescribe', 'text', false, '物料描述筛选；默认null'), p('supplierId', 'text', false, '供应商ID筛选；可省略'), p('categoryId', 'text', false, '物料分类ID筛选；可省略'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')]

export const settingMaterialCapabilities: CapabilityDefinition[] = [
  { id: 'setting-material-list', title: '查询物料列表', write: false, params: materialQueryParams },
  { id: 'setting-material-prepare-create', title: '准备新增物料', write: false, params: [] },
  { id: 'setting-material-create', title: '批量新增物料', write: true, params: [p('materials', 'text', true, '物料表单数组；每行必须填写名称、描述、分类、单位、供应商，名称按页面联动规则准备')] },
  { id: 'setting-material-remove', title: '删除物料', write: true, params: [idParam('id', '物料ID')] },
  { id: 'setting-material-platform-list', title: '查询平台物料库', write: false, params: materialQueryParams },
  { id: 'setting-material-add-platform', title: '添加平台物料到当前租户', write: true, params: [p('materielIds', 'text', true, '平台物料ID数组'), idParam('tenantId', '当前租户ID；页面会随请求提交')] },
  { id: 'setting-material-get', title: '读取物料详情与视图', write: false, params: [idParam('id', '物料ID')] },
  { id: 'setting-material-view-lookups', title: '读取物料视图展示选项', write: false, params: [idParam('materielId', '物料ID')] },
  { id: 'setting-material-receive-config-list', title: '查询物料收货配置', write: false, params: [idParam('materielId', '物料ID'), p('orgId', 'text', false, '组织ID；可省略'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '默认20')] },
  { id: 'setting-material-conversion-context', title: '读取物料单位换算上下文', write: false, params: [idParam('materielId', '物料ID')] },
  { id: 'setting-material-conversion-save', title: '替换物料单位换算规则', write: true, params: [idParam('materielId', '物料ID'), p('baseUnit', 'text', true, '物料基本单位'), p('groups', 'text', true, '按规格分组的辅助单位换算规则数组')] },
  { id: 'setting-material-conversion-remove', title: '删除单位换算规则', write: true, params: [idParam('id', '单位换算规则ID')] },
].map(definition => ({ ...definition, pagePath: SETTING_MATERIAL_PAGE_PATH, permission: SETTING_MATERIAL_PERMISSION, moduleType: SETTING_MATERIAL_MODULE_TYPE, httpInstance: 'platform' }))
