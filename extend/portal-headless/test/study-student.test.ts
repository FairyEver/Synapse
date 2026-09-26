import { describe, expect, it } from 'vitest'
import { studyStudentCapabilities, STUDY_STUDENT_DELETE_PATH } from '../src/capabilities/study-student.js'

describe('学习域学员管理边界', () => {
  it('学员主表能力仍是只读；/study/grade/student 不误归到学员主表', () => {
    expect(STUDY_STUDENT_DELETE_PATH).toBe('/study/base/studystudent')
    expect(studyStudentCapabilities.every(item => !item.write)).toBe(true)
    expect(studyStudentCapabilities.map(item => item.id)).toEqual([
      'study-student-list',
      'study-student-check-in-grade',
    ])
  })
})
