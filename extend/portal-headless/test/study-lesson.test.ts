import { describe, expect, it } from 'vitest'

import {
  STUDY_LESSON_HIDDEN_METHODS,
  STUDY_RECORD_DELETE_PATH,
  STUDY_RECORD_LIST_PATH,
  createStudyLessonCapability,
  studyLessonHiddenCapabilities,
} from '../src/capabilities/study-lesson.js'
import {
  STUDY_LESSON_HIDDEN_AI_CONTRACTS,
  STUDY_LESSON_HIDDEN_METHOD_CONTRACTS,
} from '../src/catalog/contracts-study-lesson.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

/**
 * 课堂域**隐藏子页**（学习记录页 + 月课堂的会议决议/评分记录）的能力与说明。
 *
 * 这一组和 study-lesson-actions.test.ts 是同一类测试的分工：那份管隐藏**表单/学生页**，
 * 这份管隐藏**记录页与弹窗**。两处都**直接 import 能力模块与契约模块**（不走 `src/index.ts`）——
 * 这些能力还没接进目录（接线由派单方做），而且这样跑就不会被并行改动中
 * 别的域的文件拖垮。
 *
 * 三个 `record/[id]/item-list.vue` 是逐字相同的源码（晨/周/月三页只差两个模板属性），
 * 但**只有周课堂那一页用户到得了**（晨/月的按钮打开的是弹窗，见 `描述晨/月课堂的学习记录子页**到不了**` 那条用例），
 * 所以本批只为周课堂建能力。
 */

type Call = {
  url: string
  method: 'get' | 'post' | 'put' | 'delete'
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  responseType?: string
}

/** 把 `request` 换成记录器；按 URL 给返回夹具（缺省 undefined）。 */
function build (results: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const request = async <T>(config: Call): Promise<T> => {
    calls.push(config)
    return (config.url in results ? results[config.url] : undefined) as T
  }
  const cap = createStudyLessonCapability(
    request as PortalRequest,
    request as PortalRequest,
    request as PortalRequest,
  )
  return { cap, calls }
}

const RECORD_LIST_IDS = {
  listWeeklyRecords: 'study-lesson-weekly-record-list',
} as const

const LESSON_PAGE_OF: Record<string, string> = {
  'study-lesson-daily-list': '/dashboard/lesson/daily-lesson/list',
  'study-lesson-weekly-record-list': '/dashboard/lesson/weekly-lesson/list',
  'study-record-remove': '/dashboard/lesson/weekly-lesson/list',
  'study-lesson-monthly-motion-list': '/dashboard/lesson/monthly-lesson/list',
  'study-lesson-monthly-motion-rate-list': '/dashboard/lesson/monthly-lesson/list',
  'study-lesson-monthly-rate-list': '/dashboard/lesson/monthly-lesson/list',
  'study-lesson-monthly-oversee-task-list': '/dashboard/lesson/monthly-lesson/list',
}

describe('隐藏子页的能力定义', () => {
  it('六个能力都绑定到三张菜单页之一，且只有"移出"是写能力', () => {
    expect(studyLessonHiddenCapabilities.map((d) => d.id)).toEqual([
      'study-lesson-weekly-record-list',
      'study-record-remove',
      'study-lesson-monthly-motion-list',
      'study-lesson-monthly-motion-rate-list',
      'study-lesson-monthly-rate-list',
      'study-lesson-monthly-oversee-task-list',
    ])
    for (const definition of studyLessonHiddenCapabilities) {
      expect(definition.pagePath).toBe(LESSON_PAGE_OF[definition.id])
      expect(definition.permission).toBe(definition.pagePath.replace('/list', ''))
    }
    // write 按**真实行为**判定，不按 HTTP 方法：getRateListByMotionId 是 POST 但纯读。
    expect(studyLessonHiddenCapabilities.filter((d) => d.write).map((d) => d.id)).toEqual(['study-record-remove'])
    const rate = studyLessonHiddenCapabilities.find((d) => d.id === 'study-lesson-monthly-rate-list')
    expect(rate?.write).toBe(false)
  })

  it('方法映射、能力定义、契约三者一一对应，且实现里真的有这些方法', () => {
    const ids = studyLessonHiddenCapabilities.map((d) => d.id)
    expect(Object.keys(STUDY_LESSON_HIDDEN_METHODS).sort()).toEqual([...ids].sort())
    expect(Object.keys(STUDY_LESSON_HIDDEN_AI_CONTRACTS).sort()).toEqual([...ids].sort())
    expect(Object.keys(STUDY_LESSON_HIDDEN_METHOD_CONTRACTS).sort()).toEqual(
      Object.values(STUDY_LESSON_HIDDEN_METHODS).map((method) => `studyLesson.${method}`).sort(),
    )
    const { cap } = build()
    for (const method of Object.values(STUDY_LESSON_HIDDEN_METHODS)) {
      expect(typeof (cap as unknown as Record<string, unknown>)[method]).toBe('function')
    }
    // 每个声明的参数在契约里都要有自己的含义，不能靠模板句兜底。
    for (const definition of studyLessonHiddenCapabilities) {
      const contract = STUDY_LESSON_HIDDEN_AI_CONTRACTS[definition.id]!
      // 契约的 effect 必须跟着能力定义走，不能各写各的
      expect(contract.effect, `${definition.id} 的 effect 与 write 标记不一致`).toBe(definition.write ? 'write' : 'read')
      for (const param of definition.params) {
        const input = contract.inputs[param.name]
        expect(input, `${definition.id}.${param.name} 缺少契约`).toBeDefined()
        expect(input!.meaning.length).toBeGreaterThan(4)
        expect(input!.source.length).toBeGreaterThan(4)
      }
    }
  })

  it('晨/月课堂的学习记录子页**到不了**，因此不建能力（conventions 第 28 条）', () => {
    // 三条独立证据（2026-09-26 实测）：
    //   ① 晨课堂「课堂记录」打开的是 `../components/course-record.vue` 弹窗（`daily-lesson/list.vue:172-173`）；
    //   ② 月课堂「会议记录」打开的是 `ComponentMonthCourseRecord` 弹窗（`monthly-lesson/list.vue:209`）；
    //   ③ 全仓 `grep -rn 'daily-lesson/record\|monthly-lesson/record'` 零命中；只有周课堂列表
    //      真的 `router.push('./record/${id}/item-list')`（`weekly-lesson/list.vue:307`）。
    // 与「直播课程」（`study-course.ts` 文件头）同型：路由文件在、按 URL 能渲染，但用户到不了 ⇒ 不进 SDK。
    const ids = studyLessonHiddenCapabilities.map((d) => d.id)
    expect(ids).not.toContain('study-lesson-daily-record-list')
    expect(ids).not.toContain('study-lesson-monthly-record-list')
    // 同一批里"移出"绑在**可达的那一页**（周课堂），且边界里写明原因
    const removePage = studyLessonHiddenCapabilities.find((d) => d.id === 'study-record-remove')!.pagePath
    expect(removePage).toBe('/dashboard/lesson/weekly-lesson/list')
    expect(STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-record-remove']!.boundaries.join(' ')).toContain('只有周课堂')
  })

  it('留下的学习记录能力只服务周课堂一页', () => {
    const id = 'study-lesson-weekly-record-list'
    const own = STUDY_LESSON_HIDDEN_AI_CONTRACTS[id]!.boundaries.find((item) => item.startsWith('**本能力只服务'))
    expect(own, `${id} 没有写清只服务哪一页`).toBeDefined()
    expect(own).toContain('/dashboard/lesson/weekly-lesson/list')
    expect(own).not.toContain('/dashboard/lesson/daily-lesson/list')
    expect(own).not.toContain('/dashboard/lesson/monthly-lesson/list')
  })
})

describe('学习记录列表（周课堂）', () => {
  it('URL/方法与参数键序：order → orderField → lessonId → name → staffCode → pageNo → pageSize', async () => {
    for (const [method] of Object.entries(RECORD_LIST_IDS)) {
      const { cap, calls } = build()
      const call = (cap as unknown as Record<string, (q: unknown) => Promise<unknown>>)[method]!
      const result = await call({
        lessonId: 88,
        name: '张',
        staffCode: '1001',
      })
      expect(result, `${method} 应把后端返回原样交回`).toBeUndefined()
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe(STUDY_RECORD_LIST_PATH)
      expect(calls[0]!.method).toBe('get')
      expect(Object.keys(calls[0]!.params!)).toEqual(['order', 'orderField', 'lessonId', 'name', 'staffCode', 'pageNo', 'pageSize'])
      expect(calls[0]!.params).toEqual({
        order: '',
        orderField: '',
        lessonId: 88,
        name: '张',
        staffCode: '1001',
        pageNo: 1,
        pageSize: 20,
      })
    }
  })

  it('不传筛选时发空串（与页面 `convertFetchForm` 后的形状一致），lessonId 必填', async () => {
    const { cap, calls } = build()
    await cap.listWeeklyRecords({ lessonId: '9' })
    expect(calls[0]!.params).toEqual({
      order: '',
      orderField: '',
      lessonId: '9',
      name: '',
      staffCode: '',
      pageNo: 1,
      pageSize: 20,
    })
    await expect(cap.listWeeklyRecords({} as unknown as { lessonId: string })).rejects.toThrow('学习记录lessonId')
    expect(calls).toHaveLength(1)
  })
})

describe('移出学习记录（DELETE + 批量 body）', () => {
  it('是 DELETE，body 直接是 ID 数组，没有 query（deleteIsBatch=true 的真实形状）', async () => {
    const { cap, calls } = build()
    await cap.removeStudyRecord({ ids: ['12', 13] })
    expect(calls[0]!.method).toBe('delete')
    expect(calls[0]!.url).toBe(STUDY_RECORD_DELETE_PATH)
    expect(calls[0]!.data).toEqual(['12', 13])
    expect(calls[0]!.params).toBeUndefined()
  })

  it('单删也按数组发（页面单行按钮走的是同一条 logicDelete）', async () => {
    const { cap, calls } = build()
    await cap.removeStudyRecord({ ids: [1071] })
    expect(calls[0]!.data).toEqual([1071])
  })

  it('空数组或不合法 ID 在发请求前就拒绝', async () => {
    const { cap, calls } = build()
    await expect(cap.removeStudyRecord({ ids: [] })).rejects.toThrow('非空数组')
    await expect(cap.removeStudyRecord({ ids: [0] })).rejects.toThrow('必须为正整数ID')
    expect(calls).toHaveLength(0)
  })

  it('契约把后端的 -1 业务失败写成可执行的处置办法，而不是"重试"', () => {
    const contract = STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-record-remove']!
    const failures = contract.failures.join('\n')
    expect(contract.effect).toBe('write')
    expect(failures).toContain('线上学习学员不可移出')
    expect(failures).toContain('-1')
    expect(failures).toContain('isAdmAdd')
    expect(contract.boundaries.join(' ')).toContain('deleteIsBatch')
    // 批量 body 的形状必须写死，写成 { ids: [...] } 就不一样了
    expect(contract.consume.join(' ')).toContain('["<id>", …]')
    expect(contract.output.shape).toBe('undefined')
    expect(contract.idempotency).toContain('requestId')
  })
})

describe('月课堂议案列表（会议决议页）', () => {
  it('name 不发到服务端：只有 lessonId 进 query，过滤在本地做、total 跟着变成过滤后条数', async () => {
    const rows = [
      { id: 1, name: '关于饲料的议案' },
      { id: 2, name: '关于疫苗的议案' },
      { id: 3, name: null },
    ]
    const { cap, calls } = build({ '/study/lesson/studylesson/getMotionByLesson': rows })

    const all = await cap.listMonthlyMotions({ lessonId: 7 })
    expect(calls[0]!.params).toEqual({ lessonId: 7 })
    expect(all.list).toHaveLength(3)
    expect(all.total).toBe(3)

    const hit = await cap.listMonthlyMotions({ lessonId: 7, name: '疫苗' })
    expect(calls[1]!.params, 'name 不能出现在 query 上').toEqual({ lessonId: 7 })
    expect(hit.list.map((row) => row.id)).toEqual([2])
    expect(hit.total, '页面把 total 设成过滤后的长度').toBe(1)

    // 页面在 item.name 为 null 时会抛 TypeError；SDK 按空串处理，不复制这个崩溃
    const miss = await cap.listMonthlyMotions({ lessonId: 7, name: '不存在的议案' })
    expect(miss).toEqual({ list: [], total: 0 })
  })

  it('返回的不是分页包络，而是页面 customLoad 归整后的 { list, total }', async () => {
    const { cap } = build({ '/study/lesson/studylesson/getMotionByLesson': [{ id: 1, name: 'a' }] })
    const result = await cap.listMonthlyMotions({ lessonId: 7 })
    expect(Object.keys(result).sort()).toEqual(['list', 'total'])
  })

  it('契约写明"本地过滤"这件事，且 returns 里带 isTotalMotion / motionContentType 的枚举', () => {
    const contract = STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-lesson-monthly-motion-list']!
    // 断言必须落在**这条能力自己的那句话**上：共用边界里也有"只本地校验"这种字眼，
    // 拿 "本地" 两个字去 contains 会被那句满足，反证时改坏这句也不会变红。
    expect(contract.boundaries.join(' ')).toContain('不会进入请求')
    expect(contract.inputs.name?.omitted).toBeDefined()
    expect(contract.inputs.name?.meaning).toContain('不发到服务端')
    expect(contract.consume.join(' ')).toContain('本地过滤')
    // 参数定义里也必须有同一句：describe() 的参数表在缺 inputs 时会回落到 ParamSpec.description，
    // 两处只写一处就会出现"说明写着不发、行为却在发"的分叉。
    const definition = studyLessonHiddenCapabilities.find((d) => d.id === 'study-lesson-monthly-motion-list')!
    expect(definition.params.find((p) => p.name === 'name')?.description).toContain('不发到服务端')
    const total = contract.output.fields.find((f) => f.path === 'total')
    expect(total?.meaning).toContain('本地过滤')
    const isTotal = contract.output.fields.find((f) => f.path === 'list[].isTotalMotion')
    expect(isTotal?.values).toEqual({ '0': '分议案', '1': '总议案' })
    const contentType = contract.output.fields.find((f) => f.path === 'list[].motionContentType')
    expect(contentType?.values).toEqual({ '1': '填写内容', '2': '文件' })
  })
})

describe('月课堂评分记录（评分记录页与弹窗）', () => {
  it('列表是 GET 且带 order/orderField，但没有分页参数（getDataListIsPage=false）', async () => {
    const { cap, calls } = build({ '/admin-api/study/lesson/studylesson/getMotionRateListByLesson': [{ id: 1 }] })
    const rows = await cap.listMonthlyMotionRates({ lessonId: 7, name: '议案' })
    expect(calls[0]!.method).toBe('get')
    expect(Object.keys(calls[0]!.params!)).toEqual(['order', 'orderField', 'lessonId', 'name'])
    expect(calls[0]!.params).toEqual({ order: '', orderField: '', lessonId: 7, name: '议案' })
    // 非分页结构：原样把后端数组交回，不包成 { list, total }
    expect(rows).toEqual([{ id: 1 }])
  })

  it('评分明细是 POST，body 键序与页面 formState 一致（staffName 在前、motionId 在后）', async () => {
    const { cap, calls } = build({ '/admin-api/study/lesson/studylesson/getRateListByMotionId': [{ id: 5, flowerStr: '6+' }] })
    const rows = await cap.listMonthlyRates({ motionId: 5 })
    expect(calls[0]!.method).toBe('post')
    expect(Object.keys(calls[0]!.data as object)).toEqual(['staffName', 'motionId'])
    expect(calls[0]!.data).toEqual({ staffName: '', motionId: 5 })
    await cap.listMonthlyRates({ staffName: '李', motionId: 5 })
    expect(calls[1]!.data).toEqual({ staffName: '李', motionId: 5 })
    expect(rows).toEqual([{ id: 5, flowerStr: '6+' }])
  })

  it('契约按真实行为登记为只读，并解释"POST 但纯读"与两个接口的区别', () => {
    const contract = STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-lesson-monthly-rate-list']!
    expect(contract.effect).toBe('read')
    expect(contract.boundaries.join(' ')).toContain('POST')
    expect(contract.boundaries.join(' ')).toContain('纯读')
    // flower 与 flowerStr 的换算关系必须写出来，否则 AI 会把两个数当成同一件事
    const flowerStr = contract.output.fields.find((f) => f.path === '[].flowerStr')
    expect(flowerStr?.meaning).toContain('flower+1')
    expect(flowerStr?.meaning).toContain('6+')
    const staffName = contract.output.fields.find((f) => f.path === '[].staffName')
    expect(staffName?.nullMeaning).toContain('工号')
    // 与 getMotionByLesson 的区别（服务端 LIKE / 只返回已发布课堂）要写在边界里
    const rates = STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-lesson-monthly-motion-rate-list']!
    expect(rates.boundaries.join(' ')).toContain('getMotionByLesson')
    expect(rates.boundaries.join(' ')).toContain('status = 1')
  })
})

describe('月课堂督办任务（会议决议弹窗的督办记录）', () => {
  it('参数映射成 businessId / featureId 并把 type 钉死为 1（顺序即 query 顺序）', async () => {
    const { cap, calls } = build({ '/hr/oversee-task/getOverseeTaskListByBusinessId': [{ id: 1, taskName: 't' }] })
    const rows = await cap.listMonthlyOverseeTasks({ lessonId: 9, motionId: 3 })
    expect(calls[0]!.method).toBe('get')
    expect(Object.keys(calls[0]!.params!)).toEqual(['businessId', 'featureId', 'type'])
    expect(calls[0]!.params).toEqual({ businessId: 9, featureId: 3, type: 1 })
    expect(rows).toEqual([{ id: 1, taskName: 't' }])
  })

  it('契约写清两个 ID 的归属、type 是页面常量、以及页面本地的 isSend 不是后端字段', () => {
    const contract = STUDY_LESSON_HIDDEN_AI_CONTRACTS['study-lesson-monthly-oversee-task-list']!
    expect(contract.inputs.lessonId?.meaning).toContain('businessId')
    expect(contract.inputs.motionId?.meaning).toContain('featureId')
    expect(contract.boundaries.join(' ')).toContain('businessId')
    expect(contract.boundaries.join(' ')).toContain('isSend')
    expect(contract.consume.join(' ')).toContain('isCreator')
    const isComplete = contract.output.fields.find((f) => f.path === '[].isComplete')
    expect(isComplete?.values).toEqual({ '0': '未完成', '1': '已完成' })
  })
})

describe('本批 6 条隐藏子页契约通过项目自己的检查器（complete 档）', () => {
  it('除"已声明缺口"以外零问题，且缺口提示必须存在', async () => {
    // 与 test/ai-contract-schema.test.ts / test/study-course.test.ts 同一条路：
    // 运行时 import 那个零依赖的 .mjs（它没有 .d.ts）。
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = (await import(validatorUrl)) as {
      validateAiContract: (
        id: string,
        contract: unknown,
        options?: Record<string, unknown>,
      ) => Array<{ capabilityId: string; path: string; code: string; message: string }>
    }
    const ids = studyLessonHiddenCapabilities.map((definition) => definition.id)
    const options = {
      profile: 'complete',
      definitions: studyLessonHiddenCapabilities,
      contracts: STUDY_LESSON_HIDDEN_AI_CONTRACTS,
    }
    const issues = ids.flatMap((id) => validateAiContract(id, STUDY_LESSON_HIDDEN_AI_CONTRACTS[id], options))

    // `incomplete-evidence` 是检查器对**已声明缺口**的固定提示（"存在已声明缺口，不能标记为说明完整"）。
    // 这批没有浏览器基准、也没做线上读取，缺口是如实登记的，不该为了消掉提示而删掉 gaps。
    const declaredGapNotices = issues.filter((issue) => issue.code === 'incomplete-evidence')
    expect(declaredGapNotices).toHaveLength(ids.length)
    expect(declaredGapNotices.every((issue) => issue.path === '$.gaps')).toBe(true)

    const realIssues = issues.filter((issue) => issue.code !== 'incomplete-evidence')
    expect(realIssues, JSON.stringify(realIssues, null, 2)).toEqual([])
  })
})
