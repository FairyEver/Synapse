import { describe, expect, it } from 'vitest'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createCatalog } from '../src/catalog/index.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
const installed = ALL_CAPABILITY_DEFINITIONS.some(d => d.id === 'ai-knowledge-workspace-set-permission')
function get(id: string) {
  const d = catalog.describe(id)
  if (!d.ok || !d.ai) throw new Error(`Missing ${id}`)
  return { ...d, ai: d.ai }
}

describe.skipIf(!installed)('权限与接口删除按 Portal 可见交互验收', () => {
  it('保存是权限弹窗完成条件，重新打开与失败核实分别是可选和恢复步骤', () => {
    const d = get('ai-knowledge-workspace-set-permission')
    expect(d.ai.completion).toContain('保存请求成功即完成 Portal 权限弹窗的保存动作')
    expect(d.ai.steps.find(s => s.role === 'optional')?.mapping).toEqual({ id: 'args.id' })
    expect(d.ai.steps.find(s => s.role === 'recovery')).toMatchObject({
      capabilityId: 'ai-knowledge-workspace-permission-get', mapping: { id: 'args.id' },
    })
    expect(d.ai.steps.filter(s => s.role === 'required')).toHaveLength(1)
    expect(d.ai.steps.find(s => s.role === 'required')?.when).toContain('尚未读取当前值')
    expect(d.ai.gaps ?? []).toEqual([])
    expect(d.returns.fields?.find(f => f.path === '$')?.meaning).toContain('保存成功提示')
    const page = catalog.describePage(ALL_CAPABILITY_DEFINITIONS.find(c => c.id === 'ai-knowledge-workspace-set-permission')!.pagePath)
    if (!page.ok) throw new Error('page missing')
    expect(page.capabilities.find(c => c.capabilityId === 'ai-knowledge-workspace-set-permission')?.effect).toBe('write')
  })

  it('保留四项页面字段与已知回显歧义，不把空用户组解释成确定权限', () => {
    const d = get('ai-knowledge-workspace-permission-get')
    expect(d.returns.fields?.filter(f => !f.path.includes('[]')).map(f => f.path)).toEqual([
      'isAllManager', 'authManagerIds', 'authRoleIds', 'auditorId',
    ])
    expect(d.ai.completion).toContain('按页面空选项显示')
    expect(d.ai.completion).toContain('不推断为全部用户或无人有权')
    expect(d.returns.fields?.find(f => f.path === 'authRoleIds[]')?.meaning).toContain('contract-support-role-search.list[].id')
    expect(get('ai-knowledge-workspace-set-permission').ai.inputs.authRoleIds?.lookup?.valueField).toBe('list[].id')
  })

  it('Portal取消是放弃未保存表单，兼容cancel方法是重新保存而非完整回滚', async () => {
    const d = catalog.describeMethod('aiKnowledge.cancelSetPermission')
    if (!d.ok) throw new Error('method missing')
    expect(d.ai.effect).toBe('write')
    expect(d.ai.purpose).toContain('不是 Portal 的取消按钮')
    expect(d.ai.whenToUse).toContain('尚未保存时直接放弃草案')
    expect(d.ai.completion).toContain('不能将它描述为完整回滚')
    expect(d.ai.gaps ?? []).toEqual([])
    // 独立构造页面可填写的旧表单：恢复实质仍是同一个 PUT，不存在事务撤销端点。
    const modulePath = '../src/capabilities/ai-knowledge.js'
    const { createAiKnowledgeCapability } = await import(modulePath)
    const requests: unknown[] = []
    const request = async (config: unknown) => { requests.push(config); return null }
    const sdk = createAiKnowledgeCapability(request, request)
    await sdk.cancelSetPermission({ id: 71, previous: { isAllManager: 2, authRoleIds: [19], auditorId: 8 } })
    expect(requests).toEqual([expect.objectContaining({
      url: '/manager/knowledgeFile/setPermission', method: 'put',
      data: { id: 71, isAllManager: 2, authRoleIds: '19', authManagerIds: null, auditorId: 8 },
    })])
  })

  it('接口删除尊重页面真值保护，但不新增全库无绑定证明条件', () => {
    const d = get('ai-open-api-registry-remove')
    expect(d.ai.effect).toBe('prepare')
    expect(d.params.find(p => p.name === 'id')?.description).not.toContain('不做预检查')
    expect(d.ai.inputs.id?.source).toContain('同一 SDK 实例')
    expect(get('ai-open-api-registry-list').returns.fields?.find(f => f.path === 'list[].isBound')).toMatchObject({ type: 'boolean', optional: true })
    expect(get('ai-open-api-registry-list').ai.steps.find(s => s.capabilityId === 'ai-open-api-registry-remove')?.mapping).toEqual({ id: 'result.list[].id' })
    const text = d.ai.boundaries.join(' ')
    expect(text).toContain('isBound 为真')
    expect(text).toContain('停止删除')
    expect(text).toContain('false 或缺席时页面允许继续')
    expect(text).toContain('不要求遍历技能或提供独立解绑证明')
    expect(d.ai.steps.find(s => s.role === 'optional')?.sdkPath).toBe('aiPromptTool.openApiRegistry.submit')
    expect(d.ai.steps.find(s => s.role === 'optional')?.mapping).toEqual({ plan: 'result.$' })
  })
})
