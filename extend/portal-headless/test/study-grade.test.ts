import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createStudyGradeCapability,
  studyGradeCapabilities,
  STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
  STUDY_GRADE_METHODS,
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
    // 有写能力的页面只有这三处（弹窗与子页都在班级列表页下，见文件头「弹窗与隐藏子页」）
    // ⚠️ STUDY_GRADE_STUDENT_PAGE_PATH 与 STUDY_GRADE_PAGE_PATH 是同一个字符串，
    // 去重后只剩两处页面
    expect([...new Set(writes.map(item => item.pagePath))]).toEqual([
      STUDY_GRADE_PAGE_PATH,
      STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    ])
    // 绑在这个路径上的写：班级删除、移出学员，加本批新增的关联组织、关联业务、添加学员
    expect(writes.filter(item => item.pagePath === STUDY_GRADE_PAGE_PATH).map(item => item.id)).toEqual([
      'study-grade-status-check',
      'study-grade-status-submit',
      'study-grade-remove',
      'study-grade-student-remove',
      'study-grade-add-organization-rel',
      'study-grade-post-add',
      'study-grade-student-create',
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

describe('班级启停与删除回查能力', () => {
  it('按 Portal 两步 PUT 发送同一份绝对状态草稿', async () => {
    const calls: RequestConfig[] = []
    const responses: unknown[] = [undefined, undefined]
    const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); return responses.shift() as T }
    const api = createStudyGradeCapability(request)
    const prepared = api.prepareStatus({ id: '101', currentStatus: 0 })
    expect(prepared).toEqual({ draft: { id: '101', status: 1 } })
    await expect(api.checkStatus(prepared)).resolves.toEqual({ draft: { id: '101', status: 1 }, message: null })
    await api.submitStatus(prepared)
    expect(calls).toEqual([
      { url: '/study/grade/studygrade/updateStatus', method: 'put', data: { id: '101', status: 1 } },
      { url: '/study/grade/studygrade', method: 'put', data: { id: '101', status: 1 } },
    ])
  })

  it('第一步返回提示时保留提示，不把第二步偷偷发出', async () => {
    const calls: RequestConfig[] = []
    const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); return '请确认' as T }
    const api = createStudyGradeCapability(request)
    const prepared = api.prepareStatus({ id: 7, currentStatus: 1 })
    await expect(api.checkStatus(prepared)).resolves.toEqual({ draft: { id: 7, status: 0 }, message: '请确认' })
    expect(calls).toHaveLength(1)
  })

  it('提供班级学员与组织结构班级的独立回查请求', async () => {
    const calls: RequestConfig[] = []
    const responses: unknown[] = [[], { list: [], total: 0 }]
    const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); return responses.shift() as T }
    const api = createStudyGradeCapability(request)
    await api.listStudents({ gradeId: 9 })
    await api.listManagementCenterGrades({ managementCenterId: 10 })
    expect(calls[0]).toEqual({
      url: '/study/grade/student', method: 'get',
      params: { order: '', orderField: '', gradeId: 9, name: '', mobile: '', staffCode: '', isRelatedLayer: '', createTimeStart: '', createTimeEnd: '' },
    })
    expect(calls[1]).toEqual({
      url: '/study/grade/studygrade/page', method: 'get',
      params: { order: '', orderField: '', managementCenterId: 10, name: '', type: '', createTimeStart: '', createTimeEnd: '', pageNo: 1, pageSize: 20 },
    })
  })
})

/**
 * 第二批：班级管理隐藏弹窗与子页（关联组织 / 关联业务 / 添加学员 / 人员候选）。
 *
 * 逐条对 `src/capabilities/study-grade.ts` 与 `src/catalog/contracts-study-grade.ts`；
 * 反证记录写在每条断言旁边的注释里，报告里按条目汇总。
 */
describe('班级管理隐藏弹窗与子页', () => {
  const PORTAL_REPO = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
  const JAVA_REPO = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
  const GRADE_VIEWS = 'app/portal/views/dashboard/education/grade/grade'

  function candidateFixture () {
    const calls: RequestConfig[] = []
    const responses: unknown[] = []
    const request: PortalRequest = async <T>(config: RequestConfig) => {
      calls.push(config)
      return (responses.shift() ?? { list: [], total: 0 }) as T
    }
    return { api: createStudyGradeCapability(request), calls, responses }
  }

  it('四条表单候选请求按页面的键序发出，POST 的是裸数组', async () => {
    const { api, calls, responses } = candidateFixture()
    responses.push({ list: [], total: 0 })
    await api.searchStaffCandidates({ keyword: ' 张三 ' })
    responses.push({ list: [], total: 0 })
    await api.searchStudentCandidates({ gradeId: 9, keyword: '李四', pageNo: 2, pageSize: 10 })
    responses.push({ list: [], total: 0 })
    await api.listExternalStudents({ keyword: '王五' })
    responses.push([])
    await api.listOrganizations({ gradeId: '9' })
    responses.push([])
    await api.listPosts({ gradeId: 9 })
    responses.push([])
    await api.listPostStaff({ postIdList: [7, '8'] })
    responses.push([])
    await api.getPostTree()

    expect(calls).toEqual([
      // 页面的 fetchStudentPage 就是 { pageNo, pageSize, name? }（[mode]/[id].vue:74）；
      // pageSize 是下拉组件 usePagedUserOptions 的默认值 20，不是名单表的 5
      { url: '/sys/user/getUserListPage', method: 'get', params: { pageNo: 1, pageSize: 20, name: '张三' } },
      // gradeId 在 name 之前：与 add-student.vue:154 的 params 字面顺序一致
      { url: '/sys/user/userNotInGrade', method: 'get', params: { gradeId: 9, name: '李四', pageNo: 2, pageSize: 10 } },
      // gradeId 不在这里：页面那一行是注释掉的，DTO 上也没有这个字段
      { url: '/study/grade/student/getExternalStudentList', method: 'get', params: { name: '王五', pageNo: 1, pageSize: 5 } },
      { url: '/study/grade/studygrade/getGradeOrganization', method: 'get', params: { gradeId: '9' } },
      { url: '/study/grade/studygrade/getGradePost', method: 'get', params: { gradeId: 9 } },
      // 裸数组 body，不是 { postIdList }
      { url: '/org/staff/getStaffListByPostId', method: 'post', data: [7, '8'] },
      // 无参数：后端 getOrganizationPost() 不收任何参数
      { url: '/org/organization/getOrganizationPost', method: 'get' },
    ])
  })

  it('按工号回显逐个发请求，键序 username → pageNo → pageSize，未命中进 missing', async () => {
    const { api, calls, responses } = candidateFixture()
    responses.push({ list: [{ id: 1, username: '1001', realName: '张三' }], total: 1 })
    responses.push({ list: [], total: 0 })
    const result = await api.resolveStaffByUsername({ usernames: ['1001', 2002] })
    expect(calls).toEqual([
      { url: '/sys/user/getUserListPage', method: 'get', params: { username: '1001', pageNo: 1, pageSize: 1 } },
      { url: '/sys/user/getUserListPage', method: 'get', params: { username: '2002', pageNo: 1, pageSize: 1 } },
    ])
    expect(result.list.map(row => row.username)).toEqual(['1001'])
    expect(result.missing).toEqual(['2002'])
  })

  it('人员响应里的 password / password2 / salt 被裁掉，其余字段原样保留', async () => {
    const { api, responses } = candidateFixture()
    responses.push({ list: [{ id: 3, username: '1003', realName: '赵六', password: 'x', password2: '$2a$10$hash', salt: 'abcd' }], total: 1 })
    const page = await api.searchStaffCandidates({ keyword: '赵' })
    expect(Object.keys(page.list[0]!).sort()).toEqual(['id', 'realName', 'username'])
    expect(JSON.stringify(page)).not.toMatch(/password|salt|\$2a\$/)
  })

  it('三个写入发出页面真实的请求体，prepare 只做本地校验、cancel 不发请求', async () => {
    const { api, calls } = candidateFixture()
    const org = api.prepareAddOrganizations({ gradeId: 9, organizationIdList: [3, '3', 4] })
    const post = api.prepareAddPosts({ gradeId: 9, postIdList: ['5', 5, 6] })
    const stu = api.prepareAddStudents({ gradeId: 9, staffCodeList: ['1001', 1001] })
    expect(org.draft).toEqual({ gradeId: 9, organizationIdList: [3, 4] })
    expect(post.draft).toEqual({ gradeId: 9, postIdList: ['5', 6] })
    expect(stu.draft).toEqual({ gradeId: 9, staffCodeList: ['1001'] })
    expect(calls).toHaveLength(0)

    await api.addOrganizations(org)
    await api.addPosts(post)
    await api.addStudents(stu)
    expect(calls).toEqual([
      { url: '/study/grade/studygrade/addGradeOrganizationRelV2', method: 'post', data: { gradeId: 9, organizationIdList: [3, 4] } },
      // ⚠️ 同一个 DTO 类（StudyGradeOrganizationRelDTO），这里发的是 postIdList
      { url: '/study/grade/studygrade/addGradePostRel', method: 'post', data: { gradeId: 9, postIdList: ['5', 6] } },
      { url: '/study/grade/student/addGradeStudent', method: 'post', data: { gradeId: 9, staffCodeList: ['1001'] } },
    ])

    expect(api.cancelAddOrganizations()).toEqual({ cancelled: true })
    expect(api.cancelAddPosts()).toEqual({ cancelled: true })
    expect(api.cancelAddStudents()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(3)
  })

  it('空数组、空关键字、非法 ID 与全量拉取的 pageSize 都在发请求前拒绝', async () => {
    const { api, calls } = candidateFixture()
    expect(() => api.prepareAddOrganizations({ gradeId: 9, organizationIdList: [] })).toThrow(/非空数组/)
    expect(() => api.prepareAddPosts({ gradeId: 9, postIdList: ['x'] })).toThrow(/正整数/)
    expect(() => api.prepareAddStudents({ gradeId: 9, staffCodeList: [0] })).toThrow(/正整数/)
    await expect(api.listPostStaff({ postIdList: [] })).rejects.toThrow(/非空数组/)
    expect(() => api.prepareAddStudents({ gradeId: 0, staffCodeList: [1] })).toThrow(/正整数 ID/)
    await expect(api.searchStaffCandidates({ keyword: '   ' })).rejects.toThrow(/长选项参数/)
    await expect(api.searchStudentCandidates({ gradeId: 9, keyword: '' })).rejects.toThrow(/长选项参数/)
    await expect(api.listExternalStudents({ keyword: '' })).rejects.toThrow(/长选项参数/)
    await expect(api.searchStaffCandidates({ keyword: '张', pageSize: -1 })).rejects.toThrow(/全量拉取/)
    await expect(api.searchStaffCandidates({ keyword: '张', pageSize: 501 })).rejects.toThrow(/最多 500/)
    await expect(api.listExternalStudents({ keyword: '张', pageNo: 0 })).rejects.toThrow(/pageNo/)
    await expect(api.resolveStaffByUsername({ usernames: [] })).rejects.toThrow(/非空/)
    expect(calls).toHaveLength(0)
  })

  it('响应形状不对时抛错，不把坏响应当空结果', async () => {
    const { api, responses } = candidateFixture()
    responses.push({ list: [], total: 'x' })
    await expect(api.searchStaffCandidates({ keyword: '张' })).rejects.toThrow(/list 或 total/)
    responses.push({ total: 0 })
    await expect(api.listOrganizations({ gradeId: 9 })).rejects.toThrow(/不是数组/)
    responses.push([{ id: 1, postId: null, children: [{ id: 11, postId: 7, name: '岗位' }] }])
    const tree = await api.getPostTree()
    expect(tree[0]?.children?.[0]?.postId).toBe(7)
  })

  it('Portal 与 Java 源码锁定「集合替换」的两个写与它们不同的字段', () => {
    const organization = source(PORTAL_REPO, `${GRADE_VIEWS}/components/organization.vue`)
    const post = source(PORTAL_REPO, `${GRADE_VIEWS}/components/post.vue`)
    const addStudent = source(PORTAL_REPO, `${GRADE_VIEWS}/student/[id]/components/add-student.vue`)
    const gradeController = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/grade/controller/StudyGradeController.java')
    const relService = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/grade/service/impl/StudyGradeOrganizationRelServiceImpl.java')
    const studentService = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/grade/service/impl/StudyGradeStudentRelServiceImpl.java')

    // 前端调的是 V2；V1 那一行是注释掉的（按项目规则：注释掉的不进 SDK）
    expect(organization).toContain("await http.post('/study/grade/studygrade/addGradeOrganizationRelV2'")
    expect(organization).toContain("// await http.post('/study/grade/studygrade/addGradeOrganizationRel'")
    expect(organization).toContain('organizationIdList: checkedKeys.value')
    expect(post).toContain("await http.post('/study/grade/studygrade/addGradePostRel'")
    expect(post).toContain('postIdList: checkedPostIds.value')
    expect(post).toContain('disabled: !item.postId')

    // 路由是 V2，控制器方法名却是 V1：按路径猜方法名会找错实现
    expect(gradeController).toContain('@PostMapping("addGradeOrganizationRelV2")')
    expect(gradeController).toContain('public CommonResult addGradeOrganizationRelV1(')
    // 两个写收同一个 DTO 类，靠字段区分
    expect(gradeController).toContain('public CommonResult addGradePostRel(@RequestBody StudyGradeOrganizationRelDTO dto)')
    expect(relService).toContain('hrStaffService.getUnLeaveStaffListByPost(postId)')

    // 集合替换 + 连带软删学员 + 外部云信（移除分支）
    expect(relService).toContain('Set<Long> removeOrgIdSet = orgIdList.stream().filter(orgId -> !organizationIdList.contains(orgId))')
    expect(relService).toContain('gradeStudentRelService.update(null, gradeUpdateWrapper)')
    expect(relService).toContain('pushGradeMessage(removeStaffCodeList, dto.getGradeId(), 2)')
    expect(relService).toContain('ADJUST_MEMBERS_FOR_STUDY')
    // V2 与 addGradePostRel 都没有事务注解：容器里只有 V1 与另一个方法带 @Transactional
    expect(studentService).toContain('@Transactional(rollbackFor = Exception.class)\n    public void addStudentByGradeId')
    // 添加学员把云信加人排在本地写之后
    expect(studentService).toContain('pushGradeMessage(pushStaffCodeList, dto.getGradeId(), 1)')
  })

  it('Portal 与 Java 源码锁定人员候选的真实语义（含 userNotInGrade 的缺陷）', () => {
    const form = source(PORTAL_REPO, `${GRADE_VIEWS}/[mode]/[id].vue`)
    const dropdown = source(PORTAL_REPO, 'app/portal/components/portal/education/dropdown/student/index.vue')
    const addStudent = source(PORTAL_REPO, `${GRADE_VIEWS}/student/[id]/components/add-student.vue`)
    const sysUserDao = source(JAVA_REPO, 'erp-module-system/erp-module-system-biz/src/main/resources/mapper/hrSysUser/SysUserDao.xml')
    const sysUserService = source(JAVA_REPO, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system/service/user/HrSysUserServiceImpl.java')
    const staffDao = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/organization/staff/HrStaffDao.xml')
    const studentDao = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/study/base/StudyStudentDao.xml')
    const studentService = source(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/base/service/impl/StudyStudentServiceImpl.java')

    // 班级表单的两条候选路径：分页用 name，回显用 username + pageSize: 1
    expect(form).toContain('return http.get(\'/sys/user/getUserListPage\', {\n    params: {\n      pageNo,\n      pageSize,\n      ...(keyword ? { name: keyword } : {}),')
    expect(form).toContain('username,\n      pageNo: 1,\n      pageSize: 1,')
    // 班主任/班长/助教存的 value 是工号，不是用户 id
    expect(dropdown).toContain('const value = typeof props.fetchPage === \'function\' ? item.username : item.staffCode')

    // getUserListPage 的页码是后端硬校验（500 上限），name 是包含匹配
    expect(sysUserService).toContain('单页条数必须在 1 到 500 之间')
    expect(sysUserService).toContain('.like(StringUtils.isNotBlank(name), "real_name", name)')
    // userNotInGrade：LEFT JOIN 进来的学员子查询**没有被使用** ⇒ 不过滤已在班级的人
    const notInGrade = sysUserDao.slice(sysUserDao.indexOf('<select id="getUserNotInGrade"'), sysUserDao.indexOf('</select>', sysUserDao.indexOf('<select id="getUserNotInGrade"')))
    expect(notInGrade).toContain('LEFT JOIN (SELECT distinct staff_code')
    expect(notInGrade).not.toContain('s.staff_code is null')
    expect(notInGrade.slice(notInGrade.indexOf('<where>'))).not.toContain('s.')
    // 而且它的 name 只做前缀匹配
    expect(notInGrade).toContain("and t1.real_name like CONCAT(#{dto.name},'%')")

    // 外部学员：服务端固定 isStaff=0，name 同时匹配姓名与手机号
    expect(studentService).toContain('dto.setIsStaff(0)')
    expect(studentDao).toContain("t1.name like CONCAT('%',#{dto.name},'%') or t1.mobile like CONCAT('%',#{dto.name},'%')")
    // 岗位在职员工：status in (1,4,5)
    expect(staffDao).toContain('and status in (1, 4, 5)')

    // 添加学员把两个页签的工号合并后提交；页面**没有**空选保护，SDK 的拒绝是刻意偏离
    expect(addStudent).toContain('const totalCodes = [...selectedRowKeys.value, ...selectedRowKeys2.value]')
    expect(addStudent).toContain("await http.post('/study/grade/student/addGradeStudent', {\n      gradeId: props.gradeId,\n      staffCodeList: totalCodes")
  })

  it('AI 说明覆盖全部 17 个能力，且逐条通过结构与完整档检查', async () => {
    const { STUDY_GRADE_AI_CONTRACTS, STUDY_GRADE_HIDDEN_METHODS } = await import('../src/catalog/contracts-study-grade.js')
    expect(Object.keys(STUDY_GRADE_AI_CONTRACTS).sort()).toEqual(Object.keys(STUDY_GRADE_HIDDEN_METHODS).sort())

    // 本文件只该覆盖 STUDY_GRADE_METHODS 的一部分：没被我接管的那些必须原样留着，
    // 否则等于悄悄把隔壁文件（contracts-study-grade-teacher.ts）的 9 个能力从目录里吃掉。
    const mine = new Set(Object.keys(STUDY_GRADE_AI_CONTRACTS))
    expect(Object.keys(STUDY_GRADE_METHODS).filter(id => !mine.has(id)).sort()).toEqual([
      'study-grade-cancel-remove',
      'study-grade-list',
      'study-grade-management-center-cancel-remove',
      'study-grade-management-center-prepare-remove',
      'study-grade-management-center-remove',
      'study-grade-prepare-remove',
      'study-grade-remove',
      'study-grade-search',
      'study-grade-student-cancel-remove',
      'study-grade-student-prepare-remove',
      'study-grade-student-remove',
    ])

    // 与隔壁那份契约的 id 不重叠：重叠会让接线时后写的一份静默覆盖前一份。
    // ⚠️ 这里**按源码文本**取，不 import 那个模块 —— 那个文件常有别的 agent 在改，
    // 引用一个还没定义的常量就会让模块求值抛错，把这条与它无关的检查也一起弄红。
    const sibling = readFileSync(new URL('../src/catalog/contracts-study-grade-teacher.ts', import.meta.url), 'utf8')
    const siblingIds = new Set([...sibling.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map(match => match[1]!))
    expect(siblingIds.size).toBeGreaterThan(0)
    expect([...mine].filter(id => siblingIds.has(id))).toEqual([])

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl) as {
      validateAiContract: (id: string, value: unknown, options: Record<string, unknown>) => Array<{ code: string; message: string }>
    }
    for (const [id, contract] of Object.entries(STUDY_GRADE_AI_CONTRACTS)) {
      const issues = validateAiContract(id, contract, { profile: 'complete', definitions: studyGradeCapabilities, contracts: STUDY_GRADE_AI_CONTRACTS })
      // gaps 是**必须**声明的缺口（本批没有真实环境验证），声明了就会命中 incomplete-evidence；
      // 这是唯一一项被允许的解释，其余任何一条都算失败——不是放松检查。
      const unexpected = issues.filter(issue => issue.code !== 'incomplete-evidence')
      expect(unexpected, `${id}: ${JSON.stringify(unexpected)}`).toEqual([])
      expect(contract.gaps?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('AI 说明写明关键语义：集合替换、无事务、云信、候选不过滤已在班级的人', async () => {
    const { STUDY_GRADE_AI_CONTRACTS } = await import('../src/catalog/contracts-study-grade.js')
    const orgAdd = STUDY_GRADE_AI_CONTRACTS['study-grade-add-organization-rel']!
    expect(orgAdd.boundaries.join(' ')).toContain('集合替换')
    expect(orgAdd.boundaries.join(' ')).toContain('没有事务')
    expect(orgAdd.boundaries.join(' ')).toContain('云信')
    expect(orgAdd.consume.join(' ')).toContain('addGradeOrganizationRelV2')
    expect(orgAdd.completion).toContain('回查')

    const postAdd = STUDY_GRADE_AI_CONTRACTS['study-grade-post-add']!
    expect(postAdd.purpose).toContain('关联岗位')
    expect(postAdd.consume.join(' ')).toContain('addGradePostRel')

    const candidate = STUDY_GRADE_AI_CONTRACTS['study-grade-student-candidate']!
    expect(candidate.consume.join(' ')).toContain('并不过滤已在班级的人')
    expect(candidate.consume.join(' ')).toContain('仅前缀匹配')

    const tree = STUDY_GRADE_AI_CONTRACTS['hr-organization-setting-post-tree']!
    expect(tree.consume.join(' ')).toContain('postId')
    expect(tree.output.fields.map(item => item.path)).toContain('[].postId')

    const search = STUDY_GRADE_AI_CONTRACTS['study-grade-staff-search']!
    expect(search.inputs.keyword!.required).toBe(true)
    // 下拉用 20、名单表用 5：两个数不能混
    expect(search.inputs.pageSize!.default).toBe('20')
    expect(STUDY_GRADE_AI_CONTRACTS['study-grade-student-candidate']!.inputs.pageSize!.default).toBe('5')
    expect(search.consume.join(' ')).toContain('username')

    const create = STUDY_GRADE_AI_CONTRACTS['study-grade-student-create']!
    expect(create.effect).toBe('write')
    expect(create.idempotency).toContain('已在班级中')

    // effect 与能力定义的 write 必须一致（校验器的 effect-mismatch 之外再钉一次，便于定位）
    for (const [id, contract] of Object.entries(STUDY_GRADE_AI_CONTRACTS)) {
      const definition = studyGradeCapabilities.find(item => item.id === id)!
      expect(contract.effect === 'write', `${id} 的 effect 与 write 不一致`).toBe(definition.write)
    }
  })
})
