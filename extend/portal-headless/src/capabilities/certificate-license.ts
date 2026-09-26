import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「风险防控 → 证照管理」目录树及其当前页面可达动作。 */
export const CERTIFICATE_LICENSE_PAGE_PATH = '/dashboard/certificate/certificate/list'
export const CERTIFICATE_LICENSE_PERMISSION = '/dashboard/certificate/certificate'
export const CERTIFICATE_LICENSE_MODULE_TYPE = 15

const ROOT = '/admin-api/system/license'
const CATEGORY_ROOT = '/admin-api/system/license-category'
const SHARE_ROOT = '/admin-api/system/share-user'

export type CertificateLicenseId = string | number
export type CertificateLicenseType = 1 | 2
export type CertificateLicenseBinaryFlag = 0 | 1

export type CertificateLicenseQuery = {
  /** Portal 列表唯一可见筛选：名称；默认发送空字符串。 */
  name?: string | null
}

export type CertificateLicenseStaffRef = {
  staffCode: string | number
  name: string
}

export type CertificateLicenseRecord = Record<string, unknown> & {
  id: CertificateLicenseId
  pid: CertificateLicenseId | null
  parentId: CertificateLicenseId | null
  category: CertificateLicenseId | null
  categoryName: string | null
  type: CertificateLicenseType | null
  name: string | null
  fileUrl: string | null
  fileUrlList: string[]
  roleIds: CertificateLicenseId[]
  legalName: string | null
  legalId: CertificateLicenseId | null
  legalCode: string | null
  isOur: number | null
  perpetual: number | null
  creator: CertificateLicenseId | null
  creatorName: string | null
  remindUser: string | null
  remindUserCode: string | null
  organizationId: CertificateLicenseId | null
  organizationName: string | null
  remindUserList: string[]
  expireStatus: number | null
  startTime: string | null
  endTime: string | null
  createTime: string | null
  childrenCount: number | string | null
  pdfName: string | null
  pdfUrl: string | null
  pdfUrlList: string[]
  pdfNameList: string[]
  isLight: number | null
  pushDate: string | null
  isPush: number | null
}

export type CertificateLicenseTreeNode = CertificateLicenseRecord & {
  children?: CertificateLicenseTreeNode[]
}

export type CertificateLicenseFolderDraft = {
  id?: CertificateLicenseId
  name: string
  pid?: CertificateLicenseId | null
  roleList?: CertificateLicenseId[]
}

export type CertificateLicenseFolderPreparation = {
  draft: CertificateLicenseFolderDraft
  previous?: CertificateLicenseFolderDraft
}

export type CertificateLicenseForm = {
  id?: CertificateLicenseId
  category: CertificateLicenseId
  pid: CertificateLicenseId
  organizationId: CertificateLicenseId
  name: string
  legalName?: string | null
  legalCode?: CertificateLicenseStaffRef[]
  isOur: CertificateLicenseBinaryFlag
  perpetual: CertificateLicenseBinaryFlag
  startTime: string
  endTime?: string | null
  remindUserCode?: CertificateLicenseStaffRef[]
  fileUrl?: string[]
  pdfUrl?: string[]
  pdfName?: string[]
}

export type CertificateLicenseSavePreparation = {
  draft: CertificateLicenseForm
  previous?: CertificateLicenseForm
}

export type CertificateLicenseShareMember = {
  id: CertificateLicenseId
  name?: string
  managerType?: number
}

export type CertificateLicenseShare = {
  organization: CertificateLicenseShareMember[]
  post: CertificateLicenseShareMember[]
  duty: CertificateLicenseShareMember[]
  user: CertificateLicenseShareMember[]
}

export type CertificateLicenseShareInput = {
  resourceId: CertificateLicenseId
  organization?: CertificateLicenseShareMember[]
  post?: CertificateLicenseShareMember[]
  duty?: CertificateLicenseShareMember[]
  user?: CertificateLicenseShareMember[]
}

export type CertificateLicenseRecognition = {
  imgUrl: string
  type: CertificateLicenseId
}

export type CertificateLicenseRecognitionResult = {
  name: string | null
  startTime: string | null
  endTime: string | null
  perpetual: string | number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): CertificateLicenseId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): CertificateLicenseId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为有限数字或null`)
  return value
}

function integerFlagOf (value: unknown, label: string): CertificateLicenseBinaryFlag {
  if (value === 0 || value === 1) return value
  throw new Error(`${label}只能是0或1`)
}

function typeOf (value: unknown, label: string): CertificateLicenseType | null {
  if (value === undefined || value === null) return null
  if (value === 1 || value === 2) return value
  throw new Error(`${label}只能是1（文件夹）或2（证照）`)
}

function listOfStrings (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') throw new Error(`${label}[${index}]必须为非空字符串`)
      return item
    })
  }
  if (typeof value === 'string') return value.split(',').filter(Boolean)
  throw new Error(`${label}必须是字符串数组或逗号字符串`)
}

function listOfIds (value: unknown, label: string): CertificateLicenseId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function dateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function recordOf (value: unknown, label: string): CertificateLicenseRecord {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    pid: nullableIdOf(row.pid, `${label}.pid`),
    parentId: nullableIdOf(row.parentId, `${label}.parentId`),
    category: nullableIdOf(row.category, `${label}.category`),
    categoryName: textOf(row.categoryName, `${label}.categoryName`),
    type: typeOf(row.type, `${label}.type`),
    name: textOf(row.name, `${label}.name`),
    fileUrl: textOf(row.fileUrl, `${label}.fileUrl`),
    fileUrlList: listOfStrings(row.fileUrlList, `${label}.fileUrlList`),
    roleIds: listOfIds(row.roleIds, `${label}.roleIds`),
    legalName: textOf(row.legalName, `${label}.legalName`),
    legalId: nullableIdOf(row.legalId, `${label}.legalId`),
    legalCode: textOf(row.legalCode, `${label}.legalCode`),
    isOur: nullableNumberOf(row.isOur, `${label}.isOur`),
    perpetual: nullableNumberOf(row.perpetual, `${label}.perpetual`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    creatorName: textOf(row.creatorName, `${label}.creatorName`),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    remindUserCode: textOf(row.remindUserCode, `${label}.remindUserCode`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    remindUserList: listOfStrings(row.remindUserList, `${label}.remindUserList`),
    expireStatus: nullableNumberOf(row.expireStatus, `${label}.expireStatus`),
    startTime: textOf(row.startTime, `${label}.startTime`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    childrenCount: row.childrenCount === undefined || row.childrenCount === null || typeof row.childrenCount === 'string' || typeof row.childrenCount === 'number' ? (row.childrenCount as number | string | null | undefined) ?? null : (() => { throw new Error(`${label}.childrenCount必须为数字、字符串或null`) })(),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfUrlList: listOfStrings(row.pdfUrlList, `${label}.pdfUrlList`),
    pdfNameList: listOfStrings(row.pdfNameList, `${label}.pdfNameList`),
    isLight: nullableNumberOf(row.isLight, `${label}.isLight`),
    pushDate: textOf(row.pushDate, `${label}.pushDate`),
    isPush: nullableNumberOf(row.isPush, `${label}.isPush`),
  }
}

function treeOf (value: unknown): CertificateLicenseTreeNode[] {
  if (!Array.isArray(value)) throw new Error('证照目录树响应必须是数组')
  const visit = (item: unknown, index: number): CertificateLicenseTreeNode => {
    const row = recordOf(item, `证照目录树[${index}]`)
    const source = objectOf(item, `证照目录树[${index}]`)
    const children = source.children === undefined || source.children === null ? [] : source.children
    if (!Array.isArray(children)) throw new Error(`证照目录树[${index}].children必须是数组或null`)
    if (children.length === 0) {
      const { children: _children, ...withoutChildren } = row
      return { ...withoutChildren, childrenCount: '' }
    }
    return { ...row, children: children.map((child, childIndex) => visit(child, childIndex)) }
  }
  return value.map((item, index) => visit(item, index))
}

function pageNameOf (value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('name必须为字符串或null')
  return value
}

function staffRefOf (value: unknown, label: string): CertificateLicenseStaffRef {
  const staff = objectOf(value, label)
  return { staffCode: idOf(staff.staffCode, `${label}.staffCode`), name: textOf(staff.name, `${label}.name`) ?? '' }
}

function staffRefsOf (value: unknown, label: string): CertificateLicenseStaffRef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是人员数组`)
  return value.map((item, index) => staffRefOf(item, `${label}[${index}]`))
}

function nonEmptyTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function maxTextOf (value: unknown, label: string, maxLength: number): string | null {
  const text = textOf(value, label)
  if (text !== null && text.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return text
}

function urlsOf (value: unknown, label: string, max: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (value.length > max) throw new Error(`${label}最多${max}项`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') throw new Error(`${label}[${index}]必须为非空URL`)
    return item
  })
}

function folderDraftOf (value: unknown, label: string): CertificateLicenseFolderDraft {
  const input = objectOf(value, label)
  return {
    ...(input.id === undefined ? {} : { id: idOf(input.id, `${label}.id`) }),
    name: nonEmptyTextOf(input.name, `${label}.name`, 50),
    pid: input.pid === undefined || input.pid === null ? null : idOf(input.pid, `${label}.pid`),
    roleList: listOfIds(input.roleList, `${label}.roleList`),
  }
}

function formOf (value: unknown, label: string, requireId = false): CertificateLicenseForm {
  const input = objectOf(value, label)
  const id = input.id === undefined ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const category = idOf(input.category, `${label}.category`)
  const pid = idOf(input.pid, `${label}.pid`)
  const organizationId = idOf(input.organizationId, `${label}.organizationId`)
  const name = nonEmptyTextOf(input.name, `${label}.name`, 50)
  const isOur = integerFlagOf(input.isOur, `${label}.isOur`)
  const perpetual = integerFlagOf(input.perpetual, `${label}.perpetual`)
  const startTime = dateOf(input.startTime, `${label}.startTime`)
  if (!startTime) throw new Error(`${label}.startTime不能为空`)
  const endTime = dateOf(input.endTime, `${label}.endTime`)
  if (perpetual === 0 && !endTime) throw new Error(`${label}.endTime不能为空；非永久证照必须填写到期时间`)
  if (perpetual === 1 && endTime) throw new Error(`${label}.endTime必须为空；永久证照不发送到期时间`)
  if (endTime && endTime < startTime) throw new Error(`${label}.endTime不能早于startTime`)
  // Portal only limits the external法人 field to 10 characters; it does not
  // mark the field as required, so an empty value must remain valid.
  const legalName = maxTextOf(input.legalName, `${label}.legalName`, 10)
  const legalCode = staffRefsOf(input.legalCode, `${label}.legalCode`)
  const remindUserCode = staffRefsOf(input.remindUserCode, `${label}.remindUserCode`)
  if (perpetual === 0 && remindUserCode.length === 0) throw new Error(`${label}.remindUserCode不能为空；非永久证照必须选择到期提醒人员`)
  const fileUrl = urlsOf(input.fileUrl, `${label}.fileUrl`, 1)
  const pdfUrl = urlsOf(input.pdfUrl, `${label}.pdfUrl`, 10)
  const pdfName = input.pdfName === undefined || input.pdfName === null ? [] : input.pdfName
  if (!Array.isArray(pdfName) || pdfName.some(item => typeof item !== 'string' || item.trim() === '')) throw new Error(`${label}.pdfName必须是非空字符串数组`)
  if (pdfName.length !== pdfUrl.length) throw new Error(`${label}.pdfName与pdfUrl数量必须一致`)
  if (fileUrl.length === 0 && pdfUrl.length === 0) throw new Error(`${label}.fileUrl与pdfUrl至少填写一个`)
  return {
    ...(id === undefined ? {} : { id }),
    category,
    pid,
    organizationId,
    name,
    legalName,
    legalCode,
    isOur,
    perpetual,
    startTime,
    endTime,
    remindUserCode,
    fileUrl,
    pdfUrl,
    pdfName,
  }
}

function savePayloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  const legal = form.isOur === 1 && form.legalCode && form.legalCode.length > 0 ? form.legalCode[0]! : null
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    category: form.category,
    pid: form.pid,
    organizationId: form.organizationId,
    name: form.name,
    legalName: form.isOur === 1 ? (legal?.name || null) : form.legalName,
    legalCode: form.isOur === 1 ? (legal ? String(legal.staffCode) : null) : null,
    isOur: form.isOur,
    perpetual: form.perpetual,
    startTime: form.startTime,
    endTime: form.perpetual === 1 ? null : form.endTime,
    remindUserCode: form.remindUserCode!.map(item => String(item.staffCode)).join(','),
    fileUrl: form.fileUrl!.join(','),
    pdfUrl: form.pdfUrl!.join(','),
    pdfName: form.pdfName!.join(','),
  }
}

function folderPayloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const draft = folderDraftOf(value, label)
  if (requireId && draft.id === undefined) throw new Error(`${label}.id不能为空`)
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    name: draft.name,
    pid: draft.pid || 0,
    roleList: draft.roleList ?? [],
    type: 1,
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function categoryListOf (value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('证照类型响应必须是数组')
  return value.map((item, index) => {
    const row = objectOf(item, `证照类型[${index}]`)
    return {
      ...row,
      id: idOf(row.id, `证照类型[${index}].id`),
      name: nonEmptyTextOf(row.name, `证照类型[${index}].name`, 15),
      remindTime: nullableNumberOf(row.remindTime, `证照类型[${index}].remindTime`),
      count: nullableNumberOf(row.count, `证照类型[${index}].count`),
      tipTemplateId: nullableIdOf(row.tipTemplateId, `证照类型[${index}].tipTemplateId`),
    }
  })
}

function recognitionOf (value: unknown): CertificateLicenseRecognitionResult {
  const result = objectOf(value, '证照识别响应')
  return {
    name: textOf(result.name, '证照识别响应.name'),
    startTime: textOf(result.startTime, '证照识别响应.startTime'),
    endTime: textOf(result.endTime, '证照识别响应.endTime'),
    perpetual: result.perpetual === undefined || result.perpetual === null || typeof result.perpetual === 'string' || (typeof result.perpetual === 'number' && Number.isFinite(result.perpetual)) ? (result.perpetual as string | number | null | undefined) ?? null : (() => { throw new Error('证照识别响应.perpetual必须为字符串、数字或null') })(),
  }
}

function shareMemberOf (value: unknown, label: string): CertificateLicenseShareMember {
  const member = objectOf(value, label)
  return {
    id: idOf(member.id, `${label}.id`),
    ...(member.name === undefined ? {} : { name: textOf(member.name, `${label}.name`) ?? '' }),
    ...(member.managerType === undefined ? {} : { managerType: nullableNumberOf(member.managerType, `${label}.managerType`) ?? 1 }),
  }
}

function shareOf (value: unknown): CertificateLicenseShare {
  const result = objectOf(value, '证照共享响应')
  return {
    organization: Array.isArray(result.organization) ? result.organization.map((item, index) => shareMemberOf(item, `organization[${index}]`)) : [],
    post: Array.isArray(result.post) ? result.post.map((item, index) => shareMemberOf(item, `post[${index}]`)) : [],
    duty: Array.isArray(result.duty) ? result.duty.map((item, index) => shareMemberOf(item, `duty[${index}]`)) : [],
    user: Array.isArray(result.user) ? result.user.map((item, index) => shareMemberOf(item, `user[${index}]`)) : [],
  }
}

function shareMembersOf (value: unknown, label: string, includeManagerType = false): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const member = shareMemberOf(item, `${label}[${index}]`)
    if (!includeManagerType) return { id: member.id }
    return { id: member.id, ...(member.managerType === undefined ? {} : { managerType: member.managerType }) }
  })
}

function staffFormFromRecord (record: CertificateLicenseRecord): CertificateLicenseForm {
  const remindCodes = record.remindUserCode ? record.remindUserCode.split(',').filter(Boolean) : []
  return {
    id: record.id,
    category: idOf(record.category, 'current.category'),
    pid: idOf(record.pid ?? record.parentId, 'current.pid'),
    organizationId: idOf(record.organizationId, 'current.organizationId'),
    name: record.name ?? '',
    legalName: record.legalName,
    legalCode: record.legalCode ? [{ staffCode: record.legalCode, name: record.legalName ?? '' }] : [],
    isOur: integerFlagOf(record.isOur, 'current.isOur'),
    perpetual: integerFlagOf(record.perpetual, 'current.perpetual'),
    startTime: record.startTime ?? '',
    endTime: record.endTime,
    remindUserCode: remindCodes.map((staffCode, index) => ({ staffCode, name: record.remindUserList[index] ?? '' })),
    fileUrl: record.fileUrlList,
    pdfUrl: record.pdfUrlList,
    pdfName: record.pdfNameList,
  }
}

function sharePayloadOf (input: CertificateLicenseShareInput): JsonObject {
  const resourceId = idOf(input?.resourceId, 'resourceId')
  return {
    type: 2,
    resourceId,
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

export function createCertificateLicenseCapability (request: PortalRequest) {
  return {
    async list (query: CertificateLicenseQuery = {}): Promise<CertificateLicenseTreeNode[]> {
      const result = await request({ url: `${ROOT}/tree`, method: 'get', params: { name: pageNameOf(query.name) } })
      return treeOf(result)
    },
    async get (input: { id: CertificateLicenseId }): Promise<CertificateLicenseRecord> {
      const id = idOf(input?.id, '证照ID')
      return recordOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '证照详情')
    },
    async categoryList (): Promise<Array<Record<string, unknown>>> {
      return categoryListOf(await request({ url: `${CATEGORY_ROOT}/simple-list`, method: 'get' }))
    },
    prepareCreateFolder (input: CertificateLicenseFolderDraft): CertificateLicenseFolderPreparation {
      return { draft: folderDraftOf(input, 'folder') }
    },
    async createFolder (input: { draft: CertificateLicenseFolderDraft }): Promise<CertificateLicenseId> {
      const result = await request({ url: `${ROOT}/create-file`, method: 'post', data: folderPayloadOf(input?.draft, 'folder', false), headers: { 'Content-Type': 'multipart/form-data' } })
      return idOf(result, '新建证照文件夹响应')
    },
    prepareUpdateFolder (input: { current: CertificateLicenseRecord; changes?: Partial<CertificateLicenseFolderDraft> | null }): CertificateLicenseFolderPreparation {
      const current = folderDraftOf({ id: input?.current?.id, name: input?.current?.name, pid: input?.current?.pid, roleList: input?.current?.roleIds }, 'current')
      return { draft: folderDraftOf({ ...current, ...(input?.changes ?? {}) }, 'folder'), previous: current }
    },
    async updateFolder (input: { draft: CertificateLicenseFolderDraft }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: folderPayloadOf(input?.draft, 'folder', true) }), '更新证照文件夹')
    },
    prepareCreate (input: CertificateLicenseForm): CertificateLicenseSavePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: CertificateLicenseForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/create`, method: 'post', data: savePayloadOf(input?.draft, 'draft', false) }), '创建证照')
    },
    prepareUpdate (input: { current: CertificateLicenseRecord; changes?: Partial<CertificateLicenseForm> | null }): CertificateLicenseSavePreparation {
      const current = staffFormFromRecord(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: CertificateLicenseForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: savePayloadOf(input?.draft, 'draft', true) }), '更新证照')
    },
    async remove (input: { id: CertificateLicenseId }): Promise<true> {
      const id = idOf(input?.id, '证照ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除证照')
    },
    async tipTemplate (input: { categoryId: CertificateLicenseId }): Promise<boolean> {
      const categoryId = idOf(input?.categoryId, 'categoryId')
      const result = await request({ url: `${ROOT}/isHaveTipTemplate`, method: 'get', params: { categoryId } })
      if (result === undefined || result === null) return false
      if (typeof result !== 'boolean') throw new Error('证照提示模板响应必须为布尔值')
      return result
    },
    async pictureRecognition (input: CertificateLicenseRecognition): Promise<CertificateLicenseRecognitionResult> {
      const imgUrl = urlsOf([input?.imgUrl], 'imgUrl', 1)[0]!
      const type = idOf(input?.type, 'type')
      return recognitionOf(await request({ url: `${ROOT}/pictureRecognition`, method: 'post', data: { imgUrl, type } }))
    },
    async getShare (input: { resourceId: CertificateLicenseId }): Promise<CertificateLicenseShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: 2, resourceId } }))
    },
    async saveShare (input: CertificateLicenseShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存证照共享')
    },
  }
}

export type CertificateLicenseCapability = ReturnType<typeof createCertificateLicenseCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const CERTIFICATE_LICENSE_METHODS = {
  'certificate-license-list': 'list',
  'certificate-license-get': 'get',
  'certificate-license-category-list': 'categoryList',
  'certificate-license-prepare-create-folder': 'prepareCreateFolder',
  'certificate-license-create-folder': 'createFolder',
  'certificate-license-prepare-update-folder': 'prepareUpdateFolder',
  'certificate-license-update-folder': 'updateFolder',
  'certificate-license-prepare-create': 'prepareCreate',
  'certificate-license-create': 'create',
  'certificate-license-prepare-update': 'prepareUpdate',
  'certificate-license-update': 'update',
  'certificate-license-remove': 'remove',
  'certificate-license-tip-template': 'tipTemplate',
  'certificate-license-picture-recognition': 'pictureRecognition',
  'certificate-license-get-share': 'getShare',
  'certificate-license-save-share': 'saveShare',
} as const

export const certificateLicenseCapabilities: CapabilityDefinition[] = [
  { id: 'certificate-license-list', title: '查询证照目录树', write: false, params: [p('name', 'text', false, '证照或文件夹名称筛选；默认空字符串')] },
  { id: 'certificate-license-get', title: '读取证照或文件夹详情', write: false, params: [p('id', 'number', true, '证照或文件夹 ID')] },
  { id: 'certificate-license-category-list', title: '查询可选证照类型', write: false, params: [] },
  { id: 'certificate-license-prepare-create-folder', title: '准备新建证照文件夹', write: false, params: [p('form', 'text', true, '文件夹名称、上级目录和角色授权草稿')] },
  { id: 'certificate-license-create-folder', title: '新建证照文件夹', write: true, params: [p('draft', 'text', true, 'prepareCreateFolder 返回的文件夹草稿')] },
  { id: 'certificate-license-prepare-update-folder', title: '准备编辑证照文件夹', write: false, params: [p('current', 'text', true, '最新文件夹详情'), p('changes', 'text', false, '用户明确修改的文件夹字段')] },
  { id: 'certificate-license-update-folder', title: '保存证照文件夹', write: true, params: [p('draft', 'text', true, 'prepareUpdateFolder 返回的文件夹草稿')] },
  { id: 'certificate-license-prepare-create', title: '准备新建证照', write: false, params: [p('form', 'text', true, 'Portal 证照表单草稿')] },
  { id: 'certificate-license-create', title: '新建证照', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的证照草稿')] },
  { id: 'certificate-license-prepare-update', title: '准备编辑证照', write: false, params: [p('current', 'text', true, '最新证照详情'), p('changes', 'text', false, '用户明确修改的证照字段')] },
  { id: 'certificate-license-update', title: '保存证照', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的证照草稿')] },
  { id: 'certificate-license-remove', title: '删除证照或文件夹', write: true, params: [p('id', 'number', true, '证照或文件夹 ID；文件夹必须先清空证照')] },
  { id: 'certificate-license-tip-template', title: '检查证照识别模板', write: false, params: [p('categoryId', 'number', true, '证照类型 ID')] },
  { id: 'certificate-license-picture-recognition', title: '识别证照图片', write: true, params: [p('imgUrl', 'text', true, '已上传的第一张证照图片 URL'), p('type', 'number', true, '证照类型 ID')] },
  { id: 'certificate-license-get-share', title: '读取证照共享设置', write: false, params: [p('resourceId', 'number', true, '证照 ID')] },
  { id: 'certificate-license-save-share', title: '保存证照共享设置', write: true, params: [p('resourceId', 'number', true, '证照 ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: CERTIFICATE_LICENSE_PAGE_PATH, permission: CERTIFICATE_LICENSE_PERMISSION, moduleType: CERTIFICATE_LICENSE_MODULE_TYPE, httpInstance: 'platform' }))
