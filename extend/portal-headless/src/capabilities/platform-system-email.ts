import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「平台设置 → 邮件短信」；列表与所有动作使用 platform-mall-admin.js。 */
export const PLATFORM_SYSTEM_EMAIL_PAGE_PATH = '/dashboard/platform/system/email/list'
export const PLATFORM_SYSTEM_EMAIL_PERMISSION = '/dashboard/platform-v2/system/email'
export const PLATFORM_SYSTEM_EMAIL_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/mailSms'

export type PlatformSystemEmailId = string | number

export type PlatformSystemEmailTemplate = Record<string, unknown> & {
  name?: string | null
  project?: string | null
  active?: number | null
  title?: string | null
  content?: string | null
  count?: string | null
  time?: string | null
  isChoose?: number | null
  type?: string | null
}

export type PlatformSystemEmailRow = {
  project: string
  action: string
  mail: PlatformSystemEmailTemplate | null
  sms: PlatformSystemEmailTemplate | null
  msgPush: PlatformSystemEmailTemplate | null
  smsSetting: PlatformSystemEmailTemplate | null
}

export type PlatformSystemEmailChannelRow = PlatformSystemEmailRow

export type PlatformSystemEmailAccount = Record<string, unknown> & {
  smtpPassword?: string | null
  smtpPort?: string | null
  smtpServer?: string | null
  smtpUserName?: string | null
  userMail?: string | null
}

export type PlatformSystemEmailTemplateDetail = Record<string, unknown> & {
  content: string | null
  title: string | null
  action: string
  type: string
  varMap: string | null
  isEnable: number
  label: string | null
}

export type PlatformSystemEmailTemplateForm = PlatformSystemEmailTemplateDetail & {
  [key: string]: unknown
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string, required = false): string {
  if (typeof value !== 'string' || (required && value.length === 0)) throw new Error(`${label}必须${required ? '为非空' : '为'}字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function optionalNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function channelOf (value: unknown, label: string): PlatformSystemEmailTemplate | null {
  if (value === undefined || value === null) return null
  const channel = objectOf(value, label)
  return {
    ...channel,
    ...(channel.name === undefined ? {} : { name: nullableTextOf(channel.name, `${label}.name`) }),
    ...(channel.project === undefined ? {} : { project: nullableTextOf(channel.project, `${label}.project`) }),
    ...(channel.active === undefined ? {} : { active: optionalNumberOf(channel.active, `${label}.active`) }),
    ...(channel.title === undefined ? {} : { title: nullableTextOf(channel.title, `${label}.title`) }),
    ...(channel.content === undefined ? {} : { content: nullableTextOf(channel.content, `${label}.content`) }),
    ...(channel.count === undefined ? {} : { count: nullableTextOf(channel.count, `${label}.count`) }),
    ...(channel.time === undefined ? {} : { time: nullableTextOf(channel.time, `${label}.time`) }),
    ...(channel.isChoose === undefined ? {} : { isChoose: optionalNumberOf(channel.isChoose, `${label}.isChoose`) }),
    ...(channel.type === undefined ? {} : { type: nullableTextOf(channel.type, `${label}.type`) }),
  }
}

function rowOf (value: unknown, index: number): PlatformSystemEmailRow {
  const row = objectOf(value, `邮件短信列表[${index}]`)
  return {
    project: textOf(row.project, `邮件短信列表[${index}].project`),
    action: textOf(row.action, `邮件短信列表[${index}].action`),
    mail: channelOf(row.mail, `邮件短信列表[${index}].mail`),
    sms: channelOf(row.sms, `邮件短信列表[${index}].sms`),
    msgPush: channelOf(row.msgPush, `邮件短信列表[${index}].msgPush`),
    smsSetting: channelOf(row.smsSetting, `邮件短信列表[${index}].smsSetting`),
  }
}

function rowsOf (value: unknown): PlatformSystemEmailRow[] {
  if (!Array.isArray(value)) throw new Error('邮件短信列表响应必须是数组')
  return value.map(rowOf)
}

function setAccountPayloadOf (rows: PlatformSystemEmailChannelRow[]): { list: Array<{ multiType: string; tmplAction: string }> } {
  if (!Array.isArray(rows)) throw new Error('邮件短信配置rows必须是数组')
  const list: Array<{ multiType: string; tmplAction: string }> = []
  rows.forEach((row, index) => {
    const value = objectOf(row, `邮件短信配置rows[${index}]`)
    const action = textOf(value.action, `邮件短信配置rows[${index}].action`, true)
    const types: string[] = []
    for (const key of ['mail', 'sms', 'msgPush'] as const) {
      const channel = value[key]
      if (channel !== null && channel !== undefined) {
        const channelObject = objectOf(channel, `邮件短信配置rows[${index}].${key}`)
        if (channelObject.isChoose === 1) types.push(textOf(channelObject.type, `邮件短信配置rows[${index}].${key}.type`, true))
      }
    }
    // Exact compact() behavior: rows with no selected channel are omitted.
    if (types.length > 0) list.push({ multiType: types.join(','), tmplAction: action })
  })
  return { list }
}

function templateDetailOf (value: unknown): PlatformSystemEmailTemplateDetail {
  const detail = objectOf(value, '邮件短信模板详情')
  const isEnable = optionalNumberOf(detail.isEnable, '模板是否可用')
  if (isEnable === null) throw new Error('模板是否可用必须为整数')
  return {
    ...detail,
    content: nullableTextOf(detail.content, '模板内容'),
    title: nullableTextOf(detail.title, '模板标题'),
    action: textOf(detail.action, '模板动作', true),
    type: textOf(detail.type, '模板类型', true),
    varMap: nullableTextOf(detail.varMap, '模板变量标签'),
    isEnable,
    label: nullableTextOf(detail.label, '模板名称'),
  }
}

function templateUpdatePayloadOf (input: PlatformSystemEmailTemplateForm): JsonObject {
  const form = objectOf(input, '邮件短信模板表单')
  const title = textOf(form.title, '模板标题', true)
  const content = textOf(form.content, '模板内容', true)
  const action = textOf(form.action, '模板动作', true)
  const type = textOf(form.type, '模板类型', true)
  const isEnable = optionalNumberOf(form.isEnable, '模板是否可用')
  if (isEnable === null) throw new Error('模板是否可用必须为整数')
  const payload: JsonObject = { ...form, title, content, action, type, isEnable }
  delete payload.varMap
  return payload
}

function accountOf (value: unknown): PlatformSystemEmailAccount {
  const account = objectOf(value, '邮件账号设置')
  for (const key of ['smtpPassword', 'smtpPort', 'smtpServer', 'smtpUserName', 'userMail']) {
    if (account[key] !== undefined && account[key] !== null) textOf(account[key], `邮件账号设置.${key}`)
  }
  return { ...account } as PlatformSystemEmailAccount
}

function accountPayloadOf (input: PlatformSystemEmailAccount): JsonObject {
  return { ...objectOf(input, '邮件账号设置表单') }
}

export function buildPlatformSystemEmailSetAccountPayload (rows: PlatformSystemEmailChannelRow[]): { list: Array<{ multiType: string; tmplAction: string }> } {
  return setAccountPayloadOf(rows)
}

export function buildPlatformSystemEmailTemplatePayload (input: PlatformSystemEmailTemplateForm): JsonObject {
  return templateUpdatePayloadOf(input)
}

export function createPlatformSystemEmailCapability (request: PortalRequest) {
  return {
    async list (): Promise<PlatformSystemEmailRow[]> {
      return rowsOf(await request<unknown>({ url: `${ROOT}/list`, method: 'get', params: { order: '', orderField: '' } }))
    },

    prepareSetAccount (input: { rows: PlatformSystemEmailChannelRow[] }): { payload: { list: Array<{ multiType: string; tmplAction: string }> } } {
      return { payload: setAccountPayloadOf(input.rows) }
    },

    async setAccount (input: { rows: PlatformSystemEmailChannelRow[] }): Promise<void> {
      await request({ url: `${ROOT}/setAccount`, method: 'put', data: setAccountPayloadOf(input.rows) })
    },

    async maintainTemplate (): Promise<void> {
      await request({ url: `${ROOT}/maintainTemplate`, method: 'get' })
    },

    async getSmsSignature (input: { smsSign?: string } = {}): Promise<string> {
      const config = input.smsSign === undefined
        ? { url: `${ROOT}/smsSignSet/get`, method: 'get' as const }
        : { url: `${ROOT}/smsSignSet/get`, method: 'get' as const, params: { smsSign: input.smsSign } }
      return textOf(await request<unknown>(config), '短信签名响应', true)
    },

    prepareSaveSmsSignature (input: { smsSign: string }): { payload: string } {
      return { payload: textOf(input.smsSign, '短信签名', true) }
    },

    async saveSmsSignature (input: { smsSign: string }): Promise<void> {
      await request({ url: `${ROOT}/smsSignSet/save`, method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: textOf(input.smsSign, '短信签名', true) })
    },

    async getEmailAccount (): Promise<PlatformSystemEmailAccount> {
      return accountOf(await request<unknown>({ url: `${ROOT}/mailAccountSet/get`, method: 'get' }))
    },

    prepareSaveEmailAccount (input: { account: PlatformSystemEmailAccount }): { payload: JsonObject } {
      return { payload: accountPayloadOf(input.account) }
    },

    async saveEmailAccount (input: { account: PlatformSystemEmailAccount }): Promise<void> {
      await request({ url: `${ROOT}/mailAccountSet/save`, method: 'post', data: accountPayloadOf(input.account) })
    },

    async getTemplate (input: { action: string; type: string }): Promise<PlatformSystemEmailTemplateDetail> {
      const action = textOf(input.action, '模板动作', true)
      const type = textOf(input.type, '模板类型', true)
      return templateDetailOf(await request<unknown>({ url: `${ROOT}/getTmplInfo`, method: 'get', params: { act: action, type } }))
    },

    prepareUpdateTemplate (input: { form: PlatformSystemEmailTemplateForm }): { payload: JsonObject } {
      return { payload: templateUpdatePayloadOf(input.form) }
    },

    async updateTemplate (input: { form: PlatformSystemEmailTemplateForm }): Promise<void> {
      await request({ url: `${ROOT}/editTemplate`, method: 'post', data: templateUpdatePayloadOf(input.form) })
    },
  }
}

export type PlatformSystemEmailCapability = ReturnType<typeof createPlatformSystemEmailCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const rowsParam = p('rows', 'text', true, '列表当前行数组；SDK按页面顺序压缩选中的mail/sms/msgPush类型')
const accountParam = p('account', 'text', true, '邮件账号设置对象；页面不设置额外必填校验')
const templateFormParam = p('form', 'text', true, '模板详情回显后的表单；标题和内容必填，varMap只读不提交')

export const PLATFORM_SYSTEM_EMAIL_METHODS = {
  'platform-system-email-list': 'list',
  'platform-system-email-prepare-set-account': 'prepareSetAccount',
  'platform-system-email-set-account': 'setAccount',
  'platform-system-email-maintain-template': 'maintainTemplate',
  'platform-system-email-get-sms-signature': 'getSmsSignature',
  'platform-system-email-prepare-save-sms-signature': 'prepareSaveSmsSignature',
  'platform-system-email-save-sms-signature': 'saveSmsSignature',
  'platform-system-email-get-email-account': 'getEmailAccount',
  'platform-system-email-prepare-save-email-account': 'prepareSaveEmailAccount',
  'platform-system-email-save-email-account': 'saveEmailAccount',
  'platform-system-email-get-template': 'getTemplate',
  'platform-system-email-prepare-update-template': 'prepareUpdateTemplate',
  'platform-system-email-update-template': 'updateTemplate',
} as const

export const platformSystemEmailCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-email-list', title: '查询邮件短信配置', write: false, params: [] },
  { id: 'platform-system-email-prepare-set-account', title: '准备保存邮件短信渠道选择', write: false, params: [rowsParam] },
  { id: 'platform-system-email-set-account', title: '保存邮件短信渠道选择', write: true, params: [rowsParam] },
  { id: 'platform-system-email-maintain-template', title: '初始化邮件短信模板', write: true, params: [] },
  { id: 'platform-system-email-get-sms-signature', title: '读取短信签名', write: false, params: [p('smsSign', 'text', false, '列表预览时页面传空字符串；设置页读取时省略')] },
  { id: 'platform-system-email-prepare-save-sms-signature', title: '准备保存短信签名', write: false, params: [p('smsSign', 'text', true, '短信签名；页面必填')] },
  { id: 'platform-system-email-save-sms-signature', title: '保存短信签名', write: true, params: [p('smsSign', 'text', true, '短信签名；页面必填')] },
  { id: 'platform-system-email-get-email-account', title: '读取邮件账号设置', write: false, params: [] },
  { id: 'platform-system-email-prepare-save-email-account', title: '准备保存邮件账号设置', write: false, params: [accountParam] },
  { id: 'platform-system-email-save-email-account', title: '保存邮件账号设置', write: true, params: [accountParam] },
  { id: 'platform-system-email-get-template', title: '读取邮件短信模板', write: false, params: [p('action', 'text', true, '模板动作，来自列表行 action'), p('type', 'enum', true, 'email、sms或app')] },
  { id: 'platform-system-email-prepare-update-template', title: '准备编辑邮件短信模板', write: false, params: [templateFormParam] },
  { id: 'platform-system-email-update-template', title: '编辑邮件短信模板', write: true, params: [templateFormParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_EMAIL_PAGE_PATH,
  permission: PLATFORM_SYSTEM_EMAIL_PERMISSION,
  moduleType: PLATFORM_SYSTEM_EMAIL_MODULE_TYPE,
  httpInstance: 'platform',
}))
