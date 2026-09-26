import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductNoticeConfigCapability,
  PRODUCT_NOTICE_CONFIG_METHODS,
  PRODUCT_NOTICE_CONFIG_MODULE_TYPE,
  PRODUCT_NOTICE_CONFIG_PAGE_PATH,
  PRODUCT_NOTICE_CONFIG_PERMISSION,
  productNoticeConfigCapabilities,
  type ProductNoticeConfigForm,
  type ProductNoticeConfigQuery,
} from '../src/capabilities/product-notice-config.js'
import { PRODUCT_NOTICE_CONFIG_AI_CONTRACTS as contracts } from '../src/catalog/contracts-product-notice-config.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductNoticeConfigForm = {
  module: '1',
  title: '高产日报',
  task: '日报生成',
  jumpPage: '/production/report',
  indicatorName: '产蛋率',
  params: '{{value}}',
  status: '1',
  postIdList: [101, 102],
}

const row = {
  id: 'notice-1',
  title: '高产日报',
  module: 1,
  moduleName: '高产',
  indicatorName: '产蛋率',
  params: '{{value}}',
  postIdList: [101, 102],
  postName: '场长,技术员',
  task: '日报生成',
  jumpPage: '/production/report',
  status: 1 as 0 | 1,
  statusName: '启用',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductNoticeConfigCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 产品运营 → 知会配置页面能力', () => {
  it('逐页锁定菜单、列表、级联、表单写操作和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/operation/notice-config/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/operation/notice-config/[mode]/[id].vue')
    const post = read(portalRoot, 'app/portal/components/portal/product/select/post/index.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/NotificationConfigController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/NotificationConfig.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/config/NotificationConfigDTO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/config/NotificationConfigMapperExt.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/config/impl/NotificationConfigServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_NOTICE_CONFIG_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_NOTICE_CONFIG_PERMISSION}'`)
    for (const fragment of [
      "http('/config/notification/page', { params: form })",
      "url: '/noticeConfig/delete'",
      "method: 'DELETE'",
      "params: { id: record.id }",
      "http.get('/config/notification/getModuleList')",
      "url: '/config/notification/enableOrDisable'",
      "status: record.status === 1 ? '0' : '1'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "await http.post('/flockSimu/config/notification/save', form)",
      "await http.get('/config/notification/getChoose')",
      "module: ''",
      "postIdList: []",
      "{ required: true, message: '请选择推送岗位' }",
    ]) expect(formSource).toContain(fragment)
    expect(post).toContain('http(`/config/notification/getPostList`)')
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/notification")',
      '@GetMapping("/getModuleList")',
      '@GetMapping("/getPostList")',
      '@GetMapping("/getChoose")',
      '@GetMapping("/page")',
      '@PostMapping("/save")',
      '@GetMapping("/delete")',
      '@GetMapping("/enableOrDisable")',
      'String title',
      'Integer module',
      'Integer status',
    ]) expect(controller).toContain(fragment)
    for (const field of ['title', 'module', 'indicatorName', 'params', 'postId', 'task', 'jumpPage', 'status', 'postIdList']) expect(entity).toContain(`protected ${field === 'module' || field === 'status' ? 'Integer' : field === 'postId' ? 'Long' : field === 'postIdList' ? 'List<Long>' : 'String'} ${field};`)
    for (const field of ['moduleName', 'postName', 'statusName']) expect(dto).toContain(`private String ${field};`)
    for (const fragment of ['selectGroupList', 'group by title, module', 'post_id', 'status = #{status}', 'deleteByIdList']) expect(mapper).toContain(fragment)
    for (const fragment of ['notificationConfigMapperExt.selectGroupList(query)', 'notificationConfigMapperExt.batchInsert(newList)', 'notificationConfigMapperExt.batchUpdateStatus(idList, status)', 'notificationConfigMapperExt.deleteByIdList(idList)']) expect(service).toContain(fragment)

    expect(productNoticeConfigCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_NOTICE_CONFIG_METHODS))
    expect(productNoticeConfigCapabilities.every(item => item.pagePath === PRODUCT_NOTICE_CONFIG_PAGE_PATH && item.permission === PRODUCT_NOTICE_CONFIG_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_NOTICE_CONFIG_MODULE_TYPE)).toBe(true)
  })

  it('列表、模块、岗位和级联选项复刻Portal请求与返回层级', async () => {
    const choose = [{ value: '1', label: '高产', code: 'module', childList: [{ value: '日报', label: '日报', code: 'pushName', childList: [] }] }]
    const f = fixture([{ page: { list: [row], total: 1 } }, [{ value: '1', label: '高产' }], [{ value: '101', label: '场长' }], { list: choose }])
    const query: ProductNoticeConfigQuery = { title: '高', module: '1', postId: 101, status: 1, pageNo: 2, pageSize: 50 }
    await expect(f.api.list(query)).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.moduleList()).resolves.toEqual([{ value: '1', label: '高产' }])
    await expect(f.api.postList()).resolves.toEqual([{ value: 101, label: '场长' }])
    await expect(f.api.choose()).resolves.toEqual(choose)
    expect(f.calls).toEqual([
      { url: '/config/notification/page', method: 'get', params: { order: '', orderField: '', title: '高', module: '1', postId: 101, status: 1, pageNo: 2, pageSize: 50 } },
      { url: '/config/notification/getModuleList', method: 'get' },
      { url: '/config/notification/getPostList', method: 'get' },
      { url: '/config/notification/getChoose', method: 'get' },
    ])
  })

  it('prepare→save逐字段复刻表单提交，删除和启停复刻页面实际请求', async () => {
    const f = fixture([{}, {}, {}])
    const prepared = f.api.prepareSave(form)
    expect(prepared).toEqual({ draft: form })
    await expect(f.api.save(prepared)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    await expect(f.api.toggleStatus({ title: row.title, module: row.module, status: row.status })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/flockSimu/config/notification/save', method: 'post', data: form },
      { url: '/noticeConfig/delete', method: 'delete', params: { id: 'notice-1' } },
      { url: '/config/notification/enableOrDisable', method: 'get', params: { title: '高产日报', module: 1, status: '0' } },
    ])
  })

  it('表单、分页、选项和坏响应边界在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.save({ draft: { ...form, postIdList: [] } })).rejects.toThrow('推送岗位')
    await expect(f.api.save({ draft: { ...form, indicatorName: '' } })).rejects.toThrow('指标名称')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    await expect(f.api.toggleStatus({ title: 'x', module: 1, status: 2 as 0 })).rejects.toThrow('当前状态')
    expect(f.calls).toEqual([])

    const badPage = fixture([{ page: { list: [], total: -1 } }])
    await expect(badPage.api.list()).rejects.toThrow('有效list或total')
    const badChoose = fixture([{ list: [{ value: '1', label: '高产', childList: null }] }])
    await expect(badChoose.api.choose()).rejects.toThrow('childList')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('AI契约覆盖读写链、页面权限和Portal删除接口偏差', () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_NOTICE_CONFIG_METHODS).sort())
    expect(contracts['product-notice-config-list']?.output.shape).toBe('{ list: object[], total: integer }')
    expect(contracts['product-notice-config-save']?.effect).toBe('write')
    expect(contracts['product-notice-config-save']?.boundaries.join('\n')).toContain('prepareSave')
    expect(contracts['product-notice-config-remove']?.boundaries.join('\n')).toContain('/noticeConfig/delete')
    expect(contracts['product-notice-config-remove']?.boundaries.join('\n')).toContain('Java')
  })
})
