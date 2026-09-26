/**
 * 能力定义。
 *
 * 「能力」是无头 SDK 的最小调度单位，不是接口（设计 H2 / F3b）：
 * 一个能力绑定了一个页面上下文，因此它知道该带什么 module-type。
 *
 * 这些定义不手写：由 tools/generate 从 Portal 前端代码 + 真实页面观察产出，
 * 逐页推进（设计 D24 / D26）。
 */

/** 参数类型。D6 要求把长选项单独作为一类，交给 AI 先问用户要关键字。 */
export type ParamKind = 'enum' | 'search' | 'tree' | 'date' | 'number' | 'text' | 'boolean' | 'array'

export type ParamSpec = {
  name: string
  kind: ParamKind
  required: boolean
  description?: string
  /** kind 为 enum 时的候选值 */
  options?: Array<{ label: string; value: string | number }>
  /** kind 为 search/tree 时，用于取候选的查询入口 */
  lookup?: { capabilityId: string; keywordParam: string }
}

export type CapabilityDefinition = {
  /** 唯一 ID。菜单路径归一化 + 短哈希（设计 Q140） */
  id: string
  /** 中文名，给 AI 看 */
  title: string
  /** 所属页面（菜单路径），用于推导 module-type */
  pagePath: string
  /**
   * 覆盖该能力真实请求的 module-type。undefined 仍按 pagePath 推导；
   * null 表示浏览器在这个动作上明确不发该头。
   */
  moduleType?: number | null
  /**
   * 该页面的列表请求走哪个 http 实例（`src/context/http-instance.ts` 的表键）。
   *
   * **一般不用写**——页面规则表能推出来（六种声明形式都覆盖了）。
   * 只在**推导不出来时**才必须显式钉死，典型是 iframe 内嵌的独立子应用。
   */
  httpInstance?: string
  /** 该页面在 Portal 里的权限码 */
  permission?: string
  /** 是否会产生写操作 */
  write: boolean
  /** 参数契约 */
  params: ParamSpec[]
}
