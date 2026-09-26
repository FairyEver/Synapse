import type { AiContract } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_METHODS } from '../capabilities/setting-dict-platform.js'

export type SettingDictPlatformScopedContractOptions = {
  key: string
  namespace: string
  label: string
  system: number
  pagePath: string
  permission: string
  portalSource: string
}

function replaceReferences (value: unknown, idMap: Record<string, string>, namespace: string): unknown {
  if (typeof value === 'string') {
    return Object.entries(idMap).reduce((result, [source, target]) => result.split(source).join(target), value)
      .split('settingDictPlatform.')
      .join(`${namespace}.`)
  }
  if (Array.isArray(value)) return value.map(item => replaceReferences(item, idMap, namespace))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item, idMap, namespace)]))
  }
  return value
}

export function createSettingDictPlatformScopedContracts (options: SettingDictPlatformScopedContractOptions): {
  aiContracts: Record<string, AiContract>
  methodContracts: Record<string, AiContract>
} {
  const idMap = Object.fromEntries(Object.keys(SETTING_DICT_PLATFORM_METHODS).map(id => [
    id,
    id.replace(/^setting-dict-(type|data)-/, `setting-dict-platform-${options.key}-$1-`),
  ]))
  const aiContracts = Object.fromEntries(Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS).map(([sourceId, contract]) => {
    const id = idMap[sourceId]!
    const scoped = replaceReferences(contract, idMap, options.namespace) as AiContract
    return [id, {
      ...scoped,
      purpose: `${options.label}字典：${scoped.purpose}`,
      whenToUse: `${options.label}字典：${scoped.whenToUse}`,
      boundaries: [
        `只覆盖门户系统设置下的${options.label}字典根列表 ${options.pagePath} 及其可达的字典数据子页；不覆盖平台设置下同名字典页面或独立业务菜单。`,
        `根列表固定使用 platform HTTP 实例和 /admin-api/system/dict-type/page，SDK 自动发送 useSystem=${options.system}；调用方不能改写该范围，页面 module-type=null。`,
        ...scoped.boundaries.filter(item => !item.includes('只覆盖门户“系统设置 → 字典管理”')),
      ],
      evidence: [
        { source: `CodeReview_Projects_Js@test/portal/main ${options.portalSource}`, kind: 'reference', note: `证明${options.label}字典菜单路径/权限、系统固定值、共享根页和数据子页的筛选、分页、表单、平台行只读规则。` },
        { source: 'CodeReview_Mall_Platform_Java@test/test erp-module-system DictTypeController、DictDataController、Service、Mapper', kind: 'reference', note: '证明租户字典类型分页、数据分页/详情/新增/更新/删除、tenant_editable、当前租户归属和平台共享数据范围。' },
        { source: 'src/capabilities/setting-dict-platform-scoped.ts 与当前页面测试', kind: 'implementation', note: `证明 SDK 固定 useSystem=${options.system}、请求形状、返回校验和离线反证；不替代真实环境验证。` },
      ] satisfies AiContract['evidence'],
      gaps: [
        '未启动真实 Portal 页面或测试环境；当前证据为固定 Portal/Java 源码和离线请求形状测试。',
        '该共享字典页面没有 prepare/cancel 协议；写操作仍需 submit 后分页回查确认，不能把请求回执单独当成最终生效。',
      ],
    }]
  }))
  const methodContracts = Object.fromEntries(Object.entries(SETTING_DICT_PLATFORM_METHODS).map(([sourceId, method]) => {
    const id = idMap[sourceId]!
    return [`${options.namespace}.${method}`, {
      ...aiContracts[id]!,
      boundaries: [...aiContracts[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'],
    }]
  }))
  return { aiContracts, methodContracts }
}
