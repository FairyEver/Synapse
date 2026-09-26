import { describe, expect, it } from 'vitest'

import {
  STUDY_RECORD_ASSIGNMENT_CHECK_PATH,
  STUDY_RECORD_ASSIGNMENT_INFO_PATH,
  STUDY_RECORD_ASSIGNMENT_UPDATE_PATH,
  STUDY_RECORD_HIDDEN_METHODS,
  STUDY_RECORD_LESSON_DETAIL_PATH,
  createStudyRecordCapability,
  studyRecordCapabilities,
  studyRecordHiddenCapabilities,
} from '../src/capabilities/study-record.js'
import {
  STUDY_RECORD_HIDDEN_AI_CONTRACTS,
  STUDY_RECORD_HIDDEN_METHOD_CONTRACTS,
} from '../src/catalog/contracts-study-record.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

/**
 * 学习管理页上**两级弹窗**发出的四个能力。
 *
 * `list.vue` 的行按钮打开 `components/link-view.vue`（"请选择环节"），
 * link-view 再按环节状态打开 `components/assignment.vue`（"作业详情 / 评分"）。
 * 这四个请求都不在列表页上，所以上一轮"扫列表接口"的覆盖判据整块漏掉了它们。
 *
 * 直接 import 能力模块与契约模块（不走 `src/index.ts`）：这些能力还没接进目录
 * （接线由派单方做），而且这样跑不会被并行改动中别的域的文件拖垮。
 */

type Call = {
  url: string
  method: 'get' | 'post' | 'put' | 'delete'
  params?: Record<string, unknown>
  data?: unknown
}

function build (results: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const request = async <T>(config: Call): Promise<T> => {
    calls.push(config)
    return (config.url in results ? results[config.url] : undefined) as T
  }
  const cap = createStudyRecordCapability(request as PortalRequest)
  return { cap, calls }
}

const STUDY_PAGE = '/dashboard/study/study/list'

describe('隐藏弹窗的能力定义', () => {
  it('四个能力都挂在学习管理页，且 write 按真实行为标注（不是按方法名）', () => {
    expect(studyRecordHiddenCapabilities.map((d) => d.id)).toEqual([
      'study-record-lesson-detail',
      'study-record-assignment-get',
      'assignment-check-permission',
      'study-record-assignment-update',
    ])
    for (const definition of studyRecordHiddenCapabilities) {
      expect(definition.pagePath).toBe(STUDY_PAGE)
      expect(definition.permission).toBe('/dashboard/study/study')
    }
    // 名字叫 get 的那个接口**会写** isRead；名字叫 check 的那个不写。
    expect(studyRecordHiddenCapabilities.filter((d) => d.write).map((d) => d.id)).toEqual([
      'study-record-assignment-get',
      'study-record-assignment-update',
    ])
    // 与这一页既有的 list 能力不重名
    const existing = new Set(studyRecordCapabilities.map((d) => d.id))
    for (const definition of studyRecordHiddenCapabilities) expect(existing.has(definition.id)).toBe(false)
  })

  it('方法映射、能力定义、契约三者一一对应，且实现里真的有这些方法', () => {
    const ids = studyRecordHiddenCapabilities.map((d) => d.id)
    expect(Object.keys(STUDY_RECORD_HIDDEN_METHODS).sort()).toEqual([...ids].sort())
    expect(Object.keys(STUDY_RECORD_HIDDEN_AI_CONTRACTS).sort()).toEqual([...ids].sort())
    expect(Object.keys(STUDY_RECORD_HIDDEN_METHOD_CONTRACTS).sort()).toEqual(
      Object.values(STUDY_RECORD_HIDDEN_METHODS).map((method) => `studyRecord.${method}`).sort(),
    )
    const { cap } = build()
    for (const method of Object.values(STUDY_RECORD_HIDDEN_METHODS)) {
      expect(typeof (cap as unknown as Record<string, unknown>)[method]).toBe('function')
    }
    for (const definition of studyRecordHiddenCapabilities) {
      const contract = STUDY_RECORD_HIDDEN_AI_CONTRACTS[definition.id]!
      expect(contract.effect, `${definition.id} 的 effect 与 write 标记不一致`).toBe(definition.write ? 'write' : 'read')
      for (const param of definition.params) {
        const input = contract.inputs[param.name]
        expect(input, `${definition.id}.${param.name} 缺少契约`).toBeDefined()
        expect(input!.meaning.length).toBeGreaterThan(4)
        expect(input!.source.length).toBeGreaterThan(4)
      }
    }
  })

  it('四个契约都如实写了未验证部分（不能拿"推得自洽"当"验证过"）', () => {
    for (const definition of studyRecordHiddenCapabilities) {
      const gaps = STUDY_RECORD_HIDDEN_AI_CONTRACTS[definition.id]!.gaps ?? []
      expect(gaps.length, `${definition.id} 没有写缺口`).toBeGreaterThan(0)
    }
  })
})

describe('查看环节详情（第一级弹窗）', () => {
  it('参数顺序 lessonId → staffCode，两者都必填且必须是正整数 ID', async () => {
    const { cap, calls } = build({ [STUDY_RECORD_LESSON_DETAIL_PATH]: [{ id: 31, type: 2, linkStatusCode: 3 }] })
    const rows = await cap.getLessonDetail({ lessonId: 88, staffCode: 1001 })
    expect(calls[0]!.method).toBe('get')
    expect(Object.keys(calls[0]!.params!)).toEqual(['lessonId', 'staffCode'])
    expect(calls[0]!.params).toEqual({ lessonId: 88, staffCode: 1001 })
    expect(rows).toEqual([{ id: 31, type: 2, linkStatusCode: 3 }])

    await expect(cap.getLessonDetail({ lessonId: 'abc', staffCode: 1 })).rejects.toThrow('环节详情lessonId')
    await expect(cap.getLessonDetail({ lessonId: 1, staffCode: '' })).rejects.toThrow('环节详情staffCode')
    expect(calls).toHaveLength(1)
  })

  it('契约写清环节状态码的两个口径，并指明 ID 归属：linkId 用 [].id、assignmentId 用 [].resourceId', () => {
    const contract = STUDY_RECORD_HIDDEN_AI_CONTRACTS['study-record-lesson-detail']!
    const status = contract.output.fields.find((f) => f.path === '[].linkStatusCode')
    expect(status?.meaning).toContain('1 已完成')
    expect(status?.meaning).toContain('5 已截止(已提交)')
    // 下一步必须是从"环节 ID"到"linkId"，把它写成 resourceId 是这类能力最容易犯的错
    const step = contract.steps.find((s) => s.capabilityId === 'study-record-assignment-get')
    expect(step?.mapping?.linkId).toBe('result.[].id')
    expect(step?.mapping?.staffCode).toBe('args.staffCode')
    expect(step?.mapping && Object.values(step.mapping)).not.toContain('result[].resourceId')
    expect(contract.consume.join(' ')).toContain('resourceId')
  })
})

describe('查看作业答案（评分弹窗的读取，条件性写）', () => {
  it('参数顺序 linkId → staffCode', async () => {
    const { cap, calls } = build({ [STUDY_RECORD_ASSIGNMENT_INFO_PATH]: { id: 7, assignmentId: 66 } })
    const data = await cap.getAssignment({ linkId: 31, staffCode: 1001 })
    expect(calls[0]!.method).toBe('get')
    expect(Object.keys(calls[0]!.params!)).toEqual(['linkId', 'staffCode'])
    expect(calls[0]!.params).toEqual({ linkId: 31, staffCode: 1001 })
    expect(data).toEqual({ id: 7, assignmentId: 66 })
  })

  it('契约把"条件性写 isRead"写成边界、完成条件与幂等说明，并禁止当只读轮询', () => {
    const contract = STUDY_RECORD_HIDDEN_AI_CONTRACTS['study-record-assignment-get']!
    expect(contract.effect).toBe('write')
    const boundaries = contract.boundaries.join(' ')
    expect(boundaries).toContain('isRead')
    expect(boundaries).toContain('条件性写')
    expect(boundaries).toContain('讲师')
    expect(contract.failures.join(' ')).toContain('轮询')
    // 空对象 ≠ 出错：这条必须写在 output.empty 里，否则调用方会把"没交作业"当故障
    expect(contract.output.empty).toContain('未提交')
    expect(contract.completion).toContain('空对象')
    const isRead = contract.output.fields.find((f) => f.path === 'isRead')
    expect(isRead?.meaning).toContain('本次写入之前')
    // 逗号串这两个字段不能当数组
    expect(contract.output.fields.find((f) => f.path === 'imageAnswer')?.format).toBe('URL1,URL2')
  })
})

describe('评分权限预检（只读）', () => {
  it('参数顺序 assignmentId → lessonId，返回的是数字本身', async () => {
    const { cap, calls } = build({ [STUDY_RECORD_ASSIGNMENT_CHECK_PATH]: 1 })
    const allowed = await cap.checkAssignmentPermission({ assignmentId: 66, lessonId: 88 })
    expect(calls[0]!.method).toBe('get')
    expect(Object.keys(calls[0]!.params!)).toEqual(['assignmentId', 'lessonId'])
    expect(calls[0]!.params).toEqual({ assignmentId: 66, lessonId: 88 })
    expect(allowed).toBe(1)
  })

  it('契约写清 1/0 的判据与三种放行身份，且不许把异常当 0', () => {
    const contract = STUDY_RECORD_HIDDEN_AI_CONTRACTS['assignment-check-permission']!
    expect(contract.effect).toBe('read')
    const boundaries = contract.boundaries.join(' ')
    expect(boundaries).toContain('作业创建人')
    expect(boundaries).toContain('讲师')
    expect(boundaries).toContain('助教')
    expect(contract.output.empty).toContain('=== 1')
    expect(contract.failures.join(' ')).toContain('不要把异常当成 0')
    // 提交用的是提交记录 ID，不是预检用的 assignmentId
    const step = contract.steps.find((s) => s.capabilityId === 'study-record-assignment-update')
    expect(step?.mapping?.id).toBe('context.submitRecordId')
  })
})

describe('讲师评分（写）', () => {
  it('body 键序 id → assignmentId → 评分字段，且与页面 submitData 一致', async () => {
    const { cap, calls } = build({ [STUDY_RECORD_ASSIGNMENT_UPDATE_PATH]: undefined })
    await cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherScore: 90 })
    expect(calls[0]!.method).toBe('post')
    expect(Object.keys(calls[0]!.data as object)).toEqual(['id', 'assignmentId', 'teacherScore'])
    expect(calls[0]!.data).toEqual({ id: 7, assignmentId: 66, teacherScore: 90 })

    await cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherFlower: 3 })
    expect(Object.keys(calls[1]!.data as object)).toEqual(['id', 'assignmentId', 'teacherFlower'])
    expect(calls[1]!.data).toEqual({ id: 7, assignmentId: 66, teacherFlower: 3 })
  })

  it('两个评分字段二选一：都给、都不给、越界、非整数都在发请求前拒绝', async () => {
    const { cap, calls } = build()
    await expect(cap.updateAssignmentScore({ id: 7, assignmentId: 66 })).rejects.toThrow('只能给')
    await expect(cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherScore: 90, teacherFlower: 3 })).rejects.toThrow('只能给')
    await expect(cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherScore: 101 })).rejects.toThrow('0-100')
    await expect(cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherScore: 89.5 })).rejects.toThrow('0-100')
    await expect(cap.updateAssignmentScore({ id: 7, assignmentId: 66, teacherFlower: 0 })).rejects.toThrow('正整数')
    await expect(cap.updateAssignmentScore({ id: 0, assignmentId: 66, teacherScore: 90 })).rejects.toThrow('作业评分id')
    expect(calls).toHaveLength(0)
  })

  it('契约写清绝对值写入、flower 的字典换算与推送副作用，并给出回查步骤', () => {
    const contract = STUDY_RECORD_HIDDEN_AI_CONTRACTS['study-record-assignment-update']!
    expect(contract.effect).toBe('write')
    expect(contract.boundaries.join(' ')).toContain('绝对值')
    expect(contract.boundaries.join(' ')).toContain('assignment_score')
    expect(contract.inputs.teacherScore?.requiredWhen).toContain('互斥')
    expect(contract.inputs.teacherFlower?.requiredWhen).toContain('互斥')
    expect(contract.idempotency).toContain('推送')
    // 提交后必须回查：这是写能力的完成判据
    const recovery = contract.steps.find((s) => s.capabilityId === 'study-record-assignment-get')
    expect(recovery?.role).toBe('required')
    expect(recovery?.mapping?.linkId).toBe('context.linkId')
    expect(contract.steps.some((s) => s.capabilityId === 'study-record-lesson-detail')).toBe(true)
  })
})

describe('本批 4 条弹窗契约通过项目自己的检查器（complete 档）', () => {
  it('除"已声明缺口"以外零问题，且缺口提示必须存在', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = (await import(validatorUrl)) as {
      validateAiContract: (
        id: string,
        contract: unknown,
        options?: Record<string, unknown>,
      ) => Array<{ capabilityId: string; path: string; code: string; message: string }>
    }
    const ids = studyRecordHiddenCapabilities.map((definition) => definition.id)
    const options = {
      profile: 'complete',
      definitions: studyRecordHiddenCapabilities,
      contracts: STUDY_RECORD_HIDDEN_AI_CONTRACTS,
    }
    const issues = ids.flatMap((id) => validateAiContract(id, STUDY_RECORD_HIDDEN_AI_CONTRACTS[id], options))

    // 与 study-lesson 那份同理：`incomplete-evidence` 是"存在已声明缺口"的固定提示，
    // 这批没做线上验证，缺口是如实登记的，不该为了消掉提示而删 gaps。
    const declaredGapNotices = issues.filter((issue) => issue.code === 'incomplete-evidence')
    expect(declaredGapNotices).toHaveLength(ids.length)
    expect(declaredGapNotices.every((issue) => issue.path === '$.gaps')).toBe(true)

    const realIssues = issues.filter((issue) => issue.code !== 'incomplete-evidence')
    expect(realIssues, JSON.stringify(realIssues, null, 2)).toEqual([])
  })
})
