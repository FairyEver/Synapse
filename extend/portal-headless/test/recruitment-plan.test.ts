import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  RECRUITMENT_PLAN_MODULE_TYPE,
  RECRUITMENT_PLAN_PAGE_PATH,
  RECRUITMENT_PLAN_PERMISSION,
  RECRUITMENT_PLAN_METHODS,
  createRecruitmentPlanCapability,
  recruitmentPlanCapabilities,
  type RecruitmentPlanDraft,
  type RecruitmentPlanFileInput,
  type RecruitmentPlanRow,
  type RecruitmentPlanStartUserSelectTask,
} from '../src/capabilities/recruitment-plan.js'

function harness (responses: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return { calls, api: createRecruitmentPlanCapability(request) }
}

function draft (overrides: Partial<RecruitmentPlanDraft> = {}): RecruitmentPlanDraft {
  return {
    recruitmentType: 1,
    planYear: new Date().getFullYear(),
    organizationId: 101,
    organizationName: '华东组织',
    postId: 202,
    postName: '研发工程师',
    planNumber: 2,
    purpose: '业务扩编',
    requirementText: '熟悉业务系统',
    salaryLevelMin: 3,
    salaryLevelMax: 5,
    urgency: '常规',
    arrivalDate: '2026-10-01',
    remark: '',
    ...overrides,
  }
}

function resumeDraft (overrides: Record<string, unknown> = {}) {
  return {
    planId: 7,
    name: '张三',
    age: 28,
    sex: 1,
    education: '本科',
    major: '计算机',
    workYears: '5年',
    graduateSchool: '示例大学',
    phone: '13800000000',
    intendedPost: '研发工程师',
    expectedSalary: '20K',
    attachments: [{ name: '简历.pdf', url: 'oss://resume.pdf' }],
    ...overrides,
  }
}

function interviewDraft (overrides: Record<string, unknown> = {}) {
  return {
    resumeId: 8,
    interviewDate: '2026-10-02',
    interviewer: '李四',
    interviewRound: '初面',
    professionalKnowledgeScore: 8,
    communicationScore: 8,
    learningAbilityScore: 9,
    executionAbilityScore: 8,
    teamworkScore: 9,
    stabilityScore: 8,
    personalAdvantage: '表达清晰',
    personalShortcoming: '',
    workExperienceSummary: '有相关经验',
    questionAnswer: '回答完整',
    conclusion: '考虑备选',
    ...overrides,
  }
}

describe('招聘计划页面能力', () => {
  it('把列表筛选逐字段投影到Portal分页请求，并绑定页面上下文', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.list({ planYear: new Date().getFullYear() - 1 })
    expect(calls[0]).toMatchObject({
      url: '/hr/recruitment-plan/page',
      method: 'get',
      params: {
        order: '', orderField: '', organizationId: null, postId: null,
        recruitmentType: null, status: null, createTimeStart: null, createTimeEnd: null, pageNo: 1, pageSize: 20, planYear: new Date().getFullYear() - 1,
      },
    })
    expect(recruitmentPlanCapabilities.every(definition =>
      definition.pagePath === RECRUITMENT_PLAN_PAGE_PATH &&
      definition.permission === RECRUITMENT_PLAN_PERMISSION &&
      definition.moduleType === RECRUITMENT_PLAN_MODULE_TYPE &&
      definition.httpInstance === 'platform')).toBe(true)
  })

  it('按页面顺序读取组织、岗位和薪资等级候选', async () => {
    const { api, calls } = harness([[], [], []])
    await api.organizationTree()
    await api.postOptions({ organizationId: 101, selectedPostId: null })
    await api.salaryLevelOptions()
    expect(calls.map(call => [call.url, call.params])).toEqual([
      ['/org/organization/getRoleOrganizationTree', undefined],
      ['/org/hrpost/getOrgPostList', { orgId: 101, id: null }],
      ['/org/hrsalarylevel/getAllSalaryLevel', undefined],
    ])
  })

  it('实现招聘计划 prepare→create，并严格校验审批人节点映射和覆盖开关', async () => {
    const tasks: RecruitmentPlanStartUserSelectTask[] = [{ id: 'Activity_1', name: '发起人自选', minSelectCount: 1, maxSelectCount: 2 }]
    const { api, calls } = harness([tasks, 123, 456])
    const prepared = await api.prepare(draft())
    expect(calls[0]).toMatchObject({ url: '/hr/recruitment-plan/getRequiredStartUserSelectTasks', method: 'post' })
    expect((calls[0]?.data as Record<string, unknown>).postTypeName).toBeUndefined()
    await api.create({ draft: draft(), tasks: prepared.tasks, startUserSelectAssignees: { Activity_1: [9001] } })
    expect(calls[1]).toMatchObject({
      url: '/hr/recruitment-plan/create',
      method: 'post',
      data: expect.objectContaining({ overwrite: false, startUserSelectAssignees: { Activity_1: [9001] } }),
    })
    await expect(api.create({ draft: draft(), tasks, startUserSelectAssignees: {} })).rejects.toThrow('至少需要选择1人')
    await api.create({ draft: draft(), tasks, startUserSelectAssignees: { Activity_1: [9001] }, overwrite: true })
    expect((calls[2]?.data as Record<string, unknown>).overwrite).toBe(true)
  })

  it('锁定Portal计划表单校验：年份、薪资上下限同时必填但不比较顺序', async () => {
    const { api } = harness([[]])
    await expect(api.prepare(draft({ planYear: new Date().getFullYear() - 1 }))).rejects.toThrow('不能早于当前年份')
    await expect(api.prepare(draft({ salaryLevelMax: null as unknown as number }))).rejects.toThrow('salaryLevelMax必须为正整数ID')
    await expect(api.prepare(draft({ salaryLevelMin: 9, salaryLevelMax: 2 }))).resolves.toMatchObject({ tasks: [] })
  })

  it('按计划状态门禁撤销、重新提交和删除', async () => {
    const current = { ...draft(), id: 11, status: 3 } as unknown as RecruitmentPlanRow
    const { api, calls } = harness([[], true, true, true])
    await expect(api.cancel({ id: 11, currentStatus: 2 })).rejects.toThrow('只有status=1')
    const prepared = await api.prepareUpdate({ current })
    expect(prepared.draft.id).toBe(11)
    await api.update({ draft: prepared.draft, tasks: prepared.tasks, startUserSelectAssignees: {} })
    expect(calls.some(call => call.url === '/hr/recruitment-plan/update')).toBe(true)
    await expect(api.remove({ id: 11, currentStatus: 1 })).rejects.toThrow('不能删除')
    await api.cancel({ id: 11, currentStatus: 1 })
    await api.remove({ id: 11, currentStatus: 2 })
  })

  it('计划模板下载和导入严格复刻文件扩展名、查询参数和覆盖查询串', async () => {
    const response = { data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
    const file: RecruitmentPlanFileInput = { fileName: '计划.xlsx', base64: 'AQI=', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    const { api, calls } = harness([response, '导入成功'])
    const downloaded = await api.downloadTemplate({ organizationId: 101 })
    expect(downloaded.byteLength).toBe(2)
    expect(calls[0]).toMatchObject({ url: '/hr/recruitment-plan/import-template', params: { organizationId: 101 }, responseType: 'arraybuffer' })
    expect(api.prepareImport(file)).toEqual({ fileName: '计划.xlsx', contentType: file.contentType, byteLength: 2 })
    await api.importExcel({ ...file, overwrite: true })
    expect(calls[1]?.url).toBe('/hr/recruitment-plan/import?overwrite=true')
    expect(() => api.prepareImport({ ...file, fileName: '计划.XLSX' })).toThrow()
  })

  it('简历提交序列化附件并复刻已审批计划门禁，面试固定读取100条', async () => {
    const { api, calls } = harness([88, true, { list: [], total: 0 }])
    const created = await api.createResume({ draft: resumeDraft(), planStatus: 2 })
    expect(created).toBe(88)
    expect((calls[0]?.data as Record<string, unknown>).attachments).toBe('[{"name":"简历.pdf","url":"oss://resume.pdf"}]')
    await api.updateResume({ draft: { ...resumeDraft(), id: 88 }, planStatus: 2 })
    expect(calls[1]).toMatchObject({ url: '/hr/recruitment-plan/resume/update', method: 'put' })
    await expect(api.createResume({ draft: resumeDraft({ major: '' }), planStatus: 2 })).rejects.toThrow('major不能为空')
    await expect(api.createResume({ draft: resumeDraft(), planStatus: 1 })).rejects.toThrow('只有status=2')
    await api.interviewList({ planId: 7, resumeId: 8 })
    expect(calls[2]).toMatchObject({ url: '/hr/recruitment-plan/interview/page', params: { pageNo: 1, pageSize: 100, planId: 7, resumeId: 8 } })
  })

  it('面试提交强制当前简历ID并校验日期、评分和结论', async () => {
    const { api, calls } = harness([99, true])
    await api.createInterview({ resumeId: 8, draft: interviewDraft({ resumeId: 999 }) })
    expect(calls[0]).toMatchObject({ url: '/hr/recruitment-plan/interview/create', data: expect.objectContaining({ resumeId: 8 }) })
    await expect(api.createInterview({ resumeId: 8, draft: interviewDraft({ interviewDate: '2026/10/02' }) })).rejects.toThrow('YYYY-MM-DD')
    await expect(api.createInterview({ resumeId: 8, draft: interviewDraft({ teamworkScore: 11 }) })).rejects.toThrow('1到10')
    await api.updateInterview({ resumeId: 8, draft: { ...interviewDraft(), id: 99 } })
    expect(calls[1]).toMatchObject({ url: '/hr/recruitment-plan/interview/update', method: 'put' })
  })

  it('入职按钮只生成Portal表单001的打开参数，不冒充已提交入职流程', () => {
    const { api } = harness()
    const result = api.prepareOnboarding({
      plan: { id: 7, status: 2, organizationId: 101, organizationName: '华东组织', postId: 202, postName: '研发工程师' },
      resume: { id: 8, planId: 7, status: 1, name: '张三', sex: 1, phone: '13800000000', workYears: '5年' },
    })
    expect(result).toEqual(expect.objectContaining({ path: 'simple/hr/form/001', processKey: 'ruzhi', bpmMode: 'edit', customQuery: expect.objectContaining({ resumeId: 8, planId: 7, organizationId: 101, postId: 202 }) }))
    expect(() => api.prepareOnboarding({
      plan: { id: 7, status: 2, organizationId: 101, organizationName: '华东组织', postId: 202, postName: '研发工程师' },
      resume: { id: 8, planId: 7, status: 0, name: '张三', sex: 1, phone: '13800000000', workYears: '5年' },
    })).toThrow('只有status=1')
  })

  it('所有页面能力都有唯一方法映射', () => {
    expect(new Set(Object.keys(RECRUITMENT_PLAN_METHODS))).toHaveProperty('size', recruitmentPlanCapabilities.length)
    for (const definition of recruitmentPlanCapabilities) expect(RECRUITMENT_PLAN_METHODS[definition.id as keyof typeof RECRUITMENT_PLAN_METHODS]).toBeTruthy()
  })
})
