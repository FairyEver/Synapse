/**
 * 把防重包到写能力上：`withIdempotency(...)` 产出一个「多一个 `requestId` 参数」的写函数。
 *
 * 刻意**不改 `src/capabilities/`**：能力层只需要保持「收参数、发请求」的形状，
 * 防重从外面包上去，接线由主会话统一做（与 `src/invalidation/` 同样的分工）。
 *
 * ## 调用姿势
 *
 * ```ts
 * const submitMeetingApplication = withIdempotency({
 *   store,
 *   capabilityId: 'meeting-application-submit',
 *   // 从会话现取（PortalCredential 里没有 userId，必须由知道会话身份的一方提供）
 *   identity: () => ({ tenantId: session.tenantId, userId: session.userId }),
 *   // 载荷只构建一次：指纹算的是它，发出去的也是它
 *   payload: (params) => buildMeetingApplicationPayload(params),
 *   send: (params, { payload }) =>
 *     capability.submit(payload, params.startUserSelectAssignees),
 * })
 *
 * // AI 侧看到的就是多一个 requestId：
 * await submitMeetingApplication({ ...draft, requestId })
 * ```
 *
 * ## `requestId` 从哪来
 *
 * 由调用方（AI 会话）给，`createRequestId()` 生成最省事。规则只有一条，但它是整个机制的前提：
 *
 * - **同一次意图的重试必须复用同一个值**；
 * - **新的写意图必须换新值**。
 *
 * 每次重试都新生成 = 等于没有防重，而且不会报错（AI 很容易这么做，所以工具的
 * 参数说明里要写清楚："超时重试时原样传回上一次的 requestId"）。
 *
 * ## `requestId` 不会被发出去
 *
 * 后端目前没有任何幂等入口（`Idempotency-Key` / `X-Request-Id` / `reqId` / `nonce`
 * 全仓零命中），所以这个值**只留在 SDK 本地**，不进请求体也不加请求头——
 * 否则会改变请求形状，破坏与浏览器逐字段比对的基线（D20）。
 * 将来后端支持了，加的位置就是 `send` 的第二个参数（`{ requestId, payload }`）。
 *
 * ## 本地校验放哪里
 *
 * 放在 `payload` 里（或 `withIdempotency` 之外）最好：那时候还没登记任何记录，
 * 失败了不会在防重表里留下东西，重试天然可以通过。
 * 只有在 `send` **内部**才发现的本地失败（比如要问一次服务端才知道能不能写）才需要用
 * `NotDispatchedError` 标记，否则会被当成 in-doubt 保留 TTL、挡住重试。
 */

import type { IdempotencyStore } from './store.js'
import type {
  IdempotencyIdentity,
  IdempotencyScope,
  IdempotentSendContext,
} from './types.js'

/** 调用方传给写函数的参数：原参数 + `requestId` */
export type IdempotentWriteParams<Params> = Params & { requestId: string }

/**
 * `Params` 用 `extends object` 而不是 `Record<string, unknown>`：
 * 后者会把用 `interface` 声明的参数类型挡在门外（interface 没有隐式索引签名）。
 */
export type WithIdempotencyInit<Params extends object, Result, Payload> = {
  store: IdempotencyStore
  /** 写能力 ID，进键：不同的写操作必须用不同的 ID */
  capabilityId: string
  /**
   * 身份（租户/用户/命名空间），**每次调用现取**——会话可能换人、换租户。
   * 不提供的话键里就没有用户段，见 `types.ts` 的 `IdempotencyIdentity`。
   */
  identity?: () => IdempotencyIdentity | undefined
  /** 写操作的目标对象（撤销/更新类），例如单据 id。create 类不用给 */
  target?: (params: Params) => string | number | undefined
  /**
   * 参与指纹的载荷。缺省 = 除 `requestId` 外的全部参数。
   *
   * 只把**真正决定这次写内容**的部分交给它：加了个进度回调、传了个 AbortSignal
   * 之类的东西会让指纹算不出来（`PayloadFingerprintError`），而算不准的指纹
   * 会把两份不同的载荷判成同一份。
   */
  payload?: (params: Params) => Payload
  /** 真正发请求的函数。`requestId` 不会自动进请求，需要的话自己从上下文里取 */
  send: (params: Params, context: IdempotentSendContext<Payload>) => Promise<Result>
}

/**
 * 产出一个带防重的写函数。形状与能力方法一致，只是参数上多了 `requestId`。
 *
 * 返回的函数在以下情况**不会**调用 `send`：窗口内同键已成功（回放结果）、
 * 同键正在飞（共享 Promise）、同键上一次结果未知（抛回原错误）、同键换了载荷（抛错）。
 */
export function withIdempotency<Params extends object, Result, Payload = unknown> (
  init: WithIdempotencyInit<Params, Result, Payload>,
): (params: IdempotentWriteParams<Params>) => Promise<Result> {
  if (!init.capabilityId || String(init.capabilityId).trim() === '') {
    throw new Error('withIdempotency 需要 capabilityId')
  }

  return async function idempotentWrite (params) {
    // requestId 是 SDK 的元参数，不是能力参数：剥掉它，别让它漏进请求体
    const { requestId, ...rest } = params as Record<string, unknown>
    const cleanParams = rest as Params

    // 载荷在进 store 之前构建：这里抛错（本地校验失败）不会留下任何记录，
    // 重试天然能过——这正是"本地校验应当放在 payload 里"的原因。
    const payload = init.payload
      ? init.payload(cleanParams)
      : (rest as unknown as Payload)

    const identity = init.identity?.() ?? {}
    const scope: IdempotencyScope = {
      requestId: requestId as string,
      capabilityId: init.capabilityId,
      target: init.target?.(cleanParams),
      namespace: identity.namespace,
      tenantId: identity.tenantId,
      userId: identity.userId,
    }

    return init.store.run<Result>({
      scope,
      payload,
      task: () => init.send(cleanParams, { requestId: requestId as string, payload }),
    })
  }
}
