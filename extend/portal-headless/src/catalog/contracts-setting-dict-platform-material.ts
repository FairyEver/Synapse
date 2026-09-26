import type { AiContract } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_MATERIAL_METHODS } from '../capabilities/setting-dict-platform-material.js'

const idMap: Record<string, string> = {
  'setting-dict-type-list': 'setting-dict-platform-material-type-list',
  'setting-dict-data-list': 'setting-dict-platform-material-data-list',
  'setting-dict-data-get': 'setting-dict-platform-material-data-get',
  'setting-dict-data-create': 'setting-dict-platform-material-data-create',
  'setting-dict-data-update': 'setting-dict-platform-material-data-update',
  'setting-dict-data-remove': 'setting-dict-platform-material-data-remove',
}

function replaceReferences (value: unknown): unknown {
  if (typeof value === 'string') {
    return Object.entries(idMap).reduce((result, [source, target]) => result.split(source).join(target), value)
      .split('settingDictPlatform.')
      .join('settingDictPlatformMaterial.')
  }
  if (Array.isArray(value)) return value.map(replaceReferences)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item)]))
  }
  return value
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main (acab69acc7) app/portal/menus/common.js、app/portal/utils/define.js、app/portal/views/dashboard/common/setting/dict-platform/material/list.vue、material/[mode]/[id].vue、material/data/[type]/items.vue、material/data/[type]/[mode]/[id].vue、all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue', kind: 'reference', note: '证明资产字典菜单路径/权限、固定 SYSTEM_MATERIAL_VALUE=3、platform 实例、根列表 useSystem 过滤、字典数据子页的分页/筛选/新增/编辑/单条删除；根类型写按钮、批量删除、导入和导出入口不在活动页面中。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test (0f1a55718eb) erp-module-system/.../controller/admin/dict/DictTypeController.java、DictDataController.java、DictTypePageReqVO.java、DictTypeRespVO.java、DictTypeSaveReqVO.java、DictDataPageReqVO.java、DictDataRespVO.java、DictDataSaveReqVO.java、DictDataServiceImpl.java、DictDataMapper.java', kind: 'reference', note: '证明字典类型分页筛选与 tenant_editable=1 范围、租户类型写接口拒绝、字典数据分页/详情/新增/更新/单删、状态/排序/文本校验、平台共享与当前租户数据范围及返回字段。' },
  { source: 'src/capabilities/setting-dict-platform-material.ts 与 test/setting-dict-platform-material.test.ts', kind: 'implementation', note: '证明 SDK 固定 useSystem=3 的请求投影、实际 URL/方法/载荷、返回结构校验、平台行写入拒绝和离线反证；未替代真实浏览器或 smoke。' },
]

const purposeBySourceId: Record<string, string> = {
  'setting-dict-type-list': '分页查询系统设置中的资产字典类型；类型列表固定只取 useSystem=3 的资产记录。',
  'setting-dict-data-list': '查询某个资产字典类型的字典数据，复刻子页的标签、状态和分页筛选。',
  'setting-dict-data-get': '读取一条资产字典数据的编辑详情。',
  'setting-dict-data-create': '在当前租户可维护的资产字典类型下创建一个租户私有字典数据条目。',
  'setting-dict-data-update': '按 Portal 资产字典数据表单修改一个当前租户自有条目。',
  'setting-dict-data-remove': '删除一个当前租户自有、非平台共享的资产字典数据条目。',
}

const materialBoundaries = [
  '只覆盖门户“系统设置 → 系统字典 → 资产字典”根列表和从“字典数据”按钮可达的字典数据子页；不覆盖平台设置下的字典管理页面或其他系统字典页。',
  '根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=3；页面 module-type 按当前规则表未命中，因此不发送该头。数据子页不附加 useSystem。',
  '字典类型由平台维护：/admin-api 租户接口只返回 tenant_editable=1 的类型，并明确拒绝类型 create/update/delete/export；Portal 根页的类型写入控件也不在活动 UI 中。',
  '字典数据查询返回平台共享 + 当前租户自有数据；platform=true 的行在 Portal 禁止编辑和删除，写入还必须通过当前租户和可维护字典类型校验。',
  '页面没有批量删除、导入或导出入口；后端存在的数据导出方法不因此成为本页可调用能力。',
]

const gaps = [
  '源码实测已固定 Portal/Java 分支与提交锚点，并完成离线请求/返回/失败夹具；module-type=null 是按当前规则表推导，未用浏览器网络基准复核。',
  '未启动真实 Portal 页面或 smoke：没有在安全测试数据上记录数据 create/update/delete 的真实写后回查与清理；当前后端没有通用 cancel 接口，因此不适用会议申请式 prepare → submit → cancel 闭环。',
]

function scopedContract (sourceId: string, contract: AiContract): AiContract {
  const scoped = replaceReferences(contract) as AiContract
  return {
    ...scoped,
    purpose: purposeBySourceId[sourceId]!,
    whenToUse: purposeBySourceId[sourceId]!,
    boundaries: materialBoundaries,
    evidence,
    gaps,
  }
}

export const SETTING_DICT_PLATFORM_MATERIAL_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS).map(([sourceId, contract]) => [idMap[sourceId], scopedContract(sourceId, contract)]),
)

export const SETTING_DICT_PLATFORM_MATERIAL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_MATERIAL_METHODS).map(([id, method]) => [
    `settingDictPlatformMaterial.${method}`,
    { ...SETTING_DICT_PLATFORM_MATERIAL_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_MATERIAL_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'] },
  ]),
)
