import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  buildPlatformSystemEmailSetAccountPayload,
  buildPlatformSystemEmailTemplatePayload,
  createPlatformSystemEmailCapability,
  PLATFORM_SYSTEM_EMAIL_MODULE_TYPE,
  PLATFORM_SYSTEM_EMAIL_PAGE_PATH,
  PLATFORM_SYSTEM_EMAIL_PERMISSION,
  platformSystemEmailCapabilities,
} from '../src/capabilities/platform-system-email.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    return results.shift() as T
  }
  return { api: createPlatformSystemEmailCapability(request), calls }
}

const rows = [
  {
    project: 'erp', action: 'order.created',
    mail: { type: 'email', isChoose: 1, title: '邮件' },
    sms: { type: 'sms', isChoose: 0 },
    msgPush: { type: 'app', isChoose: 1 },
    smsSetting: null,
  },
  {
    project: 'erp', action: 'order.paid',
    mail: null,
    sms: { type: 'sms', isChoose: 0 },
    msgPush: null,
    smsSetting: null,
  },
]

describe('Portal 平台设置 → 邮件短信页面能力', () => {
  it('锁定页面、v2权限、platform实例、无module-type和完整动作集合', () => {
    expect(platformSystemEmailCapabilities.map(item => item.id)).toEqual([
      'platform-system-email-list',
      'platform-system-email-prepare-set-account',
      'platform-system-email-set-account',
      'platform-system-email-maintain-template',
      'platform-system-email-get-sms-signature',
      'platform-system-email-prepare-save-sms-signature',
      'platform-system-email-save-sms-signature',
      'platform-system-email-get-email-account',
      'platform-system-email-prepare-save-email-account',
      'platform-system-email-save-email-account',
      'platform-system-email-get-template',
      'platform-system-email-prepare-update-template',
      'platform-system-email-update-template',
    ])
    expect(platformSystemEmailCapabilities.every(item => item.pagePath === PLATFORM_SYSTEM_EMAIL_PAGE_PATH)).toBe(true)
    expect(platformSystemEmailCapabilities.every(item => item.permission === PLATFORM_SYSTEM_EMAIL_PERMISSION)).toBe(true)
    expect(platformSystemEmailCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(platformSystemEmailCapabilities.every(item => item.moduleType === PLATFORM_SYSTEM_EMAIL_MODULE_TYPE)).toBe(true)
    expect(platformSystemEmailCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'platform-system-email-set-account',
      'platform-system-email-maintain-template',
      'platform-system-email-save-sms-signature',
      'platform-system-email-save-email-account',
      'platform-system-email-update-template',
    ])
  })

  it('列表是数组，默认只发送页面公共排序参数并保留渠道字段', async () => {
    const { api, calls } = setup(rows)
    await expect(api.list()).resolves.toEqual(rows)
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/mailSms/list',
      method: 'get',
      params: { order: '', orderField: '' },
    })
  })

  it('底部保存严格复刻页面 mail→sms→msgPush、join和compact规则', async () => {
    expect(buildPlatformSystemEmailSetAccountPayload(rows)).toEqual({
      list: [{ multiType: 'email,app', tmplAction: 'order.created' }],
    })
    const { api, calls } = setup('保存成功')
    await expect(api.setAccount({ rows })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/mall-manage-api/sys/mailSms/setAccount',
      method: 'put',
      data: { list: [{ multiType: 'email,app', tmplAction: 'order.created' }] },
    })
    expect(api.prepareSetAccount({ rows })).toEqual({
      payload: { list: [{ multiType: 'email,app', tmplAction: 'order.created' }] },
    })
  })

  it('初始化模板、短信签名和邮件账号的请求方法及参数不互相混用', async () => {
    const { api, calls } = setup(undefined, '旧签名', '预览签名', '保存成功', {}, '保存成功')
    await api.maintainTemplate()
    await api.getSmsSignature()
    await api.getSmsSignature({ smsSign: '' })
    await api.saveSmsSignature({ smsSign: '新签名' })
    await api.getEmailAccount()
    await api.saveEmailAccount({ account: { smtpServer: 'smtp.example.com', smtpPort: '465', userMail: 'a@example.com' } })
    expect(calls).toEqual([
      { url: '/mall-manage-api/sys/mailSms/maintainTemplate', method: 'get' },
      { url: '/mall-manage-api/sys/mailSms/smsSignSet/get', method: 'get' },
      { url: '/mall-manage-api/sys/mailSms/smsSignSet/get', method: 'get', params: { smsSign: '' } },
      { url: '/mall-manage-api/sys/mailSms/smsSignSet/save', method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: '新签名' },
      { url: '/mall-manage-api/sys/mailSms/mailAccountSet/get', method: 'get' },
      { url: '/mall-manage-api/sys/mailSms/mailAccountSet/save', method: 'post', data: { smtpServer: 'smtp.example.com', smtpPort: '465', userMail: 'a@example.com' } },
    ])
    expect(api.prepareSaveSmsSignature({ smsSign: '新签名' })).toEqual({ payload: '新签名' })
    expect(api.prepareSaveEmailAccount({ account: { userMail: 'a@example.com' } })).toEqual({ payload: { userMail: 'a@example.com' } })
  })

  it('模板读取按 act/type 查询，提交时删除varMap并保留页面字段', async () => {
    const form = {
      title: '订单已创建', content: '订单 {{id}}', action: 'order.created', type: 'sms',
      varMap: 'id=订单号', isEnable: 1, label: '订单短信', extra: 'keep',
    }
    const detail = { ...form }
    const { api, calls } = setup(detail, '保存成功')
    await expect(api.getTemplate({ action: 'order.created', type: 'sms' })).resolves.toEqual(detail)
    expect(api.prepareUpdateTemplate({ form })).toEqual({
      payload: { title: '订单已创建', content: '订单 {{id}}', action: 'order.created', type: 'sms', isEnable: 1, label: '订单短信', extra: 'keep' },
    })
    await api.updateTemplate({ form })
    expect(calls).toEqual([
      { url: '/mall-manage-api/sys/mailSms/getTmplInfo', method: 'get', params: { act: 'order.created', type: 'sms' } },
      { url: '/mall-manage-api/sys/mailSms/editTemplate', method: 'post', data: { title: '订单已创建', content: '订单 {{id}}', action: 'order.created', type: 'sms', isEnable: 1, label: '订单短信', extra: 'keep' } },
    ])
  })

  it('页面必填和响应结构在请求前失败，防止把空表单或分页响应当成合法结果', async () => {
    const { api, calls } = setup()
    await expect(api.setAccount({ rows: [{ ...rows[0], action: '' } as typeof rows[number]] })).rejects.toThrow('action')
    await expect(api.saveSmsSignature({ smsSign: '' })).rejects.toThrow('短信签名')
    await expect(api.updateTemplate({ form: { title: '', content: '正文', action: 'a', type: 'sms', varMap: null, isEnable: 1, label: null } })).rejects.toThrow('模板标题')
    await expect(api.updateTemplate({ form: { title: '标题', content: '', action: 'a', type: 'sms', varMap: null, isEnable: 1, label: null } })).rejects.toThrow('模板内容')
    const malformed = setup({ list: [] })
    await expect(malformed.api.list()).rejects.toThrow('必须是数组')
    expect(calls).toEqual([])
  })
})
