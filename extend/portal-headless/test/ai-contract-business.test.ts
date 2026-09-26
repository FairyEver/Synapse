import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'
import { BUSINESS_AI_CONTRACTS, BUSINESS_METHOD_CONTRACTS } from '../src/catalog/contracts-business.js'
import { SALARY_PROCESS_METHODS } from '../src/capabilities/salary-process.js'
import { SALARY_ACCOUNTING_METHODS } from '../src/capabilities/salary-accounting.js'
import { SALARY_ADJUST_IMPORT_METHODS } from '../src/capabilities/salary-adjust-import.js'
import { SALARY_PERSON_TAX_FILE_METHODS } from '../src/capabilities/salary-person-tax-file.js'
import { SALARY_PERSON_TAX_HANDLE_METHODS } from '../src/capabilities/salary-person-tax-handle.js'
import { SALARY_PERSON_TAX_METHODS } from '../src/capabilities/salary-person-tax.js'
import { SALARY_LEVEL_METHODS } from '../src/capabilities/salary-level.js'
import { SALE_SETTING_DICT_METHODS } from '../src/capabilities/sale-setting-dict.js'
import { SALE_SCHEDULE_JOB_METHODS } from '../src/capabilities/sale-schedule-job.js'
import { SALE_SCHEDULE_JOB_LOG_METHODS } from '../src/capabilities/sale-schedule-job-log.js'
import { SALE_REGISTER_CODE_METHODS } from '../src/capabilities/sale-register-code.js'
import { SALE_CCB_ACCOUNT_METHODS } from '../src/capabilities/sale-ccb-account.js'
import { SALE_PAYMENT_ACCOUNT_METHODS } from '../src/capabilities/sale-payment-account.js'
import { SALE_SYS_OFFICE_METHODS } from '../src/capabilities/sale-sys-office.js'
import { SALE_SYS_USER_METHODS } from '../src/capabilities/sale-sys-user.js'
import { SALE_CLAIM_SETTING_METHODS } from '../src/capabilities/sale-claim-setting.js'
import { SALE_OLD_CHICKEN_SALE_METHODS } from '../src/capabilities/sale-old-chicken-sale.js'
import { SALE_PRICE_CONTROL_METHODS } from '../src/capabilities/sale-price-control.js'
import { SALE_LOW_PRICE_METHODS } from '../src/capabilities/sale-low-price.js'
import { SALE_SYS_DICT_METHODS } from '../src/capabilities/sale-sys-dict.js'
import { SALE_SERVICE_SUBJECT_METHODS } from '../src/capabilities/sale-service-subject.js'
import { SALE_TRADE_STOREROOM_METHODS } from '../src/capabilities/sale-trade-storeroom.js'
import { SETTING_CATEGORY_DICT_METHODS } from '../src/capabilities/setting-category-dict.js'
import { SETTING_DICT_PLATFORM_METHODS } from '../src/capabilities/setting-dict-platform.js'
import { PLATFORM_DICT_MALL_COMMON_METHODS, PLATFORM_DICT_MALL_FINANCE_METHODS, PLATFORM_DICT_MALL_HR_METHODS, PLATFORM_DICT_MALL_MATERIAL_METHODS, PLATFORM_DICT_MALL_METHODS, PLATFORM_DICT_MALL_PRODUCT_METHODS, PLATFORM_DICT_MALL_SALE_METHODS, PLATFORM_DICT_MALL_SUPPLY_METHODS } from '../src/capabilities/platform-dict-mall.js'
import { SETTING_FRONTEND_LOG_METHODS } from '../src/capabilities/setting-frontend-log.js'
import { SETTING_MATERIAL_METHODS } from '../src/capabilities/setting-material.js'
import { SETTING_MENU_METHODS } from '../src/capabilities/setting-menu.js'
import { SETTING_SUPPLIER_METHODS } from '../src/capabilities/setting-supplier.js'
import { SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS } from '../src/capabilities/setting-system-accounting-parameters.js'
import { SYSTEM_INTEGRATION_METHODS } from '../src/capabilities/system-integration.js'
import { SETTING_ROLE_POST_METHODS } from '../src/capabilities/setting-role-post.js'
import { SETTING_ROLE_METHODS } from '../src/capabilities/setting-role.js'
import { SETTING_USER_METHODS } from '../src/capabilities/setting-user.js'
import { HR_EXTERNAL_STAFF_METHODS } from '../src/capabilities/hr-external-staff.js'
import { HR_INTERNAL_STAFF_METHODS } from '../src/capabilities/hr-internal-staff.js'
import { HR_ORGANIZATION_CHART_METHODS } from '../src/capabilities/org-chart.js'
import { RECRUITMENT_PLAN_METHODS } from '../src/capabilities/recruitment-plan.js'
import { HR_TRANSFER_IN_PLAN_METHODS } from '../src/capabilities/hr-transfer-in-plan.js'
import { MY_TODO_URGE_METHODS } from '../src/capabilities/my-todo-urge.js'
import { MY_URGE_METHODS } from '../src/capabilities/my-urge.js'
import { SUPPLY_PERSONNEL_CONFIG_METHODS } from '../src/capabilities/supply-personnel-config.js'
import { HONOR_METHODS } from '../src/capabilities/honor.js'
import { LEGAL_DISPUTE_METHODS } from '../src/capabilities/legal-dispute.js'
import { QUALIFICATION_METHODS } from '../src/capabilities/qualification.js'
import { PATENT_METHODS } from '../src/capabilities/patent.js'
import { SOFTWARE_METHODS } from '../src/capabilities/software.js'
import { STANDARD_DOCUMENT_METHODS } from '../src/capabilities/standard-document.js'
import { TRADEMARK_METHODS } from '../src/capabilities/trademark.js'
import { ATTENDANCE_ANNUAL_LEAVE_METHODS } from '../src/capabilities/attendance-annual-leave.js'
import { ATTENDANCE_EXCEPTION_METHODS } from '../src/capabilities/attendance-exception.js'
import { ATTENDANCE_OVERTIME_METHODS } from '../src/capabilities/attendance-overtime.js'
import { ATTENDANCE_SCHEDUAL_INFORMATION_METHODS } from '../src/capabilities/attendance-schedual-information.js'
import { CERTIFICATE_LICENSE_METHODS } from '../src/capabilities/certificate-license.js'
import { CERTIFICATE_TYPE_METHODS } from '../src/capabilities/certificate-type.js'
import { PIECE_METHODS } from '../src/capabilities/piece.js'
import { BUSINESS_REGISTRATION_METHODS } from '../src/capabilities/business-registration.js'
import { CONTRACT_LIBRARY_METHODS } from '../src/capabilities/contract-library.js'
import { REPORT_LABOR_COST_ALLOCATION_METHODS } from '../src/capabilities/report-labor-cost-allocation.js'
import { REPORT_LEADERSHIP_PROFIT_SALARY_METHODS } from '../src/capabilities/report-leadership-profit-salary.js'
import { REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS } from '../src/capabilities/report-unit-interference-cost-allocation.js'
import { createAttendanceArchiveSheetCapability } from '../src/capabilities/attendance-archive-sheet.js'
import { createAttendanceTeamCapability } from '../src/capabilities/attendance-team.js'
import { createStudyStatisticsCapability } from '../src/capabilities/study-statistics.js'
import { createPerfManageConfigCapability } from '../src/capabilities/perf-manage-config.js'
import type { PortalRequest } from '../src/session/types.js'

const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })
const hosts = new Set(['assignment', 'attendanceAnnualLeave', 'attendanceException', 'attendanceOvertime', 'attendanceSchedualInformation', 'certificateLicense', 'certificateType', 'piece', 'businessRegistration', 'honor', 'legalDispute', 'qualification', 'patent', 'software', 'standardDocument', 'trademark', 'attendanceArchive', 'attendanceStatistics', 'attendanceShift', 'attendanceTeam', 'backlogTaskExamine', 'baseImage', 'baseManagementCenter', 'contractTemplate', 'contractLibrary', 'studyCourse', 'studyStudent', 'studyGrade', 'studyLesson', 'studyRecord', 'studyStatistics', 'studyTeacher', 'perfAgreement', 'perfManageConfig', 'perfManageTemplate', 'perfSalary', 'flowTask', 'flowManage', 'mePayRoll', 'platformCategoryDict', 'settingCategoryDict', 'platformDictMall', 'orgCorporation', 'hrOrganizationSetting', 'platformSystemCustom', 'platformSystemSecurityConfig', 'platformSystemQueueStorage', 'platformSystemEmail', 'platformSystemQueueExport', 'platformSystemQueueFailed', 'platformSystemQueueMysql', 'platformSystemSchedule', 'saleSettingDict', 'settingDictPlatform', 'settingFrontendLog', 'settingMaterial', 'settingMenu', 'settingSupplier', 'settingSystemAccountingParameters', 'systemIntegration', 'settingRolePost', 'settingRole', 'settingUser', 'hrExternalStaff', 'hrInternalStaff', 'reportBankPay', 'reportBankSummary', 'reportCenterInsurance', 'reportCostCenterSalary', 'reportDepartmentSalaryDetail', 'reportDepartmentSalary', 'reportFundPaymentSummary', 'reportInsurancePaymentSummary', 'reportPersonTax', 'reportPostSalary', 'reportConfiguration', 'reportStandardUnitInsurance', 'reportRetirementSalarySummary', 'reportTemporarySalarySummary', 'reportRetirementSalary', 'reportTemporarySalary', 'reportSalaryBill', 'reportSalaryCost', 'reportLaborCostAllocation', 'reportSalaryItem', 'salaryProcess', 'salaryAccounting', 'salaryAdjustImport', 'salaryLevel'])
hosts.add('meetingRoom')
hosts.add('platformDictMallCommon')
hosts.add('platformDictMallFinance')
hosts.add('platformDictMallHr')
hosts.add('platformDictMallMaterial')
hosts.add('platformDictMallProduct')
hosts.add('platformDictMallSale')
hosts.add('platformDictMallSupply')
hosts.add('recruitmentPlan')
hosts.add('supplyPersonnelConfig')
hosts.add('salaryPersonTaxFile')
hosts.add('salaryPersonTaxHandle')
hosts.add('salaryPersonTax')
hosts.add('saleScheduleJobLog')
hosts.add('saleScheduleJob')
hosts.add('saleRegisterCode')
hosts.add('saleCcbAccount')
hosts.add('salePaymentAccount')
hosts.add('saleSysOffice')
hosts.add('saleSysUser')
hosts.add('saleClaimSetting')
hosts.add('saleOldChickenSale')
hosts.add('salePriceControl')
hosts.add('saleLowPrice')
hosts.add('saleSysDict')
hosts.add('saleServiceSubject')
hosts.add('saleTradeStoreroom')
hosts.add('reportLeadershipProfitSalary')
hosts.add('reportUnitInterferenceCostAllocation')
hosts.add('myTodoUrge')
hosts.add('myUrge')
hosts.add('hrOrganizationChart')
hosts.add('hrTransferInPlan')
function description(id: string) {
  const result = catalog.describe(id)
  if (!result.ok || !result.ai) throw new Error(`No actual AI description for ${id}`)
  return { ...result, ai: result.ai }
}
function field(id: string, path: string) {
  const result = description(id).returns.fields?.find(f => f.path === path)
  if (!result) throw new Error(`Missing field contract ${id}: ${path}`)
  return result
}
const response = (data: object | null): PortalRequest => async <T>() => data as T

describe('业务模块 SDK 实际 AI 描述', () => {
  it('全量注册范围和执行绑定闭合，所有实际参数进入说明，所有下游存在', () => {
    const expected = ALL_CAPABILITY_DEFINITIONS.filter(d => hosts.has(sdkPathOf(d.id)?.split('.')[0] ?? ''))
    expect(Object.keys(BUSINESS_AI_CONTRACTS).sort()).toEqual(expected.map(d => d.id).sort())
    for (const definition of expected) {
      const d = description(definition.id)
      expect(d.invoke?.sdkPath).toBe(sdkPathOf(definition.id))
      expect(catalog.describe(`${definition.id}-llm`)).toMatchObject({ ok: true, ai: d.ai })
      for (const p of definition.params) expect(d.params.find(x => x.name === p.name)?.contract).toEqual(d.ai.inputs[p.name])
      for (const step of d.ai.steps) if (step.capabilityId) expect(catalog.describe(step.capabilityId)).toMatchObject({ ok: true, invoke: { capabilityId: step.capabilityId } })
    }
  })

  it('原始create与注册防重创建明确分离，遗漏门面方法可下钻', () => {
	 // 业务页面动作与隐藏学习/绩效方法均进入统一门面契约；同一路径只保留一份最终契约。
	 expect(Object.keys(BUSINESS_METHOD_CONTRACTS)).toHaveLength(1072)
    expect(BUSINESS_METHOD_CONTRACTS['assignment.create']?.idempotency).toContain('不防重')
    expect(description('assignment-create').ai.idempotency).toContain('requestId')
    const method = catalog.describeMethod('perfManageConfig.listFormulaScenes')
    expect(method).toMatchObject({ ok: true, sdkPath: 'perfManageConfig.listFormulaScenes' })
    expect(description('perf-manage-formula-definition-list').ai.steps[0]?.sdkPath).toBe('perfManageConfig.listFormulaScenes')
  })

  it('作业/合同创建、更新和空回执不能被一个模板吞掉', () => {
    expect(description('assignment-create').returns.shape).toBe('string')
    expect(description('assignment-update').returns.shape).toBe('string | number')
    expect(description('contract-template-create').returns.shape).toBe('number')
    expect(description('contract-template-update').returns.shape).toBe('boolean')
    expect(description('attendance-shift-create').returns.shape).toBe('null | undefined')
    expect(description('base-image-remove').ai.consume.join(' ')).toContain('不会删除 OSS')
    expect(description('contract-template-get').ai.failures.join(' ')).toContain('删除后 get')
  })

  it('共享0/1不能混淆发布状态与作业启停、模板保存不发审批', () => {
    expect(field('assignment-list', 'list[].status').values).toEqual({ '0': '停用', '1': '启用' })
    expect(field('base-image-list', 'list[].status').values).toEqual({ '0': '未发布', '1': '已发布' })
    expect(description('assignment-create').ai.inputs.isUploadAnswer?.type).toBe('number')
    expect(description('assignment-update').ai.inputs.answerType?.requiredWhen).toContain('isUploadAnswer=1')
    expect(description('contract-template-create').ai.purpose).toContain('不启动审批')
    expect(description('base-management-center-check-status').ai.effect).toBe('read')
    expect(description('base-management-center-check-status').ai.completion).toContain('状态不变')
  })

  it('考勤候选total是源全量，matched是命中而非分页数；不归档筛选不是未归档', async () => {
    const api = createAttendanceArchiveSheetCapability(response([{ id: 1, name: '研发一组' }, { id: 2, name: '研发二组' }, { id: 3, name: '财务' }]))
    expect(await api.searchOrganizations({ keyword: '研发', type: 2, limit: 1 })).toEqual({ list: [{ id: 1, name: '研发一组' }], total: 3, matched: 2 })
    expect(field('attendance-org-search', 'total').meaning).toContain('不是命中数')
    expect(field('attendance-org-search', 'matched').meaning).toContain('可能大于 list.length')
    expect(field('attendance-statistics-list', 'list[].isArchived').meaning).toContain('允许返回已归档')
    expect(description('attendance-team-list').ai.inputs.type?.meaning).toContain('查询不传时不过滤')
  })

  it('排班读取人员ID与工号不能互换，整组覆盖不能误作追加', async () => {
    const data = { groupId: '7', startDate: '2026-09-22', hrGroupUserRelEntityList: [{ type: 4, paramsId: '197916', staffCode: '2026050801', name: '示例' }] }
    const actual = await createAttendanceTeamCapability(response(data)).scheduleGet('7')
    expect(actual.hrGroupUserRelEntityList?.[0]?.paramsId).not.toBe(actual.hrGroupUserRelEntityList?.[0]?.staffCode)
    const next = description('attendance-team-schedule-get').ai.steps.find(s => s.capabilityId === 'attendance-team-schedule-save')
    expect(next?.mapping?.userIdList).toBe('hrGroupUserRelEntityList[].staffCode')
    expect(field('attendance-team-schedule-get', 'hrGroupUserRelEntityList[].paramsId').meaning).toContain('不能写入 userIdList')
    expect(description('attendance-team-schedule-save').ai.purpose).toContain('遗漏的成员类别按空列表清空')
  })

  it('班级统计kind必填，学习记录的当前列与旧字段严格区分', () => {
    expect(description('study-statistics-grade-list').params.find(p => p.name === 'kind')?.contract).toMatchObject({ required: true, type: 'string', constraints: ['morning', 'weekly', 'monthly'] })
    expect(field('study-record-list', 'list[].startStudyTime').meaning).toContain('开始学习时间')
    expect(field('study-record-list', 'list[].endStudyTime').meaning).toContain('完成学习时间')
    expect(field('study-record-list', 'list[].status').meaning).toContain('lesson_study_status')
    expect(description('study-record-list').returns.fields?.some(f => f.path === 'list[].studyTime')).toBe(false)
    expect(field('study-statistics-student-list', 'list[].completeLesson').meaning).toContain('非完成课次数')
    expect(field('study-statistics-student-list', 'list[].completeLesson').unit).toBe('%')
    expect(field('study-statistics-lesson-list', 'list[].completionRate').type).toBe('string')
    expect(field('study-statistics-lesson-list', 'list[].completionRate').meaning).toContain('不再追加百分号')
  })

  it('学习统计部分失败必须看errors，不将null当作零', async () => {
    const request: PortalRequest = async <T>(r: Parameters<PortalRequest>[0]) => {
      if (r.url?.endsWith('/by-organization-chart')) throw new Error('测试图表失败')
      if (r.url?.endsWith('/by-staff')) return { list: [{ staffId: '8', hasView: 1 }], total: 1 } as T
      return { dueCount: 2, viewRate: 50 } as T
    }
    const api = createStudyStatisticsCapability(request, request, request, request, request)
    const actual = await api.learningSummary({ lessonId: '1', organizationId: '2' })
    expect(actual.errors).toEqual({ byOrganizationChart: '测试图表失败' })
    expect(actual.byOrganizationChart).toBeNull()
    expect(description('study-statistics-learning-summary').ai.consume.join(' ')).toContain('不是零统计')
    expect(field('study-statistics-learning-summary', 'summary.viewRate').unit).toBe('%')
    expect(field('study-statistics-learning-summary', 'byStaff.list[].hasView').values).toEqual({ '0': '否', '1': '是' })
  })

  it('绩效树种类与分页不同，时间配置键值方向不能颠倒', async () => {
    expect(field('perf-manage-profit-list', '[].type').values).toEqual({ '1': '文件夹', '2': '利润' })
    expect(field('perf-manage-template-content-list', '[].type').values).toEqual({ '0': '文件夹', '1': '模板内容' })
    expect(field('perf-manage-salary-structure-list', 'list[].dataType').values).toEqual({ '1': '文件夹', '2': '薪资结构' })
    const req = response([{ dictType: 'protocol_config', dataList: [{ value: 'self_score_start_time', label: '99 23:59:59' }] }])
    const api = createPerfManageConfigCapability(req, req, req, req, req, req)
    expect((await api.readProtocolConfig()).protocol_config?.[0]).toEqual({ value: 'self_score_start_time', label: '99 23:59:59' })
    expect(field('perf-manage-protocol-config-read', 'protocol_config[].value').meaning).toContain('字段名')
    expect(field('perf-manage-protocol-config-read', 'protocol_config[].label').meaning).toContain('实际配置值')
    expect(description('perf-year-protocol-config-get').returns.shape).toBe('string')
  })

  it('任务id到流程id下钻正确，抄送记录不赋予审批权限', () => {
    expect(description('flow-task-todo-list').ai.steps.find(s => s.capabilityId === 'task-action-instance')?.mapping).toEqual({ processInstanceId: 'result.list[].processInstance.id' })
    expect(description('flow-task-copy-list').ai.steps.find(s => s.capabilityId === 'task-action-instance')?.mapping).toEqual({ processInstanceId: 'result.list[].processInstanceId' })
    expect(description('flow-task-copy-list').ai.consume.join(' ')).toContain('不能把抄送 id')
    expect(field('flow-task-my-list', 'list[].status').values).toEqual({ '1': '审批中', '2': '审批通过', '3': '审批不通过', '4': '已取消' })
    expect(field('flow-task-my-list', 'list[].result').meaning).toContain('status 分开')
    expect(field('flow-task-my-list', 'list[].formVariables').meaning).toContain('不是可直接再次提交')
    expect(field('flow-task-my-list', 'list[].processDefinitionKey').meaning).toContain('区分同 businessKey')
    expect(field('flow-task-my-list', 'list[].tasks[].assigneeUser.id').meaning).toContain('办理人 ID')
    expect(field('flow-task-my-list', 'list[].aiReviewResults[].approved').type).toBe('boolean | null')
    expect(description('flow-task-my-cancel-reservation').ai.consume.join(' ')).toContain('businessKey')
    expect(description('flow-task-my-cancel-reservation').ai.idempotency).toContain('没有 requestId')
    expect(description('flow-task-my-cancel-reservation').ai.completion).toContain('canCancelReservation')
    expect(description('flow-task-my-cancel-reservation').ai.boundaries.join(' ')).toContain('不是取消接口自己的安全授权')
    expect(description('flow-task-done-withdraw').ai.inputs.reason?.default).toContain('无')
    expect(description('flow-task-done-withdraw').ai.consume.join(' ')).toContain('历史任务 ID')
    expect(description('flow-task-done-withdraw').ai.boundaries.join(' ')).toContain('1009005015')
    expect(description('backlog-task-examine-list').ai.steps.some(s => s.capabilityId === 'backlog-task-examine-withdraw')).toBe(true)
    expect(field('flow-task-my-follow-up-capability', 'canFollowUp').meaning).toContain('当前审批人')
    expect(field('flow-task-my-follow-up-create', '$').meaning).toContain('跟进记录 ID')
    expect(description('flow-task-my-follow-up-create').ai.idempotency).toContain('clientRequestId')
    expect(field('flow-task-my-sms-remind-detail', 'canSend').meaning).toContain('发送按钮')
    expect(field('flow-task-my-sms-remind-send', 'recipients[].status').meaning).toContain('同步失败')
    expect(description('flow-task-my-sms-remind-send').ai.failures.join(' ')).toContain('不要换新幂等键')
    expect(field('flow-manage-model-list', 'list[].processDefinition.suspensionState').values).toEqual({ '1': '激活', '2': '挂起' })
    expect(field('flow-manage-task-list', 'list[].processInstance.startUser.nickname').meaning).toBe('流程发起人姓名')
  })

  it('工资元制与百分比不能混淆，合计包含扣分折现', () => {
    for (const path of ['monthlyWageLow', 'monthlyWage', 'monthlyWageHigh', 'realWage']) expect(field('perf-analysis-person-summary', `personalStatistics.salaryScoreDetailDTO.${path}`).unit).toBe('元')
    for (const path of ['basicSalary', 'examineSalary', 'profitSalary', 'rewardSalary', 'totalSalary']) expect(field('perf-salary-main-list', `list[].${path}`).unit).toBe('元')
    expect(field('perf-salary-main-list', 'list[].totalSalary').meaning).toContain('signDeductScore+evaluateDeductScore')
    expect(field('perf-analysis-person-summary', 'personalStatistics.salaryScoreDetailDTO.completionRate').meaning).toContain('totalScore')
    expect(field('perf-analysis-person-summary', 'personalStatistics.salaryScoreDetailDTO.completionRate').meaning).toContain('不强制截断到 100')
    expect(description('perf-analysis-person-summary').ai.gaps).toBeUndefined()
  })

  it('课程只解释 Portal 可见字段，语音状态与视频时长按该页消费', () => {
    expect(field('study-course-text-list', 'list[].news.voiceState').values).toEqual({ '0': '成功', '1': '失败', '2': '生成中' })
    expect(field('study-course-text-list', 'list[].news.baseViews').meaning).toContain('不再叠加')
    expect(field('study-course-video-list', 'list[].videos.duration').unit).toBe('秒')
    expect(field('study-course-im-list', 'list[].isDel').values).toEqual({ '0': '使用', '1': '解散' })
    expect(description('study-course-text-list').ai.output.dynamic).toBeUndefined()
  })

  it('候选来源必须来自真实可描述输出字段', () => {
    for (const c of Object.values(BUSINESS_AI_CONTRACTS)) for (const p of Object.values(c.inputs)) if (p.lookup) {
      const upstream = description(p.lookup.capabilityId)
      for (const path of [p.lookup.valueField, p.lookup.labelField]) expect(upstream.returns.fields?.some(f => f.path === path), `${p.lookup.capabilityId}.${path}`).toBe(true)
    }
  })

  it('分享时效以 Portal 原值显示，不能套外部管理端约束；考核金额仍有元制证据', () => {
    for (const [id, resource] of [['study-course-text-list', 'news'], ['study-course-video-list', 'videos']]) {
      expect(field(id!, `list[].${resource}.sharingLimitation`).unit).toBeUndefined()
      expect(field(id!, `list[].${resource}.sharingLimitation`).meaning).toContain('按原值展示')
      expect(description(id!).returns.fields?.some(f => f.path.includes('antiepidemic'))).toBe(false)
    }
    expect(field('perf-salary-examine-result-list', 'list[].money').unit).toBe('元')
    expect(field('perf-salary-examine-result-list', 'list[].money').meaning).toContain('无元分转换')
  })

  it('绩效薪资新增动作的候选、映射、取消和 catalog 可见性保持可执行', () => {
    const userIdActions = [
      'perf-salary-examine-result-prepare-create',
      'perf-salary-examine-result-create',
      'perf-salary-examine-result-prepare-update',
      'perf-salary-examine-result-update',
    ]
    for (const id of userIdActions) {
      const result = description(id)
      expect(result).toMatchObject({ ok: true, ai: expect.any(Object) })
      expect(catalog.describe(`${id}-llm`)).toMatchObject({ ok: true, ai: result.ai })
      expect(result.ai.inputs.userId?.lookup).toEqual({
        capabilityId: 'base-user-search',
        args: { keyword: '<人员姓名或工号>' },
        valueField: 'list[].id',
        labelField: 'list[].nickname',
      })
      expect(result.ai.inputs.userId?.source).toContain('base-user-search')
    }

    for (const [id, parameter] of [
      ['perf-salary-main-list', 'orgIdList'],
      ['perf-salary-main-export', 'orgIdList'],
      ['perf-salary-adjust-list', 'orgIdList'],
      ['perf-salary-examine-result-list', 'organizationIdList'],
    ] as const) {
      const lookup = description(id).ai.inputs[parameter]?.lookup
      expect(lookup).toEqual({
        capabilityId: 'contract-support-role-organization-search',
        args: { keyword: '<组织名称关键字>', scope: 'performance' },
        valueField: 'list[].id',
        labelField: 'list[].name',
      })
      expect(description(id).ai.inputs[parameter]?.meaning).toContain('不是普通部门 ID')
      expect(description(id).ai.inputs[parameter]?.source).toContain('contract-support-role-organization-search')
    }

    const actionIds = [
      'perf-salary-main-prepare-import',
      'perf-salary-main-import',
      'perf-salary-adjust-prepare-save',
      'perf-salary-adjust-save',
      'perf-salary-examine-result-get',
      'perf-salary-examine-result-prepare-create',
      'perf-salary-examine-result-create',
      'perf-salary-examine-result-prepare-update',
      'perf-salary-examine-result-update',
      'perf-salary-examine-result-prepare-remove',
      'perf-salary-examine-result-remove',
      'perf-salary-examine-result-prepare-import',
      'perf-salary-examine-result-import',
      'perf-salary-main-download-template',
      'perf-salary-main-export',
      'perf-salary-examine-result-download-template',
      'perf-block-main-prepare-status',
      'perf-block-main-set-status',
    ]
    for (const id of actionIds) {
      const result = description(id)
      expect(catalog.describe(`${id}-llm`)).toMatchObject({ ok: true, ai: result.ai })
      for (const current of result.ai.steps) {
        if (current.role === 'cancel') {
          expect(current.capabilityId).toBeUndefined()
          expect(current.sdkPath).toBeUndefined()
          expect(current.mapping).toBeUndefined()
          expect(current.instruction).toContain('本地')
        }
        for (const source of Object.values(current.mapping ?? {})) {
          expect(source).toMatch(/^(?:result|args|user|context)\.[\p{L}_$][\p{L}\p{N}_$-]*(?:[.\[\]]|[\p{L}\p{N}_$-])*$/u)
        }
      }
    }

    expect(description('perf-salary-adjust-prepare-save').ai.steps[0]?.mapping).toEqual({
      adjustScore: 'result.draft.adjustScore',
      adjustProfit: 'result.draft.adjustProfit',
      adjustRemark: 'result.draft.adjustRemark',
      idList: 'result.draft.idList',
    })
    expect(description('perf-salary-adjust-save').ai.inputs.idList?.type).toBe('(string | number)[]')
    expect(description('perf-salary-examine-result-remove').ai.inputs.ids?.type).toBe('(string | number)[]')
    expect(description('perf-salary-examine-result-prepare-remove').ai.steps[0]?.mapping).toEqual({ ids: 'result.ids' })
    expect(description('perf-block-main-prepare-status').ai.steps[0]?.mapping).toEqual({ id: 'result.draft.id', status: 'result.draft.status' })
    expect(description('perf-salary-main-import').ai.steps[0]?.instruction).toContain('context.importFilter')
    expect(description('perf-salary-adjust-save').ai.steps[0]?.instruction).toContain('context.adjustFilter')
    expect(description('perf-salary-examine-result-remove').ai.steps[0]?.instruction).toContain('context.examineFilter')
    expect(description('perf-block-main-set-status').ai.steps[0]?.instruction).toContain('context.blockFilter')
    expect(description('perf-block-main-list').ai.steps[0]?.mapping).toEqual({ dictType: 'literal:"agreement_warehouse_type"' })
    expect(description('perf-block-main-list').ai.steps[0]?.instruction).toContain('不从未声明的 context 字段取值')
    for (const id of ['perf-salary-main-import', 'perf-salary-adjust-save', 'perf-salary-examine-result-create', 'perf-salary-examine-result-update', 'perf-salary-examine-result-remove', 'perf-salary-examine-result-import', 'perf-block-main-set-status']) {
      expect(description(id).ai.inputs.requestId).toMatchObject({ required: true, type: 'string' })
      expect(description(id).ai.inputs.requestId?.source).toContain('不发送到 Portal body')
    }
    expect(catalog.validate().lookups).toEqual([])
  })

  it('四个页面文档保留新增动作的契约来源、写后复核和未实测边界', () => {
    const pages = {
      '奖励导入.md': [
        'perf-salary-main-download-template',
        'perf-salary-main-export',
        'perf-salary-main-prepare-import',
        'perf-salary-main-import',
      ],
      '工资找齐.md': ['perf-salary-adjust-prepare-save', 'perf-salary-adjust-save'],
      '考核导入.md': [
        'perf-salary-examine-result-get',
        'perf-salary-examine-result-prepare-create',
        'perf-salary-examine-result-create',
        'perf-salary-examine-result-prepare-update',
        'perf-salary-examine-result-update',
        'perf-salary-examine-result-prepare-remove',
        'perf-salary-examine-result-remove',
        'perf-salary-examine-result-prepare-import',
        'perf-salary-examine-result-import',
        'perf-salary-examine-result-download-template',
      ],
      '组件管理.md': ['perf-block-main-prepare-status', 'perf-block-main-set-status'],
    } as const
    for (const [file, actionIds] of Object.entries(pages)) {
      const content = readFileSync(new URL(`../docs/pages/${file}`, import.meta.url), 'utf8')
      expect(content).toContain('src/catalog/contracts-business.ts')
      expect(content).toContain('<!-- ai-contract-business:start -->')
      expect(content).toContain('prepare')
      expect(content).toContain('submit')
      expect(content).toContain('cancel')
      expect(content).toContain('写后复核')
      expect(content).toMatch(/(?:未在真实|没有真实)/)
      for (const actionId of actionIds) expect(content).toContain(`\`${actionId}\``)
    }
  })
})

it('业务契约结构和跨能力候选字段可持续校验', async () => {
  const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
  const { validateAiContract } = await import(validatorUrl)
  const { AI_CONTRACTS } = await import('../src/catalog/ai-contracts.js')
  const issues = Object.entries(BUSINESS_AI_CONTRACTS).flatMap(([id, contract]) => validateAiContract(id, contract, {
    definitions: ALL_CAPABILITY_DEFINITIONS, contracts: AI_CONTRACTS,
    bindings: Object.fromEntries(ALL_CAPABILITY_DEFINITIONS.map(d => [d.id, sdkPathOf(d.id)])),
    sdkPaths: [...Object.keys(BUSINESS_METHOD_CONTRACTS), ...ALL_CAPABILITY_DEFINITIONS.map(d => sdkPathOf(d.id)).filter((p): p is string => typeof p === 'string'), 'catalog.describePage'],
  }))
  expect(issues).toEqual([])
}, 60000)
