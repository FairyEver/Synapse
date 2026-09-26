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
  STUDY_COURSE_CMS_HTTP_INSTANCE,
  STUDY_COURSE_COMMENT_LIST_PATH,
  STUDY_COURSE_COMMENT_TYPE,
  STUDY_COURSE_IM_LESSON_LIST_PATH,
  STUDY_COURSE_IM_PAGE_PATH,
  STUDY_COURSE_IM_AUDIO_PAGE_PATH,
  STUDY_COURSE_IM_FORM_PAGE_PATH,
  STUDY_COURSE_IM_MESSAGE_PAGE_PATH,
  STUDY_COURSE_IM_PERMISSION,
  STUDY_COURSE_IM_ROUTE_FILES,
  STUDY_COURSE_IM_STUDENT_LIST_PATH,
  STUDY_COURSE_IM_TEACHER_LEVEL_PATH,
  STUDY_COURSE_LAY_HTTP_INSTANCE,
  STUDY_COURSE_LIST_PATH,
  STUDY_COURSE_ROUTE_FILES,
  STUDY_COURSE_SPEECH_MODE_OPTIONS,
  STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH,
  STUDY_COURSE_TEXT_PAGE_PATH,
  STUDY_COURSE_TEXT_SPEECH_BY_IMAGE_PATH,
  STUDY_COURSE_TEXT_SPEECH_BY_VOICE_PATH,
  STUDY_COURSE_TEXT_VOICE_LIST_PATH,
  STUDY_COURSE_VIDEO_PAGE_PATH,
  STUDY_COURSE_VIDEO_PROFESSOR_LIST_PATH,
  STUDY_COURSE_VIDEO_TAG_LIST_PATH,
  STUDY_COURSE_VIDEO_TYPE_TREE_PATH,
  STUDY_COURSE_VIDEO_TYPE_TREE_TYPE,
  STUDY_COURSE_VIDEO_PROFESSOR_TYPE,
  STUDY_COURSE_VIDEO_TAG_TYPE,
  STUDY_COURSE_METHODS,
} from '../src/capabilities/study-course.js'
import { HTTP_INSTANCES, HttpInstanceResolutionError } from '../src/context/http-instance.js'
import { STUDY_COURSE_AI_CONTRACTS } from '../src/catalog/contracts-study-course.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp } from '../src/http/client.js'
import type { PortalRequestConfig } from '../src/http/client.js'

type CapturedCall = InternalAxiosRequestConfig & {
  moduleType?: number
  /** 逐请求指定的 http 实例（`PortalRequestConfig.httpInstance`） */
  httpInstance?: string
  /** 原样拿整个响应体、不拆包络的开关 */
  isOriginal?: boolean
}

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
 * 与 `createPortalHeadless` 内部**同一条路**：`createPortalHttp` + `createPageCall`。
 *
 * 这里刻意**不 import `src/index.js`**：那个入口会把 `src/catalog/ai-contracts.ts` 整条
 * 契约链拉进来，任何一个契约文件被别的并行任务改坏，本测试文件就整体加载不了
 * （2026-09-26 实际踩到过一次）。本文件只验课程能力与请求层，不需要门面。
 */
function makeHttp (options: { httpBaseUrls?: Record<string, string> } = {}) {
  const http = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  const call = createPageCall(
    <R,>(requestConfig: PortalRequestConfig) => http.request(requestConfig as never) as unknown as Promise<R>,
    undefined,
    options.httpBaseUrls === undefined ? undefined : { baseUrls: options.httpBaseUrls },
  )
  return { http, call }
}

/** 基准里那三个实例的 baseURL（测试环境的取值） */
const INSTANCE_BASE_URLS = {
  [STUDY_COURSE_LAY_HTTP_INSTANCE]: 'https://smarterlayeradmintest.zhihuidanji.com/admin',
  [STUDY_COURSE_CMS_HTTP_INSTANCE]: 'https://smarterlayeradmintest.zhihuidanji.com/admin',
}

/**
 * 能力**还没有**接线进 `src/capabilities/index.ts`（本次任务刻意不动门面），
 * 所以这里像 `smoke/read-study-course.mjs` 那样手工注入 `request`：
 * 用的仍是真实的 `call(页面路径, …)`，页面上下文（module-type / http 实例）
 * 走的还是同一条路，能力实现也是同一份。
 */
function makeCapability (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const { http, call } = makeHttp()
  ;(http as AxiosInstance).defaults.adapter = async (config) => {
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
    call(STUDY_COURSE_TEXT_PAGE_PATH, config as unknown as PortalRequestConfig),
  )
  return { http, capability, calls }
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
    const { http, call } = makeHttp()
    ;(http as AxiosInstance).defaults.adapter = async (config) => ({
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
      call(STUDY_COURSE_TEXT_PAGE_PATH, config as unknown as PortalRequestConfig),
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
      // 弹窗 / 隐藏子路由里那三条：**按真实行为**标写，不按 HTTP 方法
      // （`generatedSpeech.lay` 名字是 GET，但它会写库并启动 TTS 线程）
      'study-course-text-generated-speech',
      'study-course-text-generate-speech',
      'study-course-text-generate-speech-by-voice',
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

// ---------------------------------------------------------------------------
// 弹窗 / 隐藏子路由：`.lay` 网关与 zhdj-sms 上的请求
// ---------------------------------------------------------------------------

const LAY = STUDY_COURSE_LAY_HTTP_INSTANCE
const CMS = STUDY_COURSE_CMS_HTTP_INSTANCE

/**
 * 这一批走**真实的** `sdk.call(页面, config)`，并把两个跨实例的 baseURL 配上，
 * adapter 按 URL 返回各接口自己的响应体。
 *
 * 这样一次覆盖三件事：能力**自己**传的逐请求 `httpInstance`、该实例的请求头与包络、
 * 以及能力对响应的解包。用纯 request 替身是测不到前两件的。
 */
function makeInstanceCapability (bodies: Record<string, unknown>) {
  const calls: CapturedCall[] = []
  const { http, call } = makeHttp({ httpBaseUrls: INSTANCE_BASE_URLS })
  ;(http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    const key = Object.keys(bodies).find((path) => String(config.url).includes(path))
    return {
      data: key === undefined ? { ret: 'SUCCESS', code: 200 } : bodies[key],
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const capability = createStudyCourseCapability((config) =>
    call(STUDY_COURSE_TEXT_PAGE_PATH, config as unknown as PortalRequestConfig),
  )
  return { http, capability, calls }
}

const studentBody = (rows: unknown[]) => ({ ret: 'SUCCESS', code: 0, msg: '', data: rows })

/**
 * 从 axios 的最终配置里取几个我们真正关心的槽位。
 *
 * 直接 `toEqual(calls[0])` 不行：那是 axios 合并完默认值之后的**整个**配置
 * （adapter / transformRequest / baseURL / timeout…）。只比这次请求的形状。
 */
function wireOf (config: CapturedCall | undefined) {
  return {
    url: String(config?.url),
    method: String(config?.method ?? '').toUpperCase(),
    httpInstance: config?.httpInstance,
    isOriginal: config?.isOriginal,
    moduleType: config?.moduleType,
    data: config?.data,
  }
}

/** 去掉这一族拦截器注入的 `token` / `_t`，剩下的是能力自己拼的那一串（顺序保留） */
function callerParams (config: CapturedCall | undefined): Record<string, unknown> {
  const params = { ...((config?.params ?? {}) as Record<string, unknown>) }
  delete params.token
  delete params._t
  return params
}

describe('跨实例：能力定义钉死的实例与实现里逐请求传的实例必须一致', () => {
  const LAY_IDS = [
    'study-course-im-owner-level-options',
    'study-course-text-comment-list',
    'study-course-video-comment-list',
    'study-course-video-type-tree',
    'study-course-video-professor-list',
    'study-course-video-tag-list',
  ]
  const CMS_IDS = [
    'study-course-text-voice-list',
    'study-course-text-generated-speech',
    'study-course-text-generate-speech',
    'study-course-text-generate-speech-by-voice',
  ]

  it('10 条挂在 smart-layer-admin / zhdj-sms 上（6 + 4），其余仍走默认 platform（没有多写一个 httpInstance）', () => {
    const declared = new Map(
      studyCourseCapabilities.map((item) => [item.id, (item as { httpInstance?: string }).httpInstance]),
    )
    for (const id of [...LAY_IDS, ...CMS_IDS]) {
      expect(declared.has(id), `${id} 没有能力定义`).toBe(true)
    }
    for (const id of LAY_IDS) expect(declared.get(id), `${id} 的实例不对`).toBe(LAY)
    for (const id of CMS_IDS) expect(declared.get(id), `${id} 的实例不对`).toBe(CMS)
    // 列表、隐藏 IM 子页与两条候选（学员 / 班课）都在 platform 上：**不写**这个字段
    for (const id of ['study-course-text-list', 'study-course-im-list', 'study-course-im-student-list', 'study-course-im-lesson-list']) {
      expect(declared.get(id), `${id} 不该声明实例`).toBeUndefined()
    }
  })

  it('两个实例 id 都在 http 实例表里（不是自己造的名字）', () => {
    const ids = HTTP_INSTANCES.map((item) => item.id)
    expect(ids).toContain(LAY)
    expect(ids).toContain(CMS)
    // 两条不同的画像：一个 smart-layer 档、一个 zhdj-sms 档。
    // baseURL env 在测试环境取值相同，所以**判实例不能按 host**，只能按 id。
    const lay = HTTP_INSTANCES.find((item) => item.id === LAY)
    const cms = HTTP_INSTANCES.find((item) => item.id === CMS)
    expect(lay?.responseEnvelope).toBe('smart-layer')
    expect(cms?.responseEnvelope).toBe('zhdj-sms')
    // 两个实例的 baseURL 取自**不同的 env 键**。测试环境里这两个 env 的取值恰好相同，
    // 所以实例归属**既不能按 host 判、也不能按 env 取值判**，只能按实例 id 判 ——
    // 这正是要钉住这条的原因（按 host 判会把包络判错档）。
    expect(lay?.baseUrl).toEqual({ kind: 'env', env: 'VITE_SMART_LAYER_ADMIN_API' })
    expect(cms?.baseUrl).toEqual({ kind: 'env', env: 'VITE_ZHDJ_CMS_API' })
    expect(lay?.headerMode).not.toBe('generate-http-headers')
    expect(cms?.headerMode).not.toBe('generate-http-headers')
  })

  it('没配 baseURL 时拒绝发请求（失败闭合，不拿默认 baseURL 去凑）', async () => {
    // 这个 fixture **没有**配 httpBaseUrls
    const { capability, calls } = makeCapability()

    await expect(capability.listTextComments({ newsId: 1 })).rejects.toBeInstanceOf(HttpInstanceResolutionError)
    await expect(capability.listTags()).rejects.toBeInstanceOf(HttpInstanceResolutionError)
    await expect(capability.listVoiceOptions()).rejects.toBeInstanceOf(HttpInstanceResolutionError)
    // 一次都没发出去
    expect(calls).toHaveLength(0)
  })
})

describe('即时通讯课程隐藏新建表单的两个候选：学员（群主）与班课', () => {
  it('学员候选走 platform，参数名是 name（页面的 valueKey 是 staffCode）', async () => {
    const calls: CapturedCall[] = []
    const { http, call } = makeHttp()
    ;(http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config as CapturedCall)
      return {
        data: studentBody([{ id: 9, name: '张三', staffCode: 10086, mobile: 13800000000, organizationName: '一场' }]),
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const capability = createStudyCourseCapability((config) =>
      call(STUDY_COURSE_IM_PAGE_PATH, config as unknown as PortalRequestConfig),
    )

    const rows = await capability.searchStudents({ keyword: '张三' })

    expect(rows).toEqual([{ id: 9, name: '张三', staffCode: 10086, mobile: 13800000000, organizationName: '一场' }])
    expect(String(calls[0]?.url)).toContain(`${STUDY_COURSE_IM_STUDENT_LIST_PATH}?name=`)
    expect(String(calls[0]?.url)).toContain('name=%E5%BC%A0%E4%B8%89')
  })

  it('学员候选必须给关键字：空关键字在发请求前就抛错（不照抄页面的全量候选请求）', async () => {
    const { capability, calls } = makeCapability()
    await expect(capability.searchStudents({ keyword: '  ' })).rejects.toThrow(/关键字不能为空/)
    await expect(capability.searchStudents({} as never)).rejects.toThrow(/关键字不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('学员候选响应不是数组时抛错，不降级成空列表', async () => {
    const { capability } = makeCapability({ list: [], total: 0 })
    await expect(capability.searchStudents({ keyword: '张' })).rejects.toThrow(/期望数组/)
  })

  it('班课候选取 gradeId，走 platform', async () => {
    const { capability, calls } = makeCapability([{ id: 71, title: '第一课' }])
    const rows = await capability.listLessonsByGrade({ gradeId: 12 })
    expect(rows).toEqual([{ id: 71, title: '第一课' }])
    // platform 实例：路径补 /admin-api 前缀，参数只有 gradeId（外加拦截器注入的 _t）
    expect(wireOf(calls[0])).toEqual({
      url: `/admin-api${STUDY_COURSE_IM_LESSON_LIST_PATH}?gradeId=12&_t=${new URL(String(calls[0]?.url), 'https://x').searchParams.get('_t')}`,
      method: 'GET',
      httpInstance: undefined,
      isOriginal: undefined,
      moduleType: 12,
      data: undefined,
    })
  })

  it('讲师级别候选：无参、走 smart-layer-admin、取整个响应体的 StudyTeacherLevelDTOList', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_IM_TEACHER_LEVEL_PATH]: {
        ret: 'SUCCESS',
        code: 200,
        msg: 'success',
        StudyTeacherLevelDTOList: [{ id: 1, name: '高级', level: 3, sort: 1, status: 1, isDel: 0 }],
      },
    })

    const rows = await capability.listOwnerLevels()

    expect(rows).toEqual([{ id: 1, name: '高级', level: 3, sort: 1, status: 1, isDel: 0 }])
    // 地址落在**.lay 那个 host**上（baseURL 由调用方的 httpBaseUrls 给），
    // 路径不被补 /admin-api（那是 platform 独有的改写，只有 `prepend-absolute` 会做）
    expect(String(calls[0]?.url)).toBe(STUDY_COURSE_IM_TEACHER_LEVEL_PATH)
    expect(String(calls[0]?.url)).not.toContain('/admin-api')
    expect((calls[0] as unknown as { baseURL?: string })?.baseURL)
      .toBe('https://smarterlayeradmintest.zhihuidanji.com/admin')
    // 这一族是 axios 默认序列化：对象键序就是 URL 上的顺序，token 在 _t 之前
    expect(Object.keys((calls[0]?.params ?? {}) as object)).toEqual(['token', '_t'])
    // 这一族的请求头只有 token + Accept-Language（外加 axios 自己默认的 Accept）：
    // **没有 tenant-id，也没有 module-type** —— 这是实例画像 headerMode='minimal' 决定的。
    // 注意它与 platform 那一档是**两套头**：拿主站的四个头去核对这一族会全部对不上。
    const sent = (calls[0]?.headers as unknown as { toJSON: () => Record<string, string> }).toJSON()
    expect(Object.keys(sent).sort()).toEqual(['Accept', 'Accept-Language', 'token'])
    expect(sent['module-type']).toBeUndefined()
    expect(sent['tenant-id']).toBeUndefined()
  })

  it('讲师级别候选缺 StudyTeacherLevelDTOList 键时抛错', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_IM_TEACHER_LEVEL_PATH]: { ret: 'SUCCESS', code: 200, msg: 'success' },
    })
    await expect(capability.listOwnerLevels()).rejects.toThrow(/没有 StudyTeacherLevelDTOList/)
  })
})

describe('评论列表：图文 / 视频两页同一接口，参数名有两处刻意不同', () => {
  const pagesBody = (results: unknown[], totalRecord: number) => ({
    ret: 'SUCCESS',
    code: 200,
    msg: '',
    pages: { pageNo: 1, pageSize: 20, totalRecord, totalPage: 1, results },
  })

  it('图文页：type 固定 1，筛选字段是 username / phone，解包落在包络的第二选择 pages 上', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_COMMENT_LIST_PATH]: pagesBody([{ id: 5, content: '好', commentType: 1, top: 1 }], 42),
    })

    const page = await capability.listTextComments({ newsId: 900 })

    expect(page).toEqual({ list: [{ id: 5, content: '好', commentType: 1, top: 1 }], total: 42 })
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_COMMENT_LIST_PATH,
      method: 'GET',
      httpInstance: LAY,
      isOriginal: undefined,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    // 键序也是契约：能力按页面的对象字面量顺序装配（token / _t 由实例拦截器补在后面）
    expect(callerParams(calls[0])).toEqual({
      newsId: 900,
      type: STUDY_COURSE_COMMENT_TYPE.text,
      limit: DEFAULT_PAGE_SIZE,
      page: 1,
      username: '',
      phone: '',
      content: '',
      startTime: '',
      endTime: '',
    })
    // 这一族是 axios 默认序列化（不是 platform 那种拦截器拼 query），所以键序要在 params 上看：
    // 能力自己拼的九个键在前，实例拦截器补的 token / _t 在后
    expect(Object.keys((calls[0]?.params ?? {}) as object)).toEqual([
      'newsId', 'type', 'limit', 'page', 'username', 'phone', 'content', 'startTime', 'endTime', 'token', '_t',
    ])
    expect(STUDY_COURSE_COMMENT_TYPE.text).toBe(1)
  })

  it('视频页：type 固定 2，筛选字段名是 userName / userPhone（与图文页不同的**线上形状**）', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_COMMENT_LIST_PATH]: pagesBody([], 0),
    })

    await capability.listVideoComments({ newsId: 4068, userName: '李四', userPhone: '139' })

    const params = callerParams(calls[0])
    expect(Object.keys(params)).toEqual([
      'newsId', 'type', 'limit', 'page', 'userName', 'userPhone', 'content', 'startTime', 'endTime',
    ])
    expect(params.type).toBe(STUDY_COURSE_COMMENT_TYPE.video)
    expect(params.userName).toBe('李四')
    expect(params.userPhone).toBe('139')
    // 后端只认 username / phone，视频页这两个键发过去不会报错、也不会生效
    expect(params.username).toBeUndefined()
    expect(params.phone).toBeUndefined()
  })

  it('两页共用同一组输入名：SDK 侧都叫 userName / userPhone，落到线上各自的名字', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_COMMENT_LIST_PATH]: pagesBody([], 0),
    })

    await capability.listTextComments({ newsId: 1, userName: 'A', userPhone: 'B' })
    await capability.listVideoComments({ newsId: 1, userName: 'A', userPhone: 'B' })

    const text = callerParams(calls[0])
    const video = callerParams(calls[1])
    expect([text.username, text.phone]).toEqual(['A', 'B'])
    expect([video.userName, video.userPhone]).toEqual(['A', 'B'])
  })

  it('评论响应缺 pages.results 时抛错（不能把形状变化读成"没有评论"）', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_COMMENT_LIST_PATH]: { ret: 'SUCCESS', code: 200, msg: '' },
    })
    await expect(capability.listTextComments({ newsId: 1 })).rejects.toThrow(/期望分页对象/)
  })

  it('newsId 必须是正整数，否则不发请求', async () => {
    const { capability, calls } = makeInstanceCapability({})
    await expect(capability.listTextComments({ newsId: 0 } as never)).rejects.toThrow(/正整数ID/)
    expect(calls).toHaveLength(0)
  })
})

describe('图文课程生成语音：三种方式、两个实例、一条 GET 却是写', () => {
  const cmsOk = { ret: 'SUCCESS', code: 200, msg: '正在生成' }

  it('播报人候选走 zhdj-sms，只回页面消费的 label / value', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_TEXT_VOICE_LIST_PATH]: {
        ret: 'SUCCESS',
        code: 200,
        data: [
          { id: 1, label: '琪哥', value: 'x2_qige', type: 'xunfeiVoice', sort: 1 },
          { id: 2, label: '小媛', value: 'x4_lingxiaoyuan', type: 'xunfeiVoice', sort: 2 },
        ],
      },
    })

    const options = await capability.listVoiceOptions()

    expect(options).toEqual([
      { label: '琪哥', value: 'x2_qige' },
      { label: '小媛', value: 'x4_lingxiaoyuan' },
    ])
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_TEXT_VOICE_LIST_PATH,
      method: 'GET',
      httpInstance: CMS,
      isOriginal: undefined,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    expect(callerParams(calls[0])).toEqual({})
  })

  it('播报人候选缺 value 时抛错（缺了就无法提交 voiceName）', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_TEXT_VOICE_LIST_PATH]: { ret: 'SUCCESS', code: 200, data: [{ label: '琪哥' }] },
    })
    await expect(capability.listVoiceOptions()).rejects.toThrow(/value 不是非空字符串/)
  })

  it('「识别文字」分支：GET、参数键序 id/type/voiceName，且按 write 标注', async () => {
    const { capability, calls } = makeInstanceCapability({ [STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH]: cmsOk })

    await capability.generateSpeech({ newsId: 900, type: 1, voiceName: 'x2_qige' })

    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH,
      method: 'GET',
      httpInstance: CMS,
      isOriginal: undefined,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    expect(callerParams(calls[0])).toEqual({ id: 900, type: 1, voiceName: 'x2_qige' })
    expect(Object.keys((calls[0]?.params ?? {}) as object)).toEqual(['id', 'type', 'voiceName', 'token', '_t'])

    const definition = studyCourseCapabilities.find((item) => item.id === 'study-course-text-generated-speech')
    // 名字是 GET，但它会写库并启动 TTS 线程 —— write 按**真实行为**标，不按 HTTP 方法
    expect(definition?.write).toBe(true)
    expect(STUDY_COURSE_SPEECH_MODE_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3])
  })

  it('「识别图片」分支：POST JSON body 键序 id/voiceName/content', async () => {
    const { capability, calls } = makeInstanceCapability({ [STUDY_COURSE_TEXT_SPEECH_BY_IMAGE_PATH]: cmsOk })

    await capability.generateSpeechByImage({ newsId: 900, voiceName: 'x2_qige', content: '识别出来的字' })

    // POST 不带 _t（拦截器只给 GET 加），body 键序与页面逐字一致
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_TEXT_SPEECH_BY_IMAGE_PATH,
      method: 'POST',
      httpInstance: CMS,
      isOriginal: undefined,
      // 实例的 headerMode 不发 module-type，但 call() 仍把它挂在配置上（无害、可核对）
      moduleType: 12,
      data: '{"id":900,"voiceName":"x2_qige","content":"识别出来的字"}',
    })
    // 直接比对序列化后的字符串：它同时锁住键名与键序
    expect(String(calls[0]?.data)).toBe('{"id":900,"voiceName":"x2_qige","content":"识别出来的字"}')
  })

  it('「上传语音」分支：POST JSON body 键序 id/voiceUrl', async () => {
    const { capability, calls } = makeInstanceCapability({ [STUDY_COURSE_TEXT_SPEECH_BY_VOICE_PATH]: { ret: 'SUCCESS', code: 200, msg: '操作完成' } })

    await capability.generateSpeechByVoice({ newsId: 900, voiceUrl: 'https://oss.test/a.mp3' })

    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_TEXT_SPEECH_BY_VOICE_PATH,
      method: 'POST',
      httpInstance: CMS,
      isOriginal: undefined,
      // 实例的 headerMode 不发 module-type，但 call() 仍把它挂在配置上（无害、可核对）
      moduleType: 12,
      data: '{"id":900,"voiceUrl":"https://oss.test/a.mp3"}',
    })
    expect(String(calls[0]?.data)).toBe('{"id":900,"voiceUrl":"https://oss.test/a.mp3"}')
  })

  it('生成类型只接受 1/2/3，其它值在发请求前抛错', async () => {
    const { capability, calls } = makeInstanceCapability({ [STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH]: cmsOk })
    await expect(capability.generateSpeech({ newsId: 900, type: 4, voiceName: 'x2_qige' })).rejects.toThrow(/只能是 1\/2\/3/)
    expect(calls).toHaveLength(0)
  })

  it('空正文 / 空音频地址在发请求前抛错', async () => {
    const { capability, calls } = makeInstanceCapability({})
    await expect(capability.generateSpeechByImage({ newsId: 900, voiceName: 'x2_qige', content: ' ' })).rejects.toThrow(/content不能为空/)
    await expect(capability.generateSpeechByVoice({ newsId: 900, voiceUrl: '' })).rejects.toThrow(/voiceUrl不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('后端 code:300「没有文本内容！」抛成 PortalApiError，不吞成成功', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH]: { ret: 'SUCCESS', code: 300, msg: '没有文本内容！' },
    })
    await expect(capability.generateSpeech({ newsId: 900, type: 1, voiceName: 'x2_qige' })).rejects.toThrow(/没有文本内容/)
  })

  it('zhdj-sms 档的坑：`ret=FAIL` 但 `code=200` 时**不抛**，会返回 undefined —— 不能据此推断成功', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_TEXT_GENERATED_SPEECH_PATH]: { ret: 'FAIL', code: 200, msg: '别信这个成功' },
    })

    // 这与 platform 那一档正相反（那里 `ret !== 'SUCCESS'` 一律失败）。
    // 契约的 failures 里写了这条：不要用"没抛错"推断业务成功，必须回查 voiceState。
    await expect(capability.generateSpeech({ newsId: 900, type: 1, voiceName: 'x2_qige' })).resolves.toBeUndefined()
  })
})

describe('视频课程弹窗 / 编辑页：分类、讲师、标签', () => {
  it('分类候选：params.type=1、isOriginal、数据在 videoTypes 键上', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_VIDEO_TYPE_TREE_PATH]: {
        ret: 'SUCCESS',
        code: 200,
        videoTypes: [{ id: 3, title: '养殖技术', type: 11, parentType: 0 }],
      },
    })

    const rows = await capability.listVideoTypes()

    expect(rows).toEqual([{ id: 3, title: '养殖技术', type: 11, parentType: 0 }])
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_VIDEO_TYPE_TREE_PATH,
      method: 'GET',
      isOriginal: true,
      httpInstance: LAY,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    expect(callerParams(calls[0])).toEqual({ type: STUDY_COURSE_VIDEO_TYPE_TREE_TYPE })
    expect(STUDY_COURSE_VIDEO_TYPE_TREE_TYPE).toBe(1)
  })

  it('讲师列表：mediaId + 固定 type=0，且**不带** isOriginal（这一条走 data 而不是整个响应体）', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_VIDEO_PROFESSOR_LIST_PATH]: {
        ret: 'SUCCESS',
        code: 200,
        data: [{ id: 7, name: '王五', level: 2 }],
      },
    })

    const rows = await capability.listProfessors({ mediaId: 4068 })

    expect(rows).toEqual([{ id: 7, name: '王五', level: 2 }])
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_VIDEO_PROFESSOR_LIST_PATH,
      method: 'GET',
      httpInstance: LAY,
      isOriginal: undefined,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    expect(callerParams(calls[0])).toEqual({ mediaId: 4068, type: STUDY_COURSE_VIDEO_PROFESSOR_TYPE })
    expect(Object.keys(callerParams(calls[0]))).toEqual(['mediaId', 'type'])
    expect(STUDY_COURSE_VIDEO_PROFESSOR_TYPE).toBe(0)
  })

  it('标签候选：params.type=21、isOriginal、返回的是**字符串数组**（不是对象数组）', async () => {
    const { capability, calls } = makeInstanceCapability({
      [STUDY_COURSE_VIDEO_TAG_LIST_PATH]: { ret: 'SUCCESS', code: 200, data: ['育雏', '防疫'] },
    })

    const tags = await capability.listTags()

    expect(tags).toEqual(['育雏', '防疫'])
    expect(wireOf(calls[0])).toEqual({
      url: STUDY_COURSE_VIDEO_TAG_LIST_PATH,
      method: 'GET',
      isOriginal: true,
      httpInstance: LAY,
      // 页面推导出来的 module-type 仍在配置上，但**这个实例的 headerMode 不发它**
      // （见本文件那条「请求头只有 token + Accept-Language」的断言）
      moduleType: 12,
      data: undefined,
    })
    expect(callerParams(calls[0])).toEqual({ type: STUDY_COURSE_VIDEO_TAG_TYPE })
    expect(STUDY_COURSE_VIDEO_TAG_TYPE).toBe(21)
  })

  it('标签候选的元素不是字符串时抛错（图文页那条接口才是 {id,name} 对象数组）', async () => {
    const { capability } = makeInstanceCapability({
      [STUDY_COURSE_VIDEO_TAG_LIST_PATH]: { ret: 'SUCCESS', code: 200, data: [{ id: 1, name: '育雏' }] },
    })
    await expect(capability.listTags()).rejects.toThrow(/不是字符串/)
  })
})

describe('AI 说明契约：这一批 12 条都在，且关键语义被钉住', () => {
  const HIDDEN_IDS = [
    'study-course-im-student-list',
    'study-course-im-owner-level-options',
    'study-course-im-lesson-list',
    'study-course-text-comment-list',
    'study-course-video-comment-list',
    'study-course-text-voice-list',
    'study-course-text-generated-speech',
    'study-course-text-generate-speech',
    'study-course-text-generate-speech-by-voice',
    'study-course-video-type-tree',
    'study-course-video-professor-list',
    'study-course-video-tag-list',
  ]

  it('每条都有完整的必填字段，且 effect 与能力定义的 write 对得上', () => {
    const writeIds = new Set(studyCourseCapabilities.filter((item) => item.write).map((item) => item.id))
    for (const id of HIDDEN_IDS) {
      const contract = STUDY_COURSE_AI_CONTRACTS[id]
      expect(contract, `${id} 缺契约`).toBeTruthy()
      expect(contract!.purpose.length, `${id} 缺 purpose`).toBeGreaterThan(8)
      expect(contract!.whenToUse.length, `${id} 缺 whenToUse`).toBeGreaterThan(8)
      expect(contract!.boundaries.length, `${id} 缺 boundaries`).toBeGreaterThan(0)
      expect(contract!.prerequisites.length, `${id} 缺 prerequisites`).toBeGreaterThan(0)
      expect(contract!.consume.length, `${id} 缺 consume`).toBeGreaterThan(0)
      expect(contract!.completion.length, `${id} 缺 completion`).toBeGreaterThan(8)
      expect(contract!.failures.length, `${id} 缺 failures`).toBeGreaterThan(0)
      expect(contract!.evidence.length, `${id} 缺 evidence`).toBeGreaterThan(0)
      expect(contract!.gaps?.length, `${id} 必须如实登记缺口`).toBeGreaterThan(0)
      expect(contract!.output.fields.length, `${id} 缺 output.fields`).toBeGreaterThan(0)
      expect(contract!.output.empty.length, `${id} 缺 output.empty`).toBeGreaterThan(0)
      // 写能力必须写防重边界；只读必须显式 null
      if (writeIds.has(id)) expect(typeof contract!.idempotency, `${id} 是写能力，必须有 idempotency`).toBe('string')
      else expect(contract!.idempotency, `${id} 不是写能力`).toBeNull()
      expect(contract!.effect).toBe(writeIds.has(id) ? 'write' : 'read')
    }
  })

  it('「识别文字」是 GET 但写成 write —— 说明与实现必须口径一致', () => {
    const definition = studyCourseCapabilities.find((item) => item.id === 'study-course-text-generated-speech')
    const contract = STUDY_COURSE_AI_CONTRACTS['study-course-text-generated-speech']!
    expect(definition?.write).toBe(true)
    expect(contract.effect).toBe('write')
    expect(contract.idempotency).toContain('GET')
    expect(contract.consume.join('')).toContain('异步')
  })

  it('视频评论页那两个筛选「不生效」这件事必须写进说明，不能只藏在源码里', () => {
    const contract = STUDY_COURSE_AI_CONTRACTS['study-course-video-comment-list']!
    expect(contract.inputs.userName!.meaning).toContain('不生效')
    expect(contract.inputs.userPhone!.meaning).toContain('不生效')
    expect(contract.consume.join('')).toContain('不生效')
    // 图文页那一条是正常的，不能跟着写"不生效"
    expect(STUDY_COURSE_AI_CONTRACTS['study-course-text-comment-list']!.inputs.userName!.meaning).not.toContain('不生效')
  })

  it('评论页的 newsId 被指明是**远端资源 id**、不是课程行 id', () => {
    for (const id of ['study-course-text-comment-list', 'study-course-video-comment-list']) {
      expect(STUDY_COURSE_AI_CONTRACTS[id]!.inputs.newsId!.meaning).toContain('不是课程行 id')
    }
    expect(STUDY_COURSE_AI_CONTRACTS['study-course-text-comment-list']!.inputs.newsId!.source).toContain('news.id')
    expect(STUDY_COURSE_AI_CONTRACTS['study-course-video-comment-list']!.inputs.newsId!.source).toContain('videos.id')
  })

  it('播报人候选的 value 被指明就是 voiceName 的取值来源', () => {
    const contract = STUDY_COURSE_AI_CONTRACTS['study-course-text-voice-list']!
    expect(contract.output.fields.find((item) => item.path === '[].value')?.meaning).toContain('voiceName')
    // 数组根元素的映射写法是 `result.[]<字段>`（与 contracts-ai-prompt / contracts-chat 同一条语法）
    expect(contract.steps[0]?.mapping?.voiceName).toBe('result.[].value')
  })

  it('群主候选必须给关键字这件事写在参数语义里（不是通用提醒）', () => {
    const keyword = STUDY_COURSE_AI_CONTRACTS['study-course-im-student-list']!.inputs.keyword!
    expect(keyword.required).toBe(true)
    expect(keyword.meaning).toContain('非空')
    expect(keyword.constraints?.join('')).toContain('没有分页')
  })

  it('两个跨实例的 baseURL 必须由调用方配置这件事写进 prerequisites / failures', () => {
    for (const id of ['study-course-video-tag-list', 'study-course-text-voice-list']) {
      const contract = STUDY_COURSE_AI_CONTRACTS[id]!
      expect(contract.prerequisites.join('')).toContain('baseURL')
      expect(contract.failures.join('')).toContain('HttpInstanceResolutionError')
    }
  })

  it('没有浏览器基准这件事必须登记为缺口（不是"已与基准逐字段一致"）', () => {
    for (const id of HIDDEN_IDS) {
      const gaps = STUDY_COURSE_AI_CONTRACTS[id]!.gaps!.join('')
      // 两边都锁：既要有"没有基准"这条，也不能出现"已经比对过"的宣称
      expect(gaps, `${id} 没有登记"这一批没有浏览器基准"`).toContain('没有这一批的浏览器基准')
      expect(gaps, `${id} 不能宣称已与基准比对过`).not.toContain('已与基准逐字段一致')
      expect(gaps, `${id} 没有登记"没做线上冒烟"`).toContain('没有对测试环境发过任何请求')
    }
  })

  it('方法映射对每个新能力 ID 都有条目（invoke 与 describe 共用这份表）', () => {
    for (const id of HIDDEN_IDS) {
      expect(Object.keys(STUDY_COURSE_METHODS), `${id} 不在 STUDY_COURSE_METHODS 里`).toContain(id)
    }
  })

  it('能力定义的必填性与 AI 说明的 required 逐条一致（`ai:check:complete` 会拦这一条）', () => {
    for (const id of HIDDEN_IDS) {
      const definition = studyCourseCapabilities.find((item) => item.id === id)
      const contract = STUDY_COURSE_AI_CONTRACTS[id]!
      for (const param of definition?.params ?? []) {
        // `ai.inputs` 用「参数路径 → 说明」，顶层参数名直接就是键
        const described = contract.inputs[param.name]
        expect(described, `${id}.${param.name} 在 AI 说明里没有对应条目`).toBeTruthy()
        expect(described!.required, `${id}.${param.name} 的必填性与能力定义不一致`).toBe(param.required)
      }
    }
  })

  it('每条能力的每个真实参数都在 AI 说明里被解释过（不能只写一半）', () => {
    for (const id of HIDDEN_IDS) {
      const definition = studyCourseCapabilities.find((item) => item.id === id)
      for (const param of definition?.params ?? []) {
        expect(STUDY_COURSE_AI_CONTRACTS[id]!.inputs[param.name]?.meaning.length ?? 0).toBeGreaterThan(4)
      }
    }
  })

  it('本批 12 条契约通过项目自己的检查器（complete 档，零问题）', async () => {
    // 与 test/ai-contract-schema.test.ts 同一条路：运行时 import 那个零依赖的 .mjs（它没有 .d.ts）
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = (await import(validatorUrl)) as {
      validateAiContract: (
        id: string,
        contract: unknown,
        options?: Record<string, unknown>,
      ) => Array<{ capabilityId: string; path: string; code: string; message: string }>
    }

    const options = {
      profile: 'complete',
      definitions: studyCourseCapabilities,
      contracts: STUDY_COURSE_AI_CONTRACTS,
    }
    const issues = HIDDEN_IDS.flatMap((id) => validateAiContract(id, STUDY_COURSE_AI_CONTRACTS[id], options))

    // `incomplete-evidence` 是检查器对**已声明缺口**的固定提示（"存在已声明缺口，不能标记为说明完整"）：
    // 本轮这批没有浏览器基准、也没做线上冒烟，缺口是如实登记的，不该为了消掉这条提示而删掉 gaps。
    // 所以这里断言的是「除它以外零问题」，并**要求它必须存在**（否则就是把缺口删了）。
    const declaredGapNotices = issues.filter((issue) => issue.code === 'incomplete-evidence')
    expect(declaredGapNotices).toHaveLength(HIDDEN_IDS.length)
    expect(declaredGapNotices.every((issue) => issue.path === '$.gaps')).toBe(true)

    const realIssues = issues.filter((issue) => issue.code !== 'incomplete-evidence')
    // 打印出来，红了能直接看到是哪个字段
    expect(realIssues, JSON.stringify(realIssues, null, 2)).toEqual([])
  })
})

describe('新能力定义的参数表', () => {
  it('每条新能力的参数名与顺序符合契约', () => {
    expect(paramNames('study-course-im-student-list')).toEqual(['keyword'])
    expect(paramNames('study-course-im-owner-level-options')).toEqual([])
    expect(paramNames('study-course-im-lesson-list')).toEqual(['gradeId'])
    expect(paramNames('study-course-text-comment-list')).toEqual([
      'newsId', 'userName', 'userPhone', 'content', 'startTime', 'endTime', 'page', 'limit',
    ])
    expect(paramNames('study-course-video-comment-list')).toEqual([
      'newsId', 'userName', 'userPhone', 'content', 'startTime', 'endTime', 'page', 'limit',
    ])
    expect(paramNames('study-course-text-voice-list')).toEqual([])
    expect(paramNames('study-course-text-generated-speech')).toEqual(['newsId', 'type', 'voiceName'])
    expect(paramNames('study-course-text-generate-speech')).toEqual(['newsId', 'voiceName', 'content'])
    expect(paramNames('study-course-text-generate-speech-by-voice')).toEqual(['newsId', 'voiceUrl'])
    expect(paramNames('study-course-video-type-tree')).toEqual(['type'])
    expect(paramNames('study-course-video-professor-list')).toEqual(['mediaId'])
    expect(paramNames('study-course-video-tag-list')).toEqual(['type'])
  })

  it('学员候选的关键字是 kind=search 且必填（D6/H35：长选项必须先要关键字）', () => {
    const keyword = studyCourseCapabilities
      .find((item) => item.id === 'study-course-im-student-list')
      ?.params.find((param) => param.name === 'keyword')
    expect(keyword?.kind).toBe('search')
    expect(keyword?.required).toBe(true)
  })
})
