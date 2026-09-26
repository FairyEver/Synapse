import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「风险防控 → 证照类型」列表和表单。 */
export const CERTIFICATE_TYPE_PAGE_PATH = '/dashboard/certificate/type/list'
export const CERTIFICATE_TYPE_PERMISSION = '/dashboard/certificate/type'
export const CERTIFICATE_TYPE_MODULE_TYPE = 15

const ROOT = '/admin-api/system/license-category'
const TEMPLATE_ROOT = '/admin-api/sys/tip-template'

export type CertificateTypeId = string | number

export type CertificateTypeQuery = {
  name?: string | null
}

export type CertificateTypeRow = Record<string, unknown> & {
  id: CertificateTypeId
  name: string | null
  remindTime: number | null
  count: number | null
  tipTemplateId: CertificateTypeId | null
}

export type CertificateTypeForm = {
  id?: CertificateTypeId
  name: string
  remindTime: number
  tipTemplateId: CertificateTypeId | null
}

export type CertificateTypePreparation = {
  draft: CertificateTypeForm
  previous?: CertificateTypeForm
}

export type CertificateTypeTemplate = Record<string, unknown> & {
  id: CertificateTypeId
  name: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): CertificateTypeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): CertificateTypeId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  const text = value.trim()
  if (text.length === 0) throw new Error(`${label}不能为空或全为空格`)
  if (text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function requiredNumberOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负整数`)
  return value
}

function rowOf (value: unknown, label: string): CertificateTypeRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: row.name === undefined || row.name === null ? null : requiredTextOf(row.name, `${label}.name`, 15),
    remindTime: nullableNumberOf(row.remindTime, `${label}.remindTime`),
    count: nullableNumberOf(row.count, `${label}.count`),
    tipTemplateId: nullableIdOf(row.tipTemplateId, `${label}.tipTemplateId`),
  }
}

function listOf (value: unknown, label: string): CertificateTypeRow[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => rowOf(item, `${label}[${index}]`))
}

function templateOf (value: unknown, label: string): CertificateTypeTemplate {
  const row = objectOf(value, label)
  return { ...row, id: idOf(row.id, `${label}.id`), name: requiredTextOf(row.name, `${label}.name`, 100) }
}

function templatesOf (value: unknown): CertificateTypeTemplate[] {
  if (!Array.isArray(value)) throw new Error('证照提示词模板响应必须是数组')
  return value.map((item, index) => templateOf(item, `证照提示词模板[${index}]`))
}

function formOf (value: unknown, label: string, requireId = false): CertificateTypeForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  return {
    ...(id === undefined ? {} : { id }),
    name: requiredTextOf(input.name, `${label}.name`, 15),
    remindTime: requiredNumberOf(input.remindTime, `${label}.remindTime`),
    tipTemplateId: nullableIdOf(input.tipTemplateId, `${label}.tipTemplateId`),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    name: form.name,
    remindTime: form.remindTime,
    tipTemplateId: form.tipTemplateId,
  }
}

function formFromRow (row: CertificateTypeRow): CertificateTypeForm {
  return formOf({ id: row.id, name: row.name, remindTime: row.remindTime, tipTemplateId: row.tipTemplateId }, 'current', true)
}

export function createCertificateTypeCapability (request: PortalRequest) {
  return {
    async list (query: CertificateTypeQuery = {}): Promise<CertificateTypeRow[]> {
      return listOf(await request({ url: `${ROOT}/page`, method: 'get', params: { name: query.name ?? '' } }), '证照类型列表响应')
    },
    async get (input: { id: CertificateTypeId }): Promise<CertificateTypeRow> {
      const id = idOf(input?.id, '证照类型ID')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '证照类型详情')
    },
    async tipTemplates (): Promise<CertificateTypeTemplate[]> {
      return templatesOf(await request({ url: `${TEMPLATE_ROOT}/list`, method: 'get', params: { useType: 'license' } }))
    },
    prepareCreate (input: CertificateTypeForm): CertificateTypePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: CertificateTypeForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '创建证照类型')
    },
    prepareUpdate (input: { current: CertificateTypeRow | CertificateTypeForm; changes?: Partial<CertificateTypeForm> | null }): CertificateTypePreparation {
      const previous = formFromRow(input?.current as CertificateTypeRow)
      return { draft: formOf({ ...previous, ...(input?.changes ?? {}) }, 'draft', true), previous }
    },
    async update (input: { draft: CertificateTypeForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新证照类型')
    },
    async remove (input: { id: CertificateTypeId }): Promise<true> {
      const id = idOf(input?.id, '证照类型ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除证照类型')
    },
  }
}

export type CertificateTypeCapability = ReturnType<typeof createCertificateTypeCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const CERTIFICATE_TYPE_METHODS = {
  'certificate-type-list': 'list',
  'certificate-type-get': 'get',
  'certificate-type-tip-templates': 'tipTemplates',
  'certificate-type-prepare-create': 'prepareCreate',
  'certificate-type-create': 'create',
  'certificate-type-prepare-update': 'prepareUpdate',
  'certificate-type-update': 'update',
  'certificate-type-remove': 'remove',
} as const

export const certificateTypeCapabilities: CapabilityDefinition[] = [
  { id: 'certificate-type-list', title: '查询证照类型', write: false, params: [p('name', 'text', false, '类型名称筛选；省略时发送空字符串')] },
  { id: 'certificate-type-get', title: '读取证照类型', write: false, params: [p('id', 'number', true, '证照类型 ID')] },
  { id: 'certificate-type-tip-templates', title: '查询证照提示词模板', write: false, params: [] },
  { id: 'certificate-type-prepare-create', title: '准备新建证照类型', write: false, params: [p('form', 'text', true, '类型名称、提醒月数和可选提示词模板')] },
  { id: 'certificate-type-create', title: '新建证照类型', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的证照类型草稿')] },
  { id: 'certificate-type-prepare-update', title: '准备编辑证照类型', write: false, params: [p('current', 'text', true, '最新证照类型详情'), p('changes', 'text', false, '用户明确修改的字段')] },
  { id: 'certificate-type-update', title: '保存证照类型', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的证照类型草稿')] },
  { id: 'certificate-type-remove', title: '删除证照类型', write: true, params: [p('id', 'number', true, '证照类型 ID；仍被证照使用时后端拒绝')] },
].map(definition => ({ ...definition, pagePath: CERTIFICATE_TYPE_PAGE_PATH, permission: CERTIFICATE_TYPE_PERMISSION, moduleType: CERTIFICATE_TYPE_MODULE_TYPE, httpInstance: 'platform' }))
