import type { AiContract } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_PRODUCT_METHODS } from '../capabilities/setting-dict-platform-product.js'

const idMap: Record<string, string> = {
  'setting-dict-type-list': 'setting-dict-platform-product-type-list',
  'setting-dict-data-list': 'setting-dict-platform-product-data-list',
  'setting-dict-data-get': 'setting-dict-platform-product-data-get',
  'setting-dict-data-create': 'setting-dict-platform-product-data-create',
  'setting-dict-data-update': 'setting-dict-platform-product-data-update',
  'setting-dict-data-remove': 'setting-dict-platform-product-data-remove',
}

function replaceReferences (value: unknown): unknown {
  if (typeof value === 'string') {
    return Object.entries(idMap).reduce((result, [source, target]) => result.split(source).join(target), value)
      .split('settingDictPlatform.')
      .join('settingDictPlatformProduct.')
  }
  if (Array.isArray(value)) return value.map(replaceReferences)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item)]))
  }
  return value
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main (acab69acc7) app/portal/menus/common.js、app/portal/utils/define.js、app/portal/views/dashboard/common/setting/dict-platform/product/{list.vue,[mode]/[id].vue,data/[type]/items.vue,data/[type]/[mode]/[id].vue}、all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue', kind: 'reference', note: '证明生产字典路径/权限、SYSTEM_PRODUCT_VALUE=4、platform 实例、共享根列表与数据子页的筛选/分页/详情/新增/编辑/单删；根页类型写入与批量/导入/导出入口未启用。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test (0f1a55718eb) erp-module-system/.../controller/admin/dict/DictTypeController.java、DictDataController.java、DictTypePageReqVO.java、DictTypeRespVO.java、DictDataPageReqVO.java、DictDataRespVO.java、DictDataSaveReqVO.java、DictTypeServiceImpl.java、DictDataServiceImpl.java、DictDataMapper.java', kind: 'reference', note: '证明租户类型分页强制 tenant_editable=1、类型写入/导出拒绝、数据分页/详情/新增/更新/单删路径、平台+当前租户查询、当前租户归属校验及 DTO 字段和表单校验。' },
  { source: 'src/capabilities/setting-dict-platform-product.ts 与 test/setting-dict-platform-product.test.ts', kind: 'implementation', note: '证明 SDK 固定 useSystem=4 的请求投影、实际 URL/载荷、输入/返回校验及离线反证；不替代真实浏览器或 smoke 验证。' },
]

const productBoundaries = [
  '只覆盖 /dashboard/setting/dict-platform/product/list 生产字典根列表及从“字典数据”按钮可达的数据子页；不覆盖公共、财务、资产、人力、采购、销售字典页，也不覆盖平台设置下的同名页面。',
  '根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=4（生产）；useSystem 不是调用参数。页面路径按规则表未命中，因此不发送 module-type。',
  '根列表只有名称/类型筛选、分页和进入“字典数据”；类型新增、编辑、删除、批量删除、导入、导出均未启用，不能把共享组件中注释掉的动作当成能力。',
  '数据子页提供标签/状态筛选、分页、详情读取、新建、编辑和单条删除；查询是平台共享 + 当前租户自有数据，platform=true 的行在 Portal 禁止编辑/删除，写入还要求当前租户和 tenant_editable=1。',
  'Java 返回的字段含类型 id/name/type/status/remark/createTime/useSystem/tenantEditable，以及数据 id/sort/label/value/dictType/status/colorType/cssClass/remark/createTime/tenantId/platform；页面未展示的 colorType/cssClass 仅作为详情兼容字段，不引导额外操作。',
]

const purposeBySourceId: Record<string, string> = {
  'setting-dict-type-list': '分页查询系统设置中的生产字典类型；类型列表固定只取 useSystem=4 的生产记录。',
  'setting-dict-data-list': '查询某个生产字典类型的字典数据，复刻子页的标签、状态和分页筛选。',
  'setting-dict-data-get': '读取一条生产字典数据的编辑详情。',
  'setting-dict-data-create': '在当前租户可维护的生产字典类型下创建一个租户私有字典数据条目。',
  'setting-dict-data-update': '按 Portal 生产字典数据表单修改一个当前租户自有条目。',
  'setting-dict-data-remove': '删除一个当前租户自有、非平台共享的生产字典数据条目。',
}

const gaps = [
  '已完成固定 Portal/Java 检出源码核对和离线请求/契约验证；未启动浏览器，未取得真实网络基准。',
  '未在安全测试数据上执行并记录 create/update/delete 的真实写后回查；当前后端没有通用 cancel 接口，因此不适用 prepare → submit → cancel 闭环。',
]

function scopedContract (sourceId: string, contract: AiContract): AiContract {
  const scoped = replaceReferences(contract) as AiContract
  return {
    ...scoped,
    purpose: purposeBySourceId[sourceId]!,
    whenToUse: purposeBySourceId[sourceId]!,
    boundaries: productBoundaries,
    evidence,
    gaps,
  }
}

export const SETTING_DICT_PLATFORM_PRODUCT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS).map(([sourceId, contract]) => [idMap[sourceId], scopedContract(sourceId, contract)]),
)

export const SETTING_DICT_PLATFORM_PRODUCT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_PRODUCT_METHODS).map(([id, method]) => [
    `settingDictPlatformProduct.${method}`,
    { ...SETTING_DICT_PLATFORM_PRODUCT_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_PRODUCT_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'] },
  ]),
)
