import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createStudyTeacherCapability,
  studyTeacherCapabilities,
  STUDY_TEACHER_LEVEL_PAGE_PATH,
  STUDY_TEACHER_PAGE_PATH,
} from '../src/capabilities/study-teacher.js'

type RequestConfig = Parameters<PortalRequest>[0]

function source (root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

function fixture () {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    return 9001 as T
  }
  return { api: createStudyTeacherCapability(request, request, request, request), calls }
}

describe('学习域讲师 saveTeacher 写动作', () => {
  it('Portal 与 Java 源码锁定 saveTeacher 的路径、DTO body 和 Long 返回类型', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const form = source(portalRoot, 'app/portal/views/dashboard/education/base/teacher/[mode]/[id].vue')
    const controller = source(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/base/controller/StudyStudentController.java')

    expect(form).toContain("http.post('/study/base/studystudent/saveTeacher', {")
    expect(form).toContain('name: form.name')
    expect(controller).toContain('@PostMapping("/saveTeacher")')
    expect(controller).toContain('public CommonResult<Long> saveStudent(String name)')
  })

  it('prepare → submit 发送 platform POST 的 `{ name }` DTO body', async () => {
    const { api, calls } = fixture()
    const prepared = api.prepareSaveTeacher({ name: '外部讲师' })
    expect(prepared).toEqual({ draft: { name: '外部讲师' } })
    await expect(api.submitSaveTeacher(prepared)).resolves.toBe(9001)
    expect(calls).toEqual([
      {
        url: '/study/base/studystudent/saveTeacher',
        method: 'post',
        data: { name: '外部讲师' },
      },
    ])
    expect(calls[0]).not.toHaveProperty('params')
    expect(calls[0]?.data).not.toBe('外部讲师')
  })

  it('非空校验在本地完成，空姓名不发请求', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareSaveTeacher({ name: '  ' })).toThrow(/不能为空/)
    await expect(api.submitSaveTeacher({ draft: { name: '' } })).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('能力元数据绑定讲师页、平台实例和 module-type 12', () => {
    const save = studyTeacherCapabilities.find(item => item.id === 'study-teacher-save-teacher')
    expect(save).toMatchObject({
      pagePath: STUDY_TEACHER_PAGE_PATH,
      permission: '/dashboard/base/teacher',
      moduleType: 12,
      httpInstance: 'platform',
      write: true,
    })
    expect(studyTeacherCapabilities.some(item => item.id === 'study-teacher-list' && !item.write)).toBe(true)
  })

  it('cancel 只返回本地标记，不触发 HTTP', () => {
    const { api, calls } = fixture()
    expect(api.cancelSaveTeacher()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 本轮补齐：人员候选、教师类型字典、讲师类型 `.lay` 写入口、评价设置保存
// ---------------------------------------------------------------------------

type CapturedConfig = Parameters<PortalRequest>[0]

/** 带响应队列的 fixture：每个用例自己决定这一条请求回什么 */
function queueFixture (responses: unknown[] = []) {
  const calls: CapturedConfig[] = []
  const request: PortalRequest = async <T>(config: CapturedConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createStudyTeacherCapability(request, request, request, request), calls }
}

describe('讲师管理：人员候选与教师类型字典', () => {
  it('人员候选：无参数 GET，把 staffCode/name 挑成两个字段（其余后端字段不返回）', async () => {
    const { api, calls } = queueFixture([[
      { id: 1, staffCode: '2026050801', name: '徐曼曼', mobile: 13800138000, organizationName: '总部' },
      { id: 2, staffCode: 2026050802, name: '王璐' },
    ]])
    await expect(api.listCandidateStudents()).resolves.toEqual([
      { staffCode: '2026050801', name: '徐曼曼' },
      { staffCode: 2026050802, name: '王璐' },
    ])
    expect(calls[0]).toEqual({ url: '/study/base/studystudent/studentNoTeacherList', method: 'get' })
    expect(calls[0]).not.toHaveProperty('params')
  })

  it('人员候选：响应不是数组要当场炸（页面直接对结果 map）', async () => {
    const { api } = queueFixture([{ ret: 'SUCCESS', code: 0, data: [] }])
    await expect(api.listCandidateStudents()).rejects.toThrow(/没有返回数组/)
  })

  it('教师类型字典：三个固定参数，取值域不接受调用方改写，返回 value/label', async () => {
    const { api, calls } = queueFixture([{ ret: 'SUCCESS', code: 200, results: [{ value: '1', label: '内部' }] }])
    await expect(api.listTeacherTypes()).resolves.toEqual([{ value: '1', label: '内部' }])
    expect(calls[0]).toEqual({
      url: '/dict/selectByPage.lay',
      method: 'get',
      params: { type: 'teacher_type', page: 1, pageSize: -1 },
    })
  })

  it('教师类型字典：isOriginal 被接线配成 true 时拿到的是原始体，results 在 data 下也要认', async () => {
    const { api } = queueFixture([{ ret: 'SUCCESS', code: 200, data: { results: [{ value: 2, label: '外部' }] } }])
    await expect(api.listTeacherTypes()).resolves.toEqual([{ value: '2', label: '外部' }])
  })

  it('教师类型字典：smart-layer 的 code≠200 必须抛（页面靠拦截器，SDK 自己补这一判）', async () => {
    const { api } = queueFixture([{ ret: 'FAIL', code: 500, msg: '系统异常' }])
    await expect(api.listTeacherTypes()).rejects.toThrow(/code=500/)
  })

  it('教师类型字典：没有 results 数组要当场炸，不能静默返回空列表', async () => {
    const { api } = queueFixture([{ ret: 'SUCCESS', code: 200 }])
    await expect(api.listTeacherTypes()).rejects.toThrow(/results/)
  })
})

describe('讲师类型：.lay 写入口', () => {
  it('prepare：create 打 insertTeacherLevel.lay、edit 打 updateTeacherLevel.lay，body 键序固定', () => {
    const { api } = queueFixture()
    expect(api.prepareSaveLevel({ form: { mode: 'create', name: ' 初级讲师 ', level: 1, sort: 10 } }).draft).toEqual({
      mode: 'create',
      url: '/manage/study/insertTeacherLevel.lay',
      body: { name: '初级讲师', level: 1, sort: 10 },
    })
    const edit = api.prepareSaveLevel({ form: { mode: 'edit', id: '7', name: '初级讲师', level: 1, sort: 10 } }).draft
    expect(edit.url).toBe('/manage/study/updateTeacherLevel.lay')
    // 编辑态 id 在最前（行数据里的第一个键就是它）
    expect(Object.keys(edit.body)).toEqual(['id', 'name', 'level', 'sort'])
    expect(edit.body.id).toBe('7')
  })

  it('prepare：页面表单规则逐条在本地挡（名称 10 字、level 1~99、sort 1~999、mode 与 id 的组合）', () => {
    const { api, calls } = queueFixture()
    const form = { mode: 'create' as const, name: '正常', level: 1, sort: 1 }
    expect(() => api.prepareSaveLevel({ form: { ...form, name: ' ' } })).toThrow(/必填/)
    expect(() => api.prepareSaveLevel({ form: { ...form, name: '一二三四五六七八九十一' } })).toThrow(/10 字/)
    expect(() => api.prepareSaveLevel({ form: { ...form, level: 0 } })).toThrow(/1~99/)
    expect(() => api.prepareSaveLevel({ form: { ...form, level: 100 } })).toThrow(/1~99/)
    expect(() => api.prepareSaveLevel({ form: { ...form, level: 1.5 } })).toThrow(/整数/)
    expect(() => api.prepareSaveLevel({ form: { ...form, sort: 0 } })).toThrow(/1~999/)
    expect(() => api.prepareSaveLevel({ form: { ...form, id: '7' } })).toThrow(/不能带 id/)
    expect(() => api.prepareSaveLevel({ form: { mode: 'edit', name: '正常', level: 1, sort: 1 } })).toThrow(/必须给 id/)
    expect(() => api.prepareSaveLevel({ form: { ...form, mode: 'other' as never } })).toThrow(/mode/)
    expect(calls).toHaveLength(0)
  })

  it('save：按草稿的 url POST，body 就是 prepare 的那一份（不带 isOriginal）', async () => {
    const { api, calls } = queueFixture([undefined])
    const draft = api.prepareSaveLevel({ form: { mode: 'edit', id: '7', name: '初级讲师', level: 1, sort: 10 } }).draft
    await api.saveLevel({ draft })
    expect(calls[0]).toEqual({
      url: '/manage/study/updateTeacherLevel.lay',
      method: 'post',
      data: { id: '7', name: '初级讲师', level: 1, sort: 10 },
    })
    expect(calls[0]).not.toHaveProperty('isOriginal')
    expect(calls[0]).not.toHaveProperty('params')
  })

  it('save：草稿的 url 与 mode 不自洽时**不发请求**', async () => {
    const { api, calls } = queueFixture()
    await expect(api.saveLevel({
      draft: { mode: 'create', url: '/manage/study/updateTeacherLevel.lay', body: { name: 'x', level: 1, sort: 1 } },
    })).rejects.toThrow(/不匹配/)
    expect(calls).toHaveLength(0)
  })

  it('save：smart-layer 的 code≠200 要抛（写操作静默失败比报错更糟）', async () => {
    const { api } = queueFixture([{ ret: 'FAIL', code: 500, msg: '级别名称已存在' }])
    const draft = api.prepareSaveLevel({ form: { mode: 'create', name: '初级讲师', level: 1, sort: 1 } }).draft
    await expect(api.saveLevel({ draft })).rejects.toThrow(/级别名称已存在/)
  })

  it('能力元数据：类型保存是写、字典与候选是读，且都绑定各自页面', () => {
    const byId = new Map(studyTeacherCapabilities.map(item => [item.id, item]))
    expect(byId.get('study-teacher-level-save')).toMatchObject({
      pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH, write: true, httpInstance: 'smart-layer-admin',
    })
    expect(byId.get('study-teacher-level-prepare-save')?.write).toBe(false)
    expect(byId.get('study-teacher-type-dict')).toMatchObject({ write: false, httpInstance: 'smart-layer-admin' })
    expect(byId.get('study-teacher-candidate-student-list')).toMatchObject({ write: false, httpInstance: 'platform' })
    expect(byId.get('study-appraise-setting-save')?.write).toBe(true)
  })
})

describe('评价设置：题目保存', () => {
  it('prepare：3~5 条、题干规则、题号按数组顺序重排', () => {
    const { api } = queueFixture()
    const draft = api.prepareSaveAppraiseSetting({
      items: [{ content: ' 第一题 ' }, { content: '第二题', sort: 99 }, { content: '第三题' }],
    }).draft
    expect(draft.items).toEqual([
      { sort: 1, content: '第一题' },
      { sort: 2, content: '第二题' },
      { sort: 3, content: '第三题' },
    ])
  })

  it('prepare：条数 3~5 是后端硬限制，题干必填且 ≤100 字', () => {
    const { api, calls } = queueFixture()
    expect(() => api.prepareSaveAppraiseSetting({ items: [] })).toThrow(/3~5/)
    expect(() => api.prepareSaveAppraiseSetting({ items: [{ content: 'a' }, { content: 'b' }] })).toThrow(/3~5/)
    expect(() => api.prepareSaveAppraiseSetting({
      items: Array.from({ length: 6 }, (_, index) => ({ content: `第${index}题` })),
    })).toThrow(/3~5/)
    expect(() => api.prepareSaveAppraiseSetting({ items: [{ content: '  ' }, { content: 'b' }, { content: 'c' }] })).toThrow(/必填/)
    expect(() => api.prepareSaveAppraiseSetting({
      items: [{ content: '一'.repeat(101) }, { content: 'b' }, { content: 'c' }],
    })).toThrow(/100 字/)
    expect(calls).toHaveLength(0)
  })

  it('save：POST platform 的数组 body（不是 { items }），且只发 sort/content', async () => {
    const { api, calls } = queueFixture([undefined])
    const draft = api.prepareSaveAppraiseSetting({
      items: [{ content: '第一题' }, { content: '第二题' }, { content: '第三题' }],
    }).draft
    await api.submitAppraiseSetting({ draft })
    expect(calls[0]).toEqual({
      url: '/study/base/studyappraiseteacher',
      method: 'post',
      data: [
        { sort: 1, content: '第一题' },
        { sort: 2, content: '第二题' },
        { sort: 3, content: '第三题' },
      ],
    })
    expect(Array.isArray(calls[0]?.data)).toBe(true)
    expect(calls[0]).not.toHaveProperty('isOriginal')
  })

  it('save：提交前重跑一遍规则（手搓的越界草稿发不出去）', async () => {
    const { api, calls } = queueFixture()
    await expect(api.submitAppraiseSetting({
      draft: { items: [{ sort: 1, content: '只有一条' }] },
    })).rejects.toThrow(/3~5/)
    expect(calls).toHaveLength(0)
  })
})

describe('讲师域新增能力的 AI 说明契约', () => {
  const newIds = [
    'study-teacher-candidate-student-list',
    'study-teacher-type-dict',
    'study-teacher-level-prepare-save',
    'study-teacher-level-save',
    'study-appraise-setting-prepare-save',
    'study-appraise-setting-save',
  ]

  it('六条新契约都登记在 STUDY_GRADE_TEACHER 的契约与 sdkPath 映射里，且通过结构校验', async () => {
    const mod = await import('../src/catalog/contracts-study-grade-teacher.js')
    const contracts = mod.STUDY_GRADE_TEACHER_AI_CONTRACTS
    for (const id of newIds) expect(contracts[id], `${id} 没有契约`).toBeDefined()
    // sdkPath 映射（门面方法契约）也要覆盖到
    const methodContracts = mod.STUDY_GRADE_TEACHER_METHOD_CONTRACTS
    for (const path of [
      'studyTeacher.listCandidateStudents', 'studyTeacher.listTeacherTypes',
      'studyTeacher.prepareSaveLevel', 'studyTeacher.saveLevel',
      'studyTeacher.prepareSaveAppraiseSetting', 'studyTeacher.submitAppraiseSetting',
    ]) {
      expect(methodContracts[path], `${path} 没有方法契约`).toBeDefined()
    }
    const definitions = new Map(studyTeacherCapabilities.map(item => [item.id, item] as const))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl) as {
      validateAiContract: (id: string, contract: unknown, options?: unknown) => Array<{ code: string; message: string }>
    }
    const issues = newIds.flatMap(id => validateAiContract(id, contracts[id], { definitions }))
    expect(issues).toEqual([])
  })

  it('关键语义：平台/实例之别、code 判定、整份替换、无基准都要写在说明里', async () => {
    const { STUDY_GRADE_TEACHER_AI_CONTRACTS: contracts } = await import('../src/catalog/contracts-study-grade-teacher.js')
    // 人员候选走 platform、且与 base-user-search 不是同一份名单
    expect(contracts['study-teacher-candidate-student-list']?.boundaries.join(' ')).toContain('platform')
    expect(contracts['study-teacher-candidate-student-list']?.consume.join(' ')).toContain('base-user-search')
    // 字典与「讲师类型管理页」不是同一张表
    expect(contracts['study-teacher-type-dict']?.consume.join(' ')).toContain('study-teacher-level-list')
    // 类型保存：两个端点、code 自判、新建重发的后果
    const save = contracts['study-teacher-level-save']!
    expect(save.idempotency).toContain('多出一条记录')
    expect(save.purpose).toContain('insertTeacherLevel')
    expect(save.failures.join(' ')).toContain('code≠200')
    expect(save.steps[0]?.capabilityId).toBe('study-teacher-level-list')
    // 评价设置：整份替换 + 数组 body + 回查
    const appraise = contracts['study-appraise-setting-save']!
    expect(appraise.consume.join(' ')).toContain('整份替换')
    expect(appraise.steps[0]?.capabilityId).toBe('study-appraise-setting-list')
    // 无基准的结论必须标成推断
    expect(contracts['study-teacher-level-prepare-save']?.gaps?.join(' ')).toContain('没有浏览器基准')
  })
})
