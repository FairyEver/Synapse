import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 类目对照表」；静态源码锚点：Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_CAT_MAP_PAGE_PATH = '/dashboard/finance/setting/cat-map/list'
const ROOT = '/admin-api/finance/thing-category'
const FINANCE_CATEGORY_TREE_URL = '/admin-api/finance/income-category/page'
const THING_CATEGORY_TREE_URL = `${ROOT}/getThingTree`

export type FinanceSettingCatMapId = string | number

export type FinanceSettingCatMapRow = {
  /** 财务类目主键；页面也把它作为关系行 id 使用。 */
  id: FinanceSettingCatMapId
  financeCategoryId: FinanceSettingCatMapId
  financeCategoryName: string
  thingCategoryIds: FinanceSettingCatMapId[]
  thingCategoryName: string[]
  bindTime: string | null
}

export type FinanceSettingCatMapCreateDraft = {
  financeCategoryId: FinanceSettingCatMapId
  thingCategoryIds: FinanceSettingCatMapId[]
}

/** 与 Portal 表单状态及 POST/PUT body 同键序的草稿。 */
export type FinanceSettingCatMapSaveDraft = {
  thingCategoryIds: FinanceSettingCatMapId[]
  financeCategoryId: FinanceSettingCatMapId
  status: true
  id: FinanceSettingCatMapId | ''
}

export type FinanceSettingCatMapUpdateChanges = {
  financeCategoryId?: FinanceSettingCatMapId
  thingCategoryIds?: FinanceSettingCatMapId[]
}

export type FinanceSettingCatMapUpdateInput = {
  current: FinanceSettingCatMapRow | FinanceSettingCatMapSaveDraft
  changes?: FinanceSettingCatMapUpdateChanges
}

export type FinanceSettingCatMapDiscardInput = {
  id: FinanceSettingCatMapId
  financeCategoryId: FinanceSettingCatMapId
  thingCategoryIds: FinanceSettingCatMapId[]
}

export type FinanceSettingCatMapFinanceCategoryOption = {
  id: FinanceSettingCatMapId
  name: string
  path: string
}

export type FinanceSettingCatMapThingCategoryOption = {
  id: FinanceSettingCatMapId
  name: string
  path: string
  isUse: 0 | 1
  selectable: boolean
}

export type FinanceSettingCatMapCategorySearchResult<T> = {
  list: T[]
  /** Number of candidates returned after the local limit; not backend total. */
  matched: number
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): FinanceSettingCatMapId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  }
  return value
}

function idsOf (value: unknown, label: string, requireOne: boolean): FinanceSettingCatMapId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (requireOne && value.length === 0) throw new Error(`${label}至少选择一个类目`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function limitOf (value: unknown): number {
  const limit = value === undefined ? 20 : value
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit必须是1至100的正整数')
  return limit
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('keyword必须是非空字符串')
  return value.trim()
}

function searchTree<T> (
  value: unknown,
  label: string,
  nameKey: string,
  keyword: string,
  limit: number,
  mapNode: (node: Record<string, unknown>, id: FinanceSettingCatMapId, name: string, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是树数组`)
  const result: T[] = []
  const visit = (nodes: unknown[], parents: string[]) => {
    nodes.forEach((item, index) => {
      const node = objectOf(item, `${label}[${index}]`)
      const id = idOf(node.id, `${label}[${index}].id`)
      const name = textOf(node[nameKey], `${label}[${index}].${nameKey}`)
      const path = [...parents, name].join('》》')
      if (result.length < limit && name.includes(keyword)) result.push(mapNode(node, id, name, path))
      if (node.children !== undefined && node.children !== null) {
        if (!Array.isArray(node.children)) throw new Error(`${label}[${index}].children必须是数组`)
        visit(node.children, [...parents, name])
      }
    })
  }
  visit(value, [])
  return result
}

function financeCategoryOptionsOf (value: unknown, keyword: string, limit: number): FinanceSettingCatMapFinanceCategoryOption[] {
  return searchTree(value, '财务类目树', 'categoryName', keyword, limit, (node, id, name, path) => ({ id, name, path }))
}

function thingCategoryOptionsOf (value: unknown, keyword: string, limit: number): FinanceSettingCatMapThingCategoryOption[] {
  return searchTree(value, '资产类目树', 'catName', keyword, limit, (node, id, name, path) => {
    if (node.isUse !== 0 && node.isUse !== 1) throw new Error('资产类目树节点isUse必须是0或1')
    return { id, name, path, isUse: node.isUse, selectable: node.isUse === 0 }
  })
}

function sameId (left: FinanceSettingCatMapId, right: FinanceSettingCatMapId): boolean {
  return String(left) === String(right)
}

function rowOf (value: unknown): FinanceSettingCatMapRow {
  const row = objectOf(value, '类目对照列表行')
  const id = idOf(row.id, '类目对照id')
  const financeCategoryId = idOf(row.financeCategoryId, 'financeCategoryId')
  if (!sameId(id, financeCategoryId)) throw new Error('类目对照响应的id必须与financeCategoryId一致')
  return {
    id,
    financeCategoryId,
    financeCategoryName: textOf(row.financeCategoryName, 'financeCategoryName'),
    thingCategoryIds: idsOf(row.thingCategoryIds, 'thingCategoryIds', false),
    thingCategoryName: (Array.isArray(row.thingCategoryName)
      ? row.thingCategoryName.map((item, index) => textOf(item, `thingCategoryName[${index}]`))
      : (() => { throw new Error('thingCategoryName必须是数组') })()),
    bindTime: row.bindTime == null ? null : textOf(row.bindTime, 'bindTime'),
  }
}

function createDraftOf (input: FinanceSettingCatMapCreateDraft): FinanceSettingCatMapCreateDraft {
  const value = objectOf(input, '创建类目对照输入')
  return {
    financeCategoryId: idOf(value.financeCategoryId, 'financeCategoryId'),
    thingCategoryIds: idsOf(value.thingCategoryIds, 'thingCategoryIds', true),
  }
}

function saveDraftOf (input: FinanceSettingCatMapRow | FinanceSettingCatMapSaveDraft): FinanceSettingCatMapSaveDraft {
  const value = objectOf(input, '编辑类目对照当前值')
  const id = idOf(value.id, 'id')
  const financeCategoryId = idOf(value.financeCategoryId, 'financeCategoryId')
  return {
    thingCategoryIds: idsOf(value.thingCategoryIds, 'thingCategoryIds', true),
    financeCategoryId,
    status: true,
    id,
  }
}

function changesOf (input: FinanceSettingCatMapUpdateChanges | undefined): FinanceSettingCatMapUpdateChanges {
  if (input === undefined || input === null) return {}
  const value = objectOf(input, '类目对照编辑变更')
  const changes: FinanceSettingCatMapUpdateChanges = {}
  if (Object.prototype.hasOwnProperty.call(value, 'financeCategoryId')) {
    changes.financeCategoryId = idOf(value.financeCategoryId, 'financeCategoryId')
  }
  if (Object.prototype.hasOwnProperty.call(value, 'thingCategoryIds')) {
    changes.thingCategoryIds = idsOf(value.thingCategoryIds, 'thingCategoryIds', true)
  }
  return changes
}

function createPayloadOf (draft: FinanceSettingCatMapCreateDraft): FinanceSettingCatMapSaveDraft {
  const normalized = createDraftOf(draft)
  return {
    thingCategoryIds: normalized.thingCategoryIds,
    financeCategoryId: normalized.financeCategoryId,
    status: true,
    id: '',
  }
}

function updatePayloadOf (input: FinanceSettingCatMapUpdateInput): {
  draft: FinanceSettingCatMapSaveDraft
  previous: FinanceSettingCatMapSaveDraft
} {
  const previous = saveDraftOf(input?.current)
  const changes = changesOf(input?.changes)
  const draft: FinanceSettingCatMapSaveDraft = {
    thingCategoryIds: changes.thingCategoryIds ?? previous.thingCategoryIds,
    financeCategoryId: changes.financeCategoryId ?? previous.financeCategoryId,
    status: true,
    id: previous.id,
  }
  return { draft, previous }
}

function discardPayloadOf (input: FinanceSettingCatMapDiscardInput): {
  id: FinanceSettingCatMapId
  status: false
  thingCategoryIds: FinanceSettingCatMapId[]
  financeCategoryId: FinanceSettingCatMapId
} {
  const value = objectOf(input, '废弃类目对照输入')
  const id = idOf(value.id, 'id')
  const financeCategoryId = idOf(value.financeCategoryId, 'financeCategoryId')
  if (!sameId(id, financeCategoryId)) throw new Error('废弃输入的id必须与financeCategoryId一致')
  return {
    id,
    status: false,
    thingCategoryIds: idsOf(value.thingCategoryIds, 'thingCategoryIds', false),
    financeCategoryId,
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_CAT_MAP_PAGE_PATH. */
export function createFinanceSettingCatMapCapability (request: PortalRequest) {
  function prepareUpdate (input: FinanceSettingCatMapUpdateInput) {
    return updatePayloadOf(input)
  }

  return {
    async searchFinanceCategories (input: { keyword: string; limit?: number }): Promise<FinanceSettingCatMapCategorySearchResult<FinanceSettingCatMapFinanceCategoryOption>> {
      const keyword = keywordOf(input?.keyword)
      const limit = limitOf(input?.limit)
      const result = await request<unknown>({ url: FINANCE_CATEGORY_TREE_URL, method: 'get' })
      const list = financeCategoryOptionsOf(result, keyword, limit)
      return { list, matched: list.length }
    },

    async searchThingCategories (input: { keyword: string; limit?: number }): Promise<FinanceSettingCatMapCategorySearchResult<FinanceSettingCatMapThingCategoryOption>> {
      const keyword = keywordOf(input?.keyword)
      const limit = limitOf(input?.limit)
      const result = await request<unknown>({ url: THING_CATEGORY_TREE_URL, method: 'get' })
      const list = thingCategoryOptionsOf(result, keyword, limit)
      return { list, matched: list.length }
    },

    async list (): Promise<FinanceSettingCatMapRow[]> {
      const result = await request<unknown>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
        },
      })
      if (!Array.isArray(result)) throw new Error('类目对照列表响应必须为数组')
      return result.map(rowOf)
    },

    prepareCreate (input: FinanceSettingCatMapCreateDraft): { draft: FinanceSettingCatMapSaveDraft } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceSettingCatMapCreateDraft): Promise<FinanceSettingCatMapId> {
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: createPayloadOf(input),
      })
      return idOf(result, '新建类目对照返回的财务类目id')
    },

    prepareUpdate,

    async update (input: FinanceSettingCatMapUpdateInput): Promise<true> {
      const { draft } = updatePayloadOf(input)
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: draft,
      })
      return trueResult(result, '更新类目对照')
    },

    async discard (input: FinanceSettingCatMapDiscardInput): Promise<true> {
      const payload = discardPayloadOf(input)
      const result = await request<unknown>({
        url: `${ROOT}/discard`,
        method: 'put',
        data: payload,
      })
      return trueResult(result, '废弃类目对照')
    },
  }
}

export type FinanceSettingCatMapCapability = ReturnType<typeof createFinanceSettingCatMapCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

export const FINANCE_SETTING_CAT_MAP_METHODS = {
  'finance-setting-cat-map-finance-category-search': 'searchFinanceCategories',
  'finance-setting-cat-map-thing-category-search': 'searchThingCategories',
  'finance-setting-cat-map-list': 'list',
  'finance-setting-cat-map-prepare-create': 'prepareCreate',
  'finance-setting-cat-map-create': 'create',
  'finance-setting-cat-map-prepare-update': 'prepareUpdate',
  'finance-setting-cat-map-update': 'update',
  'finance-setting-cat-map-discard': 'discard',
} as const

export const financeSettingCatMapCapabilities: CapabilityDefinition[] = [
  {
    id: 'finance-setting-cat-map-finance-category-search',
    title: '搜索财务类目候选',
    write: false,
    params: [p('keyword', 'text', true, '财务类目名称关键字；SDK在页面返回的整棵树中本地匹配'), p('limit', 'number', false, '最多返回候选数；默认20，最大100')],
  },
  {
    id: 'finance-setting-cat-map-thing-category-search',
    title: '搜索资产类目候选',
    write: false,
    params: [p('keyword', 'text', true, '资产类目名称关键字；SDK在页面返回的整棵树中本地匹配'), p('limit', 'number', false, '最多返回候选数；默认20，最大100')],
  },
  { id: 'finance-setting-cat-map-list', title: '查询类目对照', write: false, params: [] },
  {
    id: 'finance-setting-cat-map-prepare-create',
    title: '准备创建类目对照',
    write: false,
    params: [
      { ...p('financeCategoryId', 'search', true, '财务类目主键ID；候选见finance-setting-cat-map-finance-category-search'), lookup: { capabilityId: 'finance-setting-cat-map-finance-category-search', keywordParam: 'keyword' } },
      { ...p('thingCategoryIds', 'search', true, '资产类目主键ID数组；至少一个，候选见finance-setting-cat-map-thing-category-search'), lookup: { capabilityId: 'finance-setting-cat-map-thing-category-search', keywordParam: 'keyword' } },
    ],
  },
  {
    id: 'finance-setting-cat-map-create',
    title: '创建类目对照',
    write: true,
    params: [
      { ...p('financeCategoryId', 'search', true, '财务类目主键ID；候选见finance-setting-cat-map-finance-category-search'), lookup: { capabilityId: 'finance-setting-cat-map-finance-category-search', keywordParam: 'keyword' } },
      { ...p('thingCategoryIds', 'search', true, '资产类目主键ID数组；至少一个，候选见finance-setting-cat-map-thing-category-search'), lookup: { capabilityId: 'finance-setting-cat-map-thing-category-search', keywordParam: 'keyword' } },
    ],
  },
  {
    id: 'finance-setting-cat-map-prepare-update',
    title: '准备编辑类目对照',
    write: false,
    params: [
      p('current', 'text', true, '来自最新类目对照列表的完整行对象或此前准备结果'),
      p('changes', 'text', false, '只包含financeCategoryId或thingCategoryIds的编辑变更'),
    ],
  },
  {
    id: 'finance-setting-cat-map-update',
    title: '编辑类目对照',
    write: true,
    params: [
      p('current', 'text', true, '来自最新类目对照列表的完整行对象或此前准备结果'),
      p('changes', 'text', false, '只包含financeCategoryId或thingCategoryIds的编辑变更'),
    ],
  },
  {
    id: 'finance-setting-cat-map-discard',
    title: '废弃类目对照',
    write: true,
    params: [
      p('id', 'text', true, '财务类目主键；与financeCategoryId相同'),
      p('financeCategoryId', 'text', true, '被废弃映射的财务类目主键'),
      p('thingCategoryIds', 'text', true, '列表行中的资产类目主键数组，可为空数组'),
    ],
  },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_CAT_MAP_PAGE_PATH,
  permission: '/dashboard/finance/setting/cat-map',
  moduleType: null,
  httpInstance: 'platform',
}))
