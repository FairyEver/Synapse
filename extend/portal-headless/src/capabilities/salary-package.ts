import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力系统 → 薪酬管理 → 薪资账套」及其薪资项目管理子页。 */
export const SALARY_PACKAGE_PAGE_PATH = '/dashboard/manage/salary-package/list'
export const SALARY_PACKAGE_PERMISSION = '/dashboard/manage/salary-package'
export const SALARY_PACKAGE_MODULE_TYPE = 14

const ROOT = '/salary/ledger'
const ITEM_ROOT = '/salary/ledgerItem'
const SALARY_ITEM_ROOT = '/salary/item'

export type SalaryPackageId = string | number
export type SalaryPackageFlag = 0 | 1

export type SalaryPackageRow = Record<string, unknown> & {
  id: SalaryPackageId
  name: string | null
  type?: string | null
  countRange?: string | null
  organizationId?: SalaryPackageId | null
  organizationName?: string | null
  roleIdList?: SalaryPackageId[]
  isDel?: SalaryPackageFlag | null
}

export type SalaryPackageForm = {
  id?: SalaryPackageId
  name: string
  organizationId: SalaryPackageId
  organizationName: string
  type: string
  countRange: string
  roleIdList: SalaryPackageId[]
}

export type SalaryPackagePreparation = {
  draft: SalaryPackageForm
  previous?: SalaryPackageForm
}

export type SalaryPackageCopyForm = {
  ledgerId: SalaryPackageId
  name: string
}

export type SalaryPackageItemRow = Record<string, unknown> & {
  id: SalaryPackageId
  ledgerId?: SalaryPackageId | null
  itemId?: SalaryPackageId | null
  name: string | null
  isMust?: SalaryPackageFlag | null
  attribute?: 1 | 2 | 3 | 4 | null
  fixedValue?: string | number | null
  type?: 1 | 2 | 3 | 4 | 5 | 6 | null
  scale?: number | null
  carryRule?: 1 | 2 | 3 | null
  remark?: string | null
  formula?: string | null
  parameter?: SalaryPackageId | null
  parameterName?: string | null
  sort?: number | null
}

export type SalaryPackageItemForm = Record<string, unknown> & {
  id: SalaryPackageId
  ledgerId: SalaryPackageId
  name: string
  isMust?: SalaryPackageFlag
  attribute: 1 | 2 | 3 | 4
  fixedValue?: string | number | null
  formula?: string | null
  parameter?: SalaryPackageId | null | ''
  type: 1 | 2 | 3 | 4 | 5 | 6
  scale: number
  carryRule: 1 | 2 | 3
  sort: number
  remark?: string | null
}

export type SalaryPackageItemPreparation = {
  draft: SalaryPackageItemForm
  previous?: SalaryPackageItemForm
}

export type SalaryPackageOrganizationQuery = {
  name?: string | null
  type?: string | number | null
  orgId?: SalaryPackageId | null | ''
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryPackageId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryPackageId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, nullable = false): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null
    throw new Error(`${label}必须为字符串`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function optionalTextOf (value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : textOf(value, label, true)
}

function requiredPortalTextOf (value: unknown, label: string, max: number): string {
  const text = textOf(value, label)
  if (text === null || text.length === 0) throw new Error(`${label}必填`)
  if (text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function requiredNonBlankTextOf (value: unknown, label: string, max: number): string {
  const text = requiredPortalTextOf(value, label, max)
  if (!text.trim()) throw new Error(`${label}不能全为空格`)
  return text
}

function enumOf<T extends number> (value: unknown, values: readonly T[], label: string): T {
  if (!Number.isSafeInteger(value) || !values.includes(value as T)) throw new Error(`${label}必须是${values.join('、')}`)
  return value as T
}

function nullableEnumOf<T extends number> (value: unknown, values: readonly T[], label: string): T | null {
  if (value === undefined || value === null || value === '') return null
  return enumOf(value, values, label)
}

function nonNegativeIntegerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}必须为非负整数`)
  return value as number
}

function nullableNonNegativeIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  return nonNegativeIntegerOf(value, label)
}

function flagOf (value: unknown, label: string): SalaryPackageFlag {
  return enumOf(value, [0, 1] as const, label)
}

function idListOf (value: unknown, label: string, required = false): SalaryPackageId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  if (required && value.length === 0) throw new Error(`${label}至少包含一个ID`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function rowOf (value: unknown, label: string): SalaryPackageRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: row.name === undefined || row.name === null ? null : textOf(row.name, `${label}.name`, true),
    ...(row.type === undefined ? {} : { type: optionalTextOf(row.type, `${label}.type`) }),
    ...(row.countRange === undefined ? {} : { countRange: optionalTextOf(row.countRange, `${label}.countRange`) }),
    ...(row.organizationId === undefined ? {} : { organizationId: optionalIdOf(row.organizationId, `${label}.organizationId`) }),
    ...(row.organizationName === undefined ? {} : { organizationName: optionalTextOf(row.organizationName, `${label}.organizationName`) }),
    ...(row.roleIdList === undefined ? {} : { roleIdList: idListOf(row.roleIdList, `${label}.roleIdList`) }),
    ...(row.isDel === undefined ? {} : { isDel: row.isDel === null ? null : flagOf(row.isDel, `${label}.isDel`) }),
  }
}

function formOf (value: unknown, label: string, requireId = false): SalaryPackageForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const roleIdList = idListOf(input.roleIdList, `${label}.roleIdList`, true)
  return {
    ...(id === undefined ? {} : { id }),
    name: requiredPortalTextOf(input.name, `${label}.name`, 50),
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    organizationName: input.organizationName === undefined || input.organizationName === null ? '' : (textOf(input.organizationName, `${label}.organizationName`) ?? ''),
    type: requiredPortalTextOf(input.type, `${label}.type`, Number.MAX_SAFE_INTEGER),
    countRange: requiredPortalTextOf(input.countRange, `${label}.countRange`, Number.MAX_SAFE_INTEGER),
    roleIdList,
  }
}

function salaryPackagePayloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(requireId ? { id: form.id } : {}),
    name: form.name,
    organizationId: form.organizationId,
    organizationName: form.organizationName,
    type: form.type,
    countRange: form.countRange,
    roleIdList: form.roleIdList,
  }
}

function formFromRow (value: SalaryPackageRow | SalaryPackageForm): SalaryPackageForm {
  return formOf(value, '当前薪资账套', true)
}

function copyOf (value: unknown, label = '薪资账套复制表单'): SalaryPackageCopyForm {
  const input = objectOf(value, label)
  return {
    ledgerId: idOf(input.ledgerId, `${label}.ledgerId`),
    name: requiredPortalTextOf(input.name, `${label}.name`, 50),
  }
}

function itemRowOf (value: unknown, label: string): SalaryPackageItemRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    ...(row.ledgerId === undefined ? {} : { ledgerId: optionalIdOf(row.ledgerId, `${label}.ledgerId`) }),
    ...(row.itemId === undefined ? {} : { itemId: optionalIdOf(row.itemId, `${label}.itemId`) }),
    name: row.name === undefined || row.name === null ? null : textOf(row.name, `${label}.name`, true),
    ...(row.isMust === undefined ? {} : { isMust: row.isMust === null ? null : flagOf(row.isMust, `${label}.isMust`) }),
    ...(row.attribute === undefined ? {} : { attribute: nullableEnumOf(row.attribute, [1, 2, 3, 4] as const, `${label}.attribute`) }),
    ...(row.fixedValue === undefined ? {} : { fixedValue: row.fixedValue === null ? null : row.fixedValue as string | number }),
    ...(row.type === undefined ? {} : { type: nullableEnumOf(row.type, [1, 2, 3, 4, 5, 6] as const, `${label}.type`) }),
    ...(row.scale === undefined ? {} : { scale: nullableNonNegativeIntegerOf(row.scale, `${label}.scale`) }),
    ...(row.carryRule === undefined ? {} : { carryRule: nullableEnumOf(row.carryRule, [1, 2, 3] as const, `${label}.carryRule`) }),
    ...(row.remark === undefined ? {} : { remark: optionalTextOf(row.remark, `${label}.remark`) }),
    ...(row.formula === undefined ? {} : { formula: optionalTextOf(row.formula, `${label}.formula`) }),
    ...(row.parameter === undefined ? {} : { parameter: optionalIdOf(row.parameter, `${label}.parameter`) }),
    ...(row.parameterName === undefined ? {} : { parameterName: optionalTextOf(row.parameterName, `${label}.parameterName`) }),
    ...(row.sort === undefined ? {} : { sort: nullableNonNegativeIntegerOf(row.sort, `${label}.sort`) }),
  }
}

function fixedValueOf (value: unknown, attribute: 1 | 2 | 3 | 4, scale: number, label: string): string | number | null {
  if (attribute !== 1 || !value) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负数字`)
    return value.toFixed(scale)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为数字或数字字符串`)
  if (value.length > 20) throw new Error(`${label}最大不能超过20位`)
  if (Number.isNaN(Number(value)) || Number(value) < 0) throw new Error(`${label}必须为非负数字`)
  return value
}

function itemFormOf (value: unknown, label = '薪资账套项目表单'): SalaryPackageItemForm {
  const input = objectOf(value, label)
  const id = idOf(input.id, `${label}.id`)
  const ledgerId = idOf(input.ledgerId, `${label}.ledgerId`)
  const attribute = enumOf(input.attribute, [1, 2, 3, 4] as const, `${label}.attribute`)
  const formula = input.formula === undefined ? '' : input.formula === null ? null : textOf(input.formula, `${label}.formula`)
  if (attribute === 2 && (!formula || !formula.trim())) throw new Error(`${label}.formula必填`)
  const parameter = attribute === 4
    ? optionalIdOf(input.parameter, `${label}.parameter`)
    : input.parameter === undefined || input.parameter === null || input.parameter === ''
      ? input.parameter === null ? null : ''
      : optionalIdOf(input.parameter, `${label}.parameter`)
  if (attribute === 4 && parameter === null) throw new Error(`${label}.parameter必填`)
  const scale = enumOf(input.scale, [0, 1, 2, 3, 4] as const, `${label}.scale`)
  const remark = input.remark === undefined || input.remark === null ? '' : (textOf(input.remark, `${label}.remark`) ?? '')
  if (remark && !remark.trim()) throw new Error(`${label}.remark不能全为空格`)
  if (remark.length > 200) throw new Error(`${label}.remark最多200个字符`)
  const { code: _code, ...rest } = input
  return {
    ...rest,
    id,
    ledgerId,
    name: requiredNonBlankTextOf(input.name, `${label}.name`, 50),
    ...(input.isMust === undefined || input.isMust === null || input.isMust === '' ? {} : { isMust: flagOf(input.isMust, `${label}.isMust`) }),
    attribute,
    fixedValue: fixedValueOf(input.fixedValue, attribute, scale, `${label}.fixedValue`),
    formula,
    parameter,
    type: enumOf(input.type, [1, 2, 3, 4, 5, 6] as const, `${label}.type`),
    scale,
    carryRule: enumOf(input.carryRule, [1, 2, 3] as const, `${label}.carryRule`),
    sort: input.sort === undefined || input.sort === null || input.sort === '' ? 0 : nonNegativeIntegerOf(input.sort, `${label}.sort`),
    remark,
  }
}

function itemPageParams (ledgerId: SalaryPackageId, pageNo?: number, pageSize?: number): Record<string, unknown> {
  return {
    ledgerId: idOf(ledgerId, '薪资账套ID'),
    order: '',
    orderField: '',
    pageNo: pageNumberOf(pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(pageSize, 20, 'pageSize'),
  }
}

function organizationPageParams (query: SalaryPackageOrganizationQuery = {}): Record<string, unknown> {
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('组织名称必须为字符串或null')
  if (query.type !== undefined && query.type !== null && typeof query.type !== 'string' && typeof query.type !== 'number') throw new Error('组织类型必须为字符串、数字或null')
  return {
    name: query.name ?? '',
    type: query.type ?? '',
    orgId: query.orgId ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: query.pageSize === undefined ? 10 : pageNumberOf(query.pageSize, 10, 'pageSize'),
  }
}

function pageOf<T> (value: unknown, label: string, map: (item: unknown, index: number) => T): PageResult<T> {
  const result = objectOf(value, label)
  if (!Array.isArray(result.list) || !Number.isSafeInteger(result.total) || (result.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: result.list.map((item, index) => map(item, index)), total: result.total as number }
}

function candidateOf (value: unknown, label: string): Record<string, unknown> {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
  }
}

function idsInputOf (value: unknown, label: string): SalaryPackageId[] {
  return idListOf(value, label, true)
}

export function createSalaryPackageCapability (request: PortalRequest) {
  return {
    async list (): Promise<SalaryPackageRow[]> {
      const result = await request<unknown>({ url: `${ROOT}/selectListByRole`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('薪资账套列表响应必须是数组')
      return result.map((item, index) => rowOf(item, `薪资账套列表[${index}]`))
    },
    async get (input: { id: SalaryPackageId }): Promise<SalaryPackageRow> {
      const id = idOf(input?.id, '薪资账套ID')
      return rowOf(await request({ url: `${ROOT}/${id}`, method: 'get' }), '薪资账套详情')
    },
    prepareCreate (input: SalaryPackageForm): SalaryPackagePreparation {
      return { draft: formOf(input, '薪资账套表单') }
    },
    async create (input: { draft: SalaryPackageForm }): Promise<true> {
      await request({ url: ROOT, method: 'post', data: salaryPackagePayloadOf(input?.draft, '薪资账套新建草稿', false) })
      return true
    },
    prepareUpdate (input: { current: SalaryPackageRow | SalaryPackageForm; changes?: Partial<Omit<SalaryPackageForm, 'id'>> | null }): SalaryPackagePreparation {
      const previous = formFromRow(input?.current)
      return { draft: formOf({ ...previous, ...(input?.changes ?? {}) }, '薪资账套编辑草稿', true), previous }
    },
    async update (input: { draft: SalaryPackageForm }): Promise<true> {
      await request({ url: ROOT, method: 'post', data: salaryPackagePayloadOf(input?.draft, '薪资账套编辑草稿', true) })
      return true
    },
    prepareCopy (input: SalaryPackageCopyForm): { draft: SalaryPackageCopyForm } {
      return { draft: copyOf(input) }
    },
    async copy (input: { draft: SalaryPackageCopyForm }): Promise<true> {
      await request({ url: `${ROOT}/copyLedger`, method: 'post', data: copyOf(input?.draft, '薪资账套复制草稿') })
      return true
    },
    prepareRemove (input: { ids: SalaryPackageId[] }): { ids: SalaryPackageId[] } {
      return { ids: idsInputOf(input?.ids, '薪资账套删除ID') }
    },
    async remove (input: { ids: SalaryPackageId[] }): Promise<true> {
      const prepared = this.prepareRemove(input)
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
      return true
    },
    async organizationTree (): Promise<Record<string, unknown>[]> {
      const result = await request<unknown>({ url: '/org/organization/getTree', method: 'get' })
      if (!Array.isArray(result)) throw new Error('薪资账套组织树响应必须是数组')
      return result.map((item, index) => objectOf(item, `薪资账套组织树[${index}]`))
    },
    async organizationPage (query: SalaryPackageOrganizationQuery = {}): Promise<PageResult<Record<string, unknown>>> {
      return pageOf(await request({ url: '/org/organization/pageByOrgId', method: 'get', params: organizationPageParams(query) }), '薪资账套组织分页响应', (item, index) => objectOf(item, `薪资账套组织分页响应.list[${index}]`))
    },
    async roleOptions (): Promise<Record<string, unknown>[]> {
      const result = await request<unknown>({ url: '/sys/role/hrRoleListNew', method: 'get' })
      if (!Array.isArray(result)) throw new Error('薪资账套角色候选响应必须是数组')
      return result.map((item, index) => objectOf(item, `薪资账套角色候选[${index}]`))
    },
    async itemList (input: { ledgerId: SalaryPackageId; pageNo?: number; pageSize?: number }): Promise<PageResult<SalaryPackageItemRow>> {
      return pageOf(await request({ url: `${ITEM_ROOT}/page`, method: 'get', params: itemPageParams(input?.ledgerId, input?.pageNo, input?.pageSize) }), '薪资账套项目分页响应', (item, index) => itemRowOf(item, `薪资账套项目分页响应.list[${index}]`))
    },
    async itemGet (input: { id: SalaryPackageId }): Promise<SalaryPackageItemRow> {
      const id = idOf(input?.id, '薪资账套项目ID')
      return itemRowOf(await request({ url: `${ITEM_ROOT}/${id}`, method: 'get' }), '薪资账套项目详情')
    },
    async itemFormulaOptions (): Promise<Record<string, unknown>[]> {
      const result = await request<unknown>({ url: `${SALARY_ITEM_ROOT}/getAllSalaryItem`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('薪资账套项目公式候选响应必须是数组')
      return result.map((item, index) => candidateOf(item, `薪资账套项目公式候选[${index}]`))
    },
    async itemCheckFormula (input: { formula: string }): Promise<void> {
      const formula = textOf(input?.formula, '薪资账套项目公式')
      if (!formula || !formula.trim()) throw new Error('薪资账套项目公式不能为空')
      await request({ url: `${SALARY_ITEM_ROOT}/checkFormula`, method: 'get', params: { formula } })
    },
    prepareItemUpdate (input: { current: SalaryPackageItemRow | SalaryPackageItemForm; changes?: Partial<SalaryPackageItemForm> | null }): SalaryPackageItemPreparation {
      const previous = itemFormOf(input?.current, '当前薪资账套项目')
      const changes = input?.changes ?? {}
      const merged = { ...previous, ...changes }
      if (Object.prototype.hasOwnProperty.call(changes, 'attribute') && changes.attribute !== previous.attribute) {
        if (changes.attribute !== 2) merged.formula = ''
        if (changes.attribute !== 4) merged.parameter = ''
      }
      return { draft: itemFormOf(merged, '薪资账套项目编辑草稿'), previous }
    },
    async itemUpdate (input: { draft: SalaryPackageItemForm }): Promise<true> {
      const draft = itemFormOf(input?.draft, '薪资账套项目编辑草稿')
      if (draft.attribute === 2) await this.itemCheckFormula({ formula: draft.formula || '' })
      await request({ url: ITEM_ROOT, method: 'put', data: draft })
      return true
    },
    async itemAvailable (input: { ledgerId: SalaryPackageId }): Promise<Record<string, unknown>[]> {
      const ledgerId = idOf(input?.ledgerId, '薪资账套ID')
      const result = await request<unknown>({ url: `${ITEM_ROOT}/getNotInsertSalaryItem`, method: 'get', params: { ledgerId } })
      if (!Array.isArray(result)) throw new Error('可引入薪资项目响应必须是数组')
      return result.map((item, index) => candidateOf(item, `可引入薪资项目[${index}]`))
    },
    prepareItemImport (input: { ledgerId: SalaryPackageId; salaryItemId: SalaryPackageId[] }): { draft: { ledgerId: SalaryPackageId; salaryItemId: SalaryPackageId[] } } {
      const ledgerId = idOf(input?.ledgerId, '薪资账套ID')
      return { draft: { ledgerId, salaryItemId: idsInputOf(input?.salaryItemId, '引入薪资项目ID') } }
    },
    async itemImport (input: { draft: { ledgerId: SalaryPackageId; salaryItemId: SalaryPackageId[] } }): Promise<true> {
      const draft = this.prepareItemImport(input?.draft)
      await request({ url: `${ITEM_ROOT}/importSalaryItem`, method: 'post', data: draft.draft })
      return true
    },
    prepareItemRemove (input: { ids: SalaryPackageId[] }): { ids: SalaryPackageId[] } {
      return { ids: idsInputOf(input?.ids, '薪资账套项目删除ID') }
    },
    async itemRemove (input: { ids: SalaryPackageId[] }): Promise<true> {
      const prepared = this.prepareItemRemove(input)
      await request({ url: ITEM_ROOT, method: 'delete', data: prepared.ids })
      return true
    },
  }
}

export type SalaryPackageCapability = ReturnType<typeof createSalaryPackageCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const packageFormParams: ParamSpec[] = [
  p('name', 'text', true, '账套名称；必填，最多50个字符，按Portal原文提交，不自动trim'),
  p('organizationId', 'text', true, '所属组织ID；来自Portal组织选择器'),
  p('organizationName', 'text', false, '组织显示名称；Portal表单会随整表提交，缺省发送空字符串'),
  p('type', 'text', true, '所得项目类型字典值'),
  p('countRange', 'text', true, '薪资计税区间字典值'),
  p('roleIdList', 'text', true, '授权角色ID数组；至少一个已核实角色ID'),
]
const itemPageParamsSpec: ParamSpec[] = [p('ledgerId', 'text', true, '薪资账套ID'), p('pageNo', 'number'), p('pageSize', 'number')]
const itemFormParams: ParamSpec[] = [
  p('id', 'text', true, '薪资账套项目ID'),
  p('ledgerId', 'text', true, '所属薪资账套ID'),
  p('name', 'text', true, '项目名称；不能全为空格，最多50个字符'),
  p('attribute', 'enum', true, '属性：1固定项、2计算项、3外部数据、4系统参数'),
  p('fixedValue', 'text', false, '固定项值；属性不是1时按Portal联动清为null'),
  p('formula', 'text', false, '计算项公式；属性为2时必填并先调用公式校验'),
  p('parameter', 'text', false, '系统参数ID；属性为4时必填'),
  p('type', 'enum', true, '类型：1税前加、2税后加、3税前减、4税后减、5计算过渡、6结果'),
  p('scale', 'number', true, '小数位数：0至4整数'),
  p('carryRule', 'enum', true, '进位规则：1四舍五入、2向上取整、3向下取整'),
  p('sort', 'number', false, '排序；缺省按Portal默认0'),
  p('remark', 'text', false, '备注；最多200个字符，非空时不能全为空格'),
]

export const SALARY_PACKAGE_METHODS = {
  'salary-package-list': 'list',
  'salary-package-get': 'get',
  'salary-package-prepare-create': 'prepareCreate',
  'salary-package-create': 'create',
  'salary-package-prepare-update': 'prepareUpdate',
  'salary-package-update': 'update',
  'salary-package-prepare-copy': 'prepareCopy',
  'salary-package-copy': 'copy',
  'salary-package-prepare-remove': 'prepareRemove',
  'salary-package-remove': 'remove',
  'salary-package-organization-tree': 'organizationTree',
  'salary-package-organization-page': 'organizationPage',
  'salary-package-role-options': 'roleOptions',
  'salary-package-item-list': 'itemList',
  'salary-package-item-get': 'itemGet',
  'salary-package-item-formula-options': 'itemFormulaOptions',
  'salary-package-item-check-formula': 'itemCheckFormula',
  'salary-package-item-prepare-update': 'prepareItemUpdate',
  'salary-package-item-update': 'itemUpdate',
  'salary-package-item-available': 'itemAvailable',
  'salary-package-item-prepare-import': 'prepareItemImport',
  'salary-package-item-import': 'itemImport',
  'salary-package-item-prepare-remove': 'prepareItemRemove',
  'salary-package-item-remove': 'itemRemove',
} as const

export const salaryPackageCapabilities: CapabilityDefinition[] = [
  { id: 'salary-package-list', title: '查询薪资账套', write: false, params: [] },
  { id: 'salary-package-get', title: '读取薪资账套编辑表单', write: false, params: [p('id', 'text', true)] },
  { id: 'salary-package-prepare-create', title: '准备新建薪资账套', write: false, params: [p('form', 'text', true)] },
  { id: 'salary-package-create', title: '新建薪资账套', write: true, params: [p('draft', 'text', true)] },
  { id: 'salary-package-prepare-update', title: '准备编辑薪资账套', write: false, params: [p('current', 'text', true), p('changes', 'text', false)] },
  { id: 'salary-package-update', title: '保存薪资账套', write: true, params: [p('draft', 'text', true)] },
  { id: 'salary-package-prepare-copy', title: '准备复制薪资账套', write: false, params: [p('form', 'text', true)] },
  { id: 'salary-package-copy', title: '复制薪资账套', write: true, params: [p('draft', 'text', true)] },
  { id: 'salary-package-prepare-remove', title: '准备删除薪资账套', write: false, params: [p('ids', 'text', true)] },
  { id: 'salary-package-remove', title: '删除薪资账套', write: true, params: [p('ids', 'text', true)] },
  { id: 'salary-package-organization-tree', title: '读取薪资账套组织树', write: false, params: [] },
  { id: 'salary-package-organization-page', title: '查询薪资账套组织候选', write: false, params: [p('name', 'text'), p('type', 'text'), p('orgId', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-package-role-options', title: '读取薪资账套授权角色', write: false, params: [] },
  { id: 'salary-package-item-list', title: '查询薪资账套项目', write: false, params: itemPageParamsSpec },
  { id: 'salary-package-item-get', title: '读取薪资账套项目编辑表单', write: false, params: [p('id', 'text', true)] },
  { id: 'salary-package-item-formula-options', title: '读取薪资账套项目公式候选', write: false, params: [] },
  { id: 'salary-package-item-check-formula', title: '校验薪资账套项目公式', write: false, params: [p('formula', 'text', true)] },
  { id: 'salary-package-item-prepare-update', title: '准备编辑薪资账套项目', write: false, params: [p('current', 'text', true), p('changes', 'text', false)] },
  { id: 'salary-package-item-update', title: '保存薪资账套项目', write: true, params: [p('draft', 'text', true)] },
  { id: 'salary-package-item-available', title: '查询可引入薪资项目', write: false, params: [p('ledgerId', 'text', true)] },
  { id: 'salary-package-item-prepare-import', title: '准备引入薪资项目', write: false, params: [p('ledgerId', 'text', true), p('salaryItemId', 'text', true)] },
  { id: 'salary-package-item-import', title: '引入薪资项目', write: true, params: [p('draft', 'text', true)] },
  { id: 'salary-package-item-prepare-remove', title: '准备删除薪资账套项目', write: false, params: [p('ids', 'text', true)] },
  { id: 'salary-package-item-remove', title: '删除薪资账套项目', write: true, params: [p('ids', 'text', true)] },
].map(definition => ({ ...definition, pagePath: SALARY_PACKAGE_PAGE_PATH, permission: SALARY_PACKAGE_PERMISSION, moduleType: SALARY_PACKAGE_MODULE_TYPE, httpInstance: 'platform' }))
