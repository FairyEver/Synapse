import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import {
  buildStudyCourseCreateTimeRange,
  buildStudyCourseDeleteTimeRange,
  buildStudyCourseTimeRange,
  createStudyCourseCapability,
  DEFAULT_PAGE_SIZE,
  IM_COURSE_STATUS_OPTIONS,
  studyCourseCapabilities,
  studyCourseListUrl,
  STUDY_COURSE_IM_PAGE_PATH,
  STUDY_COURSE_IM_AUDIO_PAGE_PATH,
  STUDY_COURSE_IM_FORM_PAGE_PATH,
  STUDY_COURSE_IM_MESSAGE_PAGE_PATH,
  STUDY_COURSE_IM_PERMISSION,
  STUDY_COURSE_IM_ROUTE_FILES,
  STUDY_COURSE_LIST_PATH,
  STUDY_COURSE_ROUTE_FILES,
  STUDY_COURSE_TEXT_PAGE_PATH,
  STUDY_COURSE_VIDEO_PAGE_PATH,
  STUDY_COURSE_METHODS,
} from '../src/capabilities/study-course.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/study-course.browser.json'), 'utf8'),
) as {
  requests: Array<{
    name: string
    method: string
    url: string
    headers: Record<string, string>
    body: null
    [key: string]: unknown
  }>
}

const TEXT = baseline.requests[0]!
const VIDEO = baseline.requests[1]!
const IM = baseline.requests[2]!
const TEXT_KEYWORD = baseline.requests[3]!
const TEXT_DATERANGE = baseline.requests[4]!

const catalog = JSON.parse(
  readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
) as { items: Array<{ menuPath: string; title: string; routeFile: string; kind: string }> }

/** 取 path + query，并把一次性时间戳参数归一化 */
function normalizeUrl (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（renren 靠同序做到逐字段一致） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

/**
 * 能力**还没有**接线进 `src/capabilities/index.ts`（本次任务刻意不动门面），
 * 所以这里像 `smoke/read-study-course.mjs` 那样手工注入 `request`：
 * 用的仍是真实的 `sdk.call(页面路径, …)`，页面上下文（module-type / http 实例）
 * 走的还是同一条路，能力实现也是同一份。
 */
function makeCapability (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const capability = createStudyCourseCapability((config) =>
    // 用 text 页作页面上下文即可：三页的 module-type / http 实例推导结果相同（都是 12 / platform）
    sdk.call(STUDY_COURSE_TEXT_PAGE_PATH, config),
  )
  return { sdk, capability, calls }
}

function makeDirectCapability (responses: unknown[] = [undefined]) {
  const calls: Array<Parameters<PortalRequest>[0]> = []
  const request: PortalRequest = async (config) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as never
  }
  return { capability: createStudyCourseCapability(request), calls }
}

/** 某个能力的参数名（按契约声明顺序） */
function paramNames (id: string): string[] {
  const definition = studyCourseCapabilities.find((item) => item.id === id)
  return definition === undefined ? [] : definition.params.map((param) => param.name)
}

describe('课程管理三页 —— 与浏览器基准逐字段一致（D20）', () => {
  const cases: Array<[string, (c: ReturnType<typeof makeCapability>['capability']) => Promise<unknown>, typeof TEXT]> = [
    ['图文课程', (c) => c.listText(), TEXT],
    ['视频课程', (c) => c.listVideo(), VIDEO],
  ]

  for (const [name, call, base] of cases) {
    it(`${name}：无筛选时的 URL 与基准完全相同（含键顺序）`, async () => {
      const { capability, calls } = makeCapability()

      await call(capability)

      const actual = String(calls[0]?.url)
      expect(queryPairs(actual)).toEqual(queryPairs(base.url))
      expect(normalizeUrl(actual)).toBe(normalizeUrl(base.url))
    })

    it(`${name}：方法、请求头与基准一致（module-type 由页面推导出 12）`, async () => {
      const { capability, calls } = makeCapability()

      await call(capability)

      expect(String(calls[0]?.method).toUpperCase()).toBe(base.method)

      // axios 的 header bag 里会多带一个值为 undefined 的 `Content-Type` 槽位
      // （own key 里有，但不会发出去）。要比对的是**真正发出去的那一组**，所以走 toJSON()。
      // 基准里的 token 是页面内脱敏后的 `<redacted>`，这里同样归一化后再比。
      const bag = calls[0]?.headers as unknown as {
        toJSON: () => Record<string, string>
        [key: string]: unknown
      }
      const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
      expect(sent).toEqual(base.headers)
      expect(sent['module-type']).toBe('12')
      // 多出来的槽位必须是空值 —— 否则就是真的多发了一个头（同样是"与浏览器不等价"）
      for (const key of Object.keys(bag)) {
        if (key in sent) continue
        expect(bag[key], `多余的头 ${key} 有值，会真的发出去`).toBeUndefined()
      }
    })
  }

  it('即时通讯课程：URL 与基准完全相同（它那一组筛选字段与另外两页不同）', async () => {
    const { capability, calls } = makeCapability()

    await capability.listIm()

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(IM.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(IM.url))
  })

  it('三页的空筛选值全部以**空字符串**发出，不是省略（convertFetchForm 的实测行为）', async () => {
    const { capability, calls } = makeCapability()

    await capability.listText()
    await capability.listIm()

    // 这一条是那 72 页 convertFetchForm 的核心：`keyword=''`、`startTime=''` 都真的在 URL 上
    const textUrl = String(calls[0]?.url)
    expect(textUrl).toContain('keyword=')
    expect(textUrl).toContain('startTime=')
    expect(textUrl).toContain('endTime=')

    const imUrl = String(calls[1]?.url)
    for (const key of ['keyword', 'numberMin', 'numberMax', 'status', 'createTimeStart', 'createTimeEnd', 'deleteTimeStart', 'deleteTimeEnd']) {
      expect(imUrl).toContain(`${key}=`)
      expect(imUrl).not.toContain(`${key}=undefined`)
    }
  })

  it('type 排在 _t **之后**，且不接受调用方覆盖', async () => {
    const { capability, calls } = makeCapability()

    // 调用方硬塞 type —— 它不是这一页的参数，是"这一页是哪一页"的定义
    // 时间戳也含 999：只检查 type 参数，不能把无关字段误判成覆盖。
    const now = vi.spyOn(Date, 'now').mockReturnValue(1790057613999)
    try {
      await capability.listText({ type: 999 } as never)
    } finally {
      now.mockRestore()
    }

    const url = String(calls[0]?.url)
    const query = new URL(url, 'https://portal.test').searchParams
    const keys = [...query.keys()]
    expect(keys.indexOf('_t')).toBeLessThan(keys.indexOf('type'))
    expect(query.get('_t')).toBe('1790057613999')
    expect(query.getAll('type')).toEqual(['1'])
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { capability, calls } = makeCapability()

    // 故意倒着写实参
    await capability.listText({ pageSize: 20, pageNo: 1, endTime: 'b', startTime: 'a', keyword: 'k' })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'keyword',
      'startTime',
      'endTime',
      'pageNo',
      'pageSize',
      '_t',
      'type',
    ])
  })

  it('即时通讯课程的参数顺序同样固定', async () => {
    const { capability, calls } = makeCapability()

    await capability.listIm({ status: 0 })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'keyword',
      'numberMin',
      'numberMax',
      'status',
      'createTimeStart',
      'createTimeEnd',
      'deleteTimeStart',
      'deleteTimeEnd',
      'pageNo',
      'pageSize',
      '_t',
      'type',
    ])
  })

  it('默认每页 20 条，与 useListPageModule(styleV2) 一致', async () => {
    const { capability, calls } = makeCapability()

    await capability.listText()

    expect(String(calls[0]?.url)).toContain(`pageSize=${DEFAULT_PAGE_SIZE}`)
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })
})

describe('关键字填值路径：与浏览器基准一致（同时也锁住"命中即报错"的现状）', () => {
  it('keyword 填值后的 URL 与基准一致', async () => {
    const { capability, calls } = makeCapability()

    await capability.listText({ keyword: '蛋鸡' })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(TEXT_KEYWORD.url))
    // startTime / endTime 仍是空串 —— 关键字不会挤掉区间字段
    expect(actual).toContain('startTime=&endTime=')
  })

  it('关键字命中时后端返回 code:500 —— SDK 把它抛成 PortalApiError，不吞成空列表', async () => {
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => ({
      data: {
        ret: 'FAIL',
        code: 500,
        msg: '用户查询结果超过500条，请缩小name条件或调用已有分页接口',
        data: null,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    const capability = createStudyCourseCapability((config) =>
      sdk.call(STUDY_COURSE_TEXT_PAGE_PATH, config),
    )

    // 关键：这是**抛错**，不是"返回空列表" —— 后者会让调用方以为"真的没有数据"
    await expect(capability.listText({ keyword: '经营' })).rejects.toThrow(/超过500条/)
  })
})

describe('时间区间：结束日 +1 天（开区间），与页面的 add(1, "day") 一致', () => {
  it('日期区间填值后的 URL 与基准一致', async () => {
    const { capability, calls } = makeCapability()

    await capability.listText(buildStudyCourseTimeRange('2026-09-01', '2026-09-15'))

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(TEXT_DATERANGE.url))
    expect(actual).toContain('startTime=2026-09-01%2000%3A00%3A00')
    expect(actual).toContain('endTime=2026-09-16%2000%3A00%3A00')
  })

  it('结束日 +1 天：选到 9-15 查的是 9-16 00:00:00 之前的（少这一天就是静默错）', () => {
    expect(buildStudyCourseTimeRange('2026-09-01', '2026-09-15')).toEqual({
      startTime: '2026-09-01 00:00:00',
      endTime: '2026-09-16 00:00:00',
    })
    expect(buildStudyCourseCreateTimeRange('2026-01-01', '2026-01-31')).toEqual({
      createTimeStart: '2026-01-01 00:00:00',
      createTimeEnd: '2026-02-01 00:00:00',
    })
    expect(buildStudyCourseDeleteTimeRange('2026-12-31', '2026-12-31')).toEqual({
      deleteTimeStart: '2026-12-31 00:00:00',
      deleteTimeEnd: '2027-01-01 00:00:00',
    })
  })

  it('跨月跨年由 Date 进位，不是字符串拼接', () => {
    expect(buildStudyCourseTimeRange('2026-02-27', '2026-02-28').endTime).toBe('2026-03-01 00:00:00')
  })

  it('结束日早于开始日 → 抛错，不发请求', () => {
    expect(() => buildStudyCourseTimeRange('2026-09-15', '2026-09-01')).toThrow(/不早于/)
    expect(() => buildStudyCourseTimeRange('不是日期', '2026-09-01')).toThrow(/YYYY-MM-DD/)
  })
})

describe('即时通讯课程及可达隐藏子页动作：请求形状与 prepare→submit→cancel', () => {
  it('互动消息列表固定 sessionType=2，并保留 voice-merge 的排序筛选字段', async () => {
    const { capability, calls } = makeDirectCapability([{ list: [], total: 0 }])

    await capability.listMessages({
      id: '81',
      roomId: 'room-9',
      order: 'asc',
      orderField: 'createTime',
      type: 2,
    })

    expect(calls[0]).toEqual({
      url: '/study/interaction/page',
      method: 'get',
      params: {
        order: 'asc',
        orderField: 'createTime',
        id: '81',
        roomId: 'room-9',
        sessionType: 2,
        content: '',
        type: 2,
        status: '',
        name: '',
        staffCode: '',
        isProhibition: '',
        createTimeStart: '',
        createTimeEnd: '',
        pageNo: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      },
    })
  })

  it('合并语音列表只按 roomId 分页查询', async () => {
    const { capability, calls } = makeDirectCapability([{ list: [], total: 0 }])
    await capability.listMergedAudio({ roomId: 'room-9', pageNo: 2, pageSize: 7 })
    expect(calls[0]).toEqual({
      url: '/study/audio/page',
      method: 'get',
      params: { order: '', orderField: '', roomId: 'room-9', pageNo: 2, pageSize: 7 },
    })
  })

  it('新建即时通讯课程固定 type/joinmode/msg，提交 body 不混入页面外字段', async () => {
    const { capability, calls } = makeDirectCapability()
    const prepared = capability.prepareCreateIm({ form: { gradeId: 12, title: '安全培训群', staffCode: 'S001' } })
    expect(prepared.draft).toEqual({
      type: 4,
      gradeId: 12,
      imGroupDTO: { joinmode: 0, msg: '即时通讯课程', title: '安全培训群', staffCode: 'S001' },
    })
    expect(capability.cancelCreateIm()).toEqual({ cancelled: true })

    await capability.createIm({ draft: prepared.draft })
    expect(calls[0]).toEqual({ url: '/study/course/studycourse', method: 'post', data: prepared.draft })
    expect(() => capability.prepareCreateIm({ form: { gradeId: 12, title: ' '.repeat(2), staffCode: 'S001' } })).toThrow(/title不能为空/)
    expect(() => capability.prepareCreateIm({ form: { gradeId: 12, title: '汉'.repeat(34), staffCode: 'S001' } })).toThrow(/100字节/)
  })

  it('禁言/解禁使用课程行 id、query muted 和 null body', async () => {
    const { capability, calls } = makeDirectCapability([{}])
    const prepared = capability.prepareMute({ id: 41, currentMuted: false })
    expect(prepared.draft).toEqual({ id: 41, muted: true })
    expect(capability.cancelMute()).toEqual({ cancelled: true })
    await capability.mute({ draft: prepared.draft })
    expect(calls[0]).toEqual({
      url: '/study/course/studycourse/41/chatroom/mute',
      method: 'put',
      params: { muted: true },
      data: null,
    })
  })

  it('互动消息状态按页面传绝对 status，body 只有 id/status', async () => {
    const { capability, calls } = makeDirectCapability()
    const prepared = capability.prepareMessageStatus({ id: '91', status: 1 })
    expect(capability.cancelMessageStatus()).toEqual({ cancelled: true })
    await capability.updateMessageStatus({ draft: prepared.draft })
    expect(calls[0]).toEqual({
      url: '/study/interaction/updateStatus',
      method: 'put',
      data: { id: '91', status: 1 },
    })
  })

  it('合并语音状态按页面顺序发送 multipart roomId/id/status/可选 lessonId', async () => {
    const { capability, calls } = makeDirectCapability()
    const prepared = capability.prepareAudioStatus({ id: 7, roomId: 'room-9', currentStatus: 0, lessonId: 1001 })
    expect(prepared.draft).toEqual({ id: 7, roomId: 'room-9', status: 1, lessonId: 1001 })
    expect(capability.cancelAudioStatus()).toEqual({ cancelled: true })
    await capability.updateAudioStatus({ draft: prepared.draft })

    const formData = calls[0]?.data as FormData
    expect(calls[0]?.url).toBe('/study/audio/updateStatus')
    expect(calls[0]?.method).toBe('put')
    expect(Array.from(formData.entries())).toEqual([
      ['roomId', 'room-9'],
      ['id', '7'],
      ['status', '1'],
      ['lessonId', '1001'],
    ])
  })

  it('合并语音删除 body 直接是 ID 数组，单删与批量共用形状', async () => {
    const { capability, calls } = makeDirectCapability()
    const prepared = capability.prepareAudioDelete({ ids: [7, '8'] })
    expect(capability.cancelAudioDelete()).toEqual({ cancelled: true })
    await capability.deleteAudio({ draft: prepared.draft })
    expect(calls[0]).toEqual({ url: '/study/audio', method: 'delete', data: [7, '8'] })
  })

  it('语音合并至少需要两个外部地址，提交 MergeDTO 四个页面字段', async () => {
    const { capability, calls } = makeDirectCapability(['https://cdn.test/merged.m4a'])
    const prepared = capability.prepareAudioMerge({
      lessonId: 1001,
      lessonName: '第一课',
      roomId: 'room-9',
      fileList: ['https://cdn.test/a.m4a', 'https://cdn.test/b.m4a'],
    })
    expect(capability.cancelAudioMerge()).toEqual({ cancelled: true })
    await expect(capability.audioMerge({ draft: prepared.draft })).resolves.toBe('https://cdn.test/merged.m4a')
    expect(calls[0]).toEqual({
      url: '/study/audioMerge',
      method: 'post',
      data: {
        lessonId: 1001,
        lessonName: '第一课',
        roomId: 'room-9',
        fileList: ['https://cdn.test/a.m4a', 'https://cdn.test/b.m4a'],
      },
    })
    expect(() => capability.prepareAudioMerge({ lessonId: 1001, roomId: 'room-9', fileList: ['only-one'] })).toThrow(/至少需要两个/)
  })
})

describe('能力定义：每个页面一个，pagePath 落在目录里', () => {
  it('能力 id 唯一、写能力标记正确、页面路径与目录一致', () => {
    const ids = studyCourseCapabilities.map((item) => item.id)
    expect(new Set(ids).size).toBe(Object.keys(STUDY_COURSE_METHODS).length)
    const writeIds = new Set([
      'study-course-im-create',
      'study-course-im-mute',
      'study-course-im-message-status',
      'study-course-im-audio-status',
      'study-course-im-audio-delete',
      'study-course-im-audio-merge',
    ])

    for (const definition of studyCourseCapabilities) {
      expect(definition.write).toBe(writeIds.has(definition.id))
      const inCatalog = catalog.items.find((item) => item.menuPath === definition.pagePath)
      expect(inCatalog, `${definition.id} 的 pagePath 不在 page-catalog 里`).toBeTruthy()
    }
  })

  it('隐藏子页动作仍归属即时通讯课程列表权限上下文', () => {
    for (const definition of studyCourseCapabilities.filter((item) => item.id.startsWith('study-course-im-'))) {
      expect(definition.pagePath).toBe(STUDY_COURSE_IM_PAGE_PATH)
      expect(definition.permission).toBe(STUDY_COURSE_IM_PERMISSION)
    }
    expect(STUDY_COURSE_IM_FORM_PAGE_PATH).toContain('/dashboard/course/im-course/')
    expect(STUDY_COURSE_IM_MESSAGE_PAGE_PATH).toContain('/message/')
    expect(STUDY_COURSE_IM_AUDIO_PAGE_PATH).toContain('/merge/')
  })

  it('三页的路由文件与目录里的 routeFile 一致', () => {
    const pairs: Array<[string, string]> = [
      [STUDY_COURSE_TEXT_PAGE_PATH, STUDY_COURSE_ROUTE_FILES.text],
      [STUDY_COURSE_VIDEO_PAGE_PATH, STUDY_COURSE_ROUTE_FILES.video],
      [STUDY_COURSE_IM_PAGE_PATH, STUDY_COURSE_ROUTE_FILES.im],
    ]
    for (const [menuPath, routeFile] of pairs) {
      const item = catalog.items.find((entry) => entry.menuPath === menuPath)
      expect(item?.routeFile).toBe(routeFile)
      expect(item?.kind).toBe('列表页(声明式 getDataListURL)')
    }
  })

  it('列表路径是四个页面共用的那一个，只有 type 不同', () => {
    expect(studyCourseListUrl(1)).toBe(`${STUDY_COURSE_LIST_PATH}?type=1`)
    expect(studyCourseListUrl(4)).toBe(`${STUDY_COURSE_LIST_PATH}?type=4`)
  })

  it('图文/视频两页的参数名一致；im 那一页是另一组', () => {
    const shared = ['keyword', 'startTime', 'endTime', 'pageNo', 'pageSize']
    expect(paramNames('study-course-text-list')).toEqual(shared)
    expect(paramNames('study-course-video-list')).toEqual(shared)
    expect(paramNames('study-course-im-list')).toEqual([
      'keyword',
      'numberMin',
      'numberMax',
      'status',
      'createTimeStart',
      'createTimeEnd',
      'deleteTimeStart',
      'deleteTimeEnd',
      'pageNo',
      'pageSize',
    ])
    expect(paramNames('study-course-im-message-list')).toEqual([
      'id',
      'roomId',
      'order',
      'orderField',
      'content',
      'type',
      'status',
      'name',
      'staffCode',
      'isProhibition',
      'createTimeStart',
      'createTimeEnd',
      'pageNo',
      'pageSize',
    ])
    expect(paramNames('study-course-im-audio-list')).toEqual(['roomId', 'order', 'orderField', 'pageNo', 'pageSize'])
  })

  it('status 是枚举，取值来自字典 im_course_status（0 使用 / 1 解散）', () => {
    expect(IM_COURSE_STATUS_OPTIONS).toEqual([
      { label: '使用', value: 0 },
      // 字典原文的 label 带一个前导空格，这里保留原样
      { label: ' 解散', value: 1 },
    ])
    const status = studyCourseCapabilities
      .find((item) => item.id === 'study-course-im-list')
      ?.params.find((param) => param.name === 'status')
    expect(status?.kind).toBe('enum')
    expect(status?.options?.map((option) => option.value)).toEqual([0, 1])
  })
})
