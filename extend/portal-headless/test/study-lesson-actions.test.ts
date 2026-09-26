import { describe, expect, it } from 'vitest'
import {
  STUDY_LESSON_DAILY_RECORD_SAVE_PATH,
  STUDY_LESSON_MONTH_RECORD_PATH,
  STUDY_LESSON_MONTH_SAVE_PATH,
  STUDY_LESSON_SAVE_PATH,
  STUDY_LESSON_STUDENT_MANAGE_PATH,
  STUDY_LESSON_STUDENT_MOVE_OUT_PATH,
  STUDY_LESSON_WEEKLY_EXPORT_PATH,
  STUDY_LESSON_WEEKLY_RECORD_SAVE_PATH,
  STUDY_LESSON_METHODS,
  createStudyLessonCapability,
  studyLessonActionCapabilities,
} from '../src/capabilities/study-lesson.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

type Call = {
  url: string
  method: 'get' | 'post' | 'put' | 'delete'
  params?: unknown
  data?: unknown
  headers?: Record<string, string>
  responseType?: string
}

function build (saveResult?: unknown, exportResult?: unknown) {
  const calls: Call[] = []
  const resolvedSaveResult = arguments.length === 0 ? 10 : saveResult
  const resolvedExportResult = arguments.length < 2
    ? {
        data: new Uint8Array([1, 2]).buffer,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment;filename="课堂信息.xlsx"',
        },
      }
    : exportResult
  const request = async <T>(config: Call): Promise<T> => {
    calls.push(config)
    if (config.url === STUDY_LESSON_WEEKLY_EXPORT_PATH) return resolvedExportResult as T
    return (config.url === STUDY_LESSON_SAVE_PATH ? resolvedSaveResult : undefined) as T
  }
  const cap = createStudyLessonCapability(
    request as PortalRequest,
    request as PortalRequest,
    request as PortalRequest,
  )
  return { cap, calls }
}

const dailyForm = {
  type: 1,
  lessonKind: 0,
  gradeIds: [11],
  gradeStaffCodeList: [101],
  title: '晨会',
  hostCode: 101,
  lessonType: 0,
  time: ['2026-09-25 07:50:00', '2026-09-25 08:00:00'],
  info: '',
  lessonContentList: ['content'],
  lessonPlan: '',
  lessonStudyStudentDTOList: [{ staffCode: 101 }],
  status: 0,
}

describe('课堂三页可达动作', () => {
  it('保留三个列表方法，并把隐藏学生页的列表参数按 Portal 顺序发送', async () => {
    const { cap, calls } = build()
    await cap.listDailyStudents({ lessonId: '10' })
    expect(calls[0]).toEqual({
      url: '/study/lesson/studylessonstudentrel/studyStudentList',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        lessonId: '10',
        name: '',
        staffCode: '',
        status: '',
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(STUDY_LESSON_METHODS['study-lesson-daily-list']).toBe('listDaily')
    expect(STUDY_LESSON_METHODS['study-lesson-monthly-last-lesson']).toBe('getLastMonthLesson')
    expect(studyLessonActionCapabilities.some(item => item.id === 'study-lesson-weekly-student-batch-delete')).toBe(true)
    for (const definition of studyLessonActionCapabilities) {
      expect(STUDY_LESSON_METHODS[definition.id as keyof typeof STUDY_LESSON_METHODS], definition.id).toBeTruthy()
    }
  })

  it('saveLesson 严格复刻晨/周会议表单：去掉 time 和学生 DTO，补 start/end，并保留 status 门禁', async () => {
    const { cap, calls } = build()
    const prepared = cap.prepareDailySave({ form: dailyForm })
    await expect(cap.saveDaily(prepared)).resolves.toBe(10)
    expect(calls[0]).toEqual({
      url: '/study/lesson/studylesson/saveLesson',
      method: 'post',
      data: {
        type: 1,
        lessonKind: 0,
        gradeIds: [11],
        gradeStaffCodeList: [101],
        title: '晨会',
        hostCode: 101,
        lessonType: 0,
        info: '',
        lessonContentList: ['content'],
        lessonPlan: '',
        status: 0,
        startTime: '2026-09-25 07:50:00',
        endTime: '2026-09-25 08:00:00',
      },
    })
    expect(() => cap.prepareDailySave({ form: { ...dailyForm, status: 1 } })).toThrow(/不可编辑/)
    expect(cap.cancelDailySave()).toEqual({ cancelled: true })
  })

  it('晨课和周课保存必须返回服务端lessonId，并拒绝缺失、空值和非法ID', async () => {
    const { cap: validCap } = build('9001')
    const dailyDraft = validCap.prepareDailySave({ form: dailyForm })
    const weeklyDraft = validCap.prepareWeeklySave({ form: { ...dailyForm, type: 2 } })
    await expect(validCap.saveDaily(dailyDraft)).resolves.toBe('9001')
    await expect(validCap.saveWeekly(weeklyDraft)).resolves.toBe('9001')

    for (const result of [undefined, null, '', 0, -1, '0', ' 1', {}, []]) {
      const { cap } = build(result)
      await expect(cap.saveDaily(dailyDraft)).rejects.toThrow(/lessonId/)
      await expect(cap.saveWeekly(weeklyDraft)).rejects.toThrow(/lessonId/)
    }
  })

  it('周课堂作业沿用隐藏 assignment 页的 POST/PUT、year 和 linkDTOS 过滤', async () => {
    const { cap, calls } = build()
    const form = {
      type: 2,
      lessonKind: 1,
      year: '2026',
      isStart: 0,
      status: 0,
      title: '作业周课',
      linkDTOS: [
        { title: '保留', type: 1, endTime: '2026-10-01', resourceId: 99, sort: 1, rater: null },
        { title: '丢弃', type: 1, endTime: '2026-10-01', resourceId: null, sort: 2 },
      ],
    }
    const draft = cap.prepareWeeklyAssignmentCreate({ form })
    await cap.createWeeklyAssignment(draft)
    await cap.updateWeeklyAssignment(draft)
    expect(calls).toEqual([
      {
        url: '/study/lesson/studylesson',
        method: 'post',
        data: expect.objectContaining({ year: 2026, linkDTOS: [{ title: '保留', type: 1, endTime: '2026-10-01', resourceId: 99, sort: 1, rater: '' }] }),
      },
      {
        url: '/study/lesson/studylesson',
        method: 'put',
        data: expect.objectContaining({ year: 2026, linkDTOS: [{ title: '保留', type: 1, endTime: '2026-10-01', resourceId: 99, sort: 1, rater: '' }] }),
      },
    ])
  })

  it('月课堂保存走 saveMonthLesson，helper POST body 直接是 gradeId 数组', async () => {
    const { cap, calls } = build()
    const draft = cap.prepareMonthlySave({
      form: {
        type: 3,
        monthKind: 1,
        gradeIdList: [11],
        title: '月会',
        hostCode: 101,
        time: ['2026-09-25 08:00:00', '2026-09-25 12:00:00'],
        attendeeDTOList: [101],
        guestDTOList: [],
        studyLessonMotionDTOList: [{ avoidStaffCode: [202], avoidName: ['乙'] }],
        status: 0,
      },
      attendanceData: [{ staffCode: 101, attendanceStatus: 1 }],
      guestData: [{ staffCode: 202 }],
    })
    await cap.saveMonthly(draft)
    await cap.getGradeInfo([11])
    await cap.getLastMonthLesson([11])
    expect(calls[0]).toMatchObject({ url: STUDY_LESSON_MONTH_SAVE_PATH, method: 'post' })
    expect(calls[0]?.data).toMatchObject({
      attendeeDTOList: [{ staffCode: 101, attendanceStatus: 1 }],
      guestDTOList: [{ staffCode: 202 }],
      startTime: '2026-09-25 08:00:00',
      endTime: '2026-09-25 12:00:00',
      studyLessonMotionDTOList: [{ avoidStaffCode: '202', avoidName: '乙' }],
    })
    expect(calls[1]).toEqual({ url: '/study/grade/studygrade/getGradeInfo', method: 'post', data: [11] })
    expect(calls[2]).toEqual({ url: '/study/lesson/studylesson/getLastMonthLessonByGradeId', method: 'post', data: [11] })
  })

  it('保留旧月课堂详情页的 saveLesson 与隐藏表单依赖读取', async () => {
    const { cap, calls } = build()
    await cap.getDailyEmcee(10)
    const draft = cap.prepareMonthlyGenericSave({ form: { ...dailyForm, type: 3 } })
    await cap.saveMonthlyGeneric(draft)
    expect(calls[0]).toEqual({ url: '/study/lesson/studylesson/getChooseEmcee', method: 'get', params: { lessonId: 10 } })
    expect(calls[1]?.url).toBe('/study/lesson/studylesson/saveLesson')
  })

  it('记录接口保留晨/周 V1 路径差异，旧月课堂走 saveLessonRecord，且出勤 body 是数组', async () => {
    const { cap, calls } = build()
    const form = {
      lessonId: 10,
      records: { thought: '想法', technology: '方法', management: '管理' },
      lessonContentList: ['content'],
      lessonPlan: 'plan',
      imgList: ['/a.png'],
      pdfList: [{ fileUrl: '/a.pdf', fileName: 'a.pdf' }],
    }
    await cap.saveDailyRecord(cap.prepareDailyRecord({ form }))
    await cap.saveWeeklyRecord(cap.prepareWeeklyRecord({ form }))
    await cap.saveMonthlyRecord(cap.prepareMonthlyRecord({ form: { lessonId: 10, recordList: [{ recordType: 1, recordContent: '旧', imgList: ['/a.pdf'] }] } }))
    await cap.saveDailyAttendance(cap.prepareDailyAttendance({ lessonId: 10, records: [{ staffCode: 101, attendanceStatus: 1 }] }))
    expect(calls[0]?.url).toBe(STUDY_LESSON_DAILY_RECORD_SAVE_PATH)
    expect(calls[1]?.url).toBe(STUDY_LESSON_WEEKLY_RECORD_SAVE_PATH)
    expect(calls[2]?.url).toBe('/study/lesson/lessonrecord/saveLessonRecord')
    expect(calls[3]).toEqual({
      url: STUDY_LESSON_STUDENT_MANAGE_PATH,
      method: 'post',
      data: [{ staffCode: 101, attendanceStatus: 1, lessonId: 10 }],
    })
  })

  it('周课堂导出按 Portal 的选择模式发送 JSON，并投影非空二进制文件', async () => {
    const { cap, calls } = build()
    await expect(cap.exportWeekly({ lessonIdList: ['10', 11], lessonKind: 0 })).resolves.toEqual({
      fileName: '周课堂.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: 'AQI=',
      byteLength: 2,
    })
    expect(calls[0]).toEqual({
      url: STUDY_LESSON_WEEKLY_EXPORT_PATH,
      method: 'post',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      data: { lessonIdList: ['10', 11], lessonKind: 0 },
      responseType: 'arraybuffer',
    })
    await expect(cap.exportWeekly({ lessonIdList: [], lessonKind: 0 })).rejects.toThrow(/非空数组/)
    await expect(cap.exportWeekly({ lessonIdList: ['10', '10'], lessonKind: 0 })).rejects.toThrow(/重复课堂ID/)
    await expect(cap.exportWeekly({ lessonIdList: ['10'], lessonKind: 2 as 0 | 1 })).rejects.toThrow(/lessonKind/)
    const empty = build(undefined, { data: new Uint8Array().buffer, headers: {} })
    await expect(empty.cap.exportWeekly({ lessonIdList: ['10'], lessonKind: 1 })).rejects.toThrow(/为空文件/)
    const error = build(undefined, {
      data: new TextEncoder().encode('{"code":500,"msg":"导出失败"}').buffer,
      headers: { 'content-type': 'application/json' },
    })
    await expect(error.cap.exportWeekly({ lessonIdList: ['10'], lessonKind: 0 })).rejects.toThrow(/不是二进制文件/)
  })

  it('发布、课堂删除和学生移出分别保留 Portal 的门禁及 body/query 规则', async () => {
    const { cap, calls } = build()
    await cap.publishWeekly(cap.prepareWeeklyPublish({ id: 10, currentStatus: 0, isRelGrade: 1, action: 'publishAndNoPush' }))
    await cap.deleteDaily(cap.prepareDailyDelete({ ids: [10, 11], statuses: [0, 0] }))
    await cap.moveOutDailyStudent(cap.prepareDailyMoveOut({ lessonId: 10, staffCodeList: [101], currentStatus: 1 }))
    await cap.deleteMonthlyStudentBatch(cap.prepareMonthlyStudentBatchDelete({ ids: [31, 32] }))
    expect(calls[0]).toEqual({
      url: '/study/lesson/studylesson/publishAndNoPush',
      method: 'put',
      data: { id: 10, status: 1 },
    })
    expect(calls[1]).toEqual({ url: '/study/lesson/studylesson', method: 'delete', data: [10, 11] })
    expect(calls[2]).toEqual({
      url: STUDY_LESSON_STUDENT_MOVE_OUT_PATH,
      method: 'put',
      data: { lessonId: 10, staffCodeList: [101], type: 2 },
    })
    expect(calls[3]).toEqual({
      url: STUDY_LESSON_STUDENT_MOVE_OUT_PATH,
      method: 'delete',
      data: [31, 32],
    })
    expect(calls[3]?.params).toBeUndefined()
    expect(() => cap.prepareDailyPublish({ id: 10, currentStatus: 0, isRelGrade: 0 })).toThrow(/isRelGrade/)
    expect(() => cap.prepareDailyDelete({ ids: [10], statuses: [1] })).toThrow(/已发布/)
  })

  it('月课堂会议记录动作保持当前弹窗 monthLessonRecord 的完整 body', async () => {
    const { cap, calls } = build()
    const draft = cap.prepareMonthRecord({ form: {
      id: 10,
      attendeeDTOList: [{ staffCode: 101 }],
      guestDTOList: [],
      studyLessonMotionDTOList: [],
      studyLessonRecordDTO: { imgUrl: '' },
    } })
    await cap.saveMonthRecord(draft)
    expect(calls[0]).toEqual({
      url: STUDY_LESSON_MONTH_RECORD_PATH,
      method: 'post',
      data: {
        id: 10,
        attendeeDTOList: [{ staffCode: 101 }],
        guestDTOList: [],
        studyLessonMotionDTOList: [],
        studyLessonRecordDTO: { imgUrl: '' },
      },
    })
    expect(cap.cancelMonthRecord()).toEqual({ cancelled: true })
  })
})
