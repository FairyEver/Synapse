import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createStudyTeacherCapability,
  studyTeacherCapabilities,
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
