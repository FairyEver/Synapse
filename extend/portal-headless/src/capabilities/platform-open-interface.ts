import type { CapabilityDefinition, ParamSpec } from './types.js'
import { aiPromptToolCapabilities } from './ai-prompt-tool.js'

/** 平台设置 → 开放平台；页面复用人工智能 → 开放接口的实现。 */
export const PLATFORM_OPEN_INTERFACE_PAGE_PATH = '/dashboard/platform/setting/open-interface/list'
export const PLATFORM_OPEN_INTERFACE_PERMISSION = '/dashboard/platform/setting/open-interface'

export const PLATFORM_OPEN_INTERFACE_SOURCE_IDS = [
  'ai-open-api-registry-list',
  'ai-open-api-registry-get',
  'ai-open-api-registry-scan',
  'ai-open-api-registry-create',
  'ai-open-api-registry-update',
  'ai-open-api-registry-remove',
] as const

const SOURCE_ID_SET = new Set<string>(PLATFORM_OPEN_INTERFACE_SOURCE_IDS)

export function platformOpenInterfaceCapabilityId (sourceId: string): string {
  return sourceId.replace('ai-open-api-registry-', 'platform-open-interface-')
}

function cloneParam (param: ParamSpec): ParamSpec {
  return {
    ...param,
    ...(param.options === undefined
      ? {}
      : { options: param.options.map(option => ({ ...option })) }),
    ...(param.lookup === undefined ? {} : { lookup: { ...param.lookup } }),
  }
}

function toPlatformOpenInterfaceCapability (definition: CapabilityDefinition): CapabilityDefinition {
  return {
    ...definition,
    id: platformOpenInterfaceCapabilityId(definition.id),
    title: definition.title.replace('（提示工程·开放接口）', '（平台设置·开放平台）'),
    pagePath: PLATFORM_OPEN_INTERFACE_PAGE_PATH,
    permission: PLATFORM_OPEN_INTERFACE_PERMISSION,
    params: definition.params.map(cloneParam),
  }
}

/**
 * 顶层“开放平台”不是把 AI 页面能力偷偷归属过来：它有自己的菜单入口和权限码，
 * 只是 Portal 两个 wrapper 最终都调用同一份列表/表单实现与同一组后端请求。
 */
export const platformOpenInterfaceCapabilities: CapabilityDefinition[] = aiPromptToolCapabilities
  .filter(definition => SOURCE_ID_SET.has(definition.id))
  .map(toPlatformOpenInterfaceCapability)
