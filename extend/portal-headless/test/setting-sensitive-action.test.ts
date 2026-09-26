import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/session/types.js'
import {
  createSettingSensitiveActionCapability,
  SETTING_SENSITIVE_ACTION_METHODS,
  SETTING_SENSITIVE_ACTION_MODULE_TYPE,
  SETTING_SENSITIVE_ACTION_PAGE_PATH,
  SETTING_SENSITIVE_ACTION_PERMISSION,
  settingSensitiveActionCapabilities,
  type SettingSensitiveActionSettings,
} from '../src/capabilities/setting-sensitive-action.js'
import {
  SETTING_SENSITIVE_ACTION_AI_CONTRACTS as contracts,
  SETTING_SENSITIVE_ACTION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-setting-sensitive-action.js'

type RequestConfig = Parameters<PortalRequest>[0]

const current: SettingSensitiveActionSettings = {
  id: '9007199254740993',
  mobile: '13800138000',
  isDel: 0,
  email: 'must-not-be-submitted@example.com',
  creator: 17,
  updateTime: '2026-09-25 10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createSettingSensitiveActionCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 系统设置 → 安全验证页面能力', () => {
  it('逐页核对菜单、页面、子组件、权限指令和 Java 实现', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/hr/setting/sensitive-action.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/sensitive-action/list.vue')
    const changePhone = read(portalRoot, 'app/portal/views/dashboard/hr/setting/sensitive-action/components/change-phone.vue')
    const sensitiveHook = read(portalRoot, 'app/portal/hooks/hr/useSensitiveAction.js')
    const verify = read(portalRoot, 'app/portal/hooks/hr/components/verify.vue')
    const controller = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/controller/HrSensitiveController.java')
    const dto = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/dto/HrSensitiveDTO.java')
    const service = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/service/impl/HrSensitiveServiceImpl.java')
    const sms = read(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/controller/admin/sms/SendSmsController.java')

    expect(menu).toContain(`path: '${SETTING_SENSITIVE_ACTION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_SENSITIVE_ACTION_PERMISSION}'`)
    expect(menu).toContain('title: \'安全验证\'')
    expect(route).toContain('title: 安全验证')
    expect(route).toContain(`permission: ${SETTING_SENSITIVE_ACTION_PERMISSION}`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "id: ''",
      'isDel: 1',
      "mobile: ''",
      "http.get('/org/sensitive/info')",
      "http.put('/org/sensitive', formState)",
      'await fetchSensitive()',
      'formState.isDel = 0',
      'actionIsDelVerify()',
      'actionPhoneVerify',
      'formState.mobile = phone',
      "message.success('保存成功')",
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('permissionCheck(')

    for (const fragment of [
      '@finish="submit"',
      "{ required: true, message: '请输入手机号' }",
      'validator: validatePhone',
      "modalEmit('submit', formState.phone)",
      'oldPhone: { type: String, required: true }',
    ]) expect(changePhone).toContain(fragment)
    for (const fragment of [
      'sensitive.state.isDel === 1',
      "http.get('/sys/sms/send'",
      "templateId: '17709'",
      "http.get('/sys/sms/checkSms'",
      'original: true',
      "if (data.ret !== 'SUCCESS')",
      'message.error(data.msg)',
      "modalEmit('verified')",
    ]) expect(sensitiveHook + verify).toContain(fragment)

    for (const fragment of [
      '@RequestMapping("/org/sensitive")',
      '@GetMapping("/info")',
      '@PutMapping',
      'hrSensitiveService.update(dto)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['Long id', 'String mobile', 'String email', 'Integer isDel', 'Long creator', 'LocalDateTime createTime', 'Long updater', 'LocalDateTime updateTime']) {
      expect(dto).toContain(field)
    }
    expect(service).toContain('queryWrapper.orderByDesc("id")')
    expect(service).toContain('queryWrapper.last("limit 1")')
    expect(controller + service).not.toContain('@PreAuthorize')
    for (const fragment of [
      'private static final String HR_SENSITIVE = "hr-sensitive"',
      '@GetMapping("/send")',
      'String.valueOf(requestId)',
      '@GetMapping("checkSms")',
      'fail(402, "验证码错误")',
    ]) expect(sms).toContain(fragment)

    expect(settingSensitiveActionCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_SENSITIVE_ACTION_METHODS))
    expect(settingSensitiveActionCapabilities.every(item => (
      item.pagePath === SETTING_SENSITIVE_ACTION_PAGE_PATH &&
      item.permission === SETTING_SENSITIVE_ACTION_PERMISSION &&
      item.httpInstance === 'platform' &&
      item.moduleType === SETTING_SENSITIVE_ACTION_MODULE_TYPE
    ))).toBe(true)
  })

  it('按 Portal 顺序读取、准备并精确序列化无短信保存', async () => {
    const f = fixture([current, undefined])
    const loaded = await f.api.get()
    expect(loaded).toMatchObject(current)

    const preparation = f.api.prepareSave({ current: loaded, changes: { isDel: 0 } })
    expect(preparation).toMatchObject({
      draft: { id: current.id, isDel: 0, mobile: current.mobile },
      verificationRequired: false,
      phone: current.mobile,
      verificationReason: 'none',
    })
    await expect(f.api.save({ preparation })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/org/sensitive', method: 'put', data: { id: current.id, isDel: 0, mobile: current.mobile } },
    ])
    expect(f.calls[1]?.data).not.toHaveProperty('email')
    expect(f.calls[1]?.data).not.toHaveProperty('creator')
  })

  it('关闭保护必须先发短信、原始校验成功后才 PUT，且手机修改遵守当前保护状态', async () => {
    const f = fixture([{ requestId: 'sms-17', result: 200 }, { ret: 'SUCCESS', code: 200 }, undefined])
    const preparation = f.api.prepareSave({ current, changes: { isDel: 1 } })
    expect(preparation).toMatchObject({ verificationRequired: true, verificationReason: 'disable-protection', phone: current.mobile })
    await expect(f.api.sendVerificationCode({ preparation })).resolves.toEqual({ requestId: 'sms-17' })
    await expect(f.api.save({ preparation, verification: { requestId: 'sms-17', code: '2468' } })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/sys/sms/send', method: 'get', params: { phone: current.mobile, templateId: '17709' } },
      { url: '/sys/sms/checkSms', method: 'get', params: { code: '2468', requestId: 'sms-17' }, sourceResponse: true },
      { url: '/org/sensitive', method: 'put', data: { id: current.id, isDel: 1, mobile: current.mobile } },
    ])

    const alreadyOpen: SettingSensitiveActionSettings = { ...current, isDel: 1 }
    const phoneFixture = fixture([undefined])
    const phonePreparation = phoneFixture.api.prepareSave({ current: alreadyOpen, changes: { mobile: '13900139000' } })
    expect(phonePreparation).toMatchObject({ verificationRequired: false, verificationReason: 'none' })
    await expect(phoneFixture.api.save({ preparation: phonePreparation })).resolves.toBe(true)
    expect(phoneFixture.calls).toEqual([
      { url: '/org/sensitive', method: 'put', data: { id: current.id, isDel: 1, mobile: '13900139000' } },
    ])
  })

  it('关键表单、权限和序列化反证会失败并阻断请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareSave({ current, changes: { isDel: 2 as 0 | 1 } })).toThrow('0或1')
    expect(() => f.api.prepareSave({ current, changes: { mobile: '1380013800' } })).toThrow('正确的手机号码')
    expect(() => f.api.prepareSave({ current, changes: { mobile: '13800138000', email: 'unexpected' } as never })).toThrow('不支持字段email')
    expect(() => f.api.prepareSave({ current: { ...current, id: '' } })).toThrow('ID')
    expect(f.calls).toEqual([])

    const needsSms = fixture([]).api.prepareSave({ current, changes: { isDel: 1 } })
    const missingVerification = fixture([])
    await expect(missingVerification.api.save({ preparation: needsSms })).rejects.toThrow('需要短信验证')
    expect(missingVerification.calls).toEqual([])

    const noPhone = fixture([])
    const noPhonePreparation = noPhone.api.prepareSave({ current: { ...current, mobile: null }, changes: { isDel: 1 } })
    await expect(noPhone.api.sendVerificationCode({ preparation: noPhonePreparation })).rejects.toThrow('手机号')
    expect(noPhone.calls).toEqual([])

    const failedSms = fixture([{ ret: 'FAIL', code: 402, msg: '验证码错误' }])
    const failedPreparation = failedSms.api.prepareSave({ current, changes: { isDel: 1 } })
    await expect(failedSms.api.save({ preparation: failedPreparation, verification: { requestId: 'sms-bad', code: '0000' } })).rejects.toThrow('验证码错误')
    expect(failedSms.calls).toEqual([
      { url: '/sys/sms/checkSms', method: 'get', params: { code: '0000', requestId: 'sms-bad' }, sourceResponse: true },
    ])
  })

  it('AI 说明逐能力覆盖，并锁定短信、回查和取消语义', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_SENSITIVE_ACTION_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(SETTING_SENSITIVE_ACTION_METHODS).map(method => `settingSensitiveAction.${method}`).sort())
    expect(contracts['setting-sensitive-action-prepare-save']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['setting-sensitive-action-save']?.steps.some(step => step.capabilityId === 'setting-sensitive-action-get')).toBe(true)
    expect(contracts['setting-sensitive-action-save']?.consume.join('\n')).toContain('{ id, isDel, mobile }')
    expect(contracts['setting-sensitive-action-send-verification-code']?.steps[0]?.mapping).toEqual({
      preparation: 'args.preparation',
      'verification.requestId': 'result.requestId',
      'verification.code': 'user.code',
    })

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as {
      validateAiContracts: (value: unknown, options: unknown) => unknown
    }
    expect(validateAiContracts(contracts, { definitions: settingSensitiveActionCapabilities, contracts })).toEqual([])
  })
})
