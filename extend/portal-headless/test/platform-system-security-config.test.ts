import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import {
  buildPlatformSecurityConfigCreatePayload,
  buildPlatformSecurityConfigMetadataPayload,
  buildPlatformSecurityConfigValuesPayload,
  createPlatformSystemSecurityConfigCapability,
  normalizePlatformSecurityConfigGroups,
  PLATFORM_SECURITY_CONFIG_GROUPS,
  PLATFORM_SECURITY_CONFIG_VALUE_TYPES,
  PLATFORM_SYSTEM_SECURITY_CONFIG_MODULE_TYPE,
  PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH,
  PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION,
  platformSystemSecurityConfigCapabilities,
} from '../src/capabilities/platform-system-security-config.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS } from '../src/catalog/ai-contracts.js'
import { PLATFORM_SYSTEM_SECURITY_CONFIG_AI_CONTRACTS as contracts } from '../src/catalog/contracts-platform-system-security-config.js'
import { createCatalog } from '../src/catalog/index.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    return results.shift() as T
  }
  return { api: createPlatformSystemSecurityConfigCapability(request), calls }
}

const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
const readPortal = (file: string) => readFileSync(join(portalRoot, file), 'utf8')
const readJava = (file: string) => readFileSync(join(javaRoot, file), 'utf8')

const wrapper = 'app/portal/views/dashboard/platform/system/security-config.vue'
const listPage = 'app/portal/views/dashboard/platform/system/security-config/list.vue'
const define = 'app/portal/views/dashboard/platform/system/security-config/define.js'
const menu = 'app/portal/menus/mall.v2.js'
const controller = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/platformconfig/PlatformConfigController.java'
const service = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/service/platformconfig/PlatformConfigServiceImpl.java'
const createDto = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/platformconfig/vo/PlatformConfigCreateReqVO.java'
const updateDto = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/platformconfig/vo/PlatformConfigUpdateReqVO.java'
const valueDto = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/platformconfig/vo/PlatformConfigValueUpdateReqVO.java'
const responseDto = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/adminmanage/platformconfig/vo/PlatformConfigRespVO.java'
const dataObject = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/dal/dataobject/platformconfig/PlatformConfigDO.java'

const row = {
  id: '9007199254740993',
  configKey: 'password.expire.enable',
  configName: '密码过期开关',
  configGroup: 'identity_auth',
  valueType: 'BOOLEAN',
  configValue: 'true',
  defaultValue: 'false',
  optionsJson: null,
  description: '启用密码过期',
  isBuiltin: true,
  sort: 1,
  remark: null,
  updateTime: '2026-09-25T12:00:00',
}

describe('Portal 平台设置 → 安全配置：逐页核对菜单、表单提交、权限和 SDK 契约', () => {
  it('页面路径、权限、platform 实例、无 module-type 与五个固定分组完全对齐', () => {
    const page = readPortal(wrapper)
    const menuSource = readPortal(menu)
    const source = readPortal(define)

    expect(menuSource).toContain(`path: '${PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH}'`)
    expect(menuSource).toContain(`permission: '${PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION}'`)
    expect(menuSource).toContain("title: '安全配置'")
    expect(page).toContain(`permission: ${PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION}`)
    expect(source).toContain("value: 'identity_auth'")
    expect(source).toContain("value: 'session_mgmt'")
    expect(source).toContain("value: 'intrusion_prevention'")
    expect(source).toContain("value: 'audit'")
    expect(source).toContain("value: 'cryptography'")
    expect(source).toContain("value: 'MULTI_CHOICE'")
    expect(PLATFORM_SECURITY_CONFIG_GROUPS).toEqual(['identity_auth', 'session_mgmt', 'intrusion_prevention', 'audit', 'cryptography'])
    expect(PLATFORM_SECURITY_CONFIG_VALUE_TYPES).toEqual(['BOOLEAN', 'INTEGER', 'STRING', 'SINGLE_CHOICE', 'MULTI_CHOICE'])
    expect(platformSystemSecurityConfigCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH)).toBe(true)
    expect(platformSystemSecurityConfigCapabilities.every(item => item.permission === PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION)).toBe(true)
    expect(platformSystemSecurityConfigCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemSecurityConfigCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_SECURITY_CONFIG_MODULE_TYPE)).toBe(true)
  })

  it('逐项锁定 Portal 的本地编辑、整组保存、创建/元数据编辑和内置删除规则', () => {
    const source = readPortal(listPage)
    const defineSource = readPortal(define)

    for (const marker of [
      'const currentConfigs = computed(() => configGroups[activeGroup.value] || [])',
      'function resetCurrentGroup ()',
      'http.put(platformConfigApi.updateValues, buildSavePayload(currentConfigs.value))',
      'buildSavePayload(currentConfigs.value)',
      'buildMetadataPayload(editingConfig)',
      'buildCreatePayload(editingConfig)',
      'v-if="!record.isBuiltin"',
      'http.delete(platformConfigApi.delete, { params: { id: record.id } })',
      'await loadConfigGroups()',
    ]) expect(source).toContain(marker)
    for (const marker of [
      "const apiPrefix = '/adminmanage-api/adminmanage/platform-config'",
      'updateValues: `${apiPrefix}/update-values`',
      "configValue: 'false'",
      "defaultValue: 'false'",
      "optionsJson: null",
      "sort: 99",
      "configValue: item.configValue ?? ''",
      "configValue',\n    'defaultValue'",
      "'id',\n    'configKey'",
    ]) expect(defineSource).toContain(marker)
  })

  it('列表响应按 Portal 规则归一成五组并复刻 Number(id) 排序，未知分组不外泄', async () => {
    const groups = {
      identity_auth: [
        { ...row, id: '10', sort: 1 },
        { ...row, id: '9007199254740994', sort: 1 },
        { ...row, id: '2', sort: 1 },
      ],
      session_mgmt: null,
      audit: [{ ...row, id: '5', configGroup: 'audit', sort: 0, isBuiltin: false }],
      unknown_group: [{ ...row, id: '6' }],
    }
    const { api, calls } = setup(groups)
    await expect(api.list()).resolves.toEqual({
      identity_auth: [
        { ...row, id: '2', sort: 1 },
        { ...row, id: '10', sort: 1 },
        { ...row, id: '9007199254740994', sort: 1 },
      ],
      session_mgmt: [],
      intrusion_prevention: [],
      audit: [{ ...row, id: '5', configGroup: 'audit', sort: 0, isBuiltin: false }],
      cryptography: [],
    })
    expect(calls).toEqual([{ url: '/adminmanage-api/adminmanage/platform-config/list', method: 'get' }])
    const precisionOrder = normalizePlatformSecurityConfigGroups({
      identity_auth: [
        { ...row, id: '9007199254740993', sort: 1 },
        { ...row, id: '9007199254740992', sort: 1 },
      ],
    }).identity_auth
    expect(precisionOrder?.map(item => item.id)).toEqual(['9007199254740993', '9007199254740992'])
  })

  it('整组值保存严格保持 id、空字符串和 Portal 的 PUT 数组形状', async () => {
    const configs = [
      { id: '9007199254740993', configValue: '' },
      { id: 12, configValue: 'false' },
    ]
    expect(buildPlatformSecurityConfigValuesPayload(configs)).toEqual(configs)
    expect(setup().api.prepareUpdateValues(configs)).toEqual({ payload: configs })
    const { api, calls } = setup(true)
    await expect(api.updateValues(configs)).resolves.toBe(true)
    expect(calls).toEqual([{
      url: '/adminmanage-api/adminmanage/platform-config/update-values',
      method: 'put',
      data: configs,
    }])
  })

  it('创建表单复刻五类 valueType 联动默认值，且元数据更新不携带 configValue', async () => {
    expect(buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.integer', configName: '整数', configGroup: 'audit', valueType: 'INTEGER' })).toEqual({
      configKey: 'custom.integer', configName: '整数', configGroup: 'audit', valueType: 'INTEGER',
      configValue: '0', defaultValue: '0', optionsJson: null, description: '', sort: 99, remark: '',
    })
    expect(buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.single', configName: '单选', configGroup: 'audit', valueType: 'SINGLE_CHOICE' })).toMatchObject({
      configValue: '', defaultValue: '', optionsJson: '[]',
    })
    expect(buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.multi', configName: '多选', configGroup: 'audit', valueType: 'MULTI_CHOICE' })).toMatchObject({
      configValue: '[]', defaultValue: '[]', optionsJson: '[]',
    })
    expect(buildPlatformSecurityConfigMetadataPayload({
      id: '9007199254740993', configKey: 'custom.integer', configName: '整数改名', configGroup: 'audit', description: null, sort: null, remark: null,
    })).toEqual({
      id: '9007199254740993', configKey: 'custom.integer', configName: '整数改名', configGroup: 'audit', description: null, sort: null, remark: null,
    })

    const { api, calls } = setup('9007199254740994', true)
    await expect(api.create({ configKey: 'custom.integer', configName: '整数', configGroup: 'audit', valueType: 'INTEGER' })).resolves.toBe('9007199254740994')
    await expect(api.update({ id: '9007199254740994', configKey: 'custom.integer', configName: '整数改名', configGroup: 'audit', description: null, sort: null, remark: null })).resolves.toBe(true)
    expect(calls).toEqual([
      {
        url: '/adminmanage-api/adminmanage/platform-config/create',
        method: 'post',
        data: {
          configKey: 'custom.integer', configName: '整数', configGroup: 'audit', valueType: 'INTEGER',
          configValue: '0', defaultValue: '0', optionsJson: null, description: '', sort: 99, remark: '',
        },
      },
      {
        url: '/adminmanage-api/adminmanage/platform-config/update',
        method: 'put',
        data: { id: '9007199254740994', configKey: 'custom.integer', configName: '整数改名', configGroup: 'audit', description: null, sort: null, remark: null },
      },
    ])
  })

  it('删除只允许 Portal 列表中的自定义项，内置项在请求前失败', async () => {
    const { api, calls } = setup(true)
    expect(api.prepareRemove({ id: '9007199254740993', isBuiltin: false })).toEqual({ id: '9007199254740993', isBuiltin: false })
    expect(() => api.prepareRemove({ id: '9007199254740993', isBuiltin: true })).toThrow('内置')
    await expect(api.remove({ id: '9007199254740993', isBuiltin: true })).rejects.toThrow('内置')
    await expect(api.remove({ id: '9007199254740993', isBuiltin: false })).resolves.toBe(true)
    expect(calls).toEqual([{
      url: '/adminmanage-api/adminmanage/platform-config/delete',
      method: 'delete',
      params: { id: '9007199254740993' },
    }])
  })

  it('页面与 Java 的端点、DTO 校验、值类型校验和权限事实逐条相符', () => {
    const controllerSource = readJava(controller)
    const serviceSource = readJava(service)
    const createSource = readJava(createDto)
    const updateSource = readJava(updateDto)
    const valueSource = readJava(valueDto)
    const responseSource = readJava(responseDto)
    const objectSource = readJava(dataObject)

    for (const marker of [
      '@RequestMapping("/adminmanage/platform-config")',
      '@GetMapping("/list")',
      '@PutMapping("/update-values")',
      '@PostMapping("/create")',
      '@PutMapping("/update")',
      '@DeleteMapping("/delete")',
      '@RequestBody List<PlatformConfigValueUpdateReqVO>',
      'return success(platformConfigService.createPlatformConfig(createReqVO))',
    ]) expect(controllerSource).toContain(marker)
    for (const marker of [
      'config.setIsBuiltin(false)',
      'validateValueMatchType',
      'PLATFORM_CONFIG_KEY_DUPLICATE',
      'PLATFORM_CONFIG_BUILTIN_CANNOT_DELETE',
      'Boolean.TRUE.equals(existing.getIsBuiltin())',
    ]) expect(serviceSource).toContain(marker)
    expect(createSource).toContain('@NotBlank(message = "配置键不能为空")')
    expect(createSource).toContain('@Pattern(regexp = "^[a-z][a-z0-9]*(\\\\.[a-z][a-z0-9]*)+$"')
    expect(updateSource).toContain('@NotNull(message = "ID 不能为空")')
    expect(valueSource).toContain('private Long id;')
    expect(valueSource).toContain('private String configValue;')
    expect(responseSource).toContain('private Boolean isBuiltin;')
    expect(objectSource).toContain('@TableName("system_platform_config")')
    expect(objectSource).toContain('extends BaseDO')
    expect(controllerSource + serviceSource).not.toContain('@PreAuthorize')
  })

  it('九个能力逐项接入调用层、目录和 AI 描述，写入说明保留回查/不可撤销边界', () => {
    const ids = [
      'platform-system-security-config-list',
      'platform-system-security-config-prepare-update-values',
      'platform-system-security-config-update-values',
      'platform-system-security-config-prepare-create',
      'platform-system-security-config-create',
      'platform-system-security-config-prepare-update',
      'platform-system-security-config-update',
      'platform-system-security-config-prepare-remove',
      'platform-system-security-config-remove',
    ]
    const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
    const all = new Map(ALL_CAPABILITY_DEFINITIONS.map(definition => [definition.id, definition]))
    expect(platformSystemSecurityConfigCapabilities.map(item => item.id)).toEqual(ids)
    for (const id of ids) {
      const definition = all.get(id)
      expect(definition).toBeDefined()
      expect(sdkPathOf(id)).toContain('platformSystemSecurityConfig.')
      expect(contracts[id]).toBeDefined()
      expect(AI_CONTRACTS[id]).toEqual(contracts[id])
      const described = catalog.describe(id)
      expect(described.ok).toBe(true)
      if (!described.ok || !described.ai) throw new Error(`缺少 ${id} 的 AI 说明`)
      expect(described.ai).toEqual(contracts[id])
      expect(described.ai.evidence.length).toBeGreaterThan(0)
      expect(described.ai.boundaries.join('\n')).toContain('不发送 module-type')
    }
    const page = catalog.describePage(PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH)
    expect(page.ok).toBe(true)
    if (!page.ok) throw new Error('安全配置页面描述缺失')
    expect(page.capabilities.map(item => item.capabilityId)).toEqual(expect.arrayContaining(ids))
    expect(contracts['platform-system-security-config-prepare-update-values']?.steps[0]).toMatchObject({
      capabilityId: 'platform-system-security-config-update-values',
      mapping: { configs: 'result.payload' },
    })
    expect(contracts['platform-system-security-config-prepare-create']?.steps[0]).toMatchObject({
      capabilityId: 'platform-system-security-config-create',
      mapping: { form: 'result.payload' },
    })
    expect(contracts['platform-system-security-config-prepare-remove']?.steps[0]).toMatchObject({
      capabilityId: 'platform-system-security-config-remove',
      mapping: { record: 'result.$' },
    })
    expect(contracts['platform-system-security-config-create']?.inputs['form.configKey']?.constraints).toContain('Java create 正则：^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$')
    expect(contracts['platform-system-security-config-create']?.inputs['form.configValue']?.type).toBe('string | null')
  })

  it('畸形响应、非法分组/类型、非法 ID 和非法值在发请求前失败', async () => {
    expect(() => normalizePlatformSecurityConfigGroups({ identity_auth: [{ ...row, id: '0' }] })).toThrow('正整数')
    expect(() => normalizePlatformSecurityConfigGroups({ identity_auth: 'bad' })).toThrow('必须是数组')
    expect(() => buildPlatformSecurityConfigCreatePayload({ configKey: '', configName: '名称', configGroup: 'audit' })).toThrow('配置键')
    expect(() => buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.key', configName: '', configGroup: 'audit' })).toThrow('配置名称')
    expect(buildPlatformSecurityConfigCreatePayload({ configKey: ' ', configName: ' ', configGroup: 'audit' })).toMatchObject({ configKey: ' ', configName: ' ' })
    expect(() => buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.key', configName: '名称', configGroup: 'not-supported' })).toThrow('配置分组')
    expect(() => buildPlatformSecurityConfigCreatePayload({ configKey: 'custom.key', configName: '名称', configGroup: 'audit', valueType: 'DATE' })).toThrow('值类型')
    expect(() => buildPlatformSecurityConfigValuesPayload([{ id: '1', configValue: 1 } as never])).toThrow('必须为字符串')
    const { api, calls } = setup()
    await expect(api.remove({ id: 0, isBuiltin: false })).rejects.toThrow('正整数')
    expect(calls).toEqual([])
  })
})
