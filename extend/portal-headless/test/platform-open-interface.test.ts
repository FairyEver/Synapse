import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import {
  PLATFORM_OPEN_INTERFACE_PAGE_PATH,
  PLATFORM_OPEN_INTERFACE_PERMISSION,
  PLATFORM_OPEN_INTERFACE_SOURCE_IDS,
  platformOpenInterfaceCapabilityId,
} from '../src/capabilities/platform-open-interface.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'
import { AI_PROMPT_CONTRACTS } from '../src/catalog/contracts-ai-prompt.js'
import { createCatalog } from '../src/catalog/index.js'

const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
const readPortal = (file: string) => readFileSync(join(portalRoot, file), 'utf8')
const readJava = (file: string) => readFileSync(join(javaRoot, file), 'utf8')

const listWrapper = 'app/portal/views/dashboard/platform/setting/open-interface/list.vue'
const formWrapper = 'app/portal/views/dashboard/platform/setting/open-interface/[mode]/[id].vue'
const sharedList = 'app/portal/views/dashboard/platform/intelligence/prompt/interface/list.vue'
const sharedForm = 'app/portal/views/dashboard/platform/intelligence/prompt/interface/[mode]/[id].vue'
const api = 'app/portal/views/dashboard/platform/intelligence/prompt/interface/api.js'
const menu = 'app/portal/menus/mall.v2.js'
const controller = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/openapi/OpenApiController.java'
const service = 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/service/openapi/OpenApiServiceImpl.java'

const aliasToSdkPath: Record<string, string> = {
  'platform-open-interface-list': 'aiPromptTool.openApiRegistry.list',
  'platform-open-interface-get': 'aiPromptTool.openApiRegistry.get',
  'platform-open-interface-scan': 'aiPromptTool.openApiRegistry.scan',
  'platform-open-interface-create': 'aiPromptTool.openApiRegistry.prepareCreate',
  'platform-open-interface-update': 'aiPromptTool.openApiRegistry.prepareUpdate',
  'platform-open-interface-remove': 'aiPromptTool.openApiRegistry.prepareRemove',
}

describe('平台设置 → 开放平台：逐页对齐 Portal wrapper、表单、权限和 SDK 契约', () => {
  it('菜单入口和两个 wrapper 使用独立路径/权限，但复用 Portal 共享页面', () => {
    const list = readPortal(listWrapper)
    const form = readPortal(formWrapper)
    const menuSource = readPortal(menu)

    expect(menuSource).toContain(`path: '${PLATFORM_OPEN_INTERFACE_PAGE_PATH}'`)
    expect(menuSource).toContain(`permission: '${PLATFORM_OPEN_INTERFACE_PERMISSION}'`)
    expect(menuSource).toContain("title: '开放平台'")
    expect(list).toContain(`permission: ${PLATFORM_OPEN_INTERFACE_PERMISSION}`)
    expect(list).toContain('<ListPage show-enabled editable/>')
    expect(list).toContain("app/portal/views/dashboard/platform/intelligence/prompt/interface/list.vue")
    expect(form).toContain('<FormPage show-enabled/>')
    expect(form).toContain("app/portal/views/dashboard/platform/intelligence/prompt/interface/[mode]/[id].vue")
  })

  it('共享列表和表单的筛选、提交、参数树与删除规则没有被 alias 弱化', () => {
    const list = readPortal(sharedList)
    const form = readPortal(sharedForm)
    const apiSource = readPortal(api)

    for (const marker of [
      'customLoad: getOpenApiRegistryPage',
      'customDelete: deleteOpenApiRegistry',
      'getDataListIsPage: true',
      "pageSizeOptions: ['10', '20', '50']",
      "name: '',",
      "status: '',",
      "enabled: '',",
      'record.isBound',
    ]) expect(list).toContain(marker)
    for (const marker of [
      'name: [',
      '仅支持中文、英文、数字、下划线',
      '最多 50 个字符',
      'name: [',
      'httpMethod: [',
      'apiPath: [',
      '请输入正确的 URL',
      'groupName: [',
      'scopeKey: [',
      'description: [',
      'sort: [',
      'validateInterfaceParams(form.params, true)',
      'createOpenApiRegistry(form)',
      'updateOpenApiRegistry(form)',
    ]) expect(form).toContain(marker)
    for (const marker of [
      "OPEN_API_REGISTRY_PAGE_URL = '/admin-api/system/openApiRegistry/getByPage'",
      "OPEN_API_REGISTRY_DETAIL_URL = '/admin-api/system/openApiRegistry/get'",
      "OPEN_API_REGISTRY_DELETE_URL = '/admin-api/system/openApiRegistry/delete'",
      'responseExample: form.responseExample || form.responseResult ||',
      'sort: String(form.sort || \'\')',
      'params: normalizeParamTreeForSubmit(form.params)',
      '`${OPEN_API_REGISTRY_DELETE_URL}/${record.id}`',
      'params: { id: record.id }',
    ]) expect(apiSource).toContain(marker)
  })

  it('后端端点和权限事实与 Portal 页面说明一致：普通接口不臆加全局权限，Webhook 才特殊校验', () => {
    const controllerSource = readJava(controller)
    const serviceSource = readJava(service)

    for (const marker of [
      '@RequestMapping("/system/openApiRegistry")',
      '@PostMapping("/create")',
      '@PostMapping("/update")',
      '@DeleteMapping("/delete/{id}")',
      '@GetMapping("/get/{id}")',
      '@GetMapping("/getByPage")',
      '@GetMapping("/scanByUrl")',
      'WEBHOOK_PERMISSION',
      'WEBHOOK_WRITE_DESCRIPTION',
    ]) expect(controllerSource + serviceSource).toContain(marker)
    expect(serviceSource).toContain('private static final String WEBHOOK_PERMISSION = "/dashboard/platform/setting/open-interface"')
    expect(serviceSource).toContain('requireWebhookPermission(reqVO.getApiPath())')
    expect(serviceSource).toContain('requireWebhookPermission(existing.getApiPath())')
    expect(serviceSource).toContain('requireWebhookPermission(validateOpenApiExists(id).getApiPath())')
    expect(serviceSource).toContain('if (isWeComWebhook(apiPath) && !securityFrameworkService.hasPermission(WEBHOOK_PERMISSION))')
  })

  it('六个 alias 能力逐项绑定到真实 SDK 方法，并具有独立页面上下文和 AI 说明', () => {
    const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
    const all = new Map(ALL_CAPABILITY_DEFINITIONS.map(definition => [definition.id, definition]))

    for (const sourceId of PLATFORM_OPEN_INTERFACE_SOURCE_IDS) {
      const aliasId = platformOpenInterfaceCapabilityId(sourceId)
      const source = all.get(sourceId)
      const alias = all.get(aliasId)
      expect(source).toBeDefined()
      expect(alias).toBeDefined()
      expect(alias).toMatchObject({
        pagePath: PLATFORM_OPEN_INTERFACE_PAGE_PATH,
        permission: PLATFORM_OPEN_INTERFACE_PERMISSION,
        write: source?.write,
        params: source?.params,
      })
      expect(sdkPathOf(aliasId)).toBe(aliasToSdkPath[aliasId])
      expect(AI_PROMPT_CONTRACTS[aliasId]).toBeDefined()
      const described = catalog.describe(aliasId)
      expect(described.ok).toBe(true)
      if (!described.ok || !described.ai) throw new Error(`缺少 ${aliasId} 的 AI 说明`)
      expect(described.ai).toEqual(AI_PROMPT_CONTRACTS[aliasId])
      expect(described.ai.evidence.length).toBeGreaterThan(0)
      const page = catalog.describePage(PLATFORM_OPEN_INTERFACE_PAGE_PATH)
      expect(page.ok).toBe(true)
      if (!page.ok) throw new Error('开放平台页面描述缺失')
      expect(page.capabilities.some(capability => capability.capabilityId === aliasId)).toBe(true)
    }
  })
})
