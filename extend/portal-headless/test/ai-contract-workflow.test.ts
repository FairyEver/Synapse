import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createCatalog } from '../src/catalog/index.js'
import { WORKFLOW_AI_CONTRACTS, WORKFLOW_METHOD_CONTRACTS } from '../src/catalog/contracts-workflow.js'
import type { AiContract } from '../src/catalog/ai-contract.js'
import { createMeetingApplicationCapability } from '../src/capabilities/meeting-application.js'
import { createTaskActionCapability } from '../src/capabilities/task-action.js'
import { buildProcessVariables, buildTravelPayload, calculateAmount, entryTravelTotal } from '../src/capabilities/travel-expense-application.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
const scope = /^(meeting-application-|meeting-room-(list|usage)$|meeting-user-search$|general-approval-|leave-application-|vehicle-application-|travel-expense-|product-design-approval-|task-action-|overtime-application-|rest-leave-application-|business-trip-application-)/
function ai (id: string): AiContract {
  const result = catalog.describe(id)
  expect(result.ok, id).toBe(true)
  if (!result.ok || !result.ai) throw new Error(`Missing SDK AI description: ${id}`)
  return result.ai
}
function field (id: string, path: string) {
  const found = ai(id).output.fields.find(f => f.path === path)
  expect(found, `${id} output field ${path}`).toBeDefined()
  return found!
}
function assertTaskStates (contract: AiContract) {
  const status = contract.output.fields.find(f => f.path === '[].status')
  expect(status?.values?.['0']).toContain('待审批')
  expect(status?.values?.['1']).toBe('审批中')
  expect(status?.values?.['6']).toBe('委派中')
  expect(contract.consume.join(' ')).toContain('status===1 或 status===6')
}
function assertVehicleMapping (contract: AiContract) {
  expect(contract.inputs.staffId?.lookup?.valueField).toBe('list[].staffId')
  expect(contract.inputs.staffId?.lookup?.capabilityId).toBe('vehicle-application-applicant-picker')
  expect(contract.inputs.startUserSelectAssignees?.lookup?.valueField).toBe('list[].id')
}
function assertMeetingPrepare (contract: AiContract) {
  expect(contract.effect).toBe('prepare')
  expect(contract.consume.join(' ')).toContain('不建单')
  expect(contract.output.fields.find(f => f.path === 'tasks[].id')?.meaning).toContain('startUserSelectAssignees')
}

describe('workflow AI contracts at the public SDK description boundary', () => {
  it('covers the complete currently registered workflow scope and keeps both description entrances consistent', () => {
    const definitions = ALL_CAPABILITY_DEFINITIONS.filter(d => scope.test(d.id))
    expect(Object.keys(WORKFLOW_AI_CONTRACTS).sort()).toEqual(definitions.map(d => d.id).sort())
    for (const def of definitions) {
      const contract = ai(def.id)
      const result = catalog.describe(`${def.id}-llm`)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.ai).toEqual(contract)
      expect(result.invoke?.sdkPath).toBe(sdkPathOf(def.id))
      expect(result.returns.fields).toEqual(contract.output.fields)
      expect(contract.output.shape, def.id).not.toBe('')
      expect(contract.output.fields.length, def.id).toBeGreaterThan(0)
      expect(contract.completion, def.id).not.toBe('')
      for (const p of def.params) expect(contract.inputs[p.name], `${def.id}.${p.name}`).toBeDefined()
      for (const next of contract.steps) if (next.capabilityId) {
        const target = catalog.describe(next.capabilityId)
        expect(target.ok, `${def.id} -> ${next.capabilityId}`).toBe(true)
        if (target.ok) for (const parameter of Object.keys(next.mapping ?? {})) expect(target.params.some(p => p.name === parameter), `${next.capabilityId}.${parameter}`).toBe(true)
      }
      for (const param of Object.values(contract.inputs)) if (param.lookup) {
        expect(catalog.describe(param.lookup.capabilityId).ok, `${def.id} candidate ${param.lookup.capabilityId}`).toBe(true)
      }
      const page = catalog.describePage(def.pagePath)
      expect(page.ok, def.pagePath).toBe(true)
      if (page.ok) expect(page.capabilities.find(c => c.capabilityId === def.id)?.purpose).toBe(contract.purpose)
    }
  })

  it('meeting prepare describes the real browser payload and never claims to reserve a room', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/meeting-application-write.browser.json', import.meta.url), 'utf8'))
    const payload = JSON.parse(baseline['同一提交动作的前一步'].body)
    const cap = createMeetingApplicationCapability(async <T>() => [] as T)
    const actual = await cap.prepare(payload)
    expect(actual.payload).toEqual(payload)
    expect(actual.payload.id).toBeNull()
    expect(field('meeting-application-prepare', 'payload.id').type).toBe('null')
    assertMeetingPrepare(ai('meeting-application-prepare'))
    for (const key of Object.keys(actual.payload)) expect(ai('meeting-application-prepare').output.fields.some(f => f.path === `payload.${key}`), key).toBe(true)
    expect(ai('meeting-room-usage').output.shape).toContain('meetingRooms')
    expect(ai('meeting-application-submit').steps.find(s => s.role === 'cancel')?.mapping).toEqual({ id: 'result.$' })
    expect(ai('meeting-application-cancel').idempotency).toContain('没有短窗口防重')
  })

  it('general and product design workflows preserve dynamic node IDs, ordered people and separate process keys', () => {
    for (const id of ['general-approval', 'product-design-approval']) {
      expect(field(`${id}-prepare`, 'tasks[].id').meaning).toContain('不能用节点名称')
      expect(field(`${id}-prepare`, 'tasks[].selectionOrderRequired').meaning).toContain('数组顺序')
      expect(ai(`${id}-submit`).inputs.startUserSelectAssignees?.source).toContain(`${id}-prepare`)
      expect(ai(`${id}-submit`).steps.find(s => s.role === 'cancel')?.role).toBe('cancel')
    }
    expect(ai('general-approval-definition').inputs.key?.default).toBe('hr_general_approval')
    expect(ai('product-design-approval-definition').inputs.key?.default).toBe('hr_product_design_approval')
    expect(field('product-design-approval-preview', 'nodes[].nodeId').meaning).toContain('不是实例 taskId')
    expect(field('product-design-approval-preview', 'nodes[].candidateUsers[].id')).toBeDefined()
  })

  it('leave detail cannot lose the original business key or invent restDay/processInstanceId', () => {
    expect(field('leave-application-detail', 'id').nullable).toBe(true)
    expect(field('leave-application-detail', 'id').meaning).toContain('恒为 null')
    expect(ai('leave-application-detail').output.fields.some(f => f.path === 'restDay' || f.path === 'processInstanceId')).toBe(false)
    expect(field('leave-application-submit', '$').meaning).toContain('最后一行 ID')
    expect(field('leave-application-profile', 'fullPath').meaning).toContain('不是 organizationFullPathName')
    expect(field('leave-application-year-rest', 'unRest').meaning).toContain('负数或半天')
    expect(ai('leave-application-duration').consume.join(' ')).toContain('婚假 type=7')
    expect(ai('leave-application-prepare').consume.join(' ')).toContain('type=3/4/7/8/9')
  })

  it('vehicle staff identifiers and approval user identifiers are not interchangeable', () => {
    assertVehicleMapping(ai('vehicle-application-submit'))
    expect(field('vehicle-application-applicant-picker', 'list[].staffId').meaning).toContain('不是 userId')
    expect(field('vehicle-application-detail', 'processInstanceId').meaning).toContain('cancel.processInstanceId')
    expect(ai('vehicle-application-detail').consume.join(' ')).toContain('status 仍可能为 0')
    expect(field('vehicle-application-detail', 'statusName').meaning).toContain('null')
  })

  it('travel totals include tax once, and preview variables match the execution code rather than guessed parameter names', () => {
    const entry = { startEndDate: ['2026-09-22', '2026-09-23'] as [string, string], startRegion: ['1', '2', '3'], endRegion: ['4', '5', '6'], startAddress: '出发地', endAddress: '目的地', trafficAmount: 100, foodAmount: 20, housingAmount: 30, otherAmount: 4, inputTaxAmount: 5 }
    expect(entryTravelTotal(entry)).toBe(154)
    expect(calculateAmount([entry])).toBe(159)
    const c = ai('travel-expense-prepare')
    const payload = buildTravelPayload({ orgId: '34', projectExpense: false, travelerIds: [1], reasons: '差旅事由', feePurpose: '费用用途', paymentDate: '2026-10-01', travelEntryList: [entry], attachments: [{name: '票据.pdf', url: 'https://example.invalid/receipt.pdf'}] })
    for (const name of Object.keys(payload)) expect(c.output.fields.some(f => f.path === `payload.${name}`), name).toBe(true)
    expect(payload.attachmentList).toHaveLength(1)
    expect(c.output.fields.some(f => f.path === 'payload.attachments')).toBe(false)
    expect(field('travel-expense-detail', 'attachmentList[].size').unit).toBe('字节')
    expect(c.output.fields.find(f => f.path === 'payload.travelEntryList[].travelTotalAmount')?.meaning).toContain('不含进项税')
    expect(c.output.fields.find(f => f.path === 'amount')?.meaning).toContain('进项税')
    const variables = buildProcessVariables({ orgId: '34', projectExpense: true } as Parameters<typeof buildProcessVariables>[0])
    expect(variables).toEqual({ 费用申请类型: '项目费用', targetOrgId: 34 })
    for (const name of Object.keys(variables)) expect(c.output.fields.some(f => f.path === `variables.${name}`), name).toBe(true)
    expect(c.output.fields.some(f => f.path === 'variables.orgId' || f.path === 'variables.projectExpense')).toBe(false)
    expect(c.steps[0]?.instruction).toContain('不传 startUserSelectAssignees')
    expect(c.gaps?.join(' ')).not.toContain('课题负责人')
    expect(field('travel-expense-prepare', 'variables.课题负责人').meaning).toContain('员工 ID')
    expect(field('travel-expense-project-principal', 'status').values).toEqual({ '0': '停用', '1': '启用' })
    expect(ai('travel-expense-project-principal').inputs.id?.lookup?.valueField).toBe('[].id')
    expect(ai('travel-expense-submit').prerequisites.join(' ')).toContain('不会再次调用审批预览')
    expect(field('travel-expense-detail', 'travelerIds').type).toBe('string')
  })

  it('overtime, rest leave and business trip describe different units and derived identities', () => {
    expect(field('overtime-application-prepare', 'derived.overtimeHours').meaning).toContain('保留 1 位小数')
    expect(field('overtime-application-prepare', 'derived.applyDate').meaning).toContain('不是加班日期')
    expect(field('rest-leave-application-prepare', 'derived.leaveType').values).toEqual({ '0': '调休' })
    expect(field('rest-leave-application-remaining-hours', '$').meaning).toContain('null 被 SDK 归一为 0')
    expect(ai('business-trip-application-prepare').inputs.companions?.meaning).toContain('自由文本')
    expect(field('business-trip-application-prepare', 'derived.applyPostId').meaning).toContain('后端校验岗位存在')
    expect(ai('business-trip-application-detail').consume.join(' ')).toContain('status 仍可能为 0')
    expect(ai('business-trip-application-detail').output.fields.some(f => f.path === 'processInstanceId')).toBe(false)
  })

  it('workflow-path describes the actual flat result and actionable task states', async () => {
    const tree = [{ id: 'cancelled', status: 4, children: [{ id: 'hidden', status: 1 }] }, { id: 'waiting', status: 0, assigneeUser: { id: 17 }, children: [{ id: 'running', status: 1, assigneeUser: { id: 17 } }, { id: 'delegated', status: 6, assigneeUser: { id: '17' } }] }]
    const cap = createTaskActionCapability(async <T>() => tree as T)
    const result = await cap.workflowPath('pi')
    expect(result.map(x => x.id)).toEqual(['waiting', 'running', 'delegated'])
    expect((await cap.myRunningTasks('pi', 17)).map(x => x.id)).toEqual(['running', 'delegated'])
    expect(ai('task-action-workflow-path').output.shape).toContain('已经展平')
    assertTaskStates(ai('task-action-workflow-path'))
    expect(ai('task-action-return-options').steps[0]?.mapping).toMatchObject({ targetTaskDefinitionKey: 'result.[].taskDefinitionKey' })
    expect(ai('task-action-transfer').purpose).toContain('不再持有')
    expect(ai('task-action-delegate').purpose).toContain('回到原持有人')
    expect(ai('task-action-return').purpose).toContain('不是取消流程')
    for (const suffix of ['approve', 'reject', 'transfer', 'delegate', 'return', 'batch-approve', 'batch-reject']) {
      expect(field(`task-action-${suffix}`, '$').type).toBe('boolean')
      expect(ai(`task-action-${suffix}`).inputs.requestId).toBeDefined()
      expect(ai(`task-action-${suffix}`).boundaries.join(' ')).toContain('第二个授权测试账号')
    }
  })

  it('unregistered business facades are available through describeMethod, with explicit signatures and correct result shapes', () => {
    for (const sdkPath of Object.keys(WORKFLOW_METHOD_CONTRACTS)) {
      const result = catalog.describeMethod(sdkPath)
      expect(result.ok, sdkPath).toBe(true)
      if (result.ok) expect(result.ai).toEqual(WORKFLOW_METHOD_CONTRACTS[sdkPath])
    }
    const payee = catalog.describeMethod('travelExpense.payeeOptions')
    expect(payee.ok).toBe(true)
    if (payee.ok) {
      expect(payee.ai.output.shape).toContain('不是分页对象')
      expect(payee.ai.output.fields.find(f => f.path === '[].bankAccounts[].bankAccount')?.meaning).toContain('receivingAccount')
    }
    const current = catalog.describeMethod('taskAction.currentUserId')
    expect(current.ok && current.ai.output.shape).toBe('number | undefined')
    const raw = catalog.describeMethod('generalApproval.submit')
    expect(raw.ok && raw.ai.inputs.requestId).toBeUndefined()
    expect(raw.ok && raw.ai.idempotency).toContain('不防重')
  })

  it('counterexamples reject a removed preparation side-effect rule, wrong task state, and staff/user ID mapping swap', () => {
    const noSideEffect = structuredClone(ai('meeting-application-prepare'))
    noSideEffect.consume = noSideEffect.consume.filter(line => !line.includes('不建单'))
    expect(() => assertMeetingPrepare(noSideEffect)).toThrow()
    const wrongState = structuredClone(ai('task-action-workflow-path'))
    wrongState.output.fields.find(f => f.path === '[].status')!.values!['0'] = '审批中'
    expect(() => assertTaskStates(wrongState)).toThrow()
    const wrongIdentifier = structuredClone(ai('vehicle-application-submit'))
    wrongIdentifier.inputs.staffId!.lookup!.valueField = 'list[].userId'
    expect(() => assertVehicleMapping(wrongIdentifier)).toThrow()
  })
  it('项目费用是原生布尔，不能让旧单选字符串false/true误导调用', () => {
    for (const id of ['travel-expense-prepare', 'travel-expense-submit']) {
      const described = catalog.describe(id)
      if (!described.ok) throw new Error(id)
      const parameter = described.params.find(p => p.name === 'projectExpense')
      expect(parameter?.kind).toBe('boolean')
      expect(parameter?.contract?.type).toBe('boolean')
      expect(parameter?.options).toBeUndefined()
    }
  })

})
