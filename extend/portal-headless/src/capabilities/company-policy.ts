import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风控管理 → 制度管理 → 公司制度」列表、表单、统计和共享入口。 */
export const COMPANY_POLICY_PAGE_PATH = '/dashboard/institution/company/list'
export const COMPANY_POLICY_PERMISSION = '/dashboard/institution/company'
export const COMPANY_POLICY_MODULE_TYPE = 15
export const COMPANY_POLICY_SHARE_TYPE = 1
export const COMPANY_POLICY_POWER_CONTENT_ID = '1225814271879340854'

const ROOT = '/admin-api/system/policy'
const CATEGORY_ROOT = '/admin-api/system/policy-category'
const SHARE_ROOT = '/admin-api/system/share-user'
const MAX_UPLOAD_COUNT = 10

export type CompanyPolicyId = string | number
export type CompanyPolicyType = 1 | 2
export type CompanyPolicyFlag = 0 | 1

export type CompanyPolicyChapter = Record<string, unknown> & {
  id?: CompanyPolicyId | null
  chapterName: string | null
  chapterContent: string | null
  directoryId?: CompanyPolicyId | null
}

export type CompanyPolicyDirectory = Record<string, unknown> & {
  id?: CompanyPolicyId | null
  directoryName: string | null
  directoryContent: string | null
  policyId?: CompanyPolicyId | null
  chapterList: CompanyPolicyChapter[]
}

export type CompanyPolicyRow = Record<string, unknown> & {
  id: CompanyPolicyId
  pid: CompanyPolicyId | null
  category: CompanyPolicyId | null
  categoryName: string | null
  type: CompanyPolicyType
  name: string | null
  fileUrl: string | null
  roleIds: CompanyPolicyId[]
  creator: CompanyPolicyId | null
  creatorName: string | null
  statics: number | null
  isRead: CompanyPolicyFlag | null
  isNeedRead: CompanyPolicyFlag | null
  createTime: string | null
  childrenCount: number | null
  organizationId: CompanyPolicyId | null
  organizationName: string | null
  directoryList: CompanyPolicyDirectory[]
  studentsNumber: string | null
  children?: CompanyPolicyRow[]
}

export type CompanyPolicyQuery = {
  name?: string | null
}

export type CompanyPolicyFolderDraft = Record<string, unknown> & {
  id?: CompanyPolicyId
  name: string
  pid: CompanyPolicyId | null
  roleIds: CompanyPolicyId[]
  type?: 1
}

export type CompanyPolicyPreparation<T> = {
  draft: T
  previous?: T
}

export type CompanyPolicyDirectoryInput = {
  directoryContent: string
  chapterList?: Array<{ chapterContent: string }>
}

export type CompanyPolicyUploadFile = {
  name: string
  fileUrl: string
  mimeType?: string | null
}

export type CompanyPolicyDocumentCreateInput = {
  pid?: CompanyPolicyId | null
  category: CompanyPolicyId
  organizationId: CompanyPolicyId
  files: CompanyPolicyUploadFile[]
  directoryList?: CompanyPolicyDirectoryInput[]
}

type NormalizedCompanyPolicyDocumentCreateInput = Omit<CompanyPolicyDocumentCreateInput, 'directoryList'> & {
  directoryList: CompanyPolicyDirectory[]
}

export type CompanyPolicyDocumentDraft = {
  id?: CompanyPolicyId
  name?: string
  fileUrl?: string | null
  pid: CompanyPolicyId | null
  type: 2
  category: CompanyPolicyId
  organizationId: CompanyPolicyId
  files?: CompanyPolicyUploadFile[]
  directoryList: CompanyPolicyDirectory[]
}

export type CompanyPolicyStudentQuery = {
  policyId: CompanyPolicyId
  name?: string | null
  mobile?: string | null
  isRead?: CompanyPolicyFlag
  pageNo?: number
  pageSize?: number
}

export type CompanyPolicyStudentRow = Record<string, unknown> & {
  realName: string | null
  mobile: string | null
  isRead: CompanyPolicyFlag | null
}

export type CompanyPolicyPowerContent = Record<string, unknown> & {
  id: CompanyPolicyId
  dictTypeId: CompanyPolicyId
  dictLabel: string
  dictValue: string | null
  remark: string | null
  sort: number | null
  createDate: string | null
  updateDate: string | null
}

export type CompanyPolicyShareMember = {
  id: CompanyPolicyId
  name?: string
  managerType?: number | null
}

export type CompanyPolicyShare = {
  organization: CompanyPolicyShareMember[]
  post: CompanyPolicyShareMember[]
  duty: CompanyPolicyShareMember[]
  user: CompanyPolicyShareMember[]
}

export type CompanyPolicyShareInput = {
  resourceId: CompanyPolicyId
  organization?: CompanyPolicyShareMember[]
  post?: CompanyPolicyShareMember[]
  duty?: CompanyPolicyShareMember[]
  user?: CompanyPolicyShareMember[]
}

export type CompanyPolicyFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): CompanyPolicyId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): CompanyPolicyId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function parentIdOf (value: unknown, label: string): CompanyPolicyId | null {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, max?: number, trim = false): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  const result = trim ? value.trim() : value
  if (result.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (max !== undefined && result.length > max) throw new Error(`${label}最多${max}个字符`)
  return result
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function nullableFlagOf (value: unknown, label: string): CompanyPolicyFlag | null {
  if (value === undefined || value === null || value === '') return null
  if (value === 0 || value === '0') return 0
  if (value === 1 || value === '1') return 1
  throw new Error(`${label}必须为0、1或null`)
}

function typeOf (value: unknown, label: string): CompanyPolicyType {
  if (value === 1 || value === '1') return 1
  if (value === 2 || value === '2') return 2
  throw new Error(`${label}必须为1（文件夹）或2（制度）`)
}

function pageNumberOf (value: unknown, fallback: number, label: string): number {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  return result
}

function chapterOf (value: unknown, label: string): CompanyPolicyChapter {
  const row = objectOf(value, label)
  return {
    ...row,
    ...(row.id === undefined || row.id === null ? {} : { id: idOf(row.id, `${label}.id`) }),
    chapterName: textOf(row.chapterName, `${label}.chapterName`),
    chapterContent: textOf(row.chapterContent, `${label}.chapterContent`),
    ...(row.directoryId === undefined || row.directoryId === null ? {} : { directoryId: idOf(row.directoryId, `${label}.directoryId`) }),
  }
}

function directoryOf (value: unknown, label: string): CompanyPolicyDirectory {
  const row = objectOf(value, label)
  const chapterList = row.chapterList === undefined || row.chapterList === null ? [] : row.chapterList
  if (!Array.isArray(chapterList)) throw new Error(`${label}.chapterList必须是数组`)
  return {
    ...row,
    ...(row.id === undefined || row.id === null ? {} : { id: idOf(row.id, `${label}.id`) }),
    directoryName: textOf(row.directoryName, `${label}.directoryName`),
    directoryContent: textOf(row.directoryContent, `${label}.directoryContent`),
    ...(row.policyId === undefined || row.policyId === null ? {} : { policyId: idOf(row.policyId, `${label}.policyId`) }),
    chapterList: chapterList.map((item, index) => chapterOf(item, `${label}.chapterList[${index}]`)),
  }
}

function directoryListOf (value: unknown, label: string): CompanyPolicyDirectory[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => directoryOf(item, `${label}[${index}]`))
}

function chineseNumberOf (value: number): string | undefined {
  const digit = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (!Number.isInteger(value) || value < 0 || value >= 100) return undefined
  if (value < 10) return digit[value]
  const tens = Math.floor(value / 10)
  const ones = value % 10
  if (tens === 1) return ones === 0 ? '十' : `十${digit[ones]}`
  return ones === 0 ? `${digit[tens]}十` : `${digit[tens]}十${digit[ones]}`
}

function computedDirectoryListOf (value: unknown, label: string): CompanyPolicyDirectory[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    const directoryContent = requiredTextOf(row.directoryContent, `${label}[${index}].directoryContent`, 50)
    const sourceChapters = row.chapterList === undefined || row.chapterList === null ? [] : row.chapterList
    if (!Array.isArray(sourceChapters)) throw new Error(`${label}[${index}].chapterList必须是数组`)
    return {
      directoryName: `第${chineseNumberOf(index + 1)}章`,
      directoryContent,
      chapterList: sourceChapters.map((chapter, chapterIndex) => {
        const chapterRow = objectOf(chapter, `${label}[${index}].chapterList[${chapterIndex}]`)
        return {
          chapterName: `第${chineseNumberOf(chapterIndex + 1)}节`,
          chapterContent: requiredTextOf(chapterRow.chapterContent, `${label}[${index}].chapterList[${chapterIndex}].chapterContent`, 50),
        }
      }),
    }
  })
}

function rawRowOf (value: unknown, label: string): CompanyPolicyRow {
  const row = objectOf(value, label)
  const type = typeOf(row.type, `${label}.type`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    pid: parentIdOf(row.pid, `${label}.pid`),
    category: nullableIdOf(row.category, `${label}.category`),
    categoryName: textOf(row.categoryName, `${label}.categoryName`),
    type,
    name: textOf(row.name, `${label}.name`),
    fileUrl: textOf(row.fileUrl, `${label}.fileUrl`),
    roleIds: row.roleIds === undefined || row.roleIds === null ? [] : idListOf(row.roleIds, `${label}.roleIds`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    creatorName: textOf(row.creatorName, `${label}.creatorName`),
    statics: nullableIntegerOf(row.statics, `${label}.statics`),
    isRead: nullableFlagOf(row.isRead, `${label}.isRead`),
    isNeedRead: nullableFlagOf(row.isNeedRead, `${label}.isNeedRead`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    childrenCount: nullableIntegerOf(row.childrenCount, `${label}.childrenCount`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    directoryList: directoryListOf(row.directoryList, `${label}.directoryList`),
    studentsNumber: textOf(row.studentsNumber, `${label}.studentsNumber`),
  }
}

function idListOf (value: unknown, label: string): CompanyPolicyId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function treeOf (value: unknown, label: string): CompanyPolicyRow[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const raw = objectOf(item, `${label}[${index}]`)
    if (!Array.isArray(raw.children)) throw new Error(`${label}[${index}].children必须是数组`)
    const row = rawRowOf(raw, `${label}[${index}]`)
    const children = treeOf(raw.children, `${label}[${index}].children`)
    if (children.length > 0) return { ...row, children }
    const leaf = { ...row }
    delete leaf.children
    return leaf
  })
}

function folderDraftOf (value: unknown, label: string, requireId = false): CompanyPolicyFolderDraft {
  const row = objectOf(value, label)
  const id = row.id === undefined || row.id === null || row.id === '' ? undefined : idOf(row.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const name = requiredTextOf(row.name, `${label}.name`, 50, true)
  const pid = parentIdOf(row.pid, `${label}.pid`)
  const roleIds = row.roleIds === undefined || row.roleIds === null ? [] : idListOf(row.roleIds, `${label}.roleIds`)
  return {
    ...(id === undefined ? {} : { id }),
    name,
    pid,
    roleIds,
  }
}

function uploadFileOf (value: unknown, label: string): CompanyPolicyUploadFile {
  const row = objectOf(value, label)
  const name = requiredTextOf(row.name, `${label}.name`)
  const fileUrl = requiredTextOf(row.fileUrl, `${label}.fileUrl`)
  const mimeType = row.mimeType === undefined || row.mimeType === null ? undefined : requiredTextOf(row.mimeType, `${label}.mimeType`)
  if (mimeType !== undefined && ![
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'application/msword',
  ].includes(mimeType)) throw new Error(`${label}.mimeType不是Portal允许的doc、docx或pdf类型`)
  return { name, fileUrl, ...(mimeType === undefined ? {} : { mimeType }) }
}

function documentCreateInputOf (value: unknown, label: string): NormalizedCompanyPolicyDocumentCreateInput {
  const row = objectOf(value, label)
  if (!Array.isArray(row.files)) throw new Error(`${label}.files必须是数组`)
  if (row.files.length === 0) throw new Error(`${label}.files不能为空；Portal后端要求至少上传一个制度文件`)
  if (row.files.length > MAX_UPLOAD_COUNT) throw new Error(`${label}.files最多${MAX_UPLOAD_COUNT}项`)
  return {
    pid: parentIdOf(row.pid, `${label}.pid`),
    category: idOf(row.category, `${label}.category`),
    organizationId: idOf(row.organizationId, `${label}.organizationId`),
    files: row.files.map((item, index) => uploadFileOf(item, `${label}.files[${index}]`)),
    directoryList: computedDirectoryListOf(row.directoryList, `${label}.directoryList`),
  }
}

function documentDraftOf (value: unknown, label: string, requireId = false): CompanyPolicyDocumentDraft {
  const row = objectOf(value, label)
  const id = row.id === undefined || row.id === null || row.id === '' ? undefined : idOf(row.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const type = typeOf(row.type ?? 2, `${label}.type`)
  if (type !== 2) throw new Error(`${label}.type必须为2（制度）`)
  const name = row.name === undefined || row.name === null ? undefined : requiredTextOf(row.name, `${label}.name`, 50)
  const files = row.files === undefined || row.files === null ? undefined : (() => {
    if (!Array.isArray(row.files)) throw new Error(`${label}.files必须是数组`)
    if (row.files.length === 0 || row.files.length > MAX_UPLOAD_COUNT) throw new Error(`${label}.files必须为1至${MAX_UPLOAD_COUNT}项`)
    return row.files.map((item, index) => uploadFileOf(item, `${label}.files[${index}]`))
  })()
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    fileUrl: textOf(row.fileUrl, `${label}.fileUrl`),
    pid: parentIdOf(row.pid, `${label}.pid`),
    type: 2,
    category: idOf(row.category, `${label}.category`),
    organizationId: idOf(row.organizationId, `${label}.organizationId`),
    ...(files === undefined ? {} : { files }),
    directoryList: computedDirectoryListOf(row.directoryList, `${label}.directoryList`),
  }
}

function studentQueryOf (query: CompanyPolicyStudentQuery): JsonObject {
  return {
    order: '',
    orderField: '',
    name: query.name == null ? '' : textOf(query.name, 'name'),
    mobile: query.mobile == null ? '' : textOf(query.mobile, 'mobile'),
    isRead: query.isRead ?? 0,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
    policyId: idOf(query.policyId, 'policyId'),
  }
}

function studentRowOf (value: unknown, label: string): CompanyPolicyStudentRow {
  const row = objectOf(value, label)
  return {
    ...row,
    realName: textOf(row.realName, `${label}.realName`),
    mobile: textOf(row.mobile, `${label}.mobile`),
    isRead: nullableFlagOf(row.isRead, `${label}.isRead`),
  }
}

function studentPageOf (value: unknown): PageResult<CompanyPolicyStudentRow> {
  const page = objectOf(value, '公司制度学习人员分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('公司制度学习人员分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => studentRowOf(item, `公司制度学习人员[${index}]`)), total: page.total }
}

function categoryOf (value: unknown, index: number): JsonObject & { id: CompanyPolicyId; name: string | null; sort: number | null; size: number | null } {
  const row = objectOf(value, `制度类型[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `制度类型[${index}].id`),
    name: textOf(row.name, `制度类型[${index}].name`),
    sort: nullableIntegerOf(row.sort, `制度类型[${index}].sort`),
    size: nullableIntegerOf(row.size, `制度类型[${index}].size`),
  }
}

function categoryListOf (value: unknown): Array<JsonObject & { id: CompanyPolicyId; name: string | null; sort: number | null; size: number | null }> {
  if (!Array.isArray(value)) throw new Error('制度类型响应必须是数组')
  return value.map(categoryOf)
}

function pageOfPowerContent (value: unknown): CompanyPolicyPowerContent {
  const row = objectOf(value, '无权限内容响应')
  return {
    ...row,
    id: idOf(row.id, '无权限内容.id'),
    dictTypeId: idOf(row.dictTypeId, '无权限内容.dictTypeId'),
    dictLabel: requiredTextOf(row.dictLabel, '无权限内容.dictLabel'),
    dictValue: textOf(row.dictValue, '无权限内容.dictValue'),
    remark: textOf(row.remark, '无权限内容.remark'),
    sort: nullableIntegerOf(row.sort, '无权限内容.sort'),
    createDate: textOf(row.createDate, '无权限内容.createDate'),
    updateDate: textOf(row.updateDate, '无权限内容.updateDate'),
  }
}

function formatDateTime (value = new Date()): string {
  const parts = [value.getFullYear(), value.getMonth() + 1, value.getDate()]
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()]
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')} ${time.map(item => String(item).padStart(2, '0')).join(':')}`
}

function shareMemberOf (value: unknown, label: string): CompanyPolicyShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: nullableIntegerOf(row.managerType, `${label}.managerType`) }),
  }
}

function shareOf (value: unknown): CompanyPolicyShare {
  const row = objectOf(value, '公司制度共享响应')
  const members = (key: string): CompanyPolicyShareMember[] => {
    if (row[key] === undefined || row[key] === null) return []
    if (!Array.isArray(row[key])) throw new Error(`公司制度共享响应.${key}必须是数组`)
    return row[key].map((item, index) => shareMemberOf(item, `公司制度共享响应.${key}[${index}]`))
  }
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '公司制度共享参数') as CompanyPolicyShareInput
  return {
    type: COMPANY_POLICY_SHARE_TYPE,
    resourceId: idOf(input.resourceId, 'resourceId'),
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function folderPayloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const draft = folderDraftOf(value, label, requireId)
  return { ...draft, pid: draft.pid || 0, roleIds: draft.roleIds, type: 1 }
}

function documentUpdatePayloadOf (value: unknown, label: string): JsonObject {
  const draft = documentDraftOf(value, label, true)
  if (draft.name === undefined) throw new Error(`${label}.name不能为空`)
  return {
    id: draft.id,
    name: draft.name,
    fileUrl: draft.fileUrl,
    pid: draft.pid,
    type: draft.type,
    category: draft.category,
    organizationId: draft.organizationId,
    directoryList: draft.directoryList,
  }
}

function documentCreatePayloadOf (value: unknown, label: string): JsonObject {
  const draft = documentDraftOf(value, label, false)
  if (!draft.files || draft.files.length === 0) throw new Error(`${label}.files不能为空；Portal后端要求至少上传一个制度文件`)
  return {
    pid: draft.pid,
    category: draft.category,
    organizationId: draft.organizationId,
    list: draft.files.map(file => ({ name: file.name, fileUrl: file.fileUrl, type: 2, directoryList: draft.directoryList })),
  }
}

function normalizeFileUrl (value: unknown): string {
  const url = requiredTextOf(value, 'fileUrl')
  const normalized = url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
  if (!normalized.startsWith('https://')) throw new Error('fileUrl必须是http或https URL')
  return normalized
}

function fileNameOf (value: unknown, fileUrl: string): string {
  if (value !== undefined && value !== null && value !== '') return requiredTextOf(value, 'fileName')
  const path = fileUrl.split('?')[0]!.split('/').pop() || '制度文件'
  return decodeURIComponent(path)
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): CompanyPolicyFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('公司制度文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fallback,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

/** The injected request must be bound to COMPANY_POLICY_PAGE_PATH. */
export function createCompanyPolicyCapability (request: PortalRequest) {
  return {
    async list (query: CompanyPolicyQuery = {}): Promise<CompanyPolicyRow[]> {
      const name = query.name == null ? '' : textOf(query.name, 'name')
      return treeOf(await request({ url: `${ROOT}/tree`, method: 'get', params: { order: '', orderField: '', name } }), '公司制度树')
    },
    async get (input: { id: CompanyPolicyId }): Promise<CompanyPolicyRow> {
      const id = idOf(input?.id, '公司制度ID')
      return rawRowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '公司制度详情')
    },
    async parentList (): Promise<CompanyPolicyRow[]> {
      return treeOf(await request({ url: `${ROOT}/simple-list`, method: 'get' }), '公司制度上级文件夹候选')
    },
    async categoryList (): Promise<Array<JsonObject & { id: CompanyPolicyId; name: string | null; sort: number | null; size: number | null }>> {
      return categoryListOf(await request({ url: `${CATEGORY_ROOT}/simple-list`, method: 'get' }))
    },
    prepareCreateFolder (input: CompanyPolicyFolderDraft): CompanyPolicyPreparation<CompanyPolicyFolderDraft> {
      return { draft: folderDraftOf(input, 'form') }
    },
    async createFolder (input: { draft: CompanyPolicyFolderDraft }): Promise<CompanyPolicyId> {
      return idOf(await request({
        url: `${ROOT}/create-file`,
        method: 'post',
        data: folderPayloadOf(input?.draft, 'draft', false),
        headers: { 'Content-Type': 'multipart/form-data' },
      }), '新建公司制度文件夹响应')
    },
    prepareUpdateFolder (input: { current: CompanyPolicyRow; changes?: Partial<CompanyPolicyFolderDraft> | null }): CompanyPolicyPreparation<CompanyPolicyFolderDraft> {
      const current = folderDraftOf({ ...input?.current, roleIds: input?.current?.roleIds ?? [], pid: input?.current?.pid ?? null }, 'current', true)
      return { draft: folderDraftOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async updateFolder (input: { draft: CompanyPolicyFolderDraft }): Promise<true> {
      return trueOf(await request({
        url: `${ROOT}/update`,
        method: 'put',
        data: folderPayloadOf(input?.draft, 'folder', true),
        headers: { 'Content-Type': 'multipart/form-data' },
      }), '更新公司制度文件夹')
    },
    prepareCreate (input: CompanyPolicyDocumentCreateInput): CompanyPolicyPreparation<CompanyPolicyDocumentDraft> {
      const source = documentCreateInputOf(input, 'form')
      return {
        draft: {
          pid: source.pid ?? null,
          type: 2,
          category: source.category,
          organizationId: source.organizationId,
          files: source.files,
          directoryList: source.directoryList ?? [],
        },
      }
    },
    async create (input: { draft: CompanyPolicyDocumentDraft }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/create`, method: 'post', data: documentCreatePayloadOf(input?.draft, 'draft') }), '新建公司制度')
    },
    prepareUpdate (input: { current: CompanyPolicyRow; changes?: Partial<CompanyPolicyDocumentDraft> | null }): CompanyPolicyPreparation<CompanyPolicyDocumentDraft> {
      const current = documentDraftOf({
        ...input?.current,
        type: 2,
        directoryList: input?.current?.directoryList ?? [],
      }, 'current', true)
      return {
        draft: documentDraftOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true),
        previous: current,
      }
    },
    async update (input: { draft: CompanyPolicyDocumentDraft }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: documentUpdatePayloadOf(input?.draft, 'draft') }), '更新公司制度')
    },
    async remove (input: { id: CompanyPolicyId }): Promise<true> {
      const id = idOf(input?.id, '公司制度ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除公司制度')
    },
    async download (input: { fileUrl: string; fileName?: string }): Promise<CompanyPolicyFile> {
      const fileUrl = normalizeFileUrl(input?.fileUrl)
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: fileUrl, method: 'get', responseType: 'arraybuffer' }), fileNameOf(input?.fileName, fileUrl))
    },
    async studentList (query: CompanyPolicyStudentQuery): Promise<PageResult<CompanyPolicyStudentRow>> {
      return studentPageOf(await request({ url: `${ROOT}/getStudent`, method: 'get', params: studentQueryOf(query) }))
    },
    async getPowerContent (): Promise<CompanyPolicyPowerContent> {
      return pageOfPowerContent(await request({ url: `/sys/dict/data/${COMPANY_POLICY_POWER_CONTENT_ID}`, method: 'get' }))
    },
    async updatePowerContent (input: { draft: CompanyPolicyPowerContent }): Promise<true> {
      const draft = pageOfPowerContent(input?.draft)
      if (String(draft.id) !== COMPANY_POLICY_POWER_CONTENT_ID) throw new Error(`无权限内容只能更新固定字典ID ${COMPANY_POLICY_POWER_CONTENT_ID}`)
      requiredTextOf(draft.dictLabel, '无权限内容.dictLabel', 200)
      return trueOf(await request({
        url: '/sys/dict/data',
        method: 'put',
        data: { ...draft, updateDate: formatDateTime() },
      }), '更新无权限内容')
    },
    async getShare (input: { resourceId: CompanyPolicyId }): Promise<CompanyPolicyShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: COMPANY_POLICY_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: CompanyPolicyShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存公司制度共享')
    },
  }
}

export type CompanyPolicyCapability = ReturnType<typeof createCompanyPolicyCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const COMPANY_POLICY_METHODS = {
  'company-policy-list': 'list',
  'company-policy-get': 'get',
  'company-policy-parent-list': 'parentList',
  'company-policy-category-list': 'categoryList',
  'company-policy-prepare-create-folder': 'prepareCreateFolder',
  'company-policy-create-folder': 'createFolder',
  'company-policy-prepare-update-folder': 'prepareUpdateFolder',
  'company-policy-update-folder': 'updateFolder',
  'company-policy-prepare-create': 'prepareCreate',
  'company-policy-create': 'create',
  'company-policy-prepare-update': 'prepareUpdate',
  'company-policy-update': 'update',
  'company-policy-remove': 'remove',
  'company-policy-download': 'download',
  'company-policy-student-list': 'studentList',
  'company-policy-get-power-content': 'getPowerContent',
  'company-policy-update-power-content': 'updatePowerContent',
  'company-policy-get-share': 'getShare',
  'company-policy-save-share': 'saveShare',
} as const

export const companyPolicyCapabilities: CapabilityDefinition[] = [
  { id: 'company-policy-list', title: '查询公司制度目录树', write: false, params: [p('name', 'text', false, '制度或文件夹名称筛选；默认空字符串')] },
  { id: 'company-policy-get', title: '读取公司制度详情', write: false, params: [p('id', 'number', true, '制度或文件夹ID')] },
  { id: 'company-policy-parent-list', title: '查询公司制度上级文件夹候选', write: false, params: [] },
  { id: 'company-policy-category-list', title: '查询制度类型候选', write: false, params: [] },
  { id: 'company-policy-prepare-create-folder', title: '准备新建公司制度文件夹', write: false, params: [p('form', 'text', true, '文件夹名称、上级目录和角色授权')] },
  { id: 'company-policy-create-folder', title: '新建公司制度文件夹', write: true, params: [p('draft', 'text', true, 'prepareCreateFolder返回的文件夹草稿')] },
  { id: 'company-policy-prepare-update-folder', title: '准备编辑公司制度文件夹', write: false, params: [p('current', 'text', true, 'get返回的最新文件夹详情'), p('changes', 'text', false, '用户明确修改的字段')] },
  { id: 'company-policy-update-folder', title: '保存公司制度文件夹', write: true, params: [p('draft', 'text', true, 'prepareUpdateFolder返回的文件夹草稿')] },
  { id: 'company-policy-prepare-create', title: '准备上传公司制度', write: false, params: [p('form', 'text', true, '制度类型、关联组织、已上传文件和目录章节')] },
  { id: 'company-policy-create', title: '上传公司制度', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的制度草稿')] },
  { id: 'company-policy-prepare-update', title: '准备编辑公司制度', write: false, params: [p('current', 'text', true, 'get返回的最新制度详情'), p('changes', 'text', false, '用户明确修改的字段')] },
  { id: 'company-policy-update', title: '保存公司制度', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的制度草稿')] },
  { id: 'company-policy-remove', title: '删除公司制度或文件夹', write: true, params: [p('id', 'number', true, '制度或文件夹ID')] },
  { id: 'company-policy-download', title: '下载或读取公司制度文件', write: false, params: [p('fileUrl', 'text', true, '列表中的制度文件URL'), p('fileName', 'text', false, '下载文件名；默认从URL提取')] },
  { id: 'company-policy-student-list', title: '查询公司制度学习人员', write: false, params: [p('policyId', 'number', true, '制度ID'), p('name', 'text', false, '人员姓名筛选'), p('mobile', 'text', false, '手机号筛选'), p('isRead', 'enum', false, '是否学习：0否、1是'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认20')] },
  { id: 'company-policy-get-power-content', title: '读取公司制度无权限内容', write: false, params: [] },
  { id: 'company-policy-update-power-content', title: '保存公司制度无权限内容', write: true, params: [p('draft', 'text', true, 'getPowerContent返回的字典内容草稿')] },
  { id: 'company-policy-get-share', title: '读取公司制度共享设置', write: false, params: [p('resourceId', 'number', true, '制度ID')] },
  { id: 'company-policy-save-share', title: '保存公司制度共享设置', write: true, params: [p('resourceId', 'number', true, '制度ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: COMPANY_POLICY_PAGE_PATH, permission: COMPANY_POLICY_PERMISSION, moduleType: COMPANY_POLICY_MODULE_TYPE, httpInstance: 'platform' }))
