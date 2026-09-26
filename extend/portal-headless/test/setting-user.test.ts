import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingUserCapability,
  SETTING_USER_METHODS,
  SETTING_USER_MODULE_TYPE,
  SETTING_USER_PAGE_PATH,
  SETTING_USER_PERMISSION,
  settingUserCapabilities,
} from '../src/capabilities/setting-user.js'
import { SETTING_USER_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-user.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingUserCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const roleList = [{ id: '7', name: '普通用户' }]
const user = {
  id: '9007199254740993', username: '2026092301', realName: '张三', headUrl: null, gender: 0, email: null, mobile: '13800138000',
  gradeId: null, deptId: null, status: 1, createDate: '2026-09-23 10:00:00', creator: '11', superAdmin: 0, roleIdList: ['7'], gradeName: null,
  roleList, organizationCode: '330100000000001', organizationName: '总部', organizationFullPathName: '总部', organizationId: '88', updaterName: '管理员',
  updateDate: '2026-09-23 10:20:00', creatorName: '管理员', type: 1, project: 2, postId: null, tenantId: '9', tenantAdmin: 0, postName: null, staffId: '101', setPwd: true,
}

describe('Portal 系统设置 → 用户查询页面能力', () => {
  it('逐页锁定菜单、路由、查询表单、编辑表单、权限和module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/common.js')
    const route = read(root, 'app/portal/views/dashboard/hr/setting/user.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/setting/user/list.vue')
    const form = read(root, 'app/portal/views/dashboard/hr/setting/user/[mode]/[id].vue')
    for (const fragment of [`path: '${SETTING_USER_PAGE_PATH}'`, `permission: '${SETTING_USER_PERMISSION}'`]) expect(menu).toContain(fragment)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "getDataListURL: '/sys/user/page'", "deleteURL: '/sys/user'", 'deleteIsBatch: true', 'exportURL:',
      "staffCode: ''", "name: ''", "mobile: ''", "role: ''", "status: ''", "time: []", "useSystemList: '1,2,3,4,5,6'",
      "data.time[0].startOf('date').format('YYYY-MM-DD HH:mm:ss')", "data.time[1].startOf('date').add(1, 'day').format('YYYY-MM-DD HH:mm:ss')", 'rrList.actionEdit(record)',
      "http.post('/sys/user/synchronous')", "message.success('数据同步中，大约需要 5 分钟，请稍候查看')",
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('common-action-delete')
    expect(list).not.toContain('common-action-export')
    for (const fragment of [
      "http.get('/sys/user/getInfo'", "useSystemList: '1,2,3,4,5,6'", "http.post('/sys/user'", "http.put('/sys/user'",
      "http.get('/sys/user/phoneIsExist'", 'validatePhone', 'command:setting-user-role-v2-edit', 'roleIdList',
    ]) expect(form).toContain(fragment)
    expect(settingUserCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_USER_METHODS))
    expect(settingUserCapabilities.every(item => item.pagePath === SETTING_USER_PAGE_PATH && item.permission === SETTING_USER_PERMISSION && item.moduleType === SETTING_USER_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_USER_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 用户Controller、DTO、分页数据权限和编辑服务', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/user/HrSysUserController.java')
    const dto = read(javaRoot, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/hrapi/sysuser/dto/SysUserDTO.java')
    const service = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/service/user/HrSysUserServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/resources/mapper/hrSysUser/SysUserDao.xml')
    for (const fragment of ['@RequestMapping("/sys/user")', '@GetMapping("page")', '@GetMapping("getInfo")', '@PutMapping', '@GetMapping("phoneIsExist")', '@PostMapping("synchronous")', 'public CommonResult synchronousUser()']) expect(controller).toContain(fragment)
    const syncStart = controller.indexOf('@PostMapping("synchronous")')
    const syncEnd = controller.indexOf('@GetMapping("userNotInGrade")', syncStart)
    expect(syncStart).toBeGreaterThanOrEqual(0)
    expect(controller.slice(syncStart, syncEnd)).not.toContain('@RequiresPermissions')
    for (const fragment of ['private Long id', 'private String username', 'private String realName', 'private String mobile', 'private List<Long> roleIdList', 'private Integer status', 'private Long organizationId', 'private Boolean setPwd']) expect(dto).toContain(fragment)
    for (const fragment of ['PageData<SysUserDTO> page(Map<String, Object> params)', 'getListV1(page, params)', 'public SysUserDTO get(Long id)', 'public CommonResult update(SysUserDTO dto)', 'sysRoleUserService.saveOrUpdate', 'phoneIsExist(String phone, Long excludeUserId)', 'public void synchronousUser()', 'REDIS_KEY', 'SYNCHRONOUS_TIME']) expect(service).toContain(fragment)
    for (const fragment of ['getListV1', 'params.name', 'params.staffCode', 'params.mobile', 'params.status', 'params.startTime', 'params.endTime', 'params.organizationIdList']) expect(mapper).toContain(fragment)
  })

  it('按Portal实际请求形状覆盖列表时间转换、详情、手机号检查、prepare和PUT', async () => {
    const f = fixture([{ list: [user], total: 1 }, user, 0, undefined])
    await expect(f.api.list({ staffCode: '2026', role: 7, status: 1, time: ['2026-09-01', '2026-09-15'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [user], total: 1 })
    await expect(f.api.getInfo({ id: user.id })).resolves.toEqual(user)
    await expect(f.api.phoneIsExist({ phone: '13800138000' })).resolves.toBe(0)
    const prepared = f.api.prepareUpdate({ current: user, changes: { realName: '李四', mobile: '13900139000', roleIdList: [8] } })
    expect(prepared.previous).toMatchObject({ id: user.id, realName: user.realName, useSystemList: [1, 2, 3, 4, 5, 6] })
    expect(prepared.draft).toMatchObject({ id: user.id, username: user.username, realName: '李四', mobile: '13900139000', roleIdList: [8], useSystemList: [1, 2, 3, 4, 5, 6] })
    await f.api.update({ draft: prepared.draft })
    expect(f.calls).toEqual([
      { url: '/sys/user/page', method: 'get', params: { order: '', orderField: '', staffCode: '2026', name: '', mobile: '', role: 7, status: 1, useSystemList: '1,2,3,4,5,6', startTime: '2026-09-01 00:00:00', endTime: '2026-09-16 00:00:00', pageNo: 2, pageSize: 50 } },
      { url: '/sys/user/getInfo', method: 'get', params: { id: user.id, useSystemList: '1,2,3,4,5,6' } },
      { url: '/sys/user/phoneIsExist', method: 'get', params: { phone: '13800138000' } },
      { url: '/sys/user', method: 'put', data: { ...user, realName: '李四', mobile: '13900139000', roleIdList: [8], useSystemList: [1, 2, 3, 4, 5, 6] } },
    ])
  })

  it('手机号空值不请求、编辑边界和坏响应显式失败', async () => {
    const f = fixture([])
    await expect(f.api.phoneIsExist({ phone: '' })).resolves.toBe(0)
    await expect(f.api.phoneIsExist({ phone: '123' })).rejects.toThrow('手机号码')
    await expect(f.api.list({ time: ['2026-09-15'] })).rejects.toThrow('两项')
    await expect(f.api.list({ time: ['2026-09-16', '2026-09-15'] })).rejects.toThrow('早于')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [{ ...user, roleList: {} }], total: 1 }]).api.list()).rejects.toThrow('roleList')
    await expect(fixture([{ ...user, id: 0 }]).api.getInfo({ id: 1 })).rejects.toThrow('用户详情')
    await expect(fixture([new Error('权限不足')]).api.list()).rejects.toThrow('权限不足')
    expect(() => f.api.prepareUpdate({ current: user, changes: { status: 0 } as never })).toThrow()
  })

  it('同步动作按 prepare→submit→cancel 执行：POST 无 body，取消不发请求', async () => {
    const f = fixture([undefined])
    const prepared = f.api.prepareSynchronous()
    expect(prepared).toEqual({ draft: { action: 'setting-user-synchronous' } })
    expect(f.api.cancelSynchronous(prepared)).toEqual({ cancelled: true })
    expect(f.calls).toEqual([])

    await expect(f.api.submitSynchronous(prepared)).resolves.toBeUndefined()
    expect(f.calls).toEqual([{ url: '/sys/user/synchronous', method: 'post' }])
  })

  it('同步动作拒绝伪造或缺失的准备草稿，且校验失败不发请求', async () => {
    const f = fixture([])
    expect(() => f.api.cancelSynchronous({ draft: { action: 'wrong-action' } as never })).toThrow('准备草稿')
    await expect(f.api.submitSynchronous({ draft: undefined as never })).rejects.toThrow('对象')
    await expect(f.api.submitSynchronous({ draft: { action: 'wrong-action' } as never })).rejects.toThrow('准备草稿')
    expect(f.calls).toEqual([])
  })

  it('AI说明锁定可达权限、时间开区间、隐藏创建/删除边界和编辑回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_USER_METHODS).sort())
    expect(contracts['setting-user-list']?.consume.join(' ')).toContain('结束日次日')
    expect(contracts['setting-user-list']?.boundaries.join(' ')).toContain('不发布删除')
    expect(contracts['setting-user-update']?.boundaries.join(' ')).toContain('password')
    expect(contracts['setting-user-prepare-update']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['setting-user-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].roleList', 'list[].organizationFullPathName']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
