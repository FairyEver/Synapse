import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductBusinessAgeDivisionCapability,
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_METHODS,
  PRODUCT_BUSINESS_AGE_DIVISION_MODULE_TYPE,
  PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH,
  PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION,
  productBusinessAgeDivisionCapabilities,
} from '../src/capabilities/product-business-age-division.js'
import { PRODUCT_BUSINESS_AGE_DIVISION_AI_CONTRACTS as contracts, PRODUCT_BUSINESS_AGE_DIVISION_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-business-age-division.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductBusinessAgeDivisionCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 生产设置 → 业务管理 → 日龄分割', () => {
  it('逐页锁定菜单、权限、tab、product实例和Java端点', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const page = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/age-division/list.vue')
    const bulk = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/age-division/age-division-bulk/index.vue')
    const bulkModal = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/age-division/age-division-bulk/modal-form-content.vue')
    const batch = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/age-division/age-division-batch/index.vue')
    const batchModal = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/age-division/age-division-batch/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/AgeDivisionController.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/vo/AgeDivisionFlockVO.java')
    expect(menu).toContain(`path: '${PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION}'`)
    for (const fragment of [
      "import AgeDivisionBulk from './age-division-bulk/index.vue'",
      "import AgeDivisionBatch from './age-division-batch/index.vue'",
      "'1': markRaw(AgeDivisionBulk)",
      "'2': markRaw(AgeDivisionBatch)",
      `query: '${PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION}'`,
      `query: '${PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION}'`,
    ]) expect(page).toContain(fragment)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "url: '/base/ageDivision/page'",
      'url: `/base/ageDivision/flock_info/${params.flockInfo}`',
      "url: '/base/ageDivision/save'",
      "url: '/base/ageDivision/delete'",
      'permissionCheck(props.permissions.submit)',
    ]) expect(bulk).toContain(fragment)
    expect(bulkModal).toContain('品种和品系至少填一项')
    for (const fragment of ["url: '/base/ageDivision/flock/page'", "url: '/base/ageDivision/flock/save'", "url: '/base/ageDivision/flock/edit'", 'url: `/base/ageDivision/flock/${record.id}`', '/^\\d+$/']) expect(batch).toContain(fragment)
    for (const fragment of ['line:', 'variety:', 'gen:', 'moult:', 'ageDiv:', 'min="0"', '必填']) expect(bulkModal).toContain(fragment)
    for (const fragment of ['batch:', 'ageDiv:', 'min="0"', '必填']) expect(batchModal).toContain(fragment)
    for (const fragment of ['@RequestMapping(value = {"flockSimu/base/ageDivision"})', '@GetMapping(value = "/page")', '@GetMapping(value = "/flock/page")', '@GetMapping(value = "/flock_info/{flockInfo}")', '@PostMapping(value = "/save")', '@PostMapping(value = "/flock/save")', '@PostMapping(value = "/flock/edit")', '@DeleteMapping(value = "/flock/{id}")', '@NotEmpty', '@NotNull', '@Min(value = 1']) expect(controller + vo).toContain(fragment)
  })

  it('批量设置列表、按批次查询和默认筛选参数逐字段复刻Portal', async () => {
    const row = { id: 'bulk-1', line: 'L1', gen: 'G1', variety: 'V1', moult: 1, ageDiv: 154, lineName: '品系1', genName: '代次1', varietyName: '品种1', extra: 'keep' }
    const f = fixture([{ page: { list: [row], total: 3 } }, { list: [row] }])
    await expect(f.api.listBulk({ line: 'L1', gen: 'G1', variety: 'V1', moult: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 3 })
    expect(f.calls[0]).toEqual({ url: '/base/ageDivision/page', method: 'get', params: { order: '', orderField: '', line: 'L1', gen: 'G1', variety: 'V1', moult: 1, flockInfo: '', pageNo: 2, pageSize: 50 } })
    await expect(f.api.getBulkByFlockInfo({ flockInfo: 'B/01' })).resolves.toMatchObject({ total: 1, list: [expect.objectContaining({ extra: 'keep' })] })
    expect(f.calls[1]).toEqual({ url: '/base/ageDivision/flock_info/B%2F01', method: 'get' })
    const empty = fixture([])
    await expect(empty.api.getBulkByFlockInfo({ flockInfo: '' })).resolves.toEqual({ list: [], total: 0 })
    expect(empty.calls).toEqual([])
    const defaults = fixture([{ page: { list: [], total: 0 } }])
    await defaults.api.listBulk()
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', line: '', gen: '', variety: '', moult: 0, flockInfo: '', pageNo: 1, pageSize: 20 })
  })

  it('批次设置列表和两套CRUD逐字段使用Portal方法与路径', async () => {
    const row = { id: 'batch-1', batch: 'B-01', ageDiv: 154 }
    const f = fixture([{ page: { list: [row], total: 1 } }, {}, {}, {}, {}])
    await expect(f.api.listBatch({ flockInfo: 'B-01', ageDiv: '154', pageNo: 1, pageSize: 10 })).resolves.toEqual({ list: [row], total: 1 })
    const bulk = f.api.prepareCreateBulk({ line: '', variety: 'V1', gen: 'G1', moult: 0, ageDiv: '154' })
    await f.api.createBulk(bulk)
    const update = f.api.prepareUpdateBulk({ line: 'L1', variety: '', gen: 'G1', moult: 1, ageDiv: 155, id: 'bulk-1' })
    await f.api.updateBulk(update)
    await f.api.removeBulk(f.api.prepareRemoveBulk({ id: 'bulk-1' }))
    const batch = f.api.prepareCreateBatch({ batch: 'B-01', ageDiv: 154 })
    await f.api.createBatch(batch)
    const batchUpdate = f.api.prepareUpdateBatch({ batch: 'B-01', ageDiv: 155, id: row.id })
    await f.api.updateBatch(batchUpdate)
    await f.api.removeBatch(f.api.prepareRemoveBatch({ id: row.id }))
    expect(f.calls).toEqual([
      { url: '/base/ageDivision/flock/page', method: 'get', params: { order: '', orderField: '', flockInfo: 'B-01', ageDiv: '154', pageNo: 1, pageSize: 10 } },
      { url: '/base/ageDivision/save', method: 'post', data: { line: '', gen: 'G1', variety: 'V1', moult: 0, ageDiv: 154 } },
      { url: '/base/ageDivision/save', method: 'post', data: { line: 'L1', gen: 'G1', variety: '', moult: 1, ageDiv: 155, id: 'bulk-1' } },
      { url: '/base/ageDivision/delete', method: 'get', params: { id: 'bulk-1' } },
      { url: '/base/ageDivision/flock/save', method: 'post', data: { batch: 'B-01', ageDiv: 154 } },
      { url: '/base/ageDivision/flock/edit', method: 'post', data: { batch: 'B-01', ageDiv: 155, id: 'batch-1' } },
      { url: '/base/ageDivision/flock/batch-1', method: 'delete' },
    ])
  })

  it('表单、分页、坏响应和权限语义反证会失败而且不发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreateBulk({ line: '', variety: '', gen: 'G1', moult: 0, ageDiv: 1 })).toThrow('至少填一项')
    expect(() => f.api.prepareCreateBulk({ line: 'L1', variety: '', gen: '', moult: 0, ageDiv: 1 })).toThrow('代次')
    expect(() => f.api.prepareCreateBulk({ line: 'L1', variety: '', gen: 'G1', moult: 2, ageDiv: 1 })).toThrow('蛋鸡类型')
    expect(() => f.api.prepareCreateBatch({ batch: '', ageDiv: 1 })).toThrow('批次号')
    expect(() => f.api.prepareCreateBatch({ batch: 'B', ageDiv: 'x' })).toThrow('整数')
    expect(() => f.api.prepareRemoveBulk({ id: '' })).toThrow('ID')
    expect(() => f.api.prepareRemoveBatch({ id: null as never })).toThrow('ID')
    await expect(f.api.listBatch({ ageDiv: '1.5' })).rejects.toThrow('整数')
    await expect(fixture([{ page: { list: [{ id: 'x', moult: 2 }], total: 1 } }]).api.listBulk()).rejects.toThrow('蛋鸡类型')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.listBatch()).rejects.toThrow('有效list或total')
    expect(f.calls).toEqual([])
  })

  it('能力定义和AI契约锁定页面上下文、字段和prepare映射', () => {
    expect(productBusinessAgeDivisionCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_BUSINESS_AGE_DIVISION_METHODS))
    expect(productBusinessAgeDivisionCapabilities.every(item => item.httpInstance === 'product' && item.moduleType === PRODUCT_BUSINESS_AGE_DIVISION_MODULE_TYPE)).toBe(true)
    expect(productBusinessAgeDivisionCapabilities.every(item => item.pagePath === PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH && item.permission === PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION)).toBe(true)
    expect(contracts['product-business-age-division-list-bulk']?.output.fields.some(item => item.path === 'list[].lineName')).toBe(true)
    expect(contracts['product-business-age-division-prepare-create-bulk']?.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    expect(contracts['product-business-age-division-prepare-remove-batch']?.steps[0]?.mapping).toEqual({ id: 'result.id' })
    expect(contracts['product-business-age-division-prepare-create-bulk']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(methodContracts['productBusinessAgeDivision.listBulk']?.boundaries.join('\n')).toContain(PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION)
    expect(methodContracts['productBusinessAgeDivision.listBatch']?.boundaries.join('\n')).toContain(PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION)
  })
})
