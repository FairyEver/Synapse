import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createStudyGradeCapability,
  studyGradeCapabilities,
  STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
  STUDY_GRADE_PAGE_PATH,
  STUDY_GRADE_STUDENT_PAGE_PATH,
} from '../src/capabilities/study-grade.js'

type RequestConfig = Parameters<PortalRequest>[0]

function source (root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

function fixture () {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    return undefined as T
  }
  return { api: createStudyGradeCapability(request), calls }
}

describe('学习域班级写动作', () => {
  it('Portal 与 Java 源码锁定两个 DELETE 的页面归属和裸数组契约', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const classStudentPage = source(portalRoot, 'app/portal/views/dashboard/education/grade/grade/student/[id]/item-list.vue')
    const orgGradePage = source(portalRoot, 'app/portal/views/dashboard/education/base/management-center/grade/[managementCenterId]/item-list.vue')
    const relationController = source(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/grade/controller/StudyGradeStudentRelController.java')
    const gradeController = source(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/grade/controller/StudyGradeController.java')

    expect(classStudentPage).toContain("getDataListURL: '/study/grade/student'")
    expect(classStudentPage).toContain("deleteURL: '/study/grade/student'")
    expect(classStudentPage).toContain('deleteIsBatch: true')
    expect(orgGradePage).toContain("deleteURL: '/study/grade/studygrade'")
    expect(orgGradePage).toContain('deleteIsBatch: true')
    expect(relationController).toContain('@RequestBody Long[] ids')
    expect(gradeController).toContain('@RequestBody Long[] ids')
  })

  it('班级删除发送 DELETE 的裸 ID 数组，不发送 query 或对象包装', async () => {
    const { api, calls } = fixture()
    const prepared = api.prepareRemove({ ids: [101, '102'] })
    expect(prepared).toEqual({ ids: [101, '102'] })
    await api.remove(prepared)
    expect(calls).toEqual([
      { url: '/study/grade/studygrade', method: 'delete', data: [101, '102'] },
    ])
  })

  it('班级详情移出学员发送关联记录 ID 的裸数组', async () => {
    const { api, calls } = fixture()
    await api.removeStudents(api.prepareRemoveStudents({ ids: [201] }))
    expect(calls[0]).toEqual({ url: '/study/grade/student', method: 'delete', data: [201] })
    expect(calls[0]).not.toHaveProperty('params')
    expect(calls[0]?.data).not.toEqual({ ids: [201] })
  })

  it('组织结构隐藏班级页复用同一删除 URL，但能力元数据绑定组织结构页', async () => {
    const { api, calls } = fixture()
    await api.removeManagementCenterGrades({ ids: ['301'] })
    expect(calls[0]).toEqual({ url: '/study/grade/studygrade', method: 'delete', data: ['301'] })
    const definition = studyGradeCapabilities.find(item => item.id === 'study-grade-management-center-remove')
    expect(definition).toMatchObject({
      pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
      permission: '/dashboard/base/management-center',
      moduleType: 12,
      httpInstance: 'platform',
      write: true,
    })
  })

  it('写动作保留页面权限、平台实例与学习模块，并且只读能力仍存在', () => {
    const writes = studyGradeCapabilities.filter(item => item.write)
    expect(writes.every(item => item.moduleType === 12 && item.httpInstance === 'platform')).toBe(true)
    expect(writes.map(item => item.pagePath)).toEqual([
      STUDY_GRADE_PAGE_PATH,
      STUDY_GRADE_STUDENT_PAGE_PATH,
      STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    ])
    expect(studyGradeCapabilities.some(item => item.id === 'study-grade-list' && !item.write)).toBe(true)
    expect(studyGradeCapabilities.some(item => item.id === 'study-grade-search' && !item.write)).toBe(true)
  })

  it('空数组、零值和对象数组都会在本地拒绝，且不发请求', async () => {
    const { api, calls } = fixture()
    await expect(api.remove({ ids: [] })).rejects.toThrow(/非空数组/)
    await expect(api.removeStudents({ ids: [0] })).rejects.toThrow(/正整数/)
    await expect(api.removeManagementCenterGrades({ ids: [{ id: 1 }] as never })).rejects.toThrow(/正整数/)
    expect(calls).toHaveLength(0)
  })

  it('cancel 只返回本地标记，不触发 HTTP', () => {
    const { api, calls } = fixture()
    expect(api.cancelRemove()).toEqual({ cancelled: true })
    expect(api.cancelRemoveStudents()).toEqual({ cancelled: true })
    expect(api.cancelRemoveManagementCenterGrades()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)
  })
})
