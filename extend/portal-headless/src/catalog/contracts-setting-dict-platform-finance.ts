import type { AiContract } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_FINANCE_METHODS } from '../capabilities/setting-dict-platform-finance.js'

const idMap: Record<string, string> = {
  'setting-dict-type-list': 'setting-dict-platform-finance-type-list',
  'setting-dict-data-list': 'setting-dict-platform-finance-data-list',
  'setting-dict-data-get': 'setting-dict-platform-finance-data-get',
  'setting-dict-data-create': 'setting-dict-platform-finance-data-create',
  'setting-dict-data-update': 'setting-dict-platform-finance-data-update',
  'setting-dict-data-remove': 'setting-dict-platform-finance-data-remove',
}

function replaceReferences (value: unknown): unknown {
  if (typeof value === 'string') {
    return Object.entries(idMap).reduce((result, [source, target]) => result.split(source).join(target), value)
      .split('settingDictPlatform.')
      .join('settingDictPlatformFinance.')
  }
  if (Array.isArray(value)) return value.map(replaceReferences)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item)]))
  }
  return value
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main (acab69acc7) app/portal/menus/common.js、app/portal/views/dashboard/common/setting/dict-platform/finance/list.vue、all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue', kind: 'reference', note: '证明财务字典菜单路径/权限、固定 SYSTEM_FINANCE_VALUE=2、platform 实例、module-type 未命中、根列表筛选、字典数据子页的分页/筛选/新增/编辑/单条删除；注释掉的类型写按钮和批量/导入/导出入口不属于页面能力。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test (0f1a55718eb) erp-module-system/.../controller/admin/dict/DictTypeController.java、DictDataController.java、DictTypePageReqVO.java、DictDataPageReqVO.java、DictDataSaveReqVO.java、DictTypeServiceImpl.java、DictDataServiceImpl.java、DictDataMapper.java', kind: 'reference', note: '证明 /admin-api/system/dict-type 与 dict-data 的租户接口、类型分页强制 tenant_editable=1、类型写入/导出拒绝、数据查询的租户视角合并及数据写入的当前租户归属校验。' },
  { source: 'src/capabilities/setting-dict-platform-finance.ts 与 test/setting-dict-platform-finance.test.ts', kind: 'implementation', note: '证明 SDK 固定 useSystem=2 的请求投影、实际 URL/载荷、输入/返回校验及离线反证；不替代真实环境验证。' },
]

const purposeBySourceId: Record<string, string> = {
  'setting-dict-type-list': '分页查询系统设置中的财务字典类型；类型列表固定只取 useSystem=2 的财务记录。',
  'setting-dict-data-list': '查询某个财务字典类型的字典数据，复刻子页的标签、状态和分页筛选。',
  'setting-dict-data-get': '读取一条财务字典数据的编辑详情。',
  'setting-dict-data-create': '在当前租户可维护的财务字典类型下创建一个租户私有字典数据条目。',
  'setting-dict-data-update': '按 Portal 财务字典数据表单修改一个当前租户自有条目。',
  'setting-dict-data-remove': '删除一个当前租户自有、非平台共享的财务字典数据条目。',
}

const financeBoundaries = [
  '只覆盖门户“系统设置 → 系统字典 → 财务字典”根列表和从“字典数据”按钮可达的字典数据子页；不覆盖平台设置下的同名财务字典页面。',
  '根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=2；页面 module-type 按规则表未命中，因此不发送该头。',
  '字典类型由平台维护：/admin-api 租户接口只返回 tenant_editable=1 的类型，并明确拒绝类型 create/update/delete/export；Portal 根页的这些按钮也是注释掉的。',
  '字典数据查询返回平台共享 + 当前租户自有数据；platform=true 的行在 Portal 禁止编辑和删除，写入还必须通过当前租户和可维护字典类型校验。',
  '页面没有批量删除、导入或导出入口；后端存在的数据导出方法不因此成为本页可调用能力。',
]

const gaps = [
  '源码实测已固定 Portal/Java 分支和请求/权限/归属规则；module-type=null 是按当前生成规则表对页面路径的推导结果，未用浏览器网络基准复核。',
  '真实 smoke 未执行：没有启动浏览器，也没有在安全测试数据上记录数据 create/update/delete 的 submit 后回查与清理；当前后端没有通用 cancel 接口。',
]

function scopedContract (sourceId: string, contract: AiContract): AiContract {
  const scoped = replaceReferences(contract) as AiContract
  return {
    ...scoped,
    purpose: purposeBySourceId[sourceId]!,
    whenToUse: purposeBySourceId[sourceId]!,
    boundaries: financeBoundaries,
    evidence,
    gaps,
  }
}

export const SETTING_DICT_PLATFORM_FINANCE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS).map(([sourceId, contract]) => [idMap[sourceId], scopedContract(sourceId, contract)]),
)

export const SETTING_DICT_PLATFORM_FINANCE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_FINANCE_METHODS).map(([id, method]) => [
    `settingDictPlatformFinance.${method}`,
    { ...SETTING_DICT_PLATFORM_FINANCE_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_FINANCE_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'] },
  ]),
)
