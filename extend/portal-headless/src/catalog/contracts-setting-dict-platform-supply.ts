import type { AiContract } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_SUPPLY_METHODS } from '../capabilities/setting-dict-platform-supply.js'

const idMap: Record<string, string> = {
  'setting-dict-type-list': 'setting-dict-platform-supply-type-list',
  'setting-dict-data-list': 'setting-dict-platform-supply-data-list',
  'setting-dict-data-get': 'setting-dict-platform-supply-data-get',
  'setting-dict-data-create': 'setting-dict-platform-supply-data-create',
  'setting-dict-data-update': 'setting-dict-platform-supply-data-update',
  'setting-dict-data-remove': 'setting-dict-platform-supply-data-remove',
}

function replaceReferences (value: unknown): unknown {
  if (typeof value === 'string') {
    return Object.entries(idMap).reduce((result, [source, target]) => result.split(source).join(target), value)
      .split('settingDictPlatform.')
      .join('settingDictPlatformSupply.')
  }
  if (Array.isArray(value)) return value.map(replaceReferences)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item)]))
  }
  return value
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main (acab69acc7) app/portal/menus/common.js、app/portal/utils/define.js、app/portal/views/dashboard/common/setting/dict-platform/supply/list.vue、supply/data/[type]/items.vue、supply/data/[type]/[mode]/[id].vue、all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue', kind: 'reference', note: '证明采购字典菜单路径/权限、SYSTEM_SUPPLY_VALUE=5、platform 实例、根列表固定系统筛选、数据子页的分页/筛选/新增/编辑/单条删除；根页类型写按钮与数据页批量删除/导入/导出均不在活动界面。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test (0f1a55718eb) erp-module-system/.../controller/admin/dict/DictTypeController.java、DictDataController.java、vo/type/DictTypePageReqVO.java、vo/type/DictTypeRespVO.java、vo/data/DictDataPageReqVO.java、vo/data/DictDataRespVO.java、vo/data/DictDataSaveReqVO.java、DictTypeServiceImpl.java、DictDataServiceImpl.java、DictDataMapper.java', kind: 'reference', note: '证明租户字典类型分页强制 tenant_editable=1、类型写入/导出拒绝、数据查询的租户视角合并、数据写入的当前租户归属/类型可维护校验、返回字段与表单约束。该 Controller 不按 useSystem=5 做权限裁决，useSystem=5 是 Portal 页面筛选值。' },
  { source: 'src/capabilities/setting-dict-platform-supply.ts 与 test/setting-dict-platform-supply.test.ts', kind: 'implementation', note: '证明 SDK 固定 useSystem=5 的请求投影、实际 URL/方法/载荷、输入/返回校验、平台行写禁用和离线反证；不替代真实环境验证。' },
]

const purposeBySourceId: Record<string, string> = {
  'setting-dict-type-list': '分页查询系统设置中的采购字典类型；类型列表固定只取 useSystem=5 的采购记录。',
  'setting-dict-data-list': '查询某个采购字典类型的字典数据，复刻子页的标签、状态和分页筛选。',
  'setting-dict-data-get': '读取一条采购字典数据的编辑详情。',
  'setting-dict-data-create': '在当前租户可维护的采购字典类型下创建一个租户私有字典数据条目。',
  'setting-dict-data-update': '按 Portal 采购字典数据表单修改一个当前租户自有条目。',
  'setting-dict-data-remove': '删除一个当前租户自有、非平台共享的采购字典数据条目。',
}

const supplyBoundaries = [
  '只覆盖门户“系统设置 → 系统字典 → 采购字典”根列表和从“字典数据”按钮可达的字典数据子页；不覆盖平台设置下的同名页面或供应模块其他设置页面。',
  '根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=5；页面 module-type 按当前规则表未命中，因此不发送该头。',
  '字典类型由平台维护：/admin-api 租户接口只返回 tenant_editable=1 的类型，并明确拒绝类型 create/update/delete/export；Portal 根页的这些按钮也是注释掉的。',
  '字典数据查询返回平台共享 + 当前租户自有数据；platform=true 的行在 Portal 禁止编辑和删除，写入还必须通过当前租户、类型启用和 tenant_editable 校验。',
  '页面没有批量删除、导入或导出入口；后端存在的数据导出方法不因此成为本页可调用能力。',
]

const gaps = [
  '参考源码检出已核对固定分支和当前锚点，但因本次禁止 Git 写操作未执行 pull；因此源码结论受当前检出版本约束。',
  '未启动浏览器，也未执行真实测试环境 smoke；没有真实读请求记录或安全测试数据上的 create/update/delete 后回查与清理记录。当前后端没有通用 cancel 接口。',
]

function scopedContract (sourceId: string, contract: AiContract): AiContract {
  const scoped = replaceReferences(contract) as AiContract
  return {
    ...scoped,
    purpose: purposeBySourceId[sourceId]!,
    whenToUse: purposeBySourceId[sourceId]!,
    boundaries: supplyBoundaries,
    evidence,
    gaps,
  }
}

export const SETTING_DICT_PLATFORM_SUPPLY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS).map(([sourceId, contract]) => [idMap[sourceId], scopedContract(sourceId, contract)]),
)

export const SETTING_DICT_PLATFORM_SUPPLY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_SUPPLY_METHODS).map(([id, method]) => [
    `settingDictPlatformSupply.${method}`,
    { ...SETTING_DICT_PLATFORM_SUPPLY_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_SUPPLY_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'] },
  ]),
)
