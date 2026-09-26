/**
 * 「写操作 → 基础数据失效」的类型（设计 §3 H5、决策 D4）。
 *
 * D4 把写操作全部放开之后，真正的问题不是"能不能写"，而是**写完谁的缓存变旧了**：
 * 会话里的基础数据是按需加载 + TTL 复用的（`src/session/`），一次写操作污染了
 * `dict-hr` 或 `tenant-system` 而不主动失效，用户和 AI 会在 TTL 窗口内一直看到旧数据。
 *
 * 这套类型只描述**证据**，不描述"应该"：
 * - `confirmed` —— Portal 前端代码里能读到「写了什么 → 紧接着重取了什么」；
 * - `inferred` —— 只能靠接口/字段同源推断，前端并没有观察到重取。
 * 两者绝不混在一起，因为它们的可信度不同：确定项漏了是 bug，推测项多了只是多一次请求。
 */

/** 一条可回溯的代码证据。 */
export type InvalidationEvidence = {
  /**
   * 证据**读自哪个仓库**（是出处，不是"当前口径"）。缺省 = Portal 前端。
   * 组织树那组规则引用了后端仓库，因为"哪些字段在树里"只有后端 DTO 说了算。
   *
   * ⚠️ 取值是**结论形成时**的目录名，刻意不随来源切换而改写：
   * 缺省那条读自旧的 `Projects_Js`（`fix/portal/…` 分支），本轮 6 条 `Mall_Platform_Java_Dev`
   * 读自旧的 `dev` 分支。把标签改成新目录名等于**声称**在新检出上读过 —— 那是把声明写成结论。
   * 当前参考来源见 `docs/conventions.md` 第 32 条；仓库根都在 `/Users/liyang/Documents/code/wdbc/` 下。
   */
  repo?: string
  /** 相对该仓库根的路径，例如 `app/portal/utils/system.js` */
  file: string
  /** 行号或行号区间，例如 `'56'` / `'60-61'` */
  lines: string
  /** 关键代码原样摘录，便于不用打开仓库就能核对 */
  code?: string
  /** 这条证据说明什么（只在原样代码不够直白时写） */
  note?: string
}

/**
 * 证据强度。
 * - `confirmed`：前端有写后重取（或显式清缓存）的直接证据；
 * - `inferred`：靠接口同源 / 字段同源推断，前端**没有**重取。
 */
export type InvalidationConfidence = 'confirmed' | 'inferred'

/** 一个写接口的匹配器。方法可选：不写表示"这个方法下的同名路径都算"。 */
export type EndpointMatcher = {
  /** HTTP 方法，大写。缺省 = 任意方法 */
  method?: string
  /**
   * 接口路径。带不带 `/admin-api` `/adminmanage-api` 这类前缀都行——
   * SDK 的 `src/http/client.ts:58-61` 会给裸路径补 `/admin-api`，
   * 因此同一个接口在"前端代码里"和"真实请求里"前缀不同，匹配时按段后缀兜住。
   */
  path: string
}

/** 一条映射：一个写目标 → 一组需要失效的基础数据 key。 */
export type WriteInvalidationRule = {
  /** 规则标识，用于日志、测试与排查（改了语义就换 id） */
  id: string
  /** 人类可读的写操作描述 */
  trigger: string
  /** SDK 能力 ID 匹配（调用面）。没有对应能力的规则不写这一项 */
  capabilityIds?: readonly string[]
  /** 接口路径匹配（兜底）。两者都写时命中任意一个即可 */
  endpoints?: readonly EndpointMatcher[]
  /**
   * 需要失效的基础数据 key（取值见 `PORTAL_BASE_DATA_KEYS`）。
   * **空数组是有意义的**：它表示"这条写目标已经核查过，确认不影响任何基础数据"，
   * 与"没登记过、不知道"是两回事，后者由 `isAuditedWriteTarget` 区分。
   */
  keys: readonly string[]
  confidence: InvalidationConfidence
  /** 至少一条。没有证据的规则不该存在 */
  evidence: readonly InvalidationEvidence[]
  /** 取舍说明：为什么是这几个 key、为什么前端没重取也要失效 */
  note?: string
}

/**
 * 一次写操作的定位。至少给一个字段；两个都给时**能力 ID 优先**，
 * 路径只在能力 ID 没命中时兜底（能力 ID 是 SDK 的调用面，路径是真实请求面）。
 */
export type WriteTarget = {
  /** SDK 能力 ID，例如 `meeting-application-submit` */
  capabilityId?: string
  /** 真实接口路径，例如 `/sys/dict/data` 或 `/admin-api/sys/dict/data` */
  path?: string
  /** HTTP 方法。缺省 = 不参与匹配 */
  method?: string
}

/** 一条写目标的解析结果，把"确定"与"推测"分开给调用方看。 */
export type InvalidationResolution = {
  target: WriteTarget
  /** 命中的规则（按其声明顺序） */
  rules: readonly WriteInvalidationRule[]
  /** 确定项给出的 key */
  confirmedKeys: readonly string[]
  /** 推测项给出的 key */
  inferredKeys: readonly string[]
  /** 并集（确定在前），去重 */
  keys: readonly string[]
  /** 这条写目标被核查过（哪怕结论是"不影响任何基础数据"） */
  audited: boolean
}
