import { randomUUID } from 'node:crypto'
import type { AxiosResponse } from 'axios'
import type { PortalRequestConfig } from '../http/client.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「智能助手」页面的唯一菜单路径与权限码。 */
export const CHAT_PAGE_PATH = '/dashboard/chat'
export const CHAT_PERMISSION = '/dashboard/chat'
export const CHAT_AGENT_ORCHESTRATION_DICT_TYPE = 'ai_agent_orchestration_status'
export const CHAT_AGENT_ORCHESTRATION_OPEN_LABEL = 'is_open'
export const CHAT_DEFAULT_CALL_TYPE = 2
export const CHAT_DEFAULT_HISTORY_PAGE_SIZE = 20
export const CHAT_MAX_ATTACHMENTS = 5
export const CHAT_MAX_IMAGES = 1
export const CHAT_MAX_CHECKED_SKILLS = 8

const CHAT_ROOT = '/ai/pc/chat'
const CHAT_SKILL_ORDER_ROOT = '/ai/pc/chat/skill-order'

export type ChatRequest = <T = unknown>(config: PortalRequestConfig) => Promise<T>

export type ChatSkill = Record<string, unknown> & {
  id: number | string
  name?: string | null
  icon?: string | null
  tipPromptText?: string | null
  promptText?: string | null
  prompt?: string | null
}

export type ChatAvailable = Record<string, unknown> & {
  id: number | string | null
  callType: number | null
  callTypeName: string | null
  skillIdList: Array<number | string>
  skills: ChatSkill[]
  models: Array<Record<string, unknown>>
}

export type ChatHistoryItem = Record<string, unknown> & {
  id: number | string
  question: string | null
  answer?: string | null
  contentItems?: unknown[] | null
  useful?: number | null
  fileInfo?: string | object | unknown[] | null
  createTime?: string | null
  router?: string | null
  pcRouter?: string | null
  routerParameter?: Record<string, unknown> | null
}

export type ChatSkillOrder = Record<string, unknown> & {
  skills: ChatSkill[]
  defaultSkills: ChatSkill[]
  displayCount: number
  customized: boolean
}

export type ChatAttachment = {
  /** 浏览器 File.name 对应的文件名；会作为 multipart 文件名发送。 */
  name: string
  /** 文件的 MIME 类型；未提供时按空类型发送。 */
  contentType?: string
  /** 文件内容。字符串默认按 base64 解码，避免把二进制内容当 UTF-8。 */
  data: string | Uint8Array
  /** 仅对 string data 生效；默认 base64。 */
  encoding?: 'base64' | 'utf8'
}

export type ChatStreamInput = {
  /** Portal 页面最终发送的提问文本；会先 trim。可为空，但有文件或技能时才有意义。 */
  question?: string | null
  /** 选中的技能 ID；来自 availableList.skills[].id。传入后页面规则是不发送 modelConfigId。 */
  skillId?: number | string | null
  /** 未选择技能时使用的模型配置 ID；选择技能时按 Portal 规则忽略。 */
  modelConfigId?: number | string | null
  /** 页面发送的意图及筛选上下文；有值才追加对应 multipart 字段。 */
  intent?: string | null
  categoryIds?: string | null
  moduleIds?: string | null
  imageIds?: string | null
  /** 页面通过平台字典决定的编排开关；省略时由 SDK 读取同一字典并回退 false。 */
  agentOrchestration?: boolean
  files?: ChatAttachment[]
}

export type ChatStreamData = Record<string, unknown> & {
  type?: string
  id?: number | string | null
  answer?: string | null
  contentItems?: unknown[] | null
  useful?: number | null
  router?: string | null
  pcRouter?: string | null
  routerParameter?: Record<string, unknown> | null
  agentData?: unknown
}

export type ChatStreamEvent = Record<string, unknown> & {
  ret?: string
  code?: number
  msg?: string
  errorMsg?: string
  data?: ChatStreamData
}

export type ChatStreamResponse = AxiosResponse<unknown> | { data?: AsyncIterable<Uint8Array | string> } | AsyncIterable<Uint8Array | string>

export type ChatSkillOrderDraft = {
  skillIds: Array<number | string>
}

export type ChatCapability = {
  availableList: (query?: { callType?: number }) => Promise<ChatAvailable>
  history: (query?: { pageNo?: number; pageSize?: number }) => Promise<PageResult<ChatHistoryItem>>
  stream: (input: ChatStreamInput) => AsyncGenerator<ChatStreamEvent, void, unknown>
  feedback: (input: { id: number | string; useful: 0 | 1 }) => Promise<void>
  skillOrder: () => Promise<ChatSkillOrder>
  prepareSaveSkillOrder: (input: ChatSkillOrderDraft) => ChatSkillOrderDraft
  saveSkillOrder: (input: ChatSkillOrderDraft) => Promise<boolean>
  resetSkillOrder: () => Promise<boolean>
  policyPreview: (id: number | string) => Promise<Record<string, unknown>>
}

function feedbackResultOf (value: unknown): { ret?: unknown; msg?: unknown } {
  const response = value && typeof value === 'object' ? value as { data?: unknown } : undefined
  const body = response?.data && typeof response.data === 'object' ? response.data : value
  if (!body || typeof body !== 'object') throw new Error('chat feedback响应缺少业务结果')
  return body as { ret?: unknown; msg?: unknown }
}

type AgentOrchestrationDictionary = {
  entries?: Array<{ label?: string | null; value?: string | number | null }>
}

function idOf (value: unknown, label: string): number | string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error(`${label}必须是正整数ID`)
}

function optionalIdOf (value: unknown, label: string): number | string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return idOf(value, label)
}

function appendOptional (form: FormData, key: string, value: string | null | undefined): void {
  if (value !== undefined && value !== null && value !== '') form.append(key, value)
}

function isImage (file: ChatAttachment): boolean {
  if (file.contentType?.toLowerCase().startsWith('image/')) return true
  return /\.(apng|avif|gif|jpe?g|png|webp|bmp|svg)$/i.test(file.name)
}

function assertFiles (files: ChatAttachment[]): void {
  if (files.length > CHAT_MAX_ATTACHMENTS) {
    throw new Error(`最多上传 ${CHAT_MAX_ATTACHMENTS} 个附件`)
  }
  if (files.filter(isImage).length > CHAT_MAX_IMAGES) {
    throw new Error(`最多上传 ${CHAT_MAX_IMAGES} 张图片`)
  }
  for (const file of files) {
    if (typeof file?.name !== 'string' || file.name.trim() === '') throw new Error('附件文件名必填')
    if (!(typeof file.data === 'string' || file.data instanceof Uint8Array)) throw new Error('附件data必须是base64/UTF-8字符串或Uint8Array')
  }
}

function appendFile (form: FormData, file: ChatAttachment): void {
  const content = typeof file.data === 'string'
    ? Buffer.from(file.data, file.encoding ?? 'base64')
    : file.data
  // Copy into an ArrayBuffer so the browser/Node Blob typings agree even when
  // the caller supplies a Uint8Array backed by SharedArrayBuffer.
  const buffer = new ArrayBuffer(content.byteLength)
  new Uint8Array(buffer).set(content)
  const blob = new Blob([buffer], { type: file.contentType ?? '' })
  form.append('files', blob, file.name)
}

function buildStreamForm (input: ChatStreamInput, agentOrchestration: boolean): FormData {
  const files = input.files ?? []
  assertFiles(files)

  const question = String(input.question ?? '').trim()
  const skillId = optionalIdOf(input.skillId, 'skillId')
  const modelConfigId = optionalIdOf(input.modelConfigId, 'modelConfigId')
  if (question === '' && skillId === undefined && files.length === 0) {
    throw new Error('question、skillId和files至少提供一项')
  }

  const form = new FormData()
  // 键顺序与 ChatConversation.vue 的 FormData.append 顺序一致。
  form.append('question', question)
  form.append('type', '1')
  form.append('skillId', skillId === undefined ? '' : String(skillId))
  form.append('requestId', randomUUID().replaceAll('-', ''))
  form.append('platform', 'PC')
  form.append('agentOrchestration', agentOrchestration ? 'true' : 'false')
  appendOptional(form, 'intent', input.intent)
  appendOptional(form, 'categoryIds', input.categoryIds)
  appendOptional(form, 'moduleIds', input.moduleIds)
  appendOptional(form, 'imageIds', input.imageIds)
  if (skillId === undefined && modelConfigId !== undefined) form.append('modelConfigId', String(modelConfigId))
  for (const file of files) appendFile(form, file)
  return form
}

async function* parseSse (response: ChatStreamResponse): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const stream = 'data' in (response as object) && (response as { data?: unknown }).data !== undefined
    ? (response as { data: AsyncIterable<Uint8Array | string> }).data
    : response
  if (!stream || typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function') {
    throw new Error('chatStream响应没有可读取的SSE流')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const consumeLine = async function* (line: string): AsyncGenerator<ChatStreamEvent, void, unknown> {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const json = trimmed.slice(5).trim()
    if (json === '') return
    let event: ChatStreamEvent
    try {
      event = JSON.parse(json) as ChatStreamEvent
    } catch {
      throw new Error(`chatStream返回了无法解析的SSE事件：${json.slice(0, 160)}`)
    }
    if (event.data?.type === 'heartbeat') return
    yield event
  }

  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      for await (const event of consumeLine(line)) {
        yield event
        if (
          event.data?.id !== undefined && event.data?.id !== null ||
          event.errorMsg || event.msg
        ) return
      }
    }
  }

  buffer += decoder.decode()
  if (buffer !== '') {
    for await (const event of consumeLine(buffer)) yield event
  }
}

function normalizeSkillOrderDraft (input: ChatSkillOrderDraft): ChatSkillOrderDraft {
  if (!Array.isArray(input?.skillIds) || input.skillIds.length === 0) {
    throw new Error('skillIds不能为空；恢复默认请调用resetSkillOrder')
  }
  if (input.skillIds.length > CHAT_MAX_CHECKED_SKILLS) throw new Error(`skillIds最多${CHAT_MAX_CHECKED_SKILLS}项`)
  const ids = input.skillIds.map((value) => idOf(value, 'skillIds中的技能ID'))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('skillIds不能重复')
  return { skillIds: ids }
}

/** 智能助手页面的实际请求与表单规则。 */
export function createChatCapability (
  request: ChatRequest,
  readAgentOrchestration?: () => Promise<AgentOrchestrationDictionary>,
): ChatCapability {
  const resolveAgentOrchestration = async (): Promise<boolean> => {
    if (readAgentOrchestration === undefined) return false
    try {
      const dict = await readAgentOrchestration()
      const option = dict.entries?.find((entry) => entry.label === CHAT_AGENT_ORCHESTRATION_OPEN_LABEL)
      return String(option?.value ?? '') === '1'
    } catch {
      // 页面 getPlatformDictListByType 在字典不可用时也会得到 false。
      return false
    }
  }

  return {
    async availableList (query = {}) {
      const callType = query.callType ?? CHAT_DEFAULT_CALL_TYPE
      if (!Number.isInteger(callType)) throw new Error('callType必须是整数')
      return request<ChatAvailable>({
        url: `${CHAT_ROOT}/getAvailableList`,
        method: 'get',
        params: { callType },
      })
    },

    async history (query = {}) {
      const pageNo = query.pageNo ?? 1
      const pageSize = query.pageSize ?? CHAT_DEFAULT_HISTORY_PAGE_SIZE
      if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error('pageNo必须是正整数')
      if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize必须是正整数')
      return request<PageResult<ChatHistoryItem>>({
        url: `${CHAT_ROOT}/history`,
        method: 'get',
        params: { pageNo, pageSize },
      })
    },

    async *stream (input) {
      const agentOrchestration = input.agentOrchestration ?? await resolveAgentOrchestration()
      const form = buildStreamForm(input, agentOrchestration)
      const response = await request<ChatStreamResponse>({
        url: `${CHAT_ROOT}/chatStream`,
        method: 'post',
        data: form,
        responseType: 'stream',
        sourceResponse: true,
        headers: { version: '3' },
      })
      yield* parseSse(response)
    },

    async feedback ({ id, useful }) {
      const feedbackId = idOf(id, 'feedback.id')
      if (useful !== 0 && useful !== 1) throw new Error('feedback.useful只能是0或1')
      // 明确选择Portal当前实际使用的GET兼容路径，保留c/id/useful字段语义。
      // 固定Java检出只声明POST；在网关未提供GET兼容前，该冲突仍是外部阻塞。
      const response = await request<unknown>({
        url: 'ai/updateUseful.json',
        method: 'get',
        params: { id: feedbackId, useful },
        tokenParamName: 'c',
        skipGetCacheParam: true,
        sourceResponse: true,
      })
      const result = feedbackResultOf(response)
      if (result.ret !== 'SUCCESS') {
        const message = typeof result.msg === 'string' && result.msg !== '' ? `：${result.msg}` : ''
        throw new Error(`chat feedback业务失败${message}`)
      }
    },

    skillOrder () {
      return request<ChatSkillOrder>({ url: `${CHAT_SKILL_ORDER_ROOT}/get`, method: 'get' })
    },

    prepareSaveSkillOrder (input) {
      return normalizeSkillOrderDraft(input)
    },

    async saveSkillOrder (input) {
      const draft = normalizeSkillOrderDraft(input)
      return request<boolean>({
        url: `${CHAT_SKILL_ORDER_ROOT}/save`,
        method: 'put',
        data: draft,
      })
    },

    async resetSkillOrder () {
      return request<boolean>({
        url: `${CHAT_SKILL_ORDER_ROOT}/reset`,
        method: 'put',
        data: null,
      })
    },

    async policyPreview (id) {
      const policyId = idOf(id, 'policyPreview.id')
      return request<Record<string, unknown>>({
        url: '/system/policy/get',
        method: 'get',
        params: { id: policyId },
      })
    },
  }
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const PAGE_PARAMS: ParamSpec[] = [
  p('pageNo', 'number', false, '历史页码，默认1；从1开始'),
  p('pageSize', 'number', false, `历史每页条数，默认${CHAT_DEFAULT_HISTORY_PAGE_SIZE}`),
]

export const CHAT_METHODS = {
  'chat-available-list': 'availableList',
  'chat-history': 'history',
  'chat-stream': 'stream',
  'chat-feedback': 'feedback',
  'chat-skill-order': 'skillOrder',
  'chat-prepare-save-skill-order': 'prepareSaveSkillOrder',
  'chat-save-skill-order': 'saveSkillOrder',
  'chat-reset-skill-order': 'resetSkillOrder',
  'chat-policy-preview': 'policyPreview',
} as const

const commonDefinition = (id: string, title: string, write: boolean, params: ParamSpec[]): CapabilityDefinition => ({
  id,
  title,
  pagePath: CHAT_PAGE_PATH,
  permission: CHAT_PERMISSION,
  moduleType: null,
  httpInstance: 'platform',
  write,
  params,
})

export const chatCapabilities: CapabilityDefinition[] = [
  commonDefinition('chat-available-list', '查询智能助手可用模型与技能', false, [
    p('callType', 'number', false, `调用类型；页面固定使用${CHAT_DEFAULT_CALL_TYPE}，省略时SDK补齐`),
  ]),
  commonDefinition('chat-history', '查询智能助手历史对话', false, PAGE_PARAMS),
  commonDefinition('chat-stream', '发送智能助手问题并读取SSE回答流', true, [
    p('question', 'text', false, '最终发送的问题文本；会trim；与skillId/files至少提供一项'),
    p('skillId', 'number', false, '技能ID，来自chat-available-list.skills[].id；传入后忽略modelConfigId'),
    p('modelConfigId', 'number', false, '未选择技能时的模型配置ID；页面规则是仅无skillId时发送'),
    p('intent', 'text', false, '可选意图字符串'),
    p('categoryIds', 'text', false, '可选分类ID字符串，按页面原值发送'),
    p('moduleIds', 'text', false, '可选模块ID字符串，按页面原值发送'),
    p('imageIds', 'text', false, '可选图片ID字符串，按页面原值发送'),
    p('agentOrchestration', 'boolean', false, '编排开关；省略时从平台字典ai_agent_orchestration_status的is_open读取'),
    p('files', 'text', false, `附件数组；SDK按页面限制最多${CHAT_MAX_ATTACHMENTS}个且最多${CHAT_MAX_IMAGES}张图片，元素为{name,data,contentType?,encoding?}`),
  ]),
  commonDefinition('chat-feedback', '提交智能助手回答有用性评价', true, [
    p('id', 'number', true, '历史回答记录ID，来自chat-history或chat-stream事件.data.id'),
    p('useful', 'enum', true, '评价值：1有用、0无用；页面将1/0映射为点赞/点踩',),
  ]),
  commonDefinition('chat-skill-order', '查询当前用户智能助手技能顺序', false, []),
  commonDefinition('chat-prepare-save-skill-order', '准备保存智能助手技能顺序', false, [
    p('skillIds', 'text', true, `按展示顺序排列的技能ID数组；不能为空、不能重复，最多${CHAT_MAX_CHECKED_SKILLS}项；恢复默认调用reset`),
  ]),
  commonDefinition('chat-save-skill-order', '保存当前用户智能助手技能顺序', true, [
    p('skillIds', 'text', true, '按展示顺序排列的技能ID数组；必须来自当前可用技能且不能为空'),
  ]),
  commonDefinition('chat-reset-skill-order', '恢复当前用户智能助手默认技能顺序', true, []),
  commonDefinition('chat-policy-preview', '读取智能助手卡片引用的制度文件', false, [
    p('id', 'number', true, '制度文件ID，来自智能助手回答动作参数'),
  ]),
]
