import { portalDeviceCapabilities } from './portal-device.js'
import { hrPostTypeCapabilities } from './hr-post-type.js'
import { attendanceSheetCapabilities } from './attendance-sheet.js'
import { hrOrganizationTypeCapabilities } from './hr-organization-type.js'
import { hrOrganizationPropertyCapabilities } from './hr-organization-property.js'
import { technologyProjectTypeCapabilities } from './technology-project-type.js'
import { technologyTypeTemplateMappingCapabilities } from './technology-type-template-mapping.js'
import { settingEnterpriseUsageCapabilities } from './setting-enterprise-usage.js'
import { settingSensitiveActionCapabilities } from './setting-sensitive-action.js'
import { settingTokenAllocationCapabilities } from './setting-token-allocation.js'
import { technologySettingTemplateBaseCapabilities } from './technology-setting-template-base.js'
import { technologySettingTemplateCapabilities } from './technology-setting-template.js'
import { financeAccountingPeriodCapabilities } from './finance-accounting-period.js'
import { financeAccountingManageCapabilities } from './finance-accounting-manage.js'
import { financeLedgerAccountsCapabilities } from './finance-ledger-accounts.js'
import { financeSettingAccuracyCapabilities } from './finance-setting-accuracy.js'
import { financeAllocationIndicatorCapabilities } from './finance-setting-allocation-indicator.js'
import { financeSettingAnnualCarryforwardCapabilities } from './finance-setting-annual-carryforward.js'
import { financeSettingCatConfigCapabilities } from './finance-setting-cat-config.js'
import { financeSettingCatMapCapabilities } from './finance-setting-cat-map.js'
import { financeSettingDateConfigCapabilities } from './finance-setting-date-config.js'
import { financeSettingMonthlyIncomeTimeConfigCapabilities } from './finance-setting-monthly-income-time-config.js'
import { financeSettingProjectCapabilities } from './finance-setting-project.js'
import { financeSettingReceivingAccountCapabilities } from './finance-setting-receiving-account.js'
import { financeSettingRelatedPartySettlementAccountCapabilities } from './finance-setting-related-party-settlement-account.js'
import { financeSettingSaleAllocationCoefficientCapabilities } from './finance-setting-sale-allocation-coefficient.js'
import { financeSettingAllocationRulesCapabilities } from './finance-setting-allocation-rules.js'
import { financeSettingCostCenterCapabilities } from './finance-setting-cost-center.js'
import { financeSettingEmployeeLoanAmountCapabilities } from './finance-setting-employee-loan-amount.js'
import { financeSettingInitialManageCapabilities } from './finance-setting-initial-manage.js'
import { financeSettingOpeningSupplierCapabilities } from './finance-setting-opening-supplier.js'
import { historyArchiveCapabilities } from './history-archive.js'
import { meOrganizationCapabilities } from './me-organization.js'
import { mePersonalCapabilities } from './me-personal.js'
import { financeSettingFeePurposeCapabilities } from './finance-setting-fee-purpose.js'
import { financeSettingInventoryAccountCapabilities } from './finance-setting-inventory-account.js'
import { financeSettingLivestockAmortizationCapabilities } from './finance-setting-livestock-amortization.js'
import { financeSettingSettlementSettingCapabilities } from './finance-setting-settlement-setting.js'
import { financeSettingVoucherTemplatesCapabilities } from './finance-setting-voucher-templates.js'
import { fundSalaryFundCostsCapabilities } from './fund-salary-fund-costs.js'
import { fundSalaryFundProcessCapabilities } from './fund-salary-fund-process.js'
import { insuranceSalaryInsuranceCostsCapabilities } from './insurance-salary-insurance-costs.js'
import { insuranceSalaryInsuranceProcessCapabilities } from './insurance-salary-insurance-process.js'
import { manageCostCenterCapabilities } from './manage-cost-center.js'
import { salaryItemCapabilities } from './salary-item.js'
import { mePayRollCapabilities } from './me-pay-roll.js'
import { platformCategoryDictCapabilities } from './platform-category-dict.js'
import { settingCategoryDictCapabilities } from './setting-category-dict.js'
import { hrOrgCorporationCapabilities } from './org-corporation.js'
import { hrOrganizationSettingCapabilities } from './org-setting.js'
import { hrOrganizationChartCapabilities } from './org-chart.js'
import { hrTransferInPlanCapabilities } from './hr-transfer-in-plan.js'
import { platformSystemCustomCapabilities } from './platform-system-custom.js'
import { platformSystemSecurityConfigCapabilities } from './platform-system-security-config.js'
import { platformSystemQueueStorageCapabilities } from './platform-system-queue-storage.js'
import { platformSystemEmailCapabilities } from './platform-system-email.js'
import { platformSystemQueueExportCapabilities } from './platform-system-queue-export.js'
import { platformSystemQueueFailedCapabilities } from './platform-system-queue-failed.js'
import { platformSystemQueueMysqlCapabilities } from './platform-system-queue-mysql.js'
import { platformSystemScheduleCapabilities } from './platform-system-schedule.js'
import { reportBankPayCapabilities } from './report-bank-pay.js'
import { reportBankSummaryCapabilities } from './report-bank-summary.js'
import { reportCenterInsuranceCapabilities } from './report-center-insurance.js'
import { reportCostCenterSalaryCapabilities } from './report-cost-center-salary.js'
import { reportDepartmentSalaryDetailCapabilities } from './report-department-salary-detail.js'
import { reportDepartmentSalaryCapabilities } from './report-department-salary.js'
import { reportFundPaymentSummaryCapabilities } from './report-fund-payment-summary.js'
import { reportInsurancePaymentSummaryCapabilities } from './report-insurance-payment-summary.js'
import { reportPersonTaxCapabilities } from './report-person-tax.js'
import { reportPostSalaryCapabilities } from './report-post-salary.js'
import { reportConfigurationCapabilities } from './report-configuration.js'
import { reportStandardUnitInsuranceCapabilities } from './report-standard-unit-insurance.js'
import { reportRetirementSalarySummaryCapabilities } from './report-retirement-salary-summary.js'
import { reportTemporarySalarySummaryCapabilities } from './report-temporary-salary-summary.js'
import { reportTemporarySalaryCapabilities } from './report-temporary-salary.js'
import { reportRetirementSalaryCapabilities } from './report-retirement-salary.js'
import { reportSalaryBillCapabilities } from './report-salary-bill.js'
import { reportSalaryCostCapabilities } from './report-salary-cost.js'
import { reportLaborCostAllocationCapabilities } from './report-labor-cost-allocation.js'
import { reportLeadershipProfitSalaryCapabilities } from './report-leadership-profit-salary.js'
import { reportUnitInterferenceCostAllocationCapabilities } from './report-unit-interference-cost-allocation.js'
import { reportSalaryItemCapabilities } from './report-salary-item.js'
import { salaryProcessCapabilities } from './salary-process.js'
import { salaryAccountingCapabilities } from './salary-accounting.js'
import { salaryPackageCapabilities } from './salary-package.js'
import { salaryAdjustImportCapabilities } from './salary-adjust-import.js'
import { salaryPersonTaxFileCapabilities } from './salary-person-tax-file.js'
import { salaryPersonTaxHandleCapabilities } from './salary-person-tax-handle.js'
import { salaryPersonTaxCapabilities } from './salary-person-tax.js'
import { salaryLevelCapabilities } from './salary-level.js'
import { saleCcbAccountCapabilities } from './sale-ccb-account.js'
import { salePaymentAccountCapabilities } from './sale-payment-account.js'
import { saleSysOfficeCapabilities } from './sale-sys-office.js'
import { saleSysUserCapabilities } from './sale-sys-user.js'
import { saleClaimSettingCapabilities } from './sale-claim-setting.js'
import { saleOldChickenSaleCapabilities } from './sale-old-chicken-sale.js'
import { salePriceControlCapabilities } from './sale-price-control.js'
import { saleLowPriceCapabilities } from './sale-low-price.js'
import { saleTradeStoreroomCapabilities } from './sale-trade-storeroom.js'
import { saleSettingDictCapabilities } from './sale-setting-dict.js'
import { saleSysDictCapabilities } from './sale-sys-dict.js'
import { saleServiceSubjectCapabilities } from './sale-service-subject.js'
import { saleScheduleJobCapabilities } from './sale-schedule-job.js'
import { saleScheduleJobLogCapabilities } from './sale-schedule-job-log.js'
import { saleRegisterCodeCapabilities } from './sale-register-code.js'
import { settingDictPlatformCapabilities } from './setting-dict-platform.js'
import { platformDictMallCapabilities, platformDictMallCommonCapabilities, platformDictMallFinanceCapabilities, platformDictMallHrCapabilities, platformDictMallMaterialCapabilities, platformDictMallProductCapabilities, platformDictMallSaleCapabilities, platformDictMallSupplyCapabilities } from './platform-dict-mall.js'
import { settingFrontendLogCapabilities } from './setting-frontend-log.js'
import { settingMaterialCapabilities } from './setting-material.js'
import { settingMenuCapabilities } from './setting-menu.js'
import { settingSupplierCapabilities } from './setting-supplier.js'
import { settingSystemAccountingParametersCapabilities } from './setting-system-accounting-parameters.js'
import { systemIntegrationCapabilities } from './system-integration.js'
import { settingRolePostCapabilities } from './setting-role-post.js'
import { settingRoleCapabilities } from './setting-role.js'
import { settingUserCapabilities } from './setting-user.js'
import { hrExternalStaffCapabilities } from './hr-external-staff.js'
import { hrInternalStaffCapabilities } from './hr-internal-staff.js'
import { recruitmentPlanCapabilities } from './recruitment-plan.js'
import { myTodoUrgeCapabilities } from './my-todo-urge.js'
import { myUrgeCapabilities } from './my-urge.js'
import { contractCodeRuleCapabilities } from './contract-code-rule.js'
import { supplyPersonnelConfigCapabilities } from './supply-personnel-config.js'
import { inventoryOrganizationConfigCapabilities } from './inventory-organization-config.js'
import { inventoryAssetDepreciationConfigCapabilities } from './inventory-asset-depreciation-config.js'
import { inventoryStockRuleCapabilities } from './inventory-stock-rule.js'
import { inventoryStockLocationCapabilities } from './inventory-stock-location.js'
import { inventoryApprovalConfigCapabilities } from './inventory-approval-config.js'
import { inventoryAssetStocktakingConfigCapabilities } from './inventory-asset-stocktaking-config.js'
import { inventoryAssetBatchConfigCapabilities } from './inventory-asset-batch-config.js'
import { inventoryValuationCapabilities } from './inventory-valuation.js'
import { platformRuleManagementCapabilities } from './platform-rule-management.js'
import { hrPostSettingCapabilities } from './hr-post-setting.js'
import { productHighProductionUsageCapabilities } from './product-high-production-usage.js'
import { productStableProductionUsageCapabilities } from './product-stable-production-usage.js'
import { productPreventionUsageAnalysisCapabilities } from './product-prevention-usage-analysis.js'
import { productUserAnalysisCapabilities } from './product-user-analysis.js'
import { productNoticeConfigCapabilities } from './product-notice-config.js'
import { productProgramLibraryCapabilities, productProgramLibraryNewCapabilities } from './product-program-library.js'
import { productSettingMaterialCapabilities } from './product-setting-material.js'
import { productSettingMedicineCapabilities } from './product-setting-medicine.js'
import { productSettingUserDictCapabilities } from './product-setting-user-dict.js'
import { productSettingVaccineCapabilities } from './product-setting-vaccine.js'
import { productSettingAntibodyCapabilities } from './product-setting-antibody.js'
import { productSettingChickenProductionCapabilities } from './product-setting-chicken-production.js'
import { productSettingEggStandardAgeStageCapabilities } from './product-setting-egg-standard-age-stage.js'
import { productSettingEpidemicPreventionCostCapabilities } from './product-setting-epidemic-prevention-cost.js'
import { productSettingHatchAnnualMonthlyCapabilities } from './product-setting-hatch-annual-monthly.js'
import { productSettingStandardBroilerCapabilities } from './product-setting-standard-broiler.js'
import { productSettingStandardFlockWeekCapabilities } from './product-setting-standard-flock-week.js'
import { productSettingStandardFlockCapabilities } from './product-setting-standard-flock.js'
import { productSettingStandardHatchCapabilities } from './product-setting-standard-hatch.js'
import { productSettingBatchStatusCapabilities } from './product-setting-batch-status.js'
import { productSettingConfigureCapabilities } from './product-setting-configure.js'
import { productSettingDayLiquidationCapabilities } from './product-setting-day-liquidation.js'
import { productSettingFunctionUseCapabilities } from './product-setting-function-use.js'
import { productSettingMaterialMasterCapabilities } from './product-setting-material-master.js'
import { productSettingTenantLogCapabilities } from './product-setting-tenant-log.js'
import { productSettingHatchManageLibCapabilities } from './product-setting-hatch-manage-lib.js'
import { productBusinessAgeDivisionCapabilities } from './product-business-age-division.js'
import { productBusinessDataRetransmitCapabilities } from './product-business-data-retransmit.js'
import { productBusinessSetupMaterialCodeCapabilities } from './product-business-setup-material-code.js'
import { productHatcheryLibCapabilities } from './product-hatchery-lib.js'
import { productHatcheryMethodCapabilities } from './product-hatchery-method.js'
import { productHatcheryMethodLibCapabilities } from './product-hatchery-method-lib.js'
import { productHatcheryMethodLibIndicatorCapabilities } from './product-hatchery-method-lib-indicator.js'
import { productHatcheryStandardIndicatorCapabilities } from './product-hatchery-standard-indicator.js'
import { productHatcheryUnitCapabilities } from './product-hatchery-unit.js'
import { productPlanPreviewCapabilities } from './product-plan-preview.js'
import { saleCustomQrCapabilities } from './sale-custom-qr.js'
import { saleVisitRecommendSettingCapabilities } from './sale-visit-recommend-setting.js'
import { settingDictPlatformFinanceCapabilities } from './setting-dict-platform-finance.js'
import { settingDictPlatformCommonCapabilities } from './setting-dict-platform-common.js'
import { settingDictPlatformHrCapabilities } from './setting-dict-platform-hr.js'
import { settingDictPlatformMaterialCapabilities } from './setting-dict-platform-material.js'
import { settingDictPlatformProductCapabilities } from './setting-dict-platform-product.js'
import { settingDictPlatformSupplyCapabilities } from './setting-dict-platform-supply.js'
import { settingDictPlatformSaleCapabilities } from './setting-dict-platform-sale.js'
import { productSettingHatchManageMethodLibCapabilities } from './product-setting-hatch-manage-method-lib.js'
import { productSettingHatchMethodLibIndicatorCapabilities } from './product-setting-hatch-method-lib-indicator.js'
import { productSettingHatchManageMethodCapabilities } from './product-setting-hatch-manage-method.js'
import { productSettingHatchManageSeasonCapabilities } from './product-setting-hatch-manage-season.js'
import { productSettingIndicatorLibCapabilities } from './product-setting-indicator-lib.js'
import { productSettingMethodLibCapabilities } from './product-setting-method-lib.js'
import { productSettingSeasonCapabilities } from './product-setting-season.js'
import { productSettingHatchManageUnitCapabilities } from './product-setting-hatch-manage-unit.js'
import { productSettingHatchManageVarietyCapabilities } from './product-setting-hatch-manage-variety.js'
import { contractSupportCapabilities } from './contract-support.js'
import { withExecutionEffect } from './execution-effects.js'
/**
 * 全部能力定义的**唯一来源**。
 *
 * 为什么要有这个文件：在此之前同一个数组在**三处**各拼了一遍
 * （`src/index.ts`、`src/server.ts`、`test/aliases-derived.test.ts`），
 * 而 `tools/generate/derive-aliases.mjs` 是**扫目录**读的。
 * 三份手写清单里漏掉任何一份，别名那组「孤儿 / 死链」断言就会红——
 * 2026-09-20 一天之内咬了两次（加考勤档案、加作业管理）。
 *
 * **新增能力时只改这里。**
 *
 * `derive-aliases.mjs` 读取本注册表的构建产物；先 pnpm build 再推导别名。
 * 不再按源码格式扫描，映射生成或紧凑声明的能力也不会漏掉。
 * `test/aliases-derived.test.ts` 核对注册数和生成物内容，避免陈旧构建被当成最新。
 */
import { assignmentCapabilities } from './assignment.js'
import { attendanceArchiveSheetCapabilities } from './attendance-archive-sheet.js'
import { attendanceAnnualLeaveCapabilities } from './attendance-annual-leave.js'
import { attendanceExceptionCapabilities } from './attendance-exception.js'
import { attendanceOvertimeCapabilities } from './attendance-overtime.js'
import { attendanceSchedualInformationCapabilities } from './attendance-schedual-information.js'
import { certificateLicenseCapabilities } from './certificate-license.js'
import { certificateTypeCapabilities } from './certificate-type.js'
import { institutionTypeCapabilities } from './institution-type.js'
import { pieceCapabilities } from './piece.js'
import { businessRegistrationCapabilities } from './business-registration.js'
import { companyPolicyCapabilities } from './company-policy.js'
import { honorCapabilities } from './honor.js'
import { legalDisputeCapabilities } from './legal-dispute.js'
import { qualificationCapabilities } from './qualification.js'
import { patentCapabilities } from './patent.js'
import { softwareCapabilities } from './software.js'
import { standardDocumentCapabilities } from './standard-document.js'
import { trademarkCapabilities } from './trademark.js'
import { attendanceShiftCapabilities } from './attendance-shift.js'
import { attendanceStatisticsCapabilities } from './attendance-statistics.js'
import { attendanceTeamCapabilities } from './attendance-team.js'
import { backlogTaskExamineCapabilities } from './backlog-task-examine.js'
import { baseDeptDictPermissionCapabilities } from './base-dept-dict-permission.js'
import { baseImageCapabilities } from './base-image.js'
import { baseManagementCenterCapabilities } from './base-management-center.js'
import { baseSaleCapabilities } from './base-sale.js'
import { baseShellCapabilities } from './base-shell.js'
import { leaveApplicationCapabilities } from './leave-application.js'
import { productDesignApprovalCapabilities } from './product-design-approval.js'
import { overtimeApplicationCapabilities } from './overtime-application.js'
import { businessTripApplicationCapabilities } from './business-trip-application.js'
import { restLeaveApplicationCapabilities } from './rest-leave-application.js'
import { taskActionCapabilities } from './task-action.js'
import { travelExpenseCapabilities } from './travel-expense-application.js'
import { vehicleApplicationCapabilities } from './vehicle-application.js'
import { baseTenantCapabilities } from './base-tenant.js'
import { generalApprovalCapabilities } from './general-approval.js'
import { baseUploadCapabilities } from './base-upload.js'
import { contractTemplateCapabilities } from './contract-template.js'
import { contractLibraryCapabilities } from './contract-library.js'
import { contractCreateCapabilities } from './contract-create.js'
import { meetingApplicationCapabilities } from './meeting-application.js'
import { meetingRoomCapabilities } from './meeting-room.js'
import { studyStudentCapabilities } from './study-student.js'
import { studyGradeCapabilities } from './study-grade.js'
import { studyLessonCapabilities, studyLessonActionCapabilities } from './study-lesson.js'
import { studyRecordCapabilities } from './study-record.js'
import { studyStatisticsCapabilities } from './study-statistics.js'
import { studyTeacherCapabilities } from './study-teacher.js'
import { perfAgreementCapabilities } from './perf-agreement.js'
import { perfManageConfigCapabilities } from './perf-manage-config.js'
import { perfManageTemplateCapabilities } from './perf-manage-template.js'
import { perfSalaryCapabilities } from './perf-salary.js'
import { flowTaskCapabilities, FLOW_TASK_MY_PAGE_PATH, FLOW_TASK_MY_PERMISSION } from './flow-task.js'
import { flowManageCapabilities } from './flow-manage.js'
import { studyCourseCapabilities } from './study-course.js'
import { aiKnowledgeCapabilities } from './ai-knowledge.js'
import { aiInteractionQaCapabilities } from './ai-interaction-qa.js'
import { aiModelCapabilities } from './ai-model.js'
import { modelUsageCapabilities } from './model-usage.js'
import { aiPromptCapabilities } from './ai-prompt.js'
import { aiPromptToolCapabilities } from './ai-prompt-tool.js'
import { platformOpenInterfaceCapabilities } from './platform-open-interface.js'
import { chatCapabilities } from './chat.js'
import { BATCH_SDK_CAPABILITIES } from './generated/index.js'
import type { CapabilityDefinition } from './types.js'

/**
 * 流程表单能力会复用「我的流程」页面完成查询/撤销；这些定义的原始 pagePath
 * 指向共享流程上下文而不是菜单叶子，因此在统一目录接线处补上可见菜单权限。
 */
const withSharedFlowPagePermission = (definition: CapabilityDefinition): CapabilityDefinition =>
  definition.pagePath === FLOW_TASK_MY_PAGE_PATH && definition.permission === undefined
    ? { ...definition, permission: FLOW_TASK_MY_PERMISSION }
    : definition

export const ALL_CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  ...hrPostTypeCapabilities,
  ...portalDeviceCapabilities,
  ...attendanceSheetCapabilities,
  ...hrOrganizationTypeCapabilities,
  ...hrOrganizationPropertyCapabilities,
  ...technologyProjectTypeCapabilities,
  ...technologyTypeTemplateMappingCapabilities,
  ...settingEnterpriseUsageCapabilities,
  ...settingSensitiveActionCapabilities,
  ...settingTokenAllocationCapabilities,
  ...technologySettingTemplateBaseCapabilities,
  ...technologySettingTemplateCapabilities,
  ...financeAccountingPeriodCapabilities,
  ...financeAccountingManageCapabilities,
  ...financeLedgerAccountsCapabilities,
  ...financeSettingAccuracyCapabilities,
  ...financeAllocationIndicatorCapabilities,
  ...financeSettingAnnualCarryforwardCapabilities,
  ...financeSettingCatConfigCapabilities,
  ...financeSettingCatMapCapabilities,
  ...financeSettingDateConfigCapabilities,
  ...financeSettingMonthlyIncomeTimeConfigCapabilities,
  ...financeSettingProjectCapabilities,
  ...financeSettingReceivingAccountCapabilities,
  ...financeSettingRelatedPartySettlementAccountCapabilities,
  ...financeSettingSaleAllocationCoefficientCapabilities,
  ...financeSettingAllocationRulesCapabilities,
  ...financeSettingCostCenterCapabilities,
  ...financeSettingEmployeeLoanAmountCapabilities,
  ...financeSettingInitialManageCapabilities,
  ...financeSettingOpeningSupplierCapabilities,
  ...historyArchiveCapabilities,
  ...meOrganizationCapabilities,
  ...mePersonalCapabilities,
  ...financeSettingFeePurposeCapabilities,
  ...financeSettingInventoryAccountCapabilities,
  ...financeSettingLivestockAmortizationCapabilities,
  ...financeSettingSettlementSettingCapabilities,
  ...financeSettingVoucherTemplatesCapabilities,
  ...fundSalaryFundCostsCapabilities,
  ...fundSalaryFundProcessCapabilities,
  ...insuranceSalaryInsuranceCostsCapabilities,
  ...insuranceSalaryInsuranceProcessCapabilities,
  ...manageCostCenterCapabilities,
  ...salaryItemCapabilities,
  ...mePayRollCapabilities,
  ...platformCategoryDictCapabilities,
  ...settingCategoryDictCapabilities,
  ...hrOrgCorporationCapabilities,
  ...hrOrganizationSettingCapabilities,
  ...hrOrganizationChartCapabilities,
  ...hrTransferInPlanCapabilities,
  ...platformSystemCustomCapabilities,
  ...platformSystemSecurityConfigCapabilities,
  ...platformSystemQueueStorageCapabilities,
  ...platformSystemEmailCapabilities,
  ...platformSystemQueueExportCapabilities,
  ...platformSystemQueueFailedCapabilities,
  ...platformSystemQueueMysqlCapabilities,
  ...platformSystemScheduleCapabilities,
  ...reportBankPayCapabilities,
  ...reportBankSummaryCapabilities,
  ...reportCenterInsuranceCapabilities,
  ...reportCostCenterSalaryCapabilities,
  ...reportDepartmentSalaryDetailCapabilities,
  ...reportDepartmentSalaryCapabilities,
  ...reportFundPaymentSummaryCapabilities,
  ...reportInsurancePaymentSummaryCapabilities,
  ...reportPersonTaxCapabilities,
  ...reportPostSalaryCapabilities,
  ...reportConfigurationCapabilities,
  ...reportStandardUnitInsuranceCapabilities,
  ...reportRetirementSalarySummaryCapabilities,
  ...reportTemporarySalarySummaryCapabilities,
  ...reportTemporarySalaryCapabilities,
  ...reportRetirementSalaryCapabilities,
  ...reportSalaryBillCapabilities,
  ...reportSalaryCostCapabilities,
  ...reportLaborCostAllocationCapabilities,
  ...reportLeadershipProfitSalaryCapabilities,
  ...reportUnitInterferenceCostAllocationCapabilities,
  ...reportSalaryItemCapabilities,
  ...salaryProcessCapabilities,
  ...salaryAccountingCapabilities,
  ...salaryPackageCapabilities,
  ...salaryAdjustImportCapabilities,
  ...salaryPersonTaxFileCapabilities,
  ...salaryPersonTaxHandleCapabilities,
  ...salaryPersonTaxCapabilities,
  ...salaryLevelCapabilities,
  ...saleCcbAccountCapabilities,
  ...salePaymentAccountCapabilities,
  ...saleSysOfficeCapabilities,
  ...saleSysUserCapabilities,
  ...saleClaimSettingCapabilities,
  ...saleOldChickenSaleCapabilities,
  ...salePriceControlCapabilities,
  ...saleLowPriceCapabilities,
  ...saleTradeStoreroomCapabilities,
  ...saleSettingDictCapabilities,
  ...saleSysDictCapabilities,
  ...saleServiceSubjectCapabilities,
  ...saleScheduleJobCapabilities,
  ...saleScheduleJobLogCapabilities,
  ...saleRegisterCodeCapabilities,
  ...settingDictPlatformCapabilities,
  ...platformDictMallCapabilities,
  ...platformDictMallCommonCapabilities,
  ...platformDictMallFinanceCapabilities,
  ...platformDictMallHrCapabilities,
  ...platformDictMallMaterialCapabilities,
  ...platformDictMallProductCapabilities,
  ...platformDictMallSaleCapabilities,
  ...platformDictMallSupplyCapabilities,
  ...settingFrontendLogCapabilities,
  ...settingMaterialCapabilities,
  ...settingMenuCapabilities,
  ...settingSupplierCapabilities,
  ...settingSystemAccountingParametersCapabilities,
  ...systemIntegrationCapabilities,
  ...settingRolePostCapabilities,
  ...settingRoleCapabilities,
  ...settingUserCapabilities,
  ...hrExternalStaffCapabilities,
  ...hrInternalStaffCapabilities,
  ...recruitmentPlanCapabilities,
  ...myTodoUrgeCapabilities,
  ...myUrgeCapabilities,
  ...contractCodeRuleCapabilities,
  ...supplyPersonnelConfigCapabilities,
  ...inventoryOrganizationConfigCapabilities,
  ...inventoryAssetDepreciationConfigCapabilities,
  ...inventoryStockRuleCapabilities,
  ...inventoryStockLocationCapabilities,
  ...inventoryApprovalConfigCapabilities,
  ...inventoryAssetStocktakingConfigCapabilities,
  ...inventoryAssetBatchConfigCapabilities,
  ...inventoryValuationCapabilities,
  ...platformRuleManagementCapabilities,
  ...hrPostSettingCapabilities,
  ...productHighProductionUsageCapabilities,
  ...productStableProductionUsageCapabilities,
  ...productPreventionUsageAnalysisCapabilities,
  ...productUserAnalysisCapabilities,
  ...productNoticeConfigCapabilities,
  ...productProgramLibraryCapabilities,
  ...productProgramLibraryNewCapabilities,
  ...productSettingMaterialCapabilities,
  ...productSettingMedicineCapabilities,
  ...productSettingUserDictCapabilities,
  ...productSettingVaccineCapabilities,
  ...productSettingAntibodyCapabilities,
  ...productSettingChickenProductionCapabilities,
  ...productSettingEggStandardAgeStageCapabilities,
  ...productSettingEpidemicPreventionCostCapabilities,
  ...productSettingHatchAnnualMonthlyCapabilities,
  ...productSettingStandardBroilerCapabilities,
  ...productSettingStandardFlockWeekCapabilities,
  ...productSettingStandardFlockCapabilities,
  ...productSettingStandardHatchCapabilities,
  ...productSettingBatchStatusCapabilities,
  ...productSettingConfigureCapabilities,
  ...productSettingDayLiquidationCapabilities,
  ...productSettingFunctionUseCapabilities,
  ...productSettingMaterialMasterCapabilities,
  ...productSettingTenantLogCapabilities,
  ...productSettingHatchManageLibCapabilities,
  ...productBusinessAgeDivisionCapabilities,
  ...productBusinessDataRetransmitCapabilities,
  ...productBusinessSetupMaterialCodeCapabilities,
  ...productHatcheryLibCapabilities,
  ...productHatcheryMethodCapabilities,
  ...productHatcheryMethodLibCapabilities,
  ...productHatcheryMethodLibIndicatorCapabilities,
  ...productHatcheryStandardIndicatorCapabilities,
  ...productHatcheryUnitCapabilities,
  ...productPlanPreviewCapabilities,
  ...saleCustomQrCapabilities,
  ...saleVisitRecommendSettingCapabilities,
  ...settingDictPlatformFinanceCapabilities,
  ...settingDictPlatformCommonCapabilities,
  ...settingDictPlatformHrCapabilities,
  ...settingDictPlatformMaterialCapabilities,
  ...settingDictPlatformProductCapabilities,
  ...settingDictPlatformSupplyCapabilities,
  ...settingDictPlatformSaleCapabilities,
  ...productSettingHatchManageMethodLibCapabilities,
  ...productSettingHatchMethodLibIndicatorCapabilities,
  ...productSettingHatchManageMethodCapabilities,
  ...productSettingHatchManageSeasonCapabilities,
  ...productSettingIndicatorLibCapabilities,
  ...productSettingMethodLibCapabilities,
  ...productSettingSeasonCapabilities,
  ...productSettingHatchManageUnitCapabilities,
  ...productSettingHatchManageVarietyCapabilities,
  ...contractSupportCapabilities,
  ...meetingRoomCapabilities,
  ...meetingApplicationCapabilities,
  ...attendanceArchiveSheetCapabilities,
  ...attendanceAnnualLeaveCapabilities,
  ...attendanceExceptionCapabilities,
  ...attendanceOvertimeCapabilities,
  ...attendanceSchedualInformationCapabilities,
  ...certificateLicenseCapabilities,
  ...certificateTypeCapabilities,
  ...institutionTypeCapabilities,
  ...pieceCapabilities,
  ...businessRegistrationCapabilities,
  ...companyPolicyCapabilities,
  ...honorCapabilities,
  ...legalDisputeCapabilities,
  ...qualificationCapabilities,
  ...patentCapabilities,
  ...softwareCapabilities,
  ...standardDocumentCapabilities,
  ...trademarkCapabilities,
  ...assignmentCapabilities,
  ...attendanceStatisticsCapabilities,
  ...attendanceShiftCapabilities,
  ...attendanceTeamCapabilities,
  ...backlogTaskExamineCapabilities,
  ...baseImageCapabilities,
  ...baseManagementCenterCapabilities,
  ...contractTemplateCapabilities,
  ...contractLibraryCapabilities,
  ...contractCreateCapabilities,
  // 基础能力：**不是页面**。它们的 pagePath 是合成的上下文路径（/base-data/*），
  // 不是菜单路径——所以不会把任何页面误判成「已完成」。理由见 docs/plan.json 的「队列之外」。
  ...baseDeptDictPermissionCapabilities,
  // 同样是基础能力：pagePath 是哨兵值 `common/utils/oss.js`（上传组件所在的前端模块），
  // **刻意不是菜单路径**——否则会把某个页面误判成「已完成」。
  ...baseUploadCapabilities,
  // 应用外壳（用户信息 / 人员 / 待办 / 菜单 / 工作台卡片）：合成的 `/base-data/*`，同样不是菜单路径
  ...baseShellCapabilities,
  // 流程表单线：通用审批（pagePath 是 `/dashboard/flow/form/edit`，那一页就是发起流程的表单页）
  ...generalApprovalCapabilities,
  // 基础能力第三批：租户/企业上下文 + 销售域基础数据（合成的 `/base-data/*`，不是菜单路径）
  ...baseTenantCapabilities,
  ...baseSaleCapabilities,
  // 流程表单线第二条：请假申请（pagePath 与通用审批同一页：`/dashboard/flow/form/edit`）
  ...leaveApplicationCapabilities,
  // 流程表单线第三条：用车申请
  ...vehicleApplicationCapabilities,
  // 流程表单线第四条：差旅费支出申请表（用户口语里的「报销」）
  ...travelExpenseCapabilities,
  // 流程表单线第五条：产品设计文档审核
  ...productDesignApprovalCapabilities,
  // 待办办理：横切能力（pagePath 是办理页 `/dashboard/flow/form/detail`）
  ...taskActionCapabilities,
  // 流程表单线第六条：加班审批
  ...overtimeApplicationCapabilities,
  // 流程表单线第七条：调休审批
  ...restLeaveApplicationCapabilities,
  // 流程表单线第八条：出差申请
  ...businessTripApplicationCapabilities,
  // 页面队列：课程管理（图文 / 视频 / 即时通讯）。三页共用
  // `/study/course/studycourse/courseList`，靠 URL 上的 `type=1|2|3|4` 分片。
  ...studyCourseCapabilities,
  // 学员管理（学习管理域·基础数据）
  ...studyStudentCapabilities,
  // 班级管理（学习能力域·课堂管理）
  ...studyGradeCapabilities,
  // 课堂三页（晨/周/月）
  ...studyLessonCapabilities,
  ...studyLessonActionCapabilities,
  // 学习管理（学习记录列表）
  ...studyRecordCapabilities,
  // 数据统计五页
  ...studyStatisticsCapabilities,
  // 讲师三页（讲师管理 / 讲师类型 / 评价设置）——前两页走 smart-layer-admin 实例
  ...studyTeacherCapabilities,
  // 绩效·协议类五页（状态变更 / 个人月度 / 所辖月度 / 个人年度 / 所辖年度）
  ...perfAgreementCapabilities,
  // 绩效·配置类六页（公式配置 / 指标管理 / 五险一金 / 标准管理 / 时间节点 / 考核规则）
  ...perfManageConfigCapabilities,
  // 绩效·模板/任务类六页（利润管理 / 薪资结构 / 模板内容 / 模板结构 / 学习任务配置 / 任务类型配置）
  ...perfManageTemplateCapabilities,
  // 绩效·薪酬与分析六页（奖励导入 / 工资找齐 / 考核导入 / 组件管理 / 管理分析 / 个人分析）
  ...perfSalaryCapabilities,
  // 审批管理·任务四页（发起流程 / 待办任务 / 已办任务 / 抄送我的）
  ...flowTaskCapabilities,
  // 审批管理·流程管理四页（流程模型 / AI审核配置 / 流程实例 / 流程任务）
  ...flowManageCapabilities,
  // 人工智能·知识管理两页（知识空间 / 知识审核）。这一域是**平台侧**页面，
  // 在 module-type 规则表里匹配不到 ⇒ 与浏览器一致，**不发 `module-type` 头**（conventions 2）。
  ...aiKnowledgeCapabilities,
  // 人工智能·智能交互「问答」四页（热门问题 / 交互历史 / 敏感词 / 意见反馈）
  ...aiInteractionQaCapabilities,
  // 人工智能·智能交互「模型与用量」四页（模型列表 / 模型选择 / 平台用量 / 数据分析）
  ...aiModelCapabilities,
  ...modelUsageCapabilities,
  // 人工智能·提示工程「基础」三页（提示词类型 / 技能列表 / 意图列表）
  ...aiPromptCapabilities,
  // 人工智能·提示工程「工具绑定」三页（业务事件绑定技能 / 开放接口 / 工具提示词绑定）
  ...aiPromptToolCapabilities,
  // 平台设置·开放平台：复用提示工程开放接口的实现，但保留独立菜单/权限上下文
  ...platformOpenInterfaceCapabilities,
  ...chatCapabilities,
  // 批量生成器只接入范围内且静态契约完整的 GET 列表；partial/范围外仍留在审计产物。
  ...BATCH_SDK_CAPABILITIES,
].map(withExecutionEffect).map(withSharedFlowPagePermission)
