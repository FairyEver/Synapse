import { describe, expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createStudyCourseCapability } from '../src/capabilities/study-course.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
function ai(id: string) {
  const d = catalog.describe(id)
  if (!d.ok || !d.ai) throw new Error(`Missing SDK description: ${id}`)
  return d.ai
}
function field(id: string, path: string) {
  const f = ai(id).output.fields.find(f => f.path === path)
  if (!f) throw new Error(`Missing SDK field: ${id}.${path}`)
  return f
}

describe('Portal 页面可见性是业务描述边界', () => {
  it('三课程保留列表可见列和内部操作标识，排除远端管理元数据', () => {
    // Independent column/bodyCell inventory from Portal's three list.vue files.
    const columns = {
      'study-course-text-list': ['id', 'creatorName', 'createTime', 'updaterName', 'updateTime', 'news.title', 'news.views', 'news.diversionMark', 'news.voiceState', 'news.voiceUrl', 'news.id', 'creator'],
      'study-course-video-list': ['id', 'creatorName', 'createTime', 'videos.title', 'videos.typeName', 'videos.duration', 'videos.views', 'videos.commentCount', 'videos.likesCount', 'videos.id', 'creator'],
      'study-course-im-list': ['imGroupDTO.title', 'imGroupDTO.number', 'imGroupDTO.ownerName', 'imGroupDTO.staffCode', 'isDel', 'creatorName', 'imGroupDTO.createTime', 'imGroupDTO.deleteTime', 'id', 'creator', 'imGroupDTO.groupId', 'imGroupDTO.chatRoomMuted'],
    }
    for (const [id, paths] of Object.entries(columns)) {
      for (const path of paths) expect(field(id, 'list[].' + path).path).toBe('list[].' + path)
      expect(ai(id).output.fields.some(f => /antiepidemic|syncType|joinmode|jumpType|\.mute$|\.live(?:\.|$)/.test(f.path))).toBe(false)
      expect(ai(id).consume.join(' ')).toContain('未列出的资源元数据')
      expect(ai(id).gaps).toBeUndefined()
    }
  })

  it('即时通讯状态取外层课程isDel，与群内禁言是两个不同判断', () => {
    // Deliberately conflicting payload: using nested isDel produces the wrong page label.
    const row = { isDel: 1, imGroupDTO: { isDel: 0, chatRoomMuted: true } }
    const status = field('study-course-im-list', 'list[].isDel')
    expect(status.values?.[String(row.isDel)]).toBe('解散')
    expect(status.meaning).toContain('外层 record.isDel')
    expect(ai('study-course-im-list').output.fields.some(f => f.path === 'list[].imGroupDTO.isDel')).toBe(false)
    expect(field('study-course-im-list', 'list[].imGroupDTO.chatRoomMuted').meaning).toContain('true 显示“解禁”')
  })

  it('当前用户与creator决定页面按钮显示；资源ID不能替换课程ID', () => {
    expect(field('study-course-text-list', 'list[].creator').meaning).toContain('当前登录 userId')
    expect(field('study-course-text-list', 'list[].news.id').meaning).toContain('不是课程行 ID')
    expect(field('study-course-text-list', 'list[].news.generateVoiceMethod').values).toEqual({ '1': '识别文字', '2': '识别图片', '3': '上传语音' })
    expect(field('study-course-im-list', 'list[].imGroupDTO.groupId').meaning).toContain('不是课程行 ID')
    expect(ai('study-course-im-list').consume.join(' ')).toContain('没有因此成为可调用 SDK 能力')
  })

  it('Portal两种分享时效都无单位，阅读量和播放秒的真实单位不能被泛化', () => {
    for (const [id, r] of [['study-course-text-list', 'news'], ['study-course-video-list', 'videos']]) {
      expect(field(id!, `list[].${r}.sharingLimitation`).unit).toBeUndefined()
      expect(field(id!, `list[].${r}.sharingLimitation`).meaning).toContain('不添加秒/分钟')
      expect(ai(id!).output.dynamic).toBeUndefined()
    }
    expect(field('study-course-text-list', 'list[].news.maySee')).toMatchObject({ unit: '%' })
    expect(field('study-course-text-list', 'list[].news.maySee').meaning).toContain('0..50')
    expect(field('study-course-video-list', 'list[].videos.maySee')).toMatchObject({ unit: '秒' })
    expect(field('study-course-video-list', 'list[].videos.maySee').meaning).toContain('0..180')
    expect(field('study-course-video-list', 'list[].videos.duration').unit).toBe('秒')
  })

  it('听课时长与四项保险原值显示，不添加页面没有的换算或阻塞', () => {
    const student = field('study-statistics-student-list', 'list[].studyTime')
    expect(student.unit).toBeUndefined()
    expect(student.meaning).toContain('按返回值展示')
    for (const name of ['personalInsurance', 'companyInsurance', 'personalFund', 'companyFund']) {
      expect(field('perf-manage-insurance-list', 'list[].' + name).unit).toBeUndefined()
      expect(field('perf-manage-insurance-list', 'list[].' + name).meaning).toContain('不换算')
    }
    expect(ai('study-statistics-student-list').gaps).toBeUndefined()
    expect(ai('perf-manage-insurance-list').gaps).toBeUndefined()
  })

  it('旧透传保持兼容，但原始扩展不成为页面展示或动态schema入口', async () => {
    const raw = { list: [{ id: '9', news: { title: '示例', sharingLimitation: 120, antiepidemic: { media: { arbitrary: '未消费扩展' } } } }], total: 1 }
    const request: PortalRequest = async <T>() => raw as T
    expect(await createStudyCourseCapability(request).listText()).toBe(raw)
    expect(ai('study-course-text-list').consume.join(' ')).toContain('不展示、不解释、不据此执行动作')
    expect(ai('study-course-text-list').output.dynamic).toBeUndefined()
  })
})
