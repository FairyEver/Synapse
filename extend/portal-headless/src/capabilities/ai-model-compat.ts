/** Compatibility with AiTokenQuotaApplyStatusEnum and rule SaveReqVO at dcb3f360194.
 * No dependency on the separately developed ai-model capability module.
 */
type Id = number | string
export const AI_MODEL_APPLY_STATUS = { pending: 0, rejected: 3, handled: 4 } as const
export type AiModelApplyStatus = typeof AI_MODEL_APPLY_STATUS[keyof typeof AI_MODEL_APPLY_STATUS]

type ApplyIdentity = { id: Id; status?: number }
type HandleOptions = { rejectReason?: string }
type RuleTarget = {
  modelId: Id
  ruleScope: number
  targetTenantId?: Id
  targetTenantName?: string
  targetUserPhone?: string
  targetUserName?: string
  targetUserTypeName?: string
  startTime: string
  endTime?: string
  reason?: string
}
type QuotaDraft = RuleTarget & { totalQuota: number | string; resetCycle: number; shortageStrategy: number }
type FlowDraft = RuleTarget & { tokenLimitPerMinute: number | string; maxTokenPerRequest: number | string; exceedStrategy: number }

/** Only the existing methods needed by the adapter; all other methods are preserved. */
export type AiModelCompatibilityClient = {
  listApplyRecords(query?: { status?: number }): Promise<unknown>
  handleApply(apply: { id: Id }, status: number, options?: HandleOptions): Promise<unknown>
  saveQuotaRule(draft: QuotaDraft): Promise<unknown>
  saveFlowRule(draft: FlowDraft): Promise<unknown>
}

export type AiModelFillApplyInput = {
  apply: ApplyIdentity & {
    modelId: Id
    tenantId?: Id | null
    tenantName?: string
    userId?: Id
    userPhone?: string | null
    userName?: string
    expectedMonthlyQuota?: number | string
    expectedMaxToken?: number | string
    reason?: string
  }
  form?: {
    /** Explicit selection from searchUsers().list[].phone when the application lacks it. */
    targetUserPhone?: string
    targetUserName?: string
    targetUserTypeName?: string
    totalQuota?: number | string
    resetCycle?: number
    shortageStrategy?: number
    tokenLimitPerMinute?: number | string
    maxTokenPerRequest?: number | string
    exceedStrategy?: number
    startTime?: string
    endTime?: string
    reason?: string
  }
  skipApplyStatus?: boolean
}

export type AiModelFillReceipt = {
  createdRuleId: Id
  applyHandled: boolean | null
  warnings: string[]
}

export type AiModelCompatibilityMethods<T extends AiModelCompatibilityClient> = {
  listApplyRecords(query?: Parameters<T['listApplyRecords']>[0]): ReturnType<T['listApplyRecords']>
  prepareHandleApply(apply: ApplyIdentity, status: number, options?: HandleOptions): {
    payload: { id: Id; status: AiModelApplyStatus; statisticsDimension: number; rejectReason?: string }
    previousStatus: number | undefined
  }
  handleApply(apply: { id: Id }, status: number, options?: HandleOptions): Promise<unknown>
  cancelHandledApply(applyId: Id, previousStatus: number): Promise<unknown>
  fillApplyWithQuotaRule(input: AiModelFillApplyInput): Promise<AiModelFillReceipt>
  fillApplyWithFlowRule(input: AiModelFillApplyInput): Promise<AiModelFillReceipt>
}

/** Removes old method overloads, so phone-based fill inputs are accepted by typed callers. */
export type CompatibleAiModel<T extends AiModelCompatibilityClient> = Omit<T, keyof AiModelCompatibilityMethods<T>> & AiModelCompatibilityMethods<T>

/** Maps an optional module only when it exists; the committed HEAD host remains unchanged. */
export type CompatibleAiModelHost<T> = {
  [K in keyof T]: K extends 'aiModel'
    ? T[K] extends AiModelCompatibilityClient ? CompatibleAiModel<T[K]> : T[K]
    : T[K]
}

/** A rule exists, but the subsequent application write failed or has an uncertain result.
 * Read the rule and application before retrying handleApply; never repeat the whole fill.
 */
export class AiModelApplyPartialWriteError extends Error {
  readonly code = 'AI_MODEL_APPLY_PARTIAL_WRITE'
  readonly stage = 'handleApply'
  readonly applyHandled = null
  constructor (
    readonly createdRuleId: Id,
    readonly applyId: Id,
    readonly ruleKind: 'quota' | 'flow',
    readonly previousStatus: number | undefined,
    cause: unknown,
  ) {
    super('规则已创建，但申请状态写入失败或结果不确定；保留 createdRuleId 回读规则与申请，勿重新执行 fill。', { cause })
    this.name = 'AiModelApplyPartialWriteError'
  }
}

export function assertAiModelApplyStatus (status: unknown): asserts status is AiModelApplyStatus {
  if (status !== 0 && status !== 3 && status !== 4) {
    throw new Error('申请状态仅支持 0 待处理、3 已驳回、4 已处理；Portal 忽略发送 1、旧填写发送 2，但当前 Java 查询和写入均拒绝；没有可靠映射，需核对页面与接口协议，不能改成驳回或已处理。')
  }
}

function assertId (value: unknown, name: string): asserts value is Id {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) {
    throw new Error(`${name} 必须是已查询到的正整数 ID`)
  }
}
function positive (value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value)
  const decimalInteger = typeof value !== 'string' || /^\d+$/.test(value.trim())
  if ((typeof value !== 'number' && typeof value !== 'string') || !decimalInteger || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) throw new Error(`${name} 必须为 1–${max} 的安全正整数；字符串须为十进制整数字符，不能以长字符串绕过数值精度限制`)
  return parsed
}
function choice (value: unknown, values: readonly number[], name: string): number {
  if (typeof value !== 'number' || !values.includes(value)) throw new Error(`${name} 必须在 ${values.join('/')} 中选择`)
  return value
}
function phone (value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function ruleTarget (input: AiModelFillApplyInput): RuleTarget {
  const { apply, form = {} } = input
  assertId(apply?.id, '申请 id')
  assertId(apply.modelId, '模型 id')
  if (typeof form.startTime !== 'string' || !form.startTime.trim()) throw new Error('startTime 必填，使用 YYYY-MM-DD HH:mm:ss')
  const common = { modelId: apply.modelId, startTime: form.startTime, endTime: form.endTime, reason: form.reason || apply.reason }
  // Backend treats null/0 as the personal tenant. String "0" must not become a tenant rule.
  if (apply.tenantId !== undefined && apply.tenantId !== null && String(apply.tenantId) !== '0' && String(apply.tenantId) !== '') {
    assertId(apply.tenantId, '申请 tenantId')
    return { ...common, ruleScope: 2, targetTenantId: apply.tenantId, targetTenantName: apply.tenantName }
  }
  const fromApply = phone(apply.userPhone)
  const selected = phone(form.targetUserPhone)
  if (fromApply && selected && fromApply !== selected) throw new Error('所选 targetUserPhone 与申请 userPhone 不一致；请核对申请人，不自动改配给其他人')
  const targetUserPhone = fromApply ?? selected
  if (!targetUserPhone) throw new Error('个人申请缺少 userPhone；先调用 ai-model-search-user，以关键词查询并确认候选 phone，再填 form.targetUserPhone；不能用 userId 代替手机号')
  return { ...common, ruleScope: 3, targetUserPhone, targetUserName: form.targetUserName ?? apply.userName, targetUserTypeName: form.targetUserTypeName }
}

/** Wrap the public aiModel facade once. Existing method names and argument order remain valid. */
export function withAiModelCompatibility<T extends AiModelCompatibilityClient> (client: T): CompatibleAiModel<T> {
  // Capture before installation mutates the facade in place; otherwise a wrapper would call itself.
  const originalList = client.listApplyRecords.bind(client)
  const originalHandle = client.handleApply.bind(client)
  const originalQuotaSave = client.saveQuotaRule.bind(client)
  const originalFlowSave = client.saveFlowRule.bind(client)
  const prepareHandleApply = (apply: ApplyIdentity, status: number, options: HandleOptions = {}) => {
    assertId(apply?.id, '申请 id')
    assertAiModelApplyStatus(status)
    return {
      payload: { id: apply.id, status, statisticsDimension: 3, ...(options.rejectReason === undefined ? {} : { rejectReason: options.rejectReason }) },
      previousStatus: apply.status,
    }
  }
  const handleApply = async (apply: { id: Id }, status: number, options: HandleOptions = {}): Promise<unknown> => {
    prepareHandleApply(apply, status, options)
    return originalHandle(apply, status, options)
  }
  const fill = async (input: AiModelFillApplyInput, kind: 'quota' | 'flow'): Promise<AiModelFillReceipt> => {
    const target = ruleTarget(input)
    const form = input.form ?? {}
    // Validate the entire first request before doing either write. Never accept a form.id.
    const draft = kind === 'quota'
      ? { ...target, totalQuota: positive(form.totalQuota ?? input.apply.expectedMonthlyQuota, 'totalQuota'), resetCycle: choice(form.resetCycle, [0, 1, 2, 3], 'resetCycle'), shortageStrategy: choice(form.shortageStrategy, [1, 2], 'shortageStrategy') }
      : { ...target, tokenLimitPerMinute: positive(form.tokenLimitPerMinute, 'tokenLimitPerMinute'), maxTokenPerRequest: positive(form.maxTokenPerRequest ?? input.apply.expectedMaxToken, 'maxTokenPerRequest', 2147483647), exceedStrategy: choice(form.exceedStrategy, [1, 2, 3], 'exceedStrategy') }
    const createdRuleId = kind === 'quota' ? await originalQuotaSave(draft as QuotaDraft) : await originalFlowSave(draft as FlowDraft)
    // No usable receipt means the first write may still exist: stop before handling the application.
    if ((typeof createdRuleId !== 'number' && typeof createdRuleId !== 'string') || !/^[1-9]\d*$/.test(String(createdRuleId))) {
      throw new Error('规则创建未返回可用 ID，写入结果不确定；先按模型和目标查询规则，勿重跑 fill 或把申请标成已处理')
    }
    if (input.skipApplyStatus) return { createdRuleId, applyHandled: null, warnings: [] }
    try {
      const applyHandled = await handleApply({ id: input.apply.id }, AI_MODEL_APPLY_STATUS.handled)
      if (applyHandled !== true) throw new Error('申请处理未返回 true；需回查申请状态')
      return { createdRuleId, applyHandled, warnings: [] }
    } catch (cause) {
      throw new AiModelApplyPartialWriteError(createdRuleId, input.apply.id, kind, input.apply.status, cause)
    }
  }
  return {
    ...client,
    listApplyRecords (query: Parameters<T['listApplyRecords']>[0] = {}) {
      if (query?.status !== undefined && query.status !== null) assertAiModelApplyStatus(query.status)
      return originalList(query) as ReturnType<T['listApplyRecords']>
    },
    prepareHandleApply,
    handleApply,
    cancelHandledApply: (applyId: Id, previousStatus: number) => handleApply({ id: applyId }, previousStatus),
    fillApplyWithQuotaRule: (input: AiModelFillApplyInput) => fill(input, 'quota'),
    fillApplyWithFlowRule: (input: AiModelFillApplyInput) => fill(input, 'flow'),
  }
}

const installedFacades = new WeakSet<object>()

/** Optional integration for a checkout without the aiModel module; preserves facade identity. */
export function installAiModelCompatibility (host: object): void {
  const client: unknown = Object.getOwnPropertyDescriptor(host, 'aiModel')?.value
  if (client === null || typeof client !== 'object' || installedFacades.has(client)) return
  if (!['listApplyRecords', 'handleApply', 'saveQuotaRule', 'saveFlowRule'].every(key => typeof Object.getOwnPropertyDescriptor(client, key)?.value === 'function')) return
  Object.assign(client, withAiModelCompatibility(client as AiModelCompatibilityClient))
  installedFacades.add(client)
}

/** Apply runtime compatibility and preserve the corresponding public method types. */
export function withCompatibleAiModelHost<T extends object> (host: T): CompatibleAiModelHost<T> {
  installAiModelCompatibility(host)
  return host as CompatibleAiModelHost<T>
}

/** Page-call compatibility for personal flow rules: unlike quota rules, Java does not default
 * a missing targetTenantId. Only the exact SDK create/update operations receive personal tenant 0.
 */
export function normalizeAiModelRequest<T extends { url?: string; method?: string; data?: unknown }> (config: T): T {
  const method = config.method?.toLowerCase()
  const eligible = (config.url === '/admin-api/ai-token/flow-rule/create' && method === 'post')
    || (config.url === '/admin-api/ai-token/flow-rule/update' && method === 'put')
  const data = config.data
  if (!eligible || data === null || typeof data !== 'object' || Array.isArray(data)) return config
  const body = data as Record<string, unknown>
  if ((body.ruleScope !== 3 && body.ruleScope !== '3') || (body.targetTenantId !== null && body.targetTenantId !== undefined)) return config
  // An old targetUserId-only request is still incomplete; do not silently repair half its target.
  if (typeof body.targetUserPhone !== 'string' || !body.targetUserPhone.trim()) return config
  return { ...config, data: { ...body, targetTenantId: 0 } }
}
