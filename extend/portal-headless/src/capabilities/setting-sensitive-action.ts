import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 安全验证」页面实际消费的设置和写入动作。 */
export const SETTING_SENSITIVE_ACTION_PAGE_PATH = '/dashboard/setting/sensitive-action/list'
export const SETTING_SENSITIVE_ACTION_PERMISSION = '/dashboard/setting/sensitive-action'
/** 该路径不命中 Portal 的 getCurrentModuleType 规则，浏览器不发送 module-type。 */
export const SETTING_SENSITIVE_ACTION_MODULE_TYPE = null

const INFO_URL = '/org/sensitive/info'
const SAVE_URL = '/org/sensitive'
const SMS_SEND_URL = '/sys/sms/send'
const SMS_CHECK_URL = '/sys/sms/checkSms'
const SMS_TEMPLATE_ID = '17709'

export type SettingSensitiveActionId = string | number
export type SettingSensitiveActionFlag = 0 | 1
export type SettingSensitiveActionVerificationReason =
  | 'none'
  | 'disable-protection'
  | 'change-phone'
  | 'disable-protection-and-change-phone'

export type SettingSensitiveActionSettings = Record<string, unknown> & {
  id: SettingSensitiveActionId
  mobile: string | null
  isDel: SettingSensitiveActionFlag
}

export type SettingSensitiveActionChanges = {
  isDel?: SettingSensitiveActionFlag
  /** 只接受 Portal change-phone.vue 的新手机号输入。 */
  mobile?: string
}

export type SettingSensitiveActionDraft = {
  id: SettingSensitiveActionId
  isDel: SettingSensitiveActionFlag
  mobile: string | null
}

export type SettingSensitiveActionVerification = {
  requestId: string
  code: string
}

export type SettingSensitiveActionPreparation = {
  draft: SettingSensitiveActionDraft
  previous: SettingSensitiveActionSettings
  verificationRequired: boolean
  phone: string | null
  verificationReason: SettingSensitiveActionVerificationReason
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingSensitiveActionId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function flagOf (value: unknown, label: string): SettingSensitiveActionFlag {
  if (value === 0 || value === 1) return value
  throw new Error(`${label}必须为数值0或1`)
}

function settingsOf (value: unknown, label: string): SettingSensitiveActionSettings {
  const settings = objectOf(value, label)
  return {
    ...settings,
    id: idOf(settings.id, `${label}.id`),
    mobile: nullableTextOf(settings.mobile, `${label}.mobile`),
    isDel: flagOf(settings.isDel, `${label}.isDel`),
  }
}

function changesOf (value: unknown): { changes: SettingSensitiveActionChanges; hasMobileChange: boolean; hasIsDelChange: boolean } {
  if (value === undefined || value === null) return { changes: {}, hasMobileChange: false, hasIsDelChange: false }
  const changes = objectOf(value, '安全验证表单变更')
  for (const key of Object.keys(changes)) {
    if (key !== 'isDel' && key !== 'mobile') throw new Error(`安全验证表单不支持字段${key}`)
  }

  const hasMobileChange = Object.prototype.hasOwnProperty.call(changes, 'mobile')
  const hasIsDelChange = Object.prototype.hasOwnProperty.call(changes, 'isDel')
  return {
    changes: {
      ...(hasIsDelChange ? { isDel: flagOf(changes.isDel, '安全验证表单.isDel') } : {}),
      ...(hasMobileChange
        ? { mobile: validateNewPhone(changes.mobile) }
        : {}),
    },
    hasMobileChange,
    hasIsDelChange,
  }
}

function validateNewPhone (value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('修改后手机号不能为空')
  if (!/^1[3456789]\d{9}$/.test(value)) throw new Error('请输入正确的手机号码')
  return value
}

function draftOf (value: unknown, label: string): SettingSensitiveActionDraft {
  const draft = objectOf(value, label)
  return {
    id: idOf(draft.id, `${label}.id`),
    isDel: flagOf(draft.isDel, `${label}.isDel`),
    mobile: nullableTextOf(draft.mobile, `${label}.mobile`),
  }
}

function verificationOf (value: unknown): SettingSensitiveActionVerification {
  const verification = objectOf(value, '短信验证输入')
  const requestId = typeof verification.requestId === 'string' ? verification.requestId.trim() : ''
  const code = typeof verification.code === 'string' ? verification.code.trim() : ''
  if (!requestId) throw new Error('短信requestId不能为空')
  if (!code) throw new Error('短信验证码不能为空')
  return { requestId, code }
}

function reasonOf (disableProtection: boolean, changePhone: boolean): SettingSensitiveActionVerificationReason {
  if (disableProtection && changePhone) return 'disable-protection-and-change-phone'
  if (disableProtection) return 'disable-protection'
  if (changePhone) return 'change-phone'
  return 'none'
}

function preparationOf (value: unknown): SettingSensitiveActionPreparation {
  const preparation = objectOf(value, '安全验证保存准备结果')
  const previous = settingsOf(preparation.previous, '安全验证保存准备结果.previous')
  const draft = draftOf(preparation.draft, '安全验证保存准备结果.draft')
  if (typeof preparation.verificationRequired !== 'boolean') throw new Error('安全验证保存准备结果.verificationRequired必须为布尔值')
  if (preparation.phone !== null && typeof preparation.phone !== 'string') throw new Error('安全验证保存准备结果.phone必须为字符串或null')
  const reason = preparation.verificationReason
  if (reason !== 'none' && reason !== 'disable-protection' && reason !== 'change-phone' && reason !== 'disable-protection-and-change-phone') {
    throw new Error('安全验证保存准备结果.verificationReason无效')
  }
  if (preparation.verificationRequired !== (reason !== 'none')) throw new Error('安全验证保存准备结果的验证标记不一致')
  if (preparation.phone !== previous.mobile) throw new Error('安全验证保存准备结果.phone必须来自当前配置手机号')
  return { draft, previous, verificationRequired: preparation.verificationRequired, phone: preparation.phone, verificationReason: reason }
}

async function verifySms (request: PortalRequest, verification: SettingSensitiveActionVerification): Promise<true> {
  const result = objectOf(await request<unknown>({
    url: SMS_CHECK_URL,
    method: 'get',
    params: { code: verification.code, requestId: verification.requestId },
    sourceResponse: true,
  }), '短信校验响应')
  if (result.ret !== 'SUCCESS') {
    throw new Error(typeof result.msg === 'string' && result.msg ? result.msg : '短信验证码校验失败')
  }
  return true
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must be bound to SETTING_SENSITIVE_ACTION_PAGE_PATH. */
export function createSettingSensitiveActionCapability (request: PortalRequest) {
  return {
    async get (): Promise<SettingSensitiveActionSettings> {
      return settingsOf(await request({ url: INFO_URL, method: 'get' }), '安全验证配置')
    },

    prepareSave (input: { current: SettingSensitiveActionSettings; changes?: SettingSensitiveActionChanges | null }): SettingSensitiveActionPreparation {
      const current = settingsOf(input?.current, '安全验证当前配置')
      const { changes, hasMobileChange, hasIsDelChange } = changesOf(input?.changes)
      const draft: SettingSensitiveActionDraft = {
        id: current.id,
        isDel: changes.isDel ?? current.isDel,
        mobile: hasMobileChange ? changes.mobile! : current.mobile,
      }
      // Portal's useSensitiveAction is invoked by the "关闭保护" radio and by the
      // "修改" phone action. The latter is an intent, so an explicitly supplied
      // mobile field requires verification even when the new value equals the old one.
      const disableProtection = current.isDel !== 1 && hasIsDelChange && draft.isDel === 1
      const changePhone = current.isDel !== 1 && hasMobileChange
      const verificationReason = reasonOf(disableProtection, changePhone)
      return {
        draft,
        previous: current,
        verificationRequired: verificationReason !== 'none',
        phone: current.mobile,
        verificationReason,
      }
    },

    async sendVerificationCode (input: { preparation: SettingSensitiveActionPreparation }): Promise<{ requestId: string }> {
      const preparation = preparationOf(input?.preparation)
      if (!preparation.verificationRequired) throw new Error('当前保存不需要短信验证，请直接save')
      if (!preparation.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = objectOf(await request<unknown>({
        url: SMS_SEND_URL,
        method: 'get',
        params: { phone: preparation.phone, templateId: SMS_TEMPLATE_ID },
      }), '短信发送响应')
      if (sent.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) {
        throw new Error('短信发送响应缺少requestId；发送结果不确定，不自动重发')
      }
      return { requestId: String(sent.requestId) }
    },

    async save (input: { preparation: SettingSensitiveActionPreparation; verification?: SettingSensitiveActionVerification }): Promise<true> {
      const preparation = preparationOf(input?.preparation)
      if (preparation.verificationRequired) {
        if (!input?.verification) throw new Error('安全验证保存需要短信验证：先sendVerificationCode，再提供requestId和用户收到的code')
        await verifySms(request, verificationOf(input.verification))
      }
      return trueAfterRequest(request({
        url: SAVE_URL,
        method: 'put',
        data: {
          id: preparation.draft.id,
          isDel: preparation.draft.isDel,
          mobile: preparation.draft.mobile,
        },
      }))
    },
  }
}

export type SettingSensitiveActionCapability = ReturnType<typeof createSettingSensitiveActionCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_SENSITIVE_ACTION_METHODS = {
  'setting-sensitive-action-get': 'get',
  'setting-sensitive-action-prepare-save': 'prepareSave',
  'setting-sensitive-action-send-verification-code': 'sendVerificationCode',
  'setting-sensitive-action-save': 'save',
} as const

export const settingSensitiveActionCapabilities: CapabilityDefinition[] = [
  { id: 'setting-sensitive-action-get', title: '查询安全验证配置', write: false, params: [] },
  { id: 'setting-sensitive-action-prepare-save', title: '准备保存安全验证配置', write: false, params: [p('current', 'text', true, 'get返回的当前配置'), p('changes', 'text', false, '用户在页面上修改的isDel或手机号')] },
  { id: 'setting-sensitive-action-send-verification-code', title: '发送安全验证短信验证码', write: true, params: [p('preparation', 'text', true, 'prepareSave返回且verificationRequired=true的准备结果')] },
  { id: 'setting-sensitive-action-save', title: '保存安全验证配置', write: true, params: [p('preparation', 'text', true, 'prepareSave返回的完整准备结果'), p('verification', 'text', false, '需要保护时由收件人提供本次requestId和验证码')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_SENSITIVE_ACTION_PAGE_PATH,
  permission: SETTING_SENSITIVE_ACTION_PERMISSION,
  moduleType: SETTING_SENSITIVE_ACTION_MODULE_TYPE,
  httpInstance: 'platform',
}))
