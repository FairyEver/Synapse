/**
 * 基础数据能力表。对应 Portal 前端的 `BASE_DATA_REGISTRY`
 * （`app/portal/utils/router/base-data.js:57-104`），但把「谁能注册」和「怎么排序」分开：
 * Portal 是一张写死的对象，这里是可注册的表，因为 SDK 的能力是由 `tools/generate` 逐页产出的。
 *
 * 与 Portal 保持一致的三点：
 * 1. `deps` 是**能力键**而不是函数引用，避免能力之间直接 import；
 * 2. `critical` 决定失败是「抛」还是「降级」，Portal 里它就是 `softFetch*` 与 `fetch*` 的区别；
 * 3. 加载顺序由依赖决定，不由声明顺序决定。
 */

import {
  SessionConfigurationError,
  type BaseDataCapability,
} from './types.js'

export class BaseDataRegistry {
  private readonly entries = new Map<string, BaseDataCapability>()

  /** 注册一个能力。重复键直接报错——静默覆盖会让「我注册的那份没生效」变成难查的问题。 */
  register (capability: BaseDataCapability): this {
    const entry = this.normalize(capability)
    if (this.entries.has(entry.key)) {
      throw new SessionConfigurationError(`基础数据能力重复注册：${entry.key}（要覆盖请显式用 replace）`)
    }
    this.entries.set(entry.key, entry)
    return this
  }

  registerAll (capabilities: readonly BaseDataCapability[]): this {
    for (const capability of capabilities) {
      this.register(capability)
    }
    return this
  }

  /** 显式覆盖。用于「先用默认表，再替换掉其中某项」的接线方式。 */
  replace (capability: BaseDataCapability): this {
    const entry = this.normalize(capability)
    if (!this.entries.has(entry.key)) {
      throw new SessionConfigurationError(`要覆盖的基础数据能力不存在：${entry.key}`)
    }
    this.entries.set(entry.key, entry)
    return this
  }

  get (key: string): BaseDataCapability | undefined {
    return this.entries.get(key)
  }

  has (key: string): boolean {
    return this.entries.has(key)
  }

  keys (): string[] {
    return [...this.entries.keys()]
  }

  list (): BaseDataCapability[] {
    return [...this.entries.values()]
  }

  /**
   * 把请求的能力键展开成「依赖先、本能力后」的加载顺序（拓扑排序 + 去重）。
   *
   * 配置类错误（键没注册、依赖成环）在这里就抛，不进入加载流程：
   * 这类问题重试一万次也一样，属于接线 bug，不该被当成「数据失败」降级掉。
   *
   * 排序是稳定的：按请求顺序访问，每个能力的依赖按声明顺序先访问。
   * 注意 `critical` 不参与排序——它只决定失败语义。
   */
  resolve (requestedKeys: readonly string[]): BaseDataCapability[] {
    const ordered: BaseDataCapability[] = []
    const done = new Set<string>()
    const stack: string[] = []

    const visit = (key: string): void => {
      if (done.has(key)) {
        return
      }

      const cycleStart = stack.indexOf(key)
      if (cycleStart >= 0) {
        const cycle = [...stack.slice(cycleStart), key].join(' -> ')
        throw new SessionConfigurationError(`基础数据能力依赖成环：${cycle}`)
      }

      const entry = this.entries.get(key)
      if (!entry) {
        const parent = stack[stack.length - 1]
        throw new SessionConfigurationError(
          parent
            ? `基础数据能力 ${parent} 依赖的能力未注册：${key}`
            : `基础数据能力未注册：${key}`,
        )
      }

      stack.push(key)
      for (const dep of entry.deps ?? []) {
        visit(dep)
      }
      stack.pop()

      done.add(key)
      ordered.push(entry)
    }

    for (const key of requestedKeys) {
      visit(key)
    }

    return ordered
  }

  private normalize (capability: BaseDataCapability): BaseDataCapability {
    if (typeof capability?.key !== 'string' || capability.key.trim() === '') {
      throw new SessionConfigurationError('基础数据能力缺少 key')
    }
    if (typeof capability.load !== 'function') {
      throw new SessionConfigurationError(`基础数据能力 ${capability.key} 缺少 load`)
    }

    const deps = [...(capability.deps ?? [])]
    if (deps.includes(capability.key)) {
      throw new SessionConfigurationError(`基础数据能力 ${capability.key} 依赖了自己`)
    }

    return {
      ...capability,
      key: capability.key.trim(),
      deps,
    }
  }
}

export function createBaseDataRegistry (
  capabilities: readonly BaseDataCapability[] = [],
): BaseDataRegistry {
  return new BaseDataRegistry().registerAll(capabilities)
}
