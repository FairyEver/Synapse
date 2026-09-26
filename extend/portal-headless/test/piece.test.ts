import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  PIECE_METHODS,
  PIECE_MODULE_TYPE,
  PIECE_PAGE_PATH,
  PIECE_PERMISSION,
  PIECE_SHARE_TYPE,
  createPieceCapability,
  pieceCapabilities,
  type PieceForm,
  type PieceRow,
} from '../src/capabilities/piece.js'
import { PIECE_AI_CONTRACTS as contracts, PIECE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-piece.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createPieceCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: PieceForm = {
  softwareNumber: '作品证书001',
  name: '示例作品',
  type: 1,
  author: '张三',
  copyrightOwner: '示例公司',
  completeDate: '2026-01-02',
  isPublish: 1,
  publishDate: '2026-02-02',
  signDate: '2026-03-02',
  organizationId: 8,
  endTime: '2030-06-02',
  remindTime: 6,
  remindUser: ['1001', '1002'],
  pdfUrl: ['https://oss.example/piece.pdf'],
  pdfName: ['piece.pdf'],
}

const detail: PieceRow = {
  id: 101,
  ...form,
  completeDate: form.completeDate,
  publishDate: form.publishDate,
  signDate: form.signDate,
  endTime: form.endTime,
  remindUser: form.remindUser.join(','),
  pdfUrl: form.pdfUrl.join(','),
  pdfName: form.pdfName.join(','),
  typeStr: '软件作品',
  organizationName: '示例公司',
  remindUserName: '张三,李四',
  createTime: '2026-09-23 10:00:00',
  status: 3,
}

describe('Portal 风险防控 → 作品管理页面能力', () => {
  it('逐页锁定菜单、列表、表单、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/works/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/works/[mode]/[id].vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${PIECE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PIECE_PERMISSION}'`)
    for (const fragment of ["'/admin-api/hr/piece/page'", "'/admin-api/hr/piece/delete'", "name: ''", "softwareNumber: ''", "author: ''", "status: ''", 'getDataListIsPage: true', 'actionEdit', 'actionDelete', 'type: 7']) expect(list).toContain(fragment)
    for (const fragment of ['customLoad: async id', "'/admin-api/hr/piece/create'", "'/admin-api/hr/piece/update'", 'formatDay', 'isPublish', ':min="1"', '最多输入五位数', 'file.type === \'application/pdf\'', ':disabled="rrForm.formState.pdfUrl.length > 4"', 'pdfUrl: form.pdfUrl?.join', 'remindUser: form.remindUser ? form.remindUser.join']) expect(formPage).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds']) expect(share).toContain(fragment)
    expect(pieceCapabilities.map(item => item.id)).toEqual(Object.keys(PIECE_METHODS))
    expect(pieceCapabilities.every(item => item.pagePath === PIECE_PAGE_PATH && item.permission === PIECE_PERMISSION && item.moduleType === PIECE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(PIECE_SHARE_TYPE).toBe(7)
    expect(PIECE_METHODS).not.toHaveProperty('piece-export')
  })

  it('逐页锁定 Java CRUD、作品字段、租户对象、状态补充和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/piece/HrPieceController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/piece/vo/HrPieceSaveReqVO.java')
    const page = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/piece/vo/HrPiecePageReqVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/piece/vo/HrPieceRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/piece/HrPieceServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/piece/HrPieceDO.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/piece")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private LocalDate completeDate', 'private Integer isPublish', 'private Long organizationId', 'private LocalDate endTime', 'private Integer remindTime', 'private String remindUser', 'private String pdfUrl']) expect(save).toContain(fragment)
    for (const fragment of ['private String softwareNumber', 'private Integer type', 'private Integer isPublish', 'private Long organizationId']) expect(page).toContain(fragment)
    for (const fragment of ['private String typeStr', 'organizationName', 'private String remindUserName', 'private Integer status']) expect(response).toContain(fragment)
    for (const fragment of ['dealRemindUser', 'setRemindUserInfo', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName("hr_piece")')
    expect(shareEnum).toContain('PIECE(7, "作品")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、创建、更新、删除和共享', async () => {
    const share = { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 1001, managerType: 1 }] }
    const f = fixture([{ list: [detail], total: 1 }, detail, 102, true, true, share, true])
    await expect(f.api.list({ name: '作品', softwareNumber: '证书', author: '张' })).resolves.toEqual({ list: [detail], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(detail)
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(102)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '更新后的作品', remindTime: 12 } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual(share)
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 1001, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/piece/page', method: 'get', params: { order: '', orderField: '', name: '作品', softwareNumber: '证书', author: '张', status: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/piece/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/piece/create', method: 'post', data: { softwareNumber: '作品证书001', name: '示例作品', type: 1, author: '张三', copyrightOwner: '示例公司', completeDate: '2026-01-02', isPublish: 1, publishDate: '2026-02-02', signDate: '2026-03-02', organizationId: 8, endTime: '2030-06-02', remindTime: 6, remindUser: '1001,1002', pdfUrl: 'https://oss.example/piece.pdf', pdfName: 'piece.pdf' } },
      { url: '/admin-api/hr/piece/update', method: 'put', data: { id: 101, softwareNumber: '作品证书001', name: '更新后的作品', type: 1, author: '张三', copyrightOwner: '示例公司', completeDate: '2026-01-02', isPublish: 1, publishDate: '2026-02-02', signDate: '2026-03-02', organizationId: 8, endTime: '2030-06-02', remindTime: 12, remindUser: '1001,1002', pdfUrl: 'https://oss.example/piece.pdf', pdfName: 'piece.pdf' } },
      { url: '/admin-api/hr/piece/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 7, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 7, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 1001 }] } },
    ])
  })

  it('表单规则、附件配对和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, softwareNumber: '' })).toThrow('softwareNumber')
    expect(() => f.api.prepareCreate({ ...form, name: 'x'.repeat(51) })).toThrow('最多50')
    expect(() => f.api.prepareCreate({ ...form, softwareNumber: 'x'.repeat(21) })).toThrow('最多20')
    expect(() => f.api.prepareCreate({ ...form, isPublish: 3 as never })).toThrow('isPublish')
    expect(() => f.api.prepareCreate({ ...form, completeDate: '2026-02-30' })).toThrow('completeDate')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 100000 })).toThrow('remindTime')
    expect(() => f.api.prepareCreate({ ...form, remindUser: [] })).toThrow('remindUser')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: [] })).toThrow('pdfUrl')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: ['a'], pdfName: [] })).toThrow('数量必须一致')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 6 }, (_, i) => `u${i}`), pdfName: Array.from({ length: 6 }, (_, i) => `n${i}`) })).toThrow('最多5')
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('作品ID')
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 0 }] })).rejects.toThrow('organization')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })
})

describe('作品管理 AI 契约', () => {
  it('九个动作和公开方法契约结构通过，后端与真实验证缺口保持显式', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(pieceCapabilities).toHaveLength(9)
    expect(validateAiContracts(contracts, { definitions: pieceCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(PIECE_METHODS).map(method => `piece.${method}`))
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: pieceCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(9).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) expect(contract.gaps?.join(' ')).toContain('尚未在真实测试环境')
  })
})
