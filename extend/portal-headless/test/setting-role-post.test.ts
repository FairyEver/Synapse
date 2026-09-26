import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingRolePostCapability,
  SETTING_ROLE_POST_METHODS,
  SETTING_ROLE_POST_MODULE_TYPE,
  SETTING_ROLE_POST_PAGE_PATH,
  SETTING_ROLE_POST_PERMISSION,
  settingRolePostCapabilities,
} from '../src/capabilities/setting-role-post.js'
import { SETTING_ROLE_POST_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-role-post.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingRolePostCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const role = { id: '20', name: '人力管理员', useSystem: 1 }
const row = { postId: '10', postName: '招聘专员', roleNameList: ['人力管理员'], roles: [role] }
const user = { id: '30', realName: '张三', sourceType: 2, orgfullpath: '总部/人力', organization: '40', organizationName: '人力', postName: '招聘专员' }

describe('Portal 系统设置 → 岗位角色页面能力', () => {
  it('逐页锁定菜单、页面动作、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/role-post/list.vue')
    const users = read(portalRoot, 'app/portal/views/dashboard/hr/setting/role-post/components/user-list.vue')
    const setRole = read(portalRoot, 'app/portal/views/dashboard/hr/setting/role-post/components/set-role.vue')
    const roleAll = read(portalRoot, 'app/portal/components/portal/hxr/select/role-all/index.vue')
    const roleBySystem = read(portalRoot, 'app/portal/components/portal/hxr/select/role-by-system/index.vue')
    const platform = read(portalRoot, 'app/portal/utils/http/platform.js')
    for (const fragment of [`path: '${SETTING_ROLE_POST_PAGE_PATH}'`, `permission: '${SETTING_ROLE_POST_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      "customLoad: async form => await http('/org/post/role/page', { params: form })",
      "postName: ''", 'roleId: null', 'getDataListIsPage: true', 'ComponentUserList', 'ComponentSetRole',
    ]) expect(list).toContain(fragment)
    for (const fragment of ["/org/post/role/usersListByPost", 'postId: props.postId', 'realName: null', 'organizationId: null']) expect(users).toContain(fragment)
    for (const fragment of [`http(\`/org/post/role/role/\${props.postId}\`)`, "http.post('/org/post/role'", 'roleIdList', 'new Set']) expect(setRole).toContain(fragment)
    expect(roleAll).toContain("/admin-api/sys/role/allProjectRoleListNotBySystem")
    expect(roleAll).toContain('data: props.project')
    expect(roleBySystem).toContain("/sys/role/listByUseSystem")
    expect(platform).toContain('generateHttpHeaders({ moduleType: config.moduleType })')
    expect(settingRolePostCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_ROLE_POST_METHODS))
    expect(settingRolePostCapabilities.every(item => item.pagePath === SETTING_ROLE_POST_PAGE_PATH && item.permission === SETTING_ROLE_POST_PERMISSION && item.moduleType === SETTING_ROLE_POST_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_ROLE_POST_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定Java端点、字段和全量替换语义', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/post')
    const controller = read(root, 'controller/HrPostRoleController.java')
    const service = read(root, 'service/impl/HrPostRoleServiceImpl.java')
    const dto = read(root, 'dto/HrPostRoleDTO.java')
    const mapper = read(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/organization/post'), 'HrPostRoleDao.xml')
    for (const fragment of [
      '@RequestMapping("/org/post/role")', '@GetMapping("page")', '@GetMapping("role/{postId}")', '@PostMapping',
      '@GetMapping("usersListByPost")', 'postId',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['deleteByPostId(dto.getPostId())', 'dto.getRoleIdList()', 'if (dto.getRoleIdList() != null']) expect(service).toContain(fragment)
    for (const fragment of ['private Long postId', 'private List<Long> roleIdList', 'private List<String> roleNameList']) expect(dto).toContain(fragment)
    for (const fragment of ['selectAllPostPage', 'getRoleListByPostId', 'getUsersByPostId', 'sourceType', 'u.`status` = 1']) expect(mapper).toContain(fragment)
  })

  it('按Portal实际请求形状覆盖列表、候选、人员、准备和全量替换保存', async () => {
    const f = fixture([
      { list: [row], total: 1 },
      [{ id: 1, name: '公共角色', children: [{ id: 2, name: '子角色' }] }],
      [role],
      [role],
      { list: [user], total: 1 },
      undefined,
    ])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.roleFilterOptions()).resolves.toEqual([{ id: 1, name: '公共角色', children: [{ id: 2, name: '子角色', children: [] }] }])
    await expect(f.api.roles({ postId: '10' })).resolves.toEqual([role])
    await expect(f.api.roleOptionsBySystem({ useSystem: 1 })).resolves.toEqual([role])
    await expect(f.api.users({ postId: '10' })).resolves.toEqual({ list: [user], total: 1 })
    await expect(f.api.replace({ draft: f.api.prepareReplace({ postId: '10', roleIdList: ['20', 20, '21'] }).draft })).resolves.toBeUndefined()
    expect(f.calls).toEqual([
      { url: '/admin-api/org/post/role/page', method: 'get', params: { order: '', orderField: '', postName: '', roleId: null, pageNo: 1, limit: 20 } },
      { url: '/admin-api/sys/role/allProjectRoleListNotBySystem', method: 'post', data: [2, 3] },
      { url: '/admin-api/org/post/role/role/10', method: 'get' },
      { url: '/admin-api/sys/role/listByUseSystem', method: 'get', params: { useSystem: 1 } },
      { url: '/admin-api/org/post/role/usersListByPost', method: 'get', params: { order: '', orderField: '', postId: '10', realName: null, organizationId: null, pageNo: 1, limit: 20 } },
      { url: '/admin-api/org/post/role', method: 'post', data: { postId: '10', roleIdList: ['20', 20, '21'] } },
    ])
    expect(f.api.prepareReplace({ postId: 10, roleIdList: [20, '20', 21] })).toEqual({ draft: { postId: 10, roleIdList: [20, '20', 21] } })
  })

  it('筛选、ID、分页、空响应和错误映射在请求前失败且不伪造成功', async () => {
    const f = fixture([])
    await expect(f.api.list({ limit: 30 })).rejects.toThrow('limit')
    await expect(f.api.list({ roleId: 0 })).rejects.toThrow('角色ID')
    await expect(f.api.roles({ postId: 0 })).rejects.toThrow('岗位ID')
    await expect(f.api.roleOptionsBySystem({ useSystem: null as never })).rejects.toThrow('系统类型')
    await expect(f.api.users({ postId: 0 })).rejects.toThrow('岗位ID')
    expect(() => f.api.prepareReplace({ postId: 10, roleIdList: [0] })).toThrow('roleIdList')
    expect(() => f.api.prepareReplace({ postId: 10, roleIdList: null as never })).toThrow('roleIdList')
    expect(f.calls).toEqual([])

    const malformedPage = fixture([{ list: [], total: -1 }])
    await expect(malformedPage.api.list()).rejects.toThrow('有效list或total')
    const malformedTree = fixture([[{ id: 1, name: '角色', children: 'bad' }]])
    await expect(malformedTree.api.roleFilterOptions()).rejects.toThrow('children')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('AI说明覆盖权限边界、生产字段边界、全量替换和回查步骤', () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_ROLE_POST_METHODS).sort())
    expect(contracts['setting-role-post-replace']?.boundaries.join(' ')).toContain('独立生产')
    expect(contracts['setting-role-post-role-options-by-system']?.boundaries.join(' ')).toContain('生产等系统')
    expect(contracts['setting-role-post-replace']?.completion).toContain('回查')
    expect(contracts['setting-role-post-prepare-replace']?.steps.some(step => step.role === 'cancel' && step.instruction.includes('不发送POST'))).toBe(true)
    expect(contracts['setting-role-post-replace']?.inputs['draft.roleIdList']?.meaning).toContain('空数组')
    expect(contracts['setting-role-post-replace']?.steps.find(step => step.capabilityId === 'setting-role-post-roles')?.mapping).toEqual({ postId: 'args.draft.postId' })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    return import(validatorUrl).then(module => {
      const validateAiContracts = (module as { validateAiContracts: (items: Record<string, unknown>) => unknown[] }).validateAiContracts
      expect(validateAiContracts(contracts)).toEqual([])
    })
  })
})
