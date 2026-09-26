import type { PortalRequest } from '../session/types.js'
import { createSettingDictPlatformCapability } from './setting-dict-platform.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

const TYPE_PAGE_URL = '/admin-api/system/dict-type/page'

/**
 * The six system-specific Portal wrappers all reuse the tenant dictionary
 * page. Their only system-specific request behavior is the fixed useSystem
 * projection on the type root page; data-page requests must not receive it.
 */
export function createSettingDictPlatformScopedCapability (request: PortalRequest, useSystem: number) {
  return createSettingDictPlatformCapability(config => {
    if (config.url !== TYPE_PAGE_URL) return request(config)
    const params = (config.params ?? {}) as Record<string, unknown>
    return request({
      ...config,
      params: {
        order: params.order,
        orderField: params.orderField,
        useSystem,
        name: params.name,
        type: params.type,
        pageNo: params.pageNo,
        pageSize: params.pageSize,
      },
    })
  })
}

export type SettingDictPlatformScopedDefinitionOptions = {
  key: string
  label: string
  pagePath: string
  permission: string
  system: number
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export function createSettingDictPlatformScopedCapabilities (options: SettingDictPlatformScopedDefinitionOptions): CapabilityDefinition[] {
  const prefix = `setting-dict-platform-${options.key}`
  return [
    { id: `${prefix}-type-list`, title: `查询${options.label}字典类型`, write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，Portal支持10、20、50、100，默认20')] },
    { id: `${prefix}-data-list`, title: `查询${options.label}字典数据`, write: false, params: [p('dictType', 'text', true, '来自当前系统字典类型列表的type'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，Portal支持10、20、50、100，默认20')] },
    { id: `${prefix}-data-get`, title: `读取${options.label}字典数据详情`, write: false, params: [p('id', 'text', true, '字典数据主键')] },
    { id: `${prefix}-data-create`, title: `创建${options.label}字典数据`, write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
    { id: `${prefix}-data-update`, title: `修改${options.label}字典数据`, write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
    { id: `${prefix}-data-remove`, title: `删除${options.label}字典数据`, write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '来自列表行；true时Portal禁用编辑和删除')] },
  ].map(definition => ({
    ...definition,
    pagePath: options.pagePath,
    permission: options.permission,
    httpInstance: 'platform',
    moduleType: null,
  }))
}
