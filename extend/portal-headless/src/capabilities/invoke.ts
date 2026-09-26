import type { PortalDeviceCapability } from './portal-device.js'
import type { HrPostTypeCapability } from './hr-post-type.js'
import type { AttendanceSheetCapability } from './attendance-sheet.js'
import type { HrOrganizationTypeCapability } from './hr-organization-type.js'
import type { HrOrganizationPropertyCapability } from './hr-organization-property.js'
import type { TechnologyProjectTypeCapability } from './technology-project-type.js'
import { TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS, type TechnologyTypeTemplateMappingCapability } from './technology-type-template-mapping.js'
import { SETTING_ENTERPRISE_USAGE_METHODS, type SettingEnterpriseUsageCapability } from './setting-enterprise-usage.js'
import { SETTING_SENSITIVE_ACTION_METHODS, type SettingSensitiveActionCapability } from './setting-sensitive-action.js'
import { SETTING_TOKEN_ALLOCATION_METHODS, type SettingTokenAllocationCapability } from './setting-token-allocation.js'
import { TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS, type TechnologySettingTemplateBaseCapability } from './technology-setting-template-base.js'
import { TECHNOLOGY_SETTING_TEMPLATE_METHODS, type TechnologySettingTemplateCapability } from './technology-setting-template.js'
import type { FinanceAccountingPeriodCapabilityWithIdempotency } from './finance-accounting-period.js'
import type { FinanceAccountingManageCapabilityWithIdempotency } from './finance-accounting-manage.js'
import type { FinanceLedgerAccountsCapabilityWithIdempotency } from './finance-ledger-accounts.js'
import type { FinanceSettingAccuracyCapabilityWithIdempotency } from './finance-setting-accuracy.js'
import type { FinanceAllocationIndicatorCapability } from './finance-setting-allocation-indicator.js'
import { FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS, type FinanceSettingAnnualCarryforwardCapability } from './finance-setting-annual-carryforward.js'
import type { FinanceSettingCatConfigCapability } from './finance-setting-cat-config.js'
import type { FinanceSettingCatMapCapability } from './finance-setting-cat-map.js'
import type { FinanceSettingDateConfigCapability } from './finance-setting-date-config.js'
import type { FinanceSettingMonthlyIncomeTimeConfigCapability } from './finance-setting-monthly-income-time-config.js'
import type { FinanceSettingProjectCapability } from './finance-setting-project.js'
import type { FinanceSettingReceivingAccountCapability } from './finance-setting-receiving-account.js'
import type { FinanceSettingRelatedPartySettlementAccountCapability } from './finance-setting-related-party-settlement-account.js'
import type { FinanceSettingSaleAllocationCoefficientCapability } from './finance-setting-sale-allocation-coefficient.js'
import type { FinanceSettingAllocationRulesCapability } from './finance-setting-allocation-rules.js'
import type { FinanceSettingCostCenterCapability } from './finance-setting-cost-center.js'
import type { FinanceSettingEmployeeLoanAmountCapability } from './finance-setting-employee-loan-amount.js'
import type { FinanceSettingInitialManageCapability } from './finance-setting-initial-manage.js'
import type { FinanceSettingOpeningSupplierCapabilityWithIdempotency, FinanceSettingOpeningSupplierCapabilityWithIdempotency as FinanceSettingOpeningSupplierCapability } from './finance-setting-opening-supplier.js'
import type { FinanceSettingFeePurposeCapability } from './finance-setting-fee-purpose.js'
import type { FinanceSettingInventoryAccountCapability } from './finance-setting-inventory-account.js'
import type { FinanceSettingLivestockAmortizationCapability } from './finance-setting-livestock-amortization.js'
import type { FinanceSettingSettlementSettingCapability } from './finance-setting-settlement-setting.js'
import type { FinanceSettingVoucherTemplatesCapability } from './finance-setting-voucher-templates.js'
import type { FundSalaryFundCostsCapability } from './fund-salary-fund-costs.js'
import type { FundSalaryFundProcessCapability } from './fund-salary-fund-process.js'
import type { InsuranceSalaryInsuranceCostsCapability } from './insurance-salary-insurance-costs.js'
import type { InsuranceSalaryInsuranceProcessCapability } from './insurance-salary-insurance-process.js'
import type { ManageCostCenterCapability } from './manage-cost-center.js'
import type { SalaryItemCapability } from './salary-item.js'
import type { MePayRollCapability, MePayRollQuery } from './me-pay-roll.js'
import type { PlatformCategoryDictCapability, PlatformCategoryDictQuery, PlatformCategoryDictCreateInput, PlatformCategoryDictUpdateInput } from './platform-category-dict.js'
import type { OrgCorporationCapability, OrgCorporationQuery, OrgCorporationDraft, OrgCorporationUpdateDraft, OrgCorporationIds, OrgCorporationDelete } from './org-corporation.js'
import type { HrOrganizationSettingCapability } from './org-setting.js'
import type { HrOrganizationChartCapability } from './org-chart.js'
import type { HrTransferInPlanCapability } from './hr-transfer-in-plan.js'
import type { PlatformSystemCustomCapability } from './platform-system-custom.js'
import type { PlatformSystemSecurityConfigCapability } from './platform-system-security-config.js'
import type { PlatformSystemQueueStorageCapability } from './platform-system-queue-storage.js'
import type { PlatformSystemEmailCapability } from './platform-system-email.js'
import type { PlatformSystemQueueExportCapability } from './platform-system-queue-export.js'
import type { PlatformSystemQueueFailedCapability } from './platform-system-queue-failed.js'
import type { PlatformSystemQueueMysqlCapability } from './platform-system-queue-mysql.js'
import type { PlatformSystemScheduleCapability } from './platform-system-schedule.js'
import type { ReportBankPayCapability } from './report-bank-pay.js'
import type { ReportBankSummaryCapability } from './report-bank-summary.js'
import type { ReportCenterInsuranceCapability } from './report-center-insurance.js'
import type { ReportCostCenterSalaryCapability } from './report-cost-center-salary.js'
import type { ReportDepartmentSalaryDetailCapability } from './report-department-salary-detail.js'
import type { ReportDepartmentSalaryCapability } from './report-department-salary.js'
import type { ReportFundPaymentSummaryCapability } from './report-fund-payment-summary.js'
import type { ReportInsurancePaymentSummaryCapability } from './report-insurance-payment-summary.js'
import type { ReportPersonTaxCapability } from './report-person-tax.js'
import type { ReportPostSalaryCapability } from './report-post-salary.js'
import type { ReportConfigurationCapability } from './report-configuration.js'
import type { ReportStandardUnitInsuranceCapability } from './report-standard-unit-insurance.js'
import type { ReportRetirementSalarySummaryCapability } from './report-retirement-salary-summary.js'
import type { ReportTemporarySalarySummaryCapability } from './report-temporary-salary-summary.js'
import type { ReportTemporarySalaryCapability } from './report-temporary-salary.js'
import type { ReportRetirementSalaryCapability } from './report-retirement-salary.js'
import type { ReportSalaryBillCapability } from './report-salary-bill.js'
import type { ReportSalaryCostCapability } from './report-salary-cost.js'
import {
  REPORT_LABOR_COST_ALLOCATION_METHODS,
  type ReportLaborCostAllocationCapability,
} from './report-labor-cost-allocation.js'
import {
  REPORT_LEADERSHIP_PROFIT_SALARY_METHODS,
  type ReportLeadershipProfitSalaryCapability,
} from './report-leadership-profit-salary.js'
import {
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS,
  type ReportUnitInterferenceCostAllocationCapability,
} from './report-unit-interference-cost-allocation.js'
import type { ReportSalaryItemCapability } from './report-salary-item.js'
import type { SalaryProcessCapability } from './salary-process.js'
import type { SalaryAccountingCapability } from './salary-accounting.js'
import type { SalaryPackageCapability } from './salary-package.js'
import { SALARY_ADJUST_IMPORT_METHODS, type SalaryAdjustImportCapability } from './salary-adjust-import.js'
import { SALARY_PERSON_TAX_FILE_METHODS, type SalaryPersonTaxFileCapability } from './salary-person-tax-file.js'
import { SALARY_PERSON_TAX_HANDLE_METHODS, type SalaryPersonTaxHandleCapability } from './salary-person-tax-handle.js'
import { SALARY_PERSON_TAX_METHODS, type SalaryPersonTaxCapability } from './salary-person-tax.js'
import type { SalaryLevelCapability } from './salary-level.js'
import type { SettingCategoryDictCapability } from './setting-category-dict.js'
import type { SaleSettingDictCapability } from './sale-setting-dict.js'
import { SALE_SYS_DICT_METHODS, type SaleSysDictCapability } from './sale-sys-dict.js'
import { SALE_SERVICE_SUBJECT_METHODS, type SaleServiceSubjectCapability } from './sale-service-subject.js'
import { SALE_CCB_ACCOUNT_METHODS, type SaleCcbAccountCapability } from './sale-ccb-account.js'
import { SALE_PAYMENT_ACCOUNT_METHODS, type SalePaymentAccountCapability } from './sale-payment-account.js'
import { SALE_SYS_OFFICE_METHODS, type SaleSysOfficeCapability } from './sale-sys-office.js'
import { SALE_SYS_USER_METHODS, type SaleSysUserCapability } from './sale-sys-user.js'
import { SALE_CLAIM_SETTING_METHODS, type SaleClaimSettingCapability } from './sale-claim-setting.js'
import { SALE_OLD_CHICKEN_SALE_METHODS, type SaleOldChickenSaleCapability } from './sale-old-chicken-sale.js'
import { SALE_PRICE_CONTROL_METHODS, type SalePriceControlCapability } from './sale-price-control.js'
import { SALE_LOW_PRICE_METHODS, type SaleLowPriceCapability } from './sale-low-price.js'
import { SALE_TRADE_STOREROOM_METHODS, type SaleTradeStoreroomCapability } from './sale-trade-storeroom.js'
import { SALE_SCHEDULE_JOB_METHODS, type SaleScheduleJobCapability } from './sale-schedule-job.js'
import { SALE_SCHEDULE_JOB_LOG_METHODS, type SaleScheduleJobLogCapability } from './sale-schedule-job-log.js'
import { SALE_REGISTER_CODE_METHODS, type SaleRegisterCodeCapability } from './sale-register-code.js'
import type { SettingDictPlatformCapability } from './setting-dict-platform.js'
import { PLATFORM_DICT_MALL_COMMON_METHODS, PLATFORM_DICT_MALL_FINANCE_METHODS, PLATFORM_DICT_MALL_HR_METHODS, PLATFORM_DICT_MALL_MATERIAL_METHODS, PLATFORM_DICT_MALL_METHODS, PLATFORM_DICT_MALL_PRODUCT_METHODS, PLATFORM_DICT_MALL_SALE_METHODS, PLATFORM_DICT_MALL_SUPPLY_METHODS, type PlatformDictMallCapability } from './platform-dict-mall.js'
import type { SettingFrontendLogCapability } from './setting-frontend-log.js'
import type { SettingMaterialCapability } from './setting-material.js'
import type { SettingMenuCapability } from './setting-menu.js'
import type { SettingSupplierCapability } from './setting-supplier.js'
import type { SettingSystemAccountingParametersCapability } from './setting-system-accounting-parameters.js'
import type { SystemIntegrationCapability } from './system-integration.js'
import type { SettingRolePostCapability } from './setting-role-post.js'
import type { SettingRoleCapabilityWithIdempotency, SettingRoleCapabilityWithIdempotency as SettingRoleCapability } from './setting-role.js'
import type { SettingUserCapability } from './setting-user.js'
import type { HrExternalStaffCapability } from './hr-external-staff.js'
import type { HrInternalStaffCapability } from './hr-internal-staff.js'
import type { HistoryArchiveCapability } from './history-archive.js'
import type { MeOrganizationCapability } from './me-organization.js'
import type { MePersonalCapability } from './me-personal.js'
import { RECRUITMENT_PLAN_METHODS, type RecruitmentPlanCapability } from './recruitment-plan.js'
import { MY_TODO_URGE_METHODS, type MyTodoUrgeCapability } from './my-todo-urge.js'
import { MY_URGE_METHODS, type MyUrgeCapability } from './my-urge.js'
import { CONTRACT_CODE_RULE_METHODS, type ContractCodeRuleCapability } from './contract-code-rule.js'
import type { SupplyPersonnelConfigCapability } from './supply-personnel-config.js'
import type { InventoryOrganizationConfigCapability } from './inventory-organization-config.js'
import type { InventoryAssetDepreciationConfigCapability } from './inventory-asset-depreciation-config.js'
import type { InventoryStockRuleCapability } from './inventory-stock-rule.js'
import type { InventoryStockLocationCapability } from './inventory-stock-location.js'
import type { InventoryApprovalConfigCapability } from './inventory-approval-config.js'
import type { InventoryAssetStocktakingConfigCapability } from './inventory-asset-stocktaking-config.js'
import type { InventoryAssetBatchConfigCapability } from './inventory-asset-batch-config.js'
import type { InventoryValuationCapability } from './inventory-valuation.js'
import type { PlatformRuleManagementCapability } from './platform-rule-management.js'
import type { HrPostSettingCapability } from './hr-post-setting.js'
import type { ProductHighProductionUsageCapability } from './product-high-production-usage.js'
import type { ProductStableProductionUsageCapability } from './product-stable-production-usage.js'
import type { ProductPreventionUsageAnalysisCapability } from './product-prevention-usage-analysis.js'
import type { ProductUserAnalysisCapability } from './product-user-analysis.js'
import type { ProductNoticeConfigCapability } from './product-notice-config.js'
import {
  PRODUCT_SETTING_MATERIAL_METHODS,
  type ProductSettingMaterialCapability,
} from './product-setting-material.js'
import {
  PRODUCT_SETTING_MEDICINE_METHODS,
  type ProductSettingMedicineCapability,
} from './product-setting-medicine.js'
import {
  PRODUCT_SETTING_USER_DICT_METHODS,
  type ProductSettingUserDictCapability,
} from './product-setting-user-dict.js'
import {
  PRODUCT_SETTING_VACCINE_METHODS,
  type ProductSettingVaccineCapability,
} from './product-setting-vaccine.js'
import {
  PRODUCT_SETTING_ANTIBODY_METHODS,
  type ProductSettingAntibodyCapability,
} from './product-setting-antibody.js'
import {
  PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS,
  type ProductSettingChickenProductionCapability,
} from './product-setting-chicken-production.js'
import {
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS,
  type ProductSettingEggStandardAgeStageCapability,
} from './product-setting-egg-standard-age-stage.js'
import {
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS,
  type ProductSettingEpidemicPreventionCostCapability,
} from './product-setting-epidemic-prevention-cost.js'
import {
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS,
  type ProductSettingHatchAnnualMonthlyCapability,
} from './product-setting-hatch-annual-monthly.js'
import {
  PRODUCT_SETTING_STANDARD_BROILER_METHODS,
  type ProductSettingStandardBroilerCapability,
} from './product-setting-standard-broiler.js'
import {
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS,
  type ProductSettingStandardFlockWeekCapability,
} from './product-setting-standard-flock-week.js'
import {
  PRODUCT_SETTING_STANDARD_FLOCK_METHODS,
  type ProductSettingStandardFlockCapability,
} from './product-setting-standard-flock.js'
import {
  PRODUCT_SETTING_STANDARD_HATCH_METHODS,
  type ProductSettingStandardHatchCapability,
} from './product-setting-standard-hatch.js'
import {
  PRODUCT_SETTING_BATCH_STATUS_METHODS,
  type ProductSettingBatchStatusCapability,
} from './product-setting-batch-status.js'
import {
  PRODUCT_SETTING_CONFIGURE_METHODS,
  type ProductSettingConfigureCapability,
} from './product-setting-configure.js'
import {
  PRODUCT_SETTING_DAY_LIQUIDATION_METHODS,
  type ProductSettingDayLiquidationCapability,
} from './product-setting-day-liquidation.js'
import {
  PRODUCT_SETTING_FUNCTION_USE_METHODS,
  type ProductSettingFunctionUseCapability,
} from './product-setting-function-use.js'
import {
  PRODUCT_SETTING_MATERIAL_MASTER_METHODS,
  type ProductSettingMaterialMasterCapability,
} from './product-setting-material-master.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS,
  type ProductSettingHatchManageLibCapability,
} from './product-setting-hatch-manage-lib.js'
import {
  PRODUCT_BUSINESS_AGE_DIVISION_METHODS,
  type ProductBusinessAgeDivisionCapability,
} from './product-business-age-division.js'
import {
  PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS,
  type ProductBusinessDataRetransmitCapability,
} from './product-business-data-retransmit.js'
import {
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS,
  type ProductBusinessSetupMaterialCodeCapability,
} from './product-business-setup-material-code.js'
import {
  PRODUCT_HATCHERY_LIB_METHODS,
  type ProductHatcheryLibCapability,
} from './product-hatchery-lib.js'
import {
  PRODUCT_HATCHERY_METHODS,
  type ProductHatcheryMethodCapability,
} from './product-hatchery-method.js'
import {
  PRODUCT_HATCHERY_METHOD_LIB_METHODS,
  type ProductHatcheryMethodLibCapability,
} from './product-hatchery-method-lib.js'
import {
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS,
  type ProductHatcheryMethodLibIndicatorCapability,
} from './product-hatchery-method-lib-indicator.js'
import {
  PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS,
  type ProductHatcheryStandardIndicatorCapability,
} from './product-hatchery-standard-indicator.js'
import {
  PRODUCT_HATCHERY_UNIT_METHODS,
  type ProductHatcheryUnitCapability,
} from './product-hatchery-unit.js'
import {
  PRODUCT_PLAN_PREVIEW_METHODS,
  type ProductPlanPreviewCapability,
} from './product-plan-preview.js'
import {
  SALE_CUSTOM_QR_METHODS,
  type SaleCustomQrCapability,
} from './sale-custom-qr.js'
import {
  SETTING_DICT_PLATFORM_FINANCE_METHODS,
  type SettingDictPlatformFinanceCapability,
} from './setting-dict-platform-finance.js'
import {
  SETTING_DICT_PLATFORM_COMMON_METHODS,
  type SettingDictPlatformCommonCapability,
} from './setting-dict-platform-common.js'
import {
  SETTING_DICT_PLATFORM_HR_METHODS,
  type SettingDictPlatformHrCapability,
} from './setting-dict-platform-hr.js'
import {
  SETTING_DICT_PLATFORM_MATERIAL_METHODS,
  type SettingDictPlatformMaterialCapability,
} from './setting-dict-platform-material.js'
import {
  SETTING_DICT_PLATFORM_PRODUCT_METHODS,
  type SettingDictPlatformProductCapability,
} from './setting-dict-platform-product.js'
import {
  SETTING_DICT_PLATFORM_SUPPLY_METHODS,
  type SettingDictPlatformSupplyCapability,
} from './setting-dict-platform-supply.js'
import {
  SETTING_DICT_PLATFORM_SALE_METHODS,
  type SettingDictPlatformSaleCapability,
} from './setting-dict-platform-sale.js'
import {
  SALE_VISIT_RECOMMEND_SETTING_METHODS,
  type SaleVisitRecommendSettingCapability,
} from './sale-visit-recommend-setting.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_METHODS,
  type ProductSettingHatchManageMethodLibCapability,
} from './product-setting-hatch-manage-method-lib.js'
import {
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS,
  type ProductSettingHatchMethodLibIndicatorCapability,
} from './product-setting-hatch-method-lib-indicator.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS,
  type ProductSettingHatchManageMethodCapability,
} from './product-setting-hatch-manage-method.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS,
  type ProductSettingHatchManageSeasonCapability,
} from './product-setting-hatch-manage-season.js'
import {
  PRODUCT_SETTING_INDICATOR_LIB_METHODS,
  type ProductSettingIndicatorLibCapability,
} from './product-setting-indicator-lib.js'
import {
  PRODUCT_SETTING_METHOD_LIB_METHODS,
  type ProductSettingMethodLibCapability,
} from './product-setting-method-lib.js'
import {
  PRODUCT_SETTING_SEASON_METHODS,
  type ProductSettingSeasonCapability,
} from './product-setting-season.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS,
  type ProductSettingHatchManageUnitCapability,
} from './product-setting-hatch-manage-unit.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS,
  type ProductSettingHatchManageVarietyCapability,
} from './product-setting-hatch-manage-variety.js'
import {
  PRODUCT_SETTING_TENANT_LOG_METHODS,
  type ProductSettingTenantLogCapability,
} from './product-setting-tenant-log.js'
import {
  PRODUCT_PROGRAM_LIBRARY_METHODS,
  PRODUCT_PROGRAM_LIBRARY_NEW_METHODS,
  type ProductProgramLibraryCapability,
} from './product-program-library.js'
import { installPortalPageCompatibility } from './portal-page-compat.js'
import { installAiModelCompatibility } from './ai-model-compat.js'
import { CONTRACT_SUPPORT_METHODS, type ContractSupport } from './contract-support.js'
/**
 * 能力的**执行绑定**：`capabilityId` → 「门面上怎么调」。
 *
 * 为什么需要它（评测报告 G1）：`describe()` 一直能回答"该做什么、传什么参数"，
 * 却没有任何一处把**能力 ID** 映射到**调用方式**。452 KB 的目录输出里
 * `meetingRoom` / `meetingApplication` 零出现，调用方拿得到参数契约也发不出请求。
 *
 * 这一层给出**同一个实现的两种用法**（两者取自下面这一张表，不会分叉）：
 *
 * ```ts
 * sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })  // 通用入口，不必知道分组
 * sdk.meetingApplication.roomUsage('2026-09-22')                          // 手写入口，sdkPath 告诉你怎么写
 * ```
 *
 * 维护规则：
 * 1. `capabilityId` 必须是真实存在的能力（`describe()` 的 `invoke` 字段读的就是这张表）。
 * 2. `sdkPath` 必须对着门面上的**真实方法**写（形如 `meetingApplication.roomUsage`）。
 *    它是给人看的"手写路径"，写错不会有运行时症状，只有一条测试能抓住。
 * 3. `run` 只做**参数适配**（把 `{ date }` 摊平成 `roomUsage(date)` 这种），
 *    不重复能力自己的校验，也不重复能力自己的语义——写操作的
 *    `prepare → submit → cancel` 分工必须保持，不能在这里合并。
 */

import type {
  MeetingApplicationCapabilityWithIdempotency,
  MeetingApplicationDraft,
  SimpleUserQuery,
  StartUserSelectAssignees,
} from './meeting-application.js'
import { MEETING_ROOM_METHODS, type MeetingRoomCapability } from './meeting-room.js'
import type {
  AttendanceArchiveSheetCapability,
  AttendanceArchiveSheetQuery,
  OrganizationSearchQuery,
} from './attendance-archive-sheet.js'
import type { AttendanceAnnualLeaveCapability, AttendanceAnnualLeaveQuery } from './attendance-annual-leave.js'
import type { AttendanceExceptionCapability, AttendanceExceptionId, AttendanceExceptionQuery } from './attendance-exception.js'
import type { AttendanceSchedualInformationAbsenceInput, AttendanceSchedualInformationCalendarQuery, AttendanceSchedualInformationCapability, AttendanceSchedualInformationListQuery } from './attendance-schedual-information.js'
import type { CertificateLicenseCapability, CertificateLicenseQuery } from './certificate-license.js'
import type { CertificateTypeCapability, CertificateTypeQuery } from './certificate-type.js'
import type { InstitutionTypeCapability } from './institution-type.js'
import type { PieceCapability, PieceQuery } from './piece.js'
import type { BusinessRegistrationCapability, BusinessRegistrationQuery } from './business-registration.js'
import type { CompanyPolicyCapability, CompanyPolicyQuery, CompanyPolicyStudentQuery } from './company-policy.js'
import type { HonorCapability, HonorQuery } from './honor.js'
import type { LegalDisputeCapability, LegalDisputeQuery } from './legal-dispute.js'
import type { QualificationCapability, QualificationQuery } from './qualification.js'
import type { PatentCapability, PatentQuery } from './patent.js'
import type { SoftwareCapability, SoftwareQuery } from './software.js'
import type { StandardDocumentCapability, StandardDocumentQuery } from './standard-document.js'
import type { TrademarkCapability, TrademarkQuery } from './trademark.js'
import type { AttendanceOvertimeCapability, AttendanceOvertimeQuery, AttendanceOvertimeDetailInput } from './attendance-overtime.js'
import type {
  AssignmentCapabilityWithIdempotency,
  AssignmentDraft,
  AssignmentPageQuery,
  AssignmentStatus,
  AssignmentUpdateDraft,
} from './assignment.js'
import type {
  AttendanceStatisticsCapability,
  AttendanceStatisticsQuery,
} from './attendance-statistics.js'
import type {
  AttendanceShiftCapabilityWithIdempotency,
  AttendanceShiftDraft,
  AttendanceShiftQuery,
  AttendanceShiftUpdateDraft,
} from './attendance-shift.js'
import type {
  AttendanceTeamCapabilityWithIdempotency,
  AttendanceTeamDraft,
  AttendanceTeamQuery,
  AttendanceTeamScheduleDraft,
  AttendanceTeamUpdateDraft,
} from './attendance-team.js'
import type { BacklogTaskExamineCapability, BacklogTaskExamineQuery, TaskWithdrawParams } from './backlog-task-examine.js'
import type {
  BaseManagementCenterCapabilityWithIdempotency,
  ManagementCenterDraft,
  ManagementCenterQuery,
  ManagementCenterUpdateDraft,
} from './base-management-center.js'
import type {
  ContractTemplateCapabilityWithIdempotency,
  ContractTemplateDraft,
  ContractTemplateQuery,
  ContractTemplateUpdateDraft,
} from './contract-template.js'
import type {
  ContractLibraryCapability,
  ContractQuery,
  ContractReplenishmentPreparation,
  ContractSignCertificatePreparation,
  ContractUpdatePreparation,
  ContractVoidDraft,
} from './contract-library.js'
import type { ContractCreateCapability, ContractCreateCapabilityWithIdempotency, ContractCreateDraft } from './contract-create.js'
import type {
  BaseImageCapabilityWithIdempotency,
  BaseImageDraft,
  BaseImagePageQuery,
  BaseImageUpdateDraft,
} from './base-image.js'
import type { BaseDeptDictPermissionCapability } from './base-dept-dict-permission.js'
import type {
  GeneralApprovalCapabilityWithIdempotency,
  GeneralApprovalDraft,
  StartUserSelectAssignees as GeneralApprovalAssignees,
} from './general-approval.js'
import type { BaseShellCapability } from './base-shell.js'
import type { BaseTenantCapability } from './base-tenant.js'
import type {
  LeaveApplicationCapabilityWithIdempotency,
  LeaveDraft,
} from './leave-application.js'
import type {
  VehicleApplicationCapabilityWithIdempotency,
  VehicleApplicationDraft,
} from './vehicle-application.js'
import type {
  TravelExpenseCapabilityWithIdempotency,
  TravelExpenseDraft,
} from './travel-expense-application.js'
import type {
  ProductDesignApprovalCapabilityWithIdempotency,
  ProductDesignApprovalDraft,
} from './product-design-approval.js'
import type { TaskActionCapabilityWithIdempotency } from './task-action.js'
import type {
  OvertimeApplicationCapabilityWithIdempotency,
  OvertimeApplicationDraft,
} from './overtime-application.js'
import type {
  RestLeaveApplicationCapabilityWithIdempotency,
  RestLeaveApplicationDraft,
} from './rest-leave-application.js'
import type {
  BusinessTripApplicationCapabilityWithIdempotency,
  BusinessTripApplicationDraft,
} from './business-trip-application.js'
import {
  STUDY_COURSE_METHODS,
  type StudyCourseCapability,
} from './study-course.js'
import type {
  StudyStudentCapability,
  StudyStudentQuery,
} from './study-student.js'
import type {
  StudyGradeCapability,
} from './study-grade.js'
import { STUDY_GRADE_METHODS } from './study-grade.js'
import {
  STUDY_LESSON_METHODS,
  type StudyLessonCapability,
} from './study-lesson.js'
import type {
  StudyRecordCapability,
  StudyRecordQuery,
} from './study-record.js'
import type {
  StudyStatisticsCapability,
  StudyStatisticsStudentQuery,
  StudyStatisticsTeacherQuery,
  StudyStatisticsLessonQuery,
  StudyStatisticsGradeQuery,
  GradeLessonKind,
  LearningStaticsPayload,
} from './study-statistics.js'
import type {
  StudyTeacherCapability,
} from './study-teacher.js'
import { STUDY_TEACHER_METHODS } from './study-teacher.js'
import type { PerfAgreementCapability } from './perf-agreement.js'
import { PERF_MANAGE_CONFIG_METHODS, type PerfManageConfigCapability } from './perf-manage-config.js'
import { PERF_MANAGE_TEMPLATE_METHODS, type PerfManageTemplateCapability } from './perf-manage-template.js'
import type { PerfSalaryCapability, PerfSalaryCapabilityWithIdempotency } from './perf-salary.js'
import type { FlowTaskCapability } from './flow-task.js'
import type { FlowManageCapability } from './flow-manage.js'
import type { BaseSaleCapability } from './base-sale.js'
import type { BaseUploadCapability, OssUploadRequest } from './base-upload.js'
import type { AiKnowledgeCapability, KnowledgePermissionDraft } from './ai-knowledge.js'
// 值导入（本文件里唯一的一处）：`ai-knowledge-workspace-create` 要按 `type` 分派到
// `createFolder` / `createFile`，用能力文件里那两个常量比写魔法数字好（同一个含义只有一份定义）
import { KNOWLEDGE_FILE_TYPE_DOCUMENT, KNOWLEDGE_FILE_TYPE_FOLDER } from './ai-knowledge.js'
import type {
  AiInteractionQaCapability,
  ChatQuery,
  ConvertChatToHotDraft,
  FeedbackQuery,
  HotQuestionDraft,
  HotQuestionQuery,
  HotQuestionUpdateDraft,
  WhitelistQuery,
  WhitelistWordDraft,
  WhitelistWordUpdateDraft,
} from './ai-interaction-qa.js'
import type {
  AiAnalysisQuery,
  AiModelCapability,
  AiModelPageQuery,
  AiModelSaveDraft,
  FlowRuleSaveDraft,
  ModelSelectionSaveDraft,
  QuotaRuleSaveDraft,
  QuotaUsageQuery,
  UsageRecordQuery,
} from './ai-model.js'
import type {
  ModelUsageCapability,
  PersonalApplyDraft,
  PersonalApplyQuery,
  PersonalQuotaQuery,
  PersonalUsageQuery,
} from './model-usage.js'
import type {
  AiPromptCapability,
  IntentDraft,
  IntentQuery,
  SkillConfigInput,
  TipTypeDraft,
  TipTypeQuery,
} from './ai-prompt.js'
import type {
  AiPromptToolCapability,
  BusinessEventAvailableSkillQuery,
  BusinessEventDraft,
  BusinessEventQuery,
  BusinessEventRecordQuery,
  OpenApiRegistryDraft,
  OpenApiRegistryQuery,
} from './ai-prompt-tool.js'
import { CHAT_METHODS, type ChatCapability } from './chat.js'
import { BATCH_SDK_CAPABILITIES, batchMethodName, type BatchCapabilityHost } from './generated/index.js'
import type { CapabilityDefinition } from './types.js'

/** 门面上承载能力的方法组（单用户与多用户门面对这份形状是一致的） */
export type CapabilityHost = {
  batch: BatchCapabilityHost
  meetingRoom: MeetingRoomCapability
  meetingApplication: MeetingApplicationCapabilityWithIdempotency
  attendanceArchive: AttendanceArchiveSheetCapability
  hrPostType: HrPostTypeCapability
  portalDevice: PortalDeviceCapability
  attendanceSheet: AttendanceSheetCapability
  hrOrganizationType: HrOrganizationTypeCapability
  hrOrganizationProperty: HrOrganizationPropertyCapability
  technologyProjectType: TechnologyProjectTypeCapability
  technologyTypeTemplateMapping: TechnologyTypeTemplateMappingCapability
  settingEnterpriseUsage: SettingEnterpriseUsageCapability
  settingSensitiveAction: SettingSensitiveActionCapability
  settingTokenAllocation: SettingTokenAllocationCapability
  technologySettingTemplateBase: TechnologySettingTemplateBaseCapability
  technologySettingTemplate: TechnologySettingTemplateCapability
  financeAccountingPeriod: FinanceAccountingPeriodCapabilityWithIdempotency
  financeAccountingManage: FinanceAccountingManageCapabilityWithIdempotency
  financeLedgerAccounts: FinanceLedgerAccountsCapabilityWithIdempotency
  financeSettingAccuracy: FinanceSettingAccuracyCapabilityWithIdempotency
  financeAllocationIndicator: FinanceAllocationIndicatorCapability
  financeSettingAnnualCarryforward: FinanceSettingAnnualCarryforwardCapability
  financeSettingCatConfig: FinanceSettingCatConfigCapability
  financeSettingCatMap: FinanceSettingCatMapCapability
  financeSettingDateConfig: FinanceSettingDateConfigCapability
  financeSettingMonthlyIncomeTimeConfig: FinanceSettingMonthlyIncomeTimeConfigCapability
  financeSettingProject: FinanceSettingProjectCapability
  financeSettingReceivingAccount: FinanceSettingReceivingAccountCapability
  financeSettingRelatedPartySettlementAccount: FinanceSettingRelatedPartySettlementAccountCapability
  financeSettingSaleAllocationCoefficient: FinanceSettingSaleAllocationCoefficientCapability
  financeSettingAllocationRules: FinanceSettingAllocationRulesCapability
  financeSettingCostCenter: FinanceSettingCostCenterCapability
  financeSettingEmployeeLoanAmount: FinanceSettingEmployeeLoanAmountCapability
  financeSettingInitialManage: FinanceSettingInitialManageCapability
  financeSettingOpeningSupplier: FinanceSettingOpeningSupplierCapabilityWithIdempotency
  financeSettingFeePurpose: FinanceSettingFeePurposeCapability
  financeSettingInventoryAccount: FinanceSettingInventoryAccountCapability
  financeSettingLivestockAmortization: FinanceSettingLivestockAmortizationCapability
  financeSettingSettlementSetting: FinanceSettingSettlementSettingCapability
  financeSettingVoucherTemplates: FinanceSettingVoucherTemplatesCapability
  fundSalaryFundCosts: FundSalaryFundCostsCapability
  fundSalaryFundProcess: FundSalaryFundProcessCapability
  insuranceSalaryInsuranceCosts: InsuranceSalaryInsuranceCostsCapability
  insuranceSalaryInsuranceProcess: InsuranceSalaryInsuranceProcessCapability
  manageCostCenter: ManageCostCenterCapability
  salaryItem: SalaryItemCapability
  mePayRoll: MePayRollCapability
  platformCategoryDict: PlatformCategoryDictCapability
  orgCorporation: OrgCorporationCapability
  hrOrganizationSetting: HrOrganizationSettingCapability
  hrOrganizationChart: HrOrganizationChartCapability
  hrTransferInPlan: HrTransferInPlanCapability
  platformSystemCustom: PlatformSystemCustomCapability
  platformSystemSecurityConfig: PlatformSystemSecurityConfigCapability
  platformSystemQueueStorage: PlatformSystemQueueStorageCapability
  platformSystemEmail: PlatformSystemEmailCapability
  platformSystemQueueExport: PlatformSystemQueueExportCapability
  platformSystemQueueFailed: PlatformSystemQueueFailedCapability
  platformSystemQueueMysql: PlatformSystemQueueMysqlCapability
  platformSystemSchedule: PlatformSystemScheduleCapability
  reportBankPay: ReportBankPayCapability
  reportBankSummary: ReportBankSummaryCapability
  reportCenterInsurance: ReportCenterInsuranceCapability
  reportCostCenterSalary: ReportCostCenterSalaryCapability
  reportDepartmentSalaryDetail: ReportDepartmentSalaryDetailCapability
  reportDepartmentSalary: ReportDepartmentSalaryCapability
  reportFundPaymentSummary: ReportFundPaymentSummaryCapability
  reportInsurancePaymentSummary: ReportInsurancePaymentSummaryCapability
  reportPersonTax: ReportPersonTaxCapability
  reportPostSalary: ReportPostSalaryCapability
  reportConfiguration: ReportConfigurationCapability
  reportStandardUnitInsurance: ReportStandardUnitInsuranceCapability
  reportRetirementSalarySummary: ReportRetirementSalarySummaryCapability
  reportTemporarySalarySummary: ReportTemporarySalarySummaryCapability
  reportTemporarySalary: ReportTemporarySalaryCapability
  reportRetirementSalary: ReportRetirementSalaryCapability
  reportSalaryBill: ReportSalaryBillCapability
  reportSalaryCost: ReportSalaryCostCapability
  reportLaborCostAllocation: ReportLaborCostAllocationCapability
  reportLeadershipProfitSalary: ReportLeadershipProfitSalaryCapability
  reportUnitInterferenceCostAllocation: ReportUnitInterferenceCostAllocationCapability
  reportSalaryItem: ReportSalaryItemCapability
  salaryProcess: SalaryProcessCapability
  salaryAccounting: SalaryAccountingCapability
  salaryPackage: SalaryPackageCapability
  salaryAdjustImport: SalaryAdjustImportCapability
  salaryPersonTaxFile: SalaryPersonTaxFileCapability
  salaryPersonTaxHandle: SalaryPersonTaxHandleCapability
  salaryPersonTax: SalaryPersonTaxCapability
  salaryLevel: SalaryLevelCapability
  settingCategoryDict: SettingCategoryDictCapability
  saleSettingDict: SaleSettingDictCapability
  saleSysDict: SaleSysDictCapability
  saleServiceSubject: SaleServiceSubjectCapability
  saleCcbAccount: SaleCcbAccountCapability
  salePaymentAccount: SalePaymentAccountCapability
  saleSysOffice: SaleSysOfficeCapability
  saleSysUser: SaleSysUserCapability
  saleClaimSetting: SaleClaimSettingCapability
  saleOldChickenSale: SaleOldChickenSaleCapability
  salePriceControl: SalePriceControlCapability
  saleLowPrice: SaleLowPriceCapability
  saleTradeStoreroom: SaleTradeStoreroomCapability
  saleScheduleJob: SaleScheduleJobCapability
  saleScheduleJobLog: SaleScheduleJobLogCapability
  saleRegisterCode: SaleRegisterCodeCapability
  settingDictPlatform: SettingDictPlatformCapability
  platformDictMall: PlatformDictMallCapability
  platformDictMallCommon: PlatformDictMallCapability
  platformDictMallFinance: PlatformDictMallCapability
  platformDictMallHr: PlatformDictMallCapability
  platformDictMallMaterial: PlatformDictMallCapability
  platformDictMallProduct: PlatformDictMallCapability
  platformDictMallSale: PlatformDictMallCapability
  platformDictMallSupply: PlatformDictMallCapability
  settingFrontendLog: SettingFrontendLogCapability
  settingMaterial: SettingMaterialCapability
  settingMenu: SettingMenuCapability
  settingSupplier: SettingSupplierCapability
  settingSystemAccountingParameters: SettingSystemAccountingParametersCapability
  systemIntegration: SystemIntegrationCapability
  settingRolePost: SettingRolePostCapability
  settingRole: SettingRoleCapabilityWithIdempotency
  settingUser: SettingUserCapability
  hrExternalStaff: HrExternalStaffCapability
  hrInternalStaff: HrInternalStaffCapability
  historyArchive: HistoryArchiveCapability
  meOrganization: MeOrganizationCapability
  mePersonal: MePersonalCapability
  recruitmentPlan: RecruitmentPlanCapability
  myTodoUrge: MyTodoUrgeCapability
  myUrge: MyUrgeCapability
  contractCodeRule: ContractCodeRuleCapability
  supplyPersonnelConfig: SupplyPersonnelConfigCapability
  inventoryOrganizationConfig: InventoryOrganizationConfigCapability
  inventoryAssetDepreciationConfig: InventoryAssetDepreciationConfigCapability
  inventoryStockRule: InventoryStockRuleCapability
  inventoryStockLocation: InventoryStockLocationCapability
  inventoryApprovalConfig: InventoryApprovalConfigCapability
  inventoryAssetStocktakingConfig: InventoryAssetStocktakingConfigCapability
  inventoryAssetBatchConfig: InventoryAssetBatchConfigCapability
  inventoryValuation: InventoryValuationCapability
  platformRuleManagement: PlatformRuleManagementCapability
  hrPostSetting: HrPostSettingCapability
  productHighProductionUsage: ProductHighProductionUsageCapability
  productStableProductionUsage: ProductStableProductionUsageCapability
  productPreventionUsageAnalysis: ProductPreventionUsageAnalysisCapability
  productUserAnalysis: ProductUserAnalysisCapability
  productNoticeConfig: ProductNoticeConfigCapability
  productProgramLibrary: ProductProgramLibraryCapability
  productProgramLibraryNew: ProductProgramLibraryCapability
  productSettingMaterial: ProductSettingMaterialCapability
  productSettingMedicine: ProductSettingMedicineCapability
  productSettingUserDict: ProductSettingUserDictCapability
  productSettingVaccine: ProductSettingVaccineCapability
  productSettingAntibody: ProductSettingAntibodyCapability
  productSettingChickenProduction: ProductSettingChickenProductionCapability
  productSettingEggStandardAgeStage: ProductSettingEggStandardAgeStageCapability
  productSettingEpidemicPreventionCost: ProductSettingEpidemicPreventionCostCapability
  productSettingHatchAnnualMonthly: ProductSettingHatchAnnualMonthlyCapability
  productSettingStandardBroiler: ProductSettingStandardBroilerCapability
  productSettingStandardFlockWeek: ProductSettingStandardFlockWeekCapability
  productSettingStandardFlock: ProductSettingStandardFlockCapability
  productSettingStandardHatch: ProductSettingStandardHatchCapability
  productSettingBatchStatus: ProductSettingBatchStatusCapability
  productSettingConfigure: ProductSettingConfigureCapability
  productSettingDayLiquidation: ProductSettingDayLiquidationCapability
  productSettingFunctionUse: ProductSettingFunctionUseCapability
  productSettingMaterialMaster: ProductSettingMaterialMasterCapability
  productSettingHatchManageLib: ProductSettingHatchManageLibCapability
  productBusinessAgeDivision: ProductBusinessAgeDivisionCapability
  productBusinessDataRetransmit: ProductBusinessDataRetransmitCapability
  productBusinessSetupMaterialCode: ProductBusinessSetupMaterialCodeCapability
  productHatcheryLib: ProductHatcheryLibCapability
  productHatcheryMethod: ProductHatcheryMethodCapability
  productHatcheryMethodLib: ProductHatcheryMethodLibCapability
  productHatcheryMethodLibIndicator: ProductHatcheryMethodLibIndicatorCapability
  productHatcheryStandardIndicator: ProductHatcheryStandardIndicatorCapability
  productHatcheryUnit: ProductHatcheryUnitCapability
  productPlanPreview: ProductPlanPreviewCapability
  saleCustomQr: SaleCustomQrCapability
  settingDictPlatformFinance: SettingDictPlatformFinanceCapability
  settingDictPlatformCommon: SettingDictPlatformCommonCapability
  settingDictPlatformHr: SettingDictPlatformHrCapability
  settingDictPlatformMaterial: SettingDictPlatformMaterialCapability
  settingDictPlatformProduct: SettingDictPlatformProductCapability
  settingDictPlatformSupply: SettingDictPlatformSupplyCapability
  settingDictPlatformSale: SettingDictPlatformSaleCapability
  saleVisitRecommendSetting: SaleVisitRecommendSettingCapability
  productSettingHatchManageMethodLib: ProductSettingHatchManageMethodLibCapability
  productSettingHatchMethodLibIndicator: ProductSettingHatchMethodLibIndicatorCapability
  productSettingHatchManageMethod: ProductSettingHatchManageMethodCapability
  productSettingHatchManageSeason: ProductSettingHatchManageSeasonCapability
  productSettingIndicatorLib: ProductSettingIndicatorLibCapability
  productSettingMethodLib: ProductSettingMethodLibCapability
  productSettingSeason: ProductSettingSeasonCapability
  productSettingHatchManageUnit: ProductSettingHatchManageUnitCapability
  productSettingHatchManageVariety: ProductSettingHatchManageVarietyCapability
  productSettingTenantLog: ProductSettingTenantLogCapability
  attendanceStatistics: AttendanceStatisticsCapability
  attendanceAnnualLeave: AttendanceAnnualLeaveCapability
  attendanceException: AttendanceExceptionCapability
  attendanceSchedualInformation: AttendanceSchedualInformationCapability
  certificateLicense: CertificateLicenseCapability
  certificateType: CertificateTypeCapability
  institutionType: InstitutionTypeCapability
  piece: PieceCapability
  businessRegistration: BusinessRegistrationCapability
  companyPolicy: CompanyPolicyCapability
  honor: HonorCapability
  legalDispute: LegalDisputeCapability
  qualification: QualificationCapability
  patent: PatentCapability
  software: SoftwareCapability
  standardDocument: StandardDocumentCapability
  trademark: TrademarkCapability
  attendanceOvertime: AttendanceOvertimeCapability
  assignment: AssignmentCapabilityWithIdempotency
  attendanceShift: AttendanceShiftCapabilityWithIdempotency
  attendanceTeam: AttendanceTeamCapabilityWithIdempotency
  backlogTaskExamine: BacklogTaskExamineCapability
  baseImage: BaseImageCapabilityWithIdempotency
  baseManagementCenter: BaseManagementCenterCapabilityWithIdempotency
  contractTemplate: ContractTemplateCapabilityWithIdempotency
  contractLibrary: ContractLibraryCapability
  contractCreate: ContractCreateCapabilityWithIdempotency
  /**
   * 基础数据（部门 / 字典 / 权限清单）。**不是页面能力**：它的 pagePath 是合成的
   * `/base-data/*`，只用来给请求一个页面上下文，不指向任何菜单。
   */
  baseData: BaseDeptDictPermissionCapability
  /**
   * 上传（OSS 直传）。**不是页面能力**，`pagePath` 是哨兵值 `common/utils/oss.js`。
   *
   * 凭据在**建 SDK 时**由调用方给（`PortalHeadlessConfig.oss`）；没给也能建，
   * 但真去 `upload`/`getAcl`/`putAcl` 时会在发请求之前失败关闭。
   */
  baseUpload: BaseUploadCapability
  /**
   * **应用外壳**：用户信息 / 人员候选 / 待办与角标 / 可见菜单 / 工作台卡片。
   * 同样是基础能力（合成路径 `/base-data/*`），不是页面能力。
   */
  baseShell: BaseShellCapability
  /** 通用审批（流程表单线第一条，见 docs/pages/通用审批.md）；`submit` 带防重 */
  generalApproval: GeneralApprovalCapabilityWithIdempotency
  /** 租户/企业上下文（基础能力，合成路径 `/base-data/*`） */
  baseTenant: BaseTenantCapability
  /**
   * 销售域基础数据（店铺 / 地区 / 厂商 / 品牌 / 首页提示）。
   *
   * ⚠️ 它打的是 **`sale` 实例**（同 host 不同前缀）。没配 `httpBaseUrls.sale` 时
   * 每个方法抛 `SaleNotWiredError` —— 与 conventions 第 27 条一致：失败关闭，不拿默认 baseURL 去凑。
   */
  baseSale: BaseSaleCapability
  /** 请假申请（流程表单线第二条，见 docs/pages/请假申请.md）；`submit` 带防重 */
  leaveApplication: LeaveApplicationCapabilityWithIdempotency
  /** 用车申请（流程表单线第三条，见 docs/pages/用车申请.md）；`submit` 带防重 */
  vehicleApplication: VehicleApplicationCapabilityWithIdempotency
  /** 差旅费支出申请表（流程表单线第四条，见 docs/pages/差旅费报销.md）；`submit` 带防重 */
  travelExpense: TravelExpenseCapabilityWithIdempotency
  /** 已有业务所需的候选与内部法人开户只读查询。 */
  contractSupport: ContractSupport
  /** 产品设计文档审核（流程表单线第五条，见 docs/pages/产品设计文档审核.md）；`submit` 带防重 */
  productDesignApproval: ProductDesignApprovalCapabilityWithIdempotency
  /**
   * **待办办理（横切能力）**：以审批人的身份办理待办——通过 / 驳回 / 转办 / 委派 / 回退 / 批量办理。
   * 见 `docs/pages/待办办理.md`。
   *
   * ⚠️ 七个写能力都带防重：办理天然不该重放（重复通过/驳回的语义很糟）。
   */
  taskAction: TaskActionCapabilityWithIdempotency
  /** 加班审批（流程表单线第六条，见 docs/pages/加班申请.md）；`submit` 带防重 */
  overtimeApplication: OvertimeApplicationCapabilityWithIdempotency
  /** 调休审批（流程表单线第七条，见 docs/pages/调休申请.md）；`submit` 带防重 */
  restLeaveApplication: RestLeaveApplicationCapabilityWithIdempotency
  /** 出差申请（流程表单线第八条，见 docs/pages/出差申请.md）；`submit` 带防重 */
  businessTripApplication: BusinessTripApplicationCapabilityWithIdempotency
  /** 课程管理三页（页面队列，见 docs/pages/图文课程.md）；三个都是只读 */
  studyCourse: StudyCourseCapability
  /** 学员管理（学习管理域·基础数据）；只读 */
  studyStudent: StudyStudentCapability
  /** 班级管理（学习能力域·课堂管理）；只读 */
  studyGrade: StudyGradeCapability
  /** 课堂三页（晨/周/月）；只读 */
  studyLesson: StudyLessonCapability
  /** 学习管理（学习记录列表）；只读 */
  studyRecord: StudyRecordCapability
  /** 数据统计五页；只读 */
  studyStatistics: StudyStatisticsCapability
  /** 讲师三页（讲师管理 / 讲师类型 / 评价设置）——前两页走 smart-layer-admin 实例；只读 */
  studyTeacher: StudyTeacherCapability
  /** 绩效·协议类五页（状态变更 / 个人月度 / 所辖月度 / 个人年度 / 所辖年度）；只读 */
  perfAgreement: PerfAgreementCapability
  /** 绩效·配置类六页（公式配置 / 指标管理 / 五险一金 / 标准管理 / 时间节点 / 考核规则）；只读 */
  perfManageConfig: PerfManageConfigCapability
  /** 绩效·模板/任务类六页（利润管理 / 薪资结构 / 模板内容 / 模板结构 / 学习任务配置 / 任务类型配置）；只读 */
  perfManageTemplate: PerfManageTemplateCapability
  /** 绩效·薪酬与分析六页（奖励导入 / 工资找齐 / 考核导入 / 组件管理 / 管理分析 / 个人分析）；含写 */
  perfSalary: PerfSalaryCapabilityWithIdempotency
  /** 审批管理·任务四页（发起流程 / 待办任务 / 已办任务 / 抄送我的）；只读 */
  flowTask: FlowTaskCapability
  /** 审批管理·流程管理四页（流程模型 / AI审核配置 / 流程实例 / 流程任务）；只读 */
  flowManage: FlowManageCapability
  /** 人工智能·知识管理两页（知识空间 / 知识审核）；**含写**（新建/改名/移动/删除/设权限/审核） */
  aiKnowledge: AiKnowledgeCapability
  /** 人工智能·智能交互「问答」四页（热门问题 / 交互历史 / 敏感词 / 意见反馈）；**含写** */
  aiInteractionQa: AiInteractionQaCapability
  /**
   * 人工智能·智能交互「模型与用量」四页（模型列表 / 模型选择 / 平台用量 / 数据分析）。
   *
   * **含写**，而且这些写**会影响真人的额度与限流**（`ruleScope=1` 是全局兜底），
   * 见 `docs/pages/模型列表.md`。读能力里有几条是**本地过滤**（`keyword` 不减少请求量）。
   */
  aiModel: AiModelCapability
  /** 人工智能·个人用量页面；固定个人统计维度，含额度申请写入口。 */
  modelUsage: ModelUsageCapability
  /** 人工智能·提示工程「基础」三页（提示词类型 / 技能列表 / 意图列表）；**含写** */
  aiPrompt: AiPromptCapability
  /**
   * 人工智能·提示工程「工具绑定」三页（业务事件绑定技能 / 开放接口 / 工具提示词绑定）；**含写**。
   *
   * ⚠️ 它是**嵌套命名空间**（`businessEvent` / `openApiRegistry` / `templateBinding`），
   * 所以 `sdkPath` 是**三层**（`aiPromptTool.businessEvent.list`）。
   */
  aiPromptTool: AiPromptToolCapability
  chat: ChatCapability
}

/** `invoke()` 的参数：键就是 `describe().params[].name`，写操作另加 `requestId` */
export type CapabilityInvokeArgs = Record<string, unknown>

function requireRequestId (args: CapabilityInvokeArgs, capabilityId: string): string {
  const requestId = args.requestId
  if (typeof requestId !== 'string' || requestId.trim() === '') {
    throw new CapabilityInvokeError(
      `${capabilityId} 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，超时重试时原样传回上一次那个）。`,
      capabilityId,
    )
  }
  return requestId
}

type CapabilityBinding = {
  capabilityId: string
  /** 手写路径：门面上的方法位置。给人看，也用来核对"两种入口是同一份实现" */
  sdkPath: string
  run: (host: CapabilityHost, args: CapabilityInvokeArgs) => Promise<unknown>
}

/**
 * 能力 ID → 执行绑定。**这是唯一的一份表**：
 * `describe().invoke.sdkPath` 与 `capabilities.invoke()` 都从它读。
 */
function productProgramLibraryBindings (
  namespace: 'productProgramLibrary' | 'productProgramLibraryNew',
  methods: Record<string, string>,
): CapabilityBinding[] {
  return Object.entries(methods).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `${namespace}.${method}`,
    run: (host, args) => {
      const fn = (host[namespace] as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`程序库调用方法不存在：${namespace}.${method}`)
      return Promise.resolve(fn.call(host[namespace], args))
    },
  }))
}

function capabilityMethodBindings (
  namespace: keyof CapabilityHost,
  methods: Record<string, string>,
  label: string,
): CapabilityBinding[] {
  return Object.entries(methods).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `${String(namespace)}.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const capability = host[namespace] as unknown as Record<string, (input?: unknown) => unknown>
      const fn = capability[method]
      if (typeof fn !== 'function') throw new Error(`${label}调用方法不存在：${String(namespace)}.${method}`)
      return Promise.resolve(args === undefined ? fn.call(capability) : fn.call(capability, args))
    },
  }))
}

function batchCapabilityBindings (): CapabilityBinding[] {
  return BATCH_SDK_CAPABILITIES.map((definition) => {
    const method = batchMethodName(definition.id)
    return {
      capabilityId: definition.id,
      sdkPath: `batch.${method}.list`,
      run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
        const capability = host.batch[method]
        if (capability === undefined) throw new Error(`批量列表调用方法不存在：batch.${method}.list`)
        return capability.list(args as Parameters<typeof capability.list>[0])
      },
    }
  })
}

export const CAPABILITY_BINDINGS: readonly CapabilityBinding[] = [
  { capabilityId: 'hr-post-type-list', sdkPath: 'hrPostType.list', run: (host, args) => host.hrPostType.list(args as Parameters<HrPostTypeCapability['list']>[0]) },
  { capabilityId: 'hr-post-type-get', sdkPath: 'hrPostType.get', run: (host, args) => host.hrPostType.get(args as Parameters<HrPostTypeCapability['get']>[0]) },
  { capabilityId: 'hr-post-type-create', sdkPath: 'hrPostType.create', run: (host, args) => host.hrPostType.create(args as Parameters<HrPostTypeCapability['create']>[0]) },
  { capabilityId: 'hr-post-type-update', sdkPath: 'hrPostType.update', run: (host, args) => host.hrPostType.update(args as Parameters<HrPostTypeCapability['update']>[0]) },
  { capabilityId: 'hr-post-type-prepare-remove', sdkPath: 'hrPostType.prepareRemove', run: (host, args) => host.hrPostType.prepareRemove(args as Parameters<HrPostTypeCapability['prepareRemove']>[0]) },
  { capabilityId: 'hr-post-type-send-delete-code', sdkPath: 'hrPostType.sendDeleteCode', run: (host, args) => host.hrPostType.sendDeleteCode(args as Parameters<HrPostTypeCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'hr-post-type-remove', sdkPath: 'hrPostType.remove', run: (host, args) => host.hrPostType.remove(args as Parameters<HrPostTypeCapability['remove']>[0]) },
  { capabilityId: 'portal-device-list', sdkPath: 'portalDevice.list', run: (host, args) => host.portalDevice.list() },
  { capabilityId: 'portal-device-count', sdkPath: 'portalDevice.getCount', run: (host, args) => host.portalDevice.getCount() },
  { capabilityId: 'portal-device-prepare-remove', sdkPath: 'portalDevice.prepareRemove', run: (host, args) => host.portalDevice.prepareRemove(args.targetDeviceCode as Parameters<PortalDeviceCapability['prepareRemove']>[0]) },
  { capabilityId: 'portal-device-remove', sdkPath: 'portalDevice.remove', run: (host, args) => host.portalDevice.remove(args.targetDeviceCode as Parameters<PortalDeviceCapability['remove']>[0]) },

  { capabilityId: 'hr-organization-type-list', sdkPath: 'hrOrganizationType.list', run: (host, args) => host.hrOrganizationType.list(args as Parameters<HrOrganizationTypeCapability['list']>[0]) },
  { capabilityId: 'hr-organization-type-create', sdkPath: 'hrOrganizationType.create', run: (host, args) => host.hrOrganizationType.create(args as Parameters<HrOrganizationTypeCapability['create']>[0]) },
  { capabilityId: 'hr-organization-type-prepare-remove', sdkPath: 'hrOrganizationType.prepareRemove', run: (host, args) => host.hrOrganizationType.prepareRemove(args as Parameters<HrOrganizationTypeCapability['prepareRemove']>[0]) },
  { capabilityId: 'hr-organization-type-send-delete-code', sdkPath: 'hrOrganizationType.sendDeleteCode', run: (host, args) => host.hrOrganizationType.sendDeleteCode(args as Parameters<HrOrganizationTypeCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'hr-organization-type-remove', sdkPath: 'hrOrganizationType.remove', run: (host, args) => host.hrOrganizationType.remove(args as Parameters<HrOrganizationTypeCapability['remove']>[0]) },
  { capabilityId: 'hr-organization-property-list', sdkPath: 'hrOrganizationProperty.list', run: (host, args) => host.hrOrganizationProperty.list(args as Parameters<HrOrganizationPropertyCapability['list']>[0]) },
  { capabilityId: 'hr-organization-property-create', sdkPath: 'hrOrganizationProperty.create', run: (host, args) => host.hrOrganizationProperty.create(args as Parameters<HrOrganizationPropertyCapability['create']>[0]) },
  { capabilityId: 'hr-organization-property-deactivate', sdkPath: 'hrOrganizationProperty.deactivate', run: (host, args) => host.hrOrganizationProperty.deactivate(args as Parameters<HrOrganizationPropertyCapability['deactivate']>[0]) },
  { capabilityId: 'hr-organization-property-enable', sdkPath: 'hrOrganizationProperty.enable', run: (host, args) => host.hrOrganizationProperty.enable(args as Parameters<HrOrganizationPropertyCapability['enable']>[0]) },
  { capabilityId: 'technology-project-type-list', sdkPath: 'technologyProjectType.list', run: (host, args) => host.technologyProjectType.list(args as Parameters<TechnologyProjectTypeCapability['list']>[0]) },
  { capabilityId: 'technology-project-type-prepare-create', sdkPath: 'technologyProjectType.prepareCreate', run: async (host, args) => host.technologyProjectType.prepareCreate(args as Parameters<TechnologyProjectTypeCapability['prepareCreate']>[0]) },
  { capabilityId: 'technology-project-type-prepare-update', sdkPath: 'technologyProjectType.prepareUpdate', run: async (host, args) => host.technologyProjectType.prepareUpdate(args as Parameters<TechnologyProjectTypeCapability['prepareUpdate']>[0]) },
  { capabilityId: 'technology-project-type-create', sdkPath: 'technologyProjectType.create', run: (host, args) => host.technologyProjectType.create(args as Parameters<TechnologyProjectTypeCapability['create']>[0]) },
  { capabilityId: 'technology-project-type-update', sdkPath: 'technologyProjectType.update', run: (host, args) => host.technologyProjectType.update(args as Parameters<TechnologyProjectTypeCapability['update']>[0]) },
  { capabilityId: 'technology-project-type-remove', sdkPath: 'technologyProjectType.remove', run: (host, args) => host.technologyProjectType.remove(args.id as Parameters<TechnologyProjectTypeCapability['remove']>[0]) },
  ...capabilityMethodBindings('technologyTypeTemplateMapping', TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS, '类型模板映射'),
  ...capabilityMethodBindings('settingEnterpriseUsage', SETTING_ENTERPRISE_USAGE_METHODS, '企业用量'),
  ...capabilityMethodBindings('settingSensitiveAction', SETTING_SENSITIVE_ACTION_METHODS, '安全验证'),
  ...capabilityMethodBindings('settingTokenAllocation', SETTING_TOKEN_ALLOCATION_METHODS, '用量分配'),
  ...capabilityMethodBindings('technologySettingTemplateBase', TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS, '模板基础配置'),
  ...capabilityMethodBindings('technologySettingTemplate', TECHNOLOGY_SETTING_TEMPLATE_METHODS, '模板中心'),
  { capabilityId: 'finance-accounting-period-list', sdkPath: 'financeAccountingPeriod.list', run: (host, args) => host.financeAccountingPeriod.list(args as Parameters<FinanceAccountingPeriodCapabilityWithIdempotency['list']>[0]) },
  { capabilityId: 'finance-accounting-period-detail', sdkPath: 'financeAccountingPeriod.detail', run: async (host, args) => host.financeAccountingPeriod.detail(args as Parameters<FinanceAccountingPeriodCapabilityWithIdempotency['detail']>[0]) },
  { capabilityId: 'finance-accounting-period-prepare-create', sdkPath: 'financeAccountingPeriod.prepareCreate', run: async (host, args) => host.financeAccountingPeriod.prepareCreate(args as Parameters<FinanceAccountingPeriodCapabilityWithIdempotency['prepareCreate']>[0]) },
  { capabilityId: 'finance-accounting-period-create', sdkPath: 'financeAccountingPeriod.createIdempotent', run: (host, args) => host.financeAccountingPeriod.createIdempotent(args as Parameters<FinanceAccountingPeriodCapabilityWithIdempotency['createIdempotent']>[0]) },
  { capabilityId: 'finance-accounting-period-set-status', sdkPath: 'financeAccountingPeriod.setStatus', run: (host, args) => host.financeAccountingPeriod.setStatus(args as Parameters<FinanceAccountingPeriodCapabilityWithIdempotency['setStatus']>[0]) },
  { capabilityId: 'finance-accounting-manage-list', sdkPath: 'financeAccountingManage.list', run: (host, args) => host.financeAccountingManage.list(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['list']>[0]) },
  { capabilityId: 'finance-accounting-manage-detail', sdkPath: 'financeAccountingManage.detail', run: async (host, args) => host.financeAccountingManage.detail(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['detail']>[0]) },
  { capabilityId: 'finance-accounting-manage-export', sdkPath: 'financeAccountingManage.exportExcel', run: (host, args) => host.financeAccountingManage.exportExcel(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['exportExcel']>[0]) },
  { capabilityId: 'finance-accounting-manage-corporation-search', sdkPath: 'financeAccountingManage.searchCorporations', run: (host, args) => host.financeAccountingManage.searchCorporations(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['searchCorporations']>[0]) },
  { capabilityId: 'finance-accounting-manage-accounting-standards-options', sdkPath: 'financeAccountingManage.accountingStandardsOptions', run: (host) => host.financeAccountingManage.accountingStandardsOptions() },
  { capabilityId: 'finance-accounting-manage-accounting-period-options', sdkPath: 'financeAccountingManage.accountingPeriodOptions', run: (host, args) => host.financeAccountingManage.accountingPeriodOptions(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['accountingPeriodOptions']>[0]) },
  { capabilityId: 'finance-accounting-manage-accuracy-options', sdkPath: 'financeAccountingManage.accuracyOptions', run: (host) => host.financeAccountingManage.accuracyOptions() },
  { capabilityId: 'finance-accounting-manage-user-search', sdkPath: 'financeAccountingManage.searchUsers', run: (host, args) => host.financeAccountingManage.searchUsers(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['searchUsers']>[0]) },
  { capabilityId: 'finance-accounting-manage-prepare-create', sdkPath: 'financeAccountingManage.prepareCreate', run: async (host, args) => host.financeAccountingManage.prepareCreate(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['prepareCreate']>[0]) },
  { capabilityId: 'finance-accounting-manage-create', sdkPath: 'financeAccountingManage.createIdempotent', run: (host, args) => host.financeAccountingManage.createIdempotent(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['createIdempotent']>[0]) },
  { capabilityId: 'finance-accounting-manage-set-status', sdkPath: 'financeAccountingManage.setStatus', run: (host, args) => host.financeAccountingManage.setStatus(args as Parameters<FinanceAccountingManageCapabilityWithIdempotency['setStatus']>[0]) },
  { capabilityId: 'finance-ledger-account-organization-search', sdkPath: 'financeLedgerAccounts.searchOrganizations', run: (host, args) => host.financeLedgerAccounts.searchOrganizations(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['searchOrganizations']>[0]) },
  { capabilityId: 'finance-ledger-account-list', sdkPath: 'financeLedgerAccounts.list', run: (host, args) => host.financeLedgerAccounts.list(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['list']>[0]) },
  { capabilityId: 'finance-ledger-account-detail', sdkPath: 'financeLedgerAccounts.detail', run: async (host, args) => host.financeLedgerAccounts.detail(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['detail']>[0]) },
  { capabilityId: 'finance-ledger-account-prepare-create', sdkPath: 'financeLedgerAccounts.prepareCreate', run: async (host, args) => host.financeLedgerAccounts.prepareCreate(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['prepareCreate']>[0]) },
  { capabilityId: 'finance-ledger-account-create', sdkPath: 'financeLedgerAccounts.createIdempotent', run: (host, args) => host.financeLedgerAccounts.createIdempotent(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['createIdempotent']>[0]) },
  { capabilityId: 'finance-ledger-account-set-status', sdkPath: 'financeLedgerAccounts.setStatus', run: (host, args) => host.financeLedgerAccounts.setStatus(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['setStatus']>[0]) },
  { capabilityId: 'finance-ledger-account-export', sdkPath: 'financeLedgerAccounts.export', run: (host, args) => host.financeLedgerAccounts.export(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['export']>[0]) },
  { capabilityId: 'finance-ledger-account-download-template', sdkPath: 'financeLedgerAccounts.downloadTemplate', run: (host) => host.financeLedgerAccounts.downloadTemplate() },
  { capabilityId: 'finance-ledger-account-prepare-import', sdkPath: 'financeLedgerAccounts.prepareImport', run: async (host, args) => host.financeLedgerAccounts.prepareImport(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['prepareImport']>[0]) },
  { capabilityId: 'finance-ledger-account-import', sdkPath: 'financeLedgerAccounts.importIdempotent', run: (host, args) => host.financeLedgerAccounts.importIdempotent(args as Parameters<FinanceLedgerAccountsCapabilityWithIdempotency['importIdempotent']>[0]) },
  { capabilityId: 'finance-setting-accuracy-list', sdkPath: 'financeSettingAccuracy.list', run: (host, args) => host.financeSettingAccuracy.list(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['list']>[0]) },
  { capabilityId: 'finance-setting-accuracy-get', sdkPath: 'financeSettingAccuracy.get', run: (host, args) => host.financeSettingAccuracy.get(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['get']>[0]) },
  { capabilityId: 'finance-setting-accuracy-prepare-create', sdkPath: 'financeSettingAccuracy.prepareCreate', run: async (host, args) => host.financeSettingAccuracy.prepareCreate(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-accuracy-create', sdkPath: 'financeSettingAccuracy.createIdempotent', run: (host, args) => host.financeSettingAccuracy.createIdempotent(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['createIdempotent']>[0]) },
  { capabilityId: 'finance-setting-accuracy-prepare-update', sdkPath: 'financeSettingAccuracy.prepareUpdate', run: async (host, args) => host.financeSettingAccuracy.prepareUpdate(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-accuracy-update', sdkPath: 'financeSettingAccuracy.update', run: (host, args) => host.financeSettingAccuracy.update(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['update']>[0]) },
  { capabilityId: 'finance-setting-accuracy-set-status', sdkPath: 'financeSettingAccuracy.setStatus', run: (host, args) => host.financeSettingAccuracy.setStatus(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['setStatus']>[0]) },
  { capabilityId: 'finance-setting-accuracy-remove', sdkPath: 'financeSettingAccuracy.remove', run: (host, args) => host.financeSettingAccuracy.remove(args as Parameters<FinanceSettingAccuracyCapabilityWithIdempotency['remove']>[0]) },
  { capabilityId: 'finance-allocation-indicator-list', sdkPath: 'financeAllocationIndicator.list', run: (host, args) => host.financeAllocationIndicator.list(args as Parameters<FinanceAllocationIndicatorCapability['list']>[0]) },
  { capabilityId: 'finance-allocation-indicator-set-status', sdkPath: 'financeAllocationIndicator.setStatus', run: (host, args) => host.financeAllocationIndicator.setStatus(args as Parameters<FinanceAllocationIndicatorCapability['setStatus']>[0]) },
  ...Object.entries(FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `financeSettingAnnualCarryforward.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.financeSettingAnnualCarryforward as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`年度账结转调用方法不存在：financeSettingAnnualCarryforward.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.financeSettingAnnualCarryforward) : fn.call(host.financeSettingAnnualCarryforward, args))
    },
  })),
  { capabilityId: 'finance-setting-cat-config-list', sdkPath: 'financeSettingCatConfig.list', run: (host) => host.financeSettingCatConfig.list() },
  { capabilityId: 'finance-setting-cat-config-detail', sdkPath: 'financeSettingCatConfig.detail', run: async (host, args) => host.financeSettingCatConfig.detail(args as Parameters<FinanceSettingCatConfigCapability['detail']>[0]) },
  { capabilityId: 'finance-setting-cat-config-prepare-create', sdkPath: 'financeSettingCatConfig.prepareCreate', run: async (host, args) => host.financeSettingCatConfig.prepareCreate(args as Parameters<FinanceSettingCatConfigCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-cat-config-create', sdkPath: 'financeSettingCatConfig.create', run: (host, args) => host.financeSettingCatConfig.create(args as Parameters<FinanceSettingCatConfigCapability['create']>[0]) },
  { capabilityId: 'finance-setting-cat-config-prepare-update', sdkPath: 'financeSettingCatConfig.prepareUpdate', run: async (host, args) => host.financeSettingCatConfig.prepareUpdate(args as Parameters<FinanceSettingCatConfigCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-cat-config-update', sdkPath: 'financeSettingCatConfig.update', run: (host, args) => host.financeSettingCatConfig.update(args as Parameters<FinanceSettingCatConfigCapability['update']>[0]) },
  { capabilityId: 'finance-setting-cat-config-prepare-discard', sdkPath: 'financeSettingCatConfig.prepareDiscard', run: async (host, args) => host.financeSettingCatConfig.prepareDiscard(args as Parameters<FinanceSettingCatConfigCapability['prepareDiscard']>[0]) },
  { capabilityId: 'finance-setting-cat-config-discard', sdkPath: 'financeSettingCatConfig.discard', run: (host, args) => host.financeSettingCatConfig.discard(args as Parameters<FinanceSettingCatConfigCapability['discard']>[0]) },
  { capabilityId: 'finance-setting-cat-map-finance-category-search', sdkPath: 'financeSettingCatMap.searchFinanceCategories', run: (host, args) => host.financeSettingCatMap.searchFinanceCategories(args as Parameters<FinanceSettingCatMapCapability['searchFinanceCategories']>[0]) },
  { capabilityId: 'finance-setting-cat-map-thing-category-search', sdkPath: 'financeSettingCatMap.searchThingCategories', run: (host, args) => host.financeSettingCatMap.searchThingCategories(args as Parameters<FinanceSettingCatMapCapability['searchThingCategories']>[0]) },
  { capabilityId: 'finance-setting-cat-map-list', sdkPath: 'financeSettingCatMap.list', run: (host) => host.financeSettingCatMap.list() },
  { capabilityId: 'finance-setting-cat-map-prepare-create', sdkPath: 'financeSettingCatMap.prepareCreate', run: async (host, args) => host.financeSettingCatMap.prepareCreate(args as Parameters<FinanceSettingCatMapCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-cat-map-create', sdkPath: 'financeSettingCatMap.create', run: (host, args) => host.financeSettingCatMap.create(args as Parameters<FinanceSettingCatMapCapability['create']>[0]) },
  { capabilityId: 'finance-setting-cat-map-prepare-update', sdkPath: 'financeSettingCatMap.prepareUpdate', run: async (host, args) => host.financeSettingCatMap.prepareUpdate(args as Parameters<FinanceSettingCatMapCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-cat-map-update', sdkPath: 'financeSettingCatMap.update', run: (host, args) => host.financeSettingCatMap.update(args as Parameters<FinanceSettingCatMapCapability['update']>[0]) },
  { capabilityId: 'finance-setting-cat-map-discard', sdkPath: 'financeSettingCatMap.discard', run: (host, args) => host.financeSettingCatMap.discard(args as Parameters<FinanceSettingCatMapCapability['discard']>[0]) },
  { capabilityId: 'finance-setting-date-config-list', sdkPath: 'financeSettingDateConfig.list', run: (host, args) => host.financeSettingDateConfig.list(args as Parameters<FinanceSettingDateConfigCapability['list']>[0]) },
  { capabilityId: 'finance-setting-date-config-prepare-create', sdkPath: 'financeSettingDateConfig.prepareCreate', run: async (host, args) => host.financeSettingDateConfig.prepareCreate(args as Parameters<FinanceSettingDateConfigCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-date-config-create', sdkPath: 'financeSettingDateConfig.create', run: (host, args) => host.financeSettingDateConfig.create(args as Parameters<FinanceSettingDateConfigCapability['create']>[0]) },
  { capabilityId: 'finance-setting-date-config-set-status', sdkPath: 'financeSettingDateConfig.setStatus', run: (host, args) => host.financeSettingDateConfig.setStatus(args as Parameters<FinanceSettingDateConfigCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-monthly-income-time-config-list', sdkPath: 'financeSettingMonthlyIncomeTimeConfig.list', run: (host, args) => host.financeSettingMonthlyIncomeTimeConfig.list(args as Parameters<FinanceSettingMonthlyIncomeTimeConfigCapability['list']>[0]) },
  { capabilityId: 'finance-setting-monthly-income-time-config-get', sdkPath: 'financeSettingMonthlyIncomeTimeConfig.get', run: (host) => host.financeSettingMonthlyIncomeTimeConfig.get() },
  { capabilityId: 'finance-setting-monthly-income-time-config-update', sdkPath: 'financeSettingMonthlyIncomeTimeConfig.update', run: (host, args) => host.financeSettingMonthlyIncomeTimeConfig.update(args as Parameters<FinanceSettingMonthlyIncomeTimeConfigCapability['update']>[0]) },
  { capabilityId: 'finance-setting-project-list', sdkPath: 'financeSettingProject.list', run: (host, args) => host.financeSettingProject.list(args as Parameters<FinanceSettingProjectCapability['list']>[0]) },
  { capabilityId: 'finance-setting-project-get', sdkPath: 'financeSettingProject.get', run: async (host, args) => host.financeSettingProject.get(args as Parameters<FinanceSettingProjectCapability['get']>[0]) },
  { capabilityId: 'finance-setting-project-organization-tree', sdkPath: 'financeSettingProject.organizationTree', run: (host) => host.financeSettingProject.organizationTree() },
  { capabilityId: 'finance-setting-project-user-search', sdkPath: 'financeSettingProject.searchUsers', run: (host, args) => host.financeSettingProject.searchUsers(args as Parameters<FinanceSettingProjectCapability['searchUsers']>[0]) },
  { capabilityId: 'finance-setting-project-prepare-create', sdkPath: 'financeSettingProject.prepareCreate', run: async (host, args) => host.financeSettingProject.prepareCreate(args as Parameters<FinanceSettingProjectCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-project-create', sdkPath: 'financeSettingProject.create', run: (host, args) => host.financeSettingProject.create(args as Parameters<FinanceSettingProjectCapability['create']>[0]) },
  { capabilityId: 'finance-setting-project-prepare-update', sdkPath: 'financeSettingProject.prepareUpdate', run: async (host, args) => host.financeSettingProject.prepareUpdate(args as Parameters<FinanceSettingProjectCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-project-update', sdkPath: 'financeSettingProject.update', run: (host, args) => host.financeSettingProject.update(args as Parameters<FinanceSettingProjectCapability['update']>[0]) },
  { capabilityId: 'finance-setting-project-enable', sdkPath: 'financeSettingProject.enable', run: (host, args) => host.financeSettingProject.enable(args as Parameters<FinanceSettingProjectCapability['enable']>[0]) },
  { capabilityId: 'finance-setting-project-disable', sdkPath: 'financeSettingProject.disable', run: (host, args) => host.financeSettingProject.disable(args as Parameters<FinanceSettingProjectCapability['disable']>[0]) },
  { capabilityId: 'finance-setting-project-remove', sdkPath: 'financeSettingProject.remove', run: (host, args) => host.financeSettingProject.remove(args.id as string | number) },
  { capabilityId: 'finance-setting-receiving-account-list', sdkPath: 'financeSettingReceivingAccount.list', run: (host, args) => host.financeSettingReceivingAccount.list(args as Parameters<FinanceSettingReceivingAccountCapability['list']>[0]) },
  { capabilityId: 'finance-setting-receiving-account-corporation-options', sdkPath: 'financeSettingReceivingAccount.corporationOptions', run: (host) => host.financeSettingReceivingAccount.corporationOptions() },
  { capabilityId: 'finance-setting-receiving-account-prepare-create', sdkPath: 'financeSettingReceivingAccount.prepareCreate', run: async (host, args) => host.financeSettingReceivingAccount.prepareCreate(args as Parameters<FinanceSettingReceivingAccountCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-receiving-account-create', sdkPath: 'financeSettingReceivingAccount.create', run: (host, args) => host.financeSettingReceivingAccount.create(args as Parameters<FinanceSettingReceivingAccountCapability['create']>[0]) },
  { capabilityId: 'finance-setting-receiving-account-prepare-set-status', sdkPath: 'financeSettingReceivingAccount.prepareSetStatus', run: async (host, args) => host.financeSettingReceivingAccount.prepareSetStatus(args as Parameters<FinanceSettingReceivingAccountCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-receiving-account-set-status', sdkPath: 'financeSettingReceivingAccount.setStatus', run: (host, args) => host.financeSettingReceivingAccount.setStatus(args as Parameters<FinanceSettingReceivingAccountCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-list', sdkPath: 'financeSettingRelatedPartySettlementAccount.list', run: (host, args) => host.financeSettingRelatedPartySettlementAccount.list(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['list']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-detail', sdkPath: 'financeSettingRelatedPartySettlementAccount.detail', run: async (host, args) => host.financeSettingRelatedPartySettlementAccount.detail(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['detail']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-prepare-create', sdkPath: 'financeSettingRelatedPartySettlementAccount.prepareCreate', run: async (host, args) => host.financeSettingRelatedPartySettlementAccount.prepareCreate(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-create', sdkPath: 'financeSettingRelatedPartySettlementAccount.create', run: (host, args) => host.financeSettingRelatedPartySettlementAccount.create(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['create']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-prepare-update', sdkPath: 'financeSettingRelatedPartySettlementAccount.prepareUpdate', run: async (host, args) => host.financeSettingRelatedPartySettlementAccount.prepareUpdate(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-update', sdkPath: 'financeSettingRelatedPartySettlementAccount.update', run: (host, args) => host.financeSettingRelatedPartySettlementAccount.update(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['update']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-prepare-set-status', sdkPath: 'financeSettingRelatedPartySettlementAccount.prepareSetStatus', run: async (host, args) => host.financeSettingRelatedPartySettlementAccount.prepareSetStatus(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-related-party-settlement-account-set-status', sdkPath: 'financeSettingRelatedPartySettlementAccount.setStatus', run: (host, args) => host.financeSettingRelatedPartySettlementAccount.setStatus(args as Parameters<FinanceSettingRelatedPartySettlementAccountCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-list', sdkPath: 'financeSettingSaleAllocationCoefficient.list', run: (host, args) => host.financeSettingSaleAllocationCoefficient.list(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['list']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-get', sdkPath: 'financeSettingSaleAllocationCoefficient.get', run: (host, args) => host.financeSettingSaleAllocationCoefficient.get(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['get']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-prepare-create', sdkPath: 'financeSettingSaleAllocationCoefficient.prepareCreate', run: async (host, args) => host.financeSettingSaleAllocationCoefficient.prepareCreate(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-create', sdkPath: 'financeSettingSaleAllocationCoefficient.create', run: (host, args) => host.financeSettingSaleAllocationCoefficient.create(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['create']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-prepare-set-status', sdkPath: 'financeSettingSaleAllocationCoefficient.prepareSetStatus', run: async (host, args) => host.financeSettingSaleAllocationCoefficient.prepareSetStatus(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-sale-allocation-coefficient-set-status', sdkPath: 'financeSettingSaleAllocationCoefficient.setStatus', run: (host, args) => host.financeSettingSaleAllocationCoefficient.setStatus(args as Parameters<FinanceSettingSaleAllocationCoefficientCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-list', sdkPath: 'financeSettingAllocationRules.list', run: (host, args) => host.financeSettingAllocationRules.list(args as Parameters<FinanceSettingAllocationRulesCapability['list']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-get', sdkPath: 'financeSettingAllocationRules.get', run: (host, args) => host.financeSettingAllocationRules.get(args as Parameters<FinanceSettingAllocationRulesCapability['get']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-prepare-create', sdkPath: 'financeSettingAllocationRules.prepareCreate', run: async (host, args) => host.financeSettingAllocationRules.prepareCreate(args as Parameters<FinanceSettingAllocationRulesCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-create', sdkPath: 'financeSettingAllocationRules.create', run: (host, args) => host.financeSettingAllocationRules.create(args as Parameters<FinanceSettingAllocationRulesCapability['create']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-prepare-update', sdkPath: 'financeSettingAllocationRules.prepareUpdate', run: async (host, args) => host.financeSettingAllocationRules.prepareUpdate(args as Parameters<FinanceSettingAllocationRulesCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-update', sdkPath: 'financeSettingAllocationRules.update', run: (host, args) => host.financeSettingAllocationRules.update(args as Parameters<FinanceSettingAllocationRulesCapability['update']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-prepare-set-status', sdkPath: 'financeSettingAllocationRules.prepareSetStatus', run: async (host, args) => host.financeSettingAllocationRules.prepareSetStatus(args as Parameters<FinanceSettingAllocationRulesCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-allocation-rules-set-status', sdkPath: 'financeSettingAllocationRules.setStatus', run: (host, args) => host.financeSettingAllocationRules.setStatus(args as Parameters<FinanceSettingAllocationRulesCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-cost-center-list', sdkPath: 'financeSettingCostCenter.list', run: (host, args) => host.financeSettingCostCenter.list(args as Parameters<FinanceSettingCostCenterCapability['list']>[0]) },
  { capabilityId: 'finance-setting-cost-center-get', sdkPath: 'financeSettingCostCenter.get', run: (host, args) => host.financeSettingCostCenter.get(args as Parameters<FinanceSettingCostCenterCapability['get']>[0]) },
  { capabilityId: 'finance-setting-cost-center-resolve-org-scope', sdkPath: 'financeSettingCostCenter.resolveOrgScope', run: (host, args) => host.financeSettingCostCenter.resolveOrgScope(args as Parameters<FinanceSettingCostCenterCapability['resolveOrgScope']>[0]) },
  { capabilityId: 'finance-setting-cost-center-generate-code', sdkPath: 'financeSettingCostCenter.generateCode', run: (host, args) => host.financeSettingCostCenter.generateCode(args as Parameters<FinanceSettingCostCenterCapability['generateCode']>[0]) },
  { capabilityId: 'finance-setting-cost-center-prepare-create', sdkPath: 'financeSettingCostCenter.prepareCreate', run: async (host, args) => host.financeSettingCostCenter.prepareCreate(args as Parameters<FinanceSettingCostCenterCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-cost-center-create', sdkPath: 'financeSettingCostCenter.create', run: (host, args) => host.financeSettingCostCenter.create(args as Parameters<FinanceSettingCostCenterCapability['create']>[0]) },
  { capabilityId: 'finance-setting-cost-center-prepare-update', sdkPath: 'financeSettingCostCenter.prepareUpdate', run: async (host, args) => host.financeSettingCostCenter.prepareUpdate(args as Parameters<FinanceSettingCostCenterCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-cost-center-update', sdkPath: 'financeSettingCostCenter.update', run: (host, args) => host.financeSettingCostCenter.update(args as Parameters<FinanceSettingCostCenterCapability['update']>[0]) },
  { capabilityId: 'finance-setting-cost-center-prepare-set-status', sdkPath: 'financeSettingCostCenter.prepareSetStatus', run: async (host, args) => host.financeSettingCostCenter.prepareSetStatus(args as Parameters<FinanceSettingCostCenterCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-cost-center-set-status', sdkPath: 'financeSettingCostCenter.setStatus', run: (host, args) => host.financeSettingCostCenter.setStatus(args as Parameters<FinanceSettingCostCenterCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-employee-loan-amount-list', sdkPath: 'financeSettingEmployeeLoanAmount.list', run: (host, args) => host.financeSettingEmployeeLoanAmount.list(args as Parameters<FinanceSettingEmployeeLoanAmountCapability['list']>[0]) },
  { capabilityId: 'finance-setting-employee-loan-amount-download-template', sdkPath: 'financeSettingEmployeeLoanAmount.downloadTemplate', run: (host) => host.financeSettingEmployeeLoanAmount.downloadTemplate() },
  { capabilityId: 'finance-setting-employee-loan-amount-prepare-import', sdkPath: 'financeSettingEmployeeLoanAmount.prepareImport', run: async (host, args) => host.financeSettingEmployeeLoanAmount.prepareImport(args as Parameters<FinanceSettingEmployeeLoanAmountCapability['prepareImport']>[0]) },
  { capabilityId: 'finance-setting-employee-loan-amount-import', sdkPath: 'financeSettingEmployeeLoanAmount.importFile', run: (host, args) => host.financeSettingEmployeeLoanAmount.importFile(args as Parameters<FinanceSettingEmployeeLoanAmountCapability['importFile']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-list-tabs', sdkPath: 'financeSettingInitialManage.listTabs', run: (host) => host.financeSettingInitialManage.listTabs() },
  { capabilityId: 'finance-setting-initial-manage-status', sdkPath: 'financeSettingInitialManage.getStatus', run: (host, args) => host.financeSettingInitialManage.getStatus(args as Parameters<FinanceSettingInitialManageCapability['getStatus']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-list', sdkPath: 'financeSettingInitialManage.list', run: (host, args) => host.financeSettingInitialManage.list(args as Parameters<FinanceSettingInitialManageCapability['list']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-download-template', sdkPath: 'financeSettingInitialManage.downloadTemplate', run: (host, args) => host.financeSettingInitialManage.downloadTemplate(args as Parameters<FinanceSettingInitialManageCapability['downloadTemplate']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-import', sdkPath: 'financeSettingInitialManage.prepareImport', run: async (host, args) => host.financeSettingInitialManage.prepareImport(args as Parameters<FinanceSettingInitialManageCapability['prepareImport']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-import', sdkPath: 'financeSettingInitialManage.importFile', run: (host, args) => host.financeSettingInitialManage.importFile(args as Parameters<FinanceSettingInitialManageCapability['importFile']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-trial-balance', sdkPath: 'financeSettingInitialManage.prepareTrialBalance', run: async (host, args) => host.financeSettingInitialManage.prepareTrialBalance(args as Parameters<FinanceSettingInitialManageCapability['prepareTrialBalance']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-trial-balance', sdkPath: 'financeSettingInitialManage.trialBalance', run: (host, args) => host.financeSettingInitialManage.trialBalance(args as Parameters<FinanceSettingInitialManageCapability['trialBalance']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-reconcile', sdkPath: 'financeSettingInitialManage.prepareReconcile', run: async (host, args) => host.financeSettingInitialManage.prepareReconcile(args as Parameters<FinanceSettingInitialManageCapability['prepareReconcile']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-reconcile', sdkPath: 'financeSettingInitialManage.reconcile', run: (host, args) => host.financeSettingInitialManage.reconcile(args as Parameters<FinanceSettingInitialManageCapability['reconcile']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-manual-match', sdkPath: 'financeSettingInitialManage.prepareManualMatch', run: async (host, args) => host.financeSettingInitialManage.prepareManualMatch(args as Parameters<FinanceSettingInitialManageCapability['prepareManualMatch']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-manual-match', sdkPath: 'financeSettingInitialManage.manualMatch', run: (host, args) => host.financeSettingInitialManage.manualMatch(args as Parameters<FinanceSettingInitialManageCapability['manualMatch']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-delete-lines', sdkPath: 'financeSettingInitialManage.prepareDeleteLines', run: async (host, args) => host.financeSettingInitialManage.prepareDeleteLines(args as Parameters<FinanceSettingInitialManageCapability['prepareDeleteLines']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-delete-lines', sdkPath: 'financeSettingInitialManage.deleteLines', run: (host, args) => host.financeSettingInitialManage.deleteLines(args as Parameters<FinanceSettingInitialManageCapability['deleteLines']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-post-to-ledger', sdkPath: 'financeSettingInitialManage.preparePostToLedger', run: async (host, args) => host.financeSettingInitialManage.preparePostToLedger(args as Parameters<FinanceSettingInitialManageCapability['preparePostToLedger']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-post-to-ledger', sdkPath: 'financeSettingInitialManage.postToLedger', run: (host, args) => host.financeSettingInitialManage.postToLedger(args as Parameters<FinanceSettingInitialManageCapability['postToLedger']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-prepare-update', sdkPath: 'financeSettingInitialManage.prepareUpdate', run: (host, args) => Promise.resolve(host.financeSettingInitialManage.prepareUpdate({ form: args.form } as Parameters<FinanceSettingInitialManageCapability['prepareUpdate']>[0])) },
  { capabilityId: 'finance-setting-initial-manage-update', sdkPath: 'financeSettingInitialManage.update', run: (host, args) => host.financeSettingInitialManage.update(args as Parameters<FinanceSettingInitialManageCapability['update']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-cancel-update', sdkPath: 'financeSettingInitialManage.cancelUpdate', run: (host) => Promise.resolve(host.financeSettingInitialManage.cancelUpdate()) },
  { capabilityId: 'finance-setting-initial-manage-reconcile-results', sdkPath: 'financeSettingInitialManage.listReconcileResults', run: (host, args) => host.financeSettingInitialManage.listReconcileResults(args as Parameters<FinanceSettingInitialManageCapability['listReconcileResults']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-export-reconcile-results', sdkPath: 'financeSettingInitialManage.exportReconcileResults', run: (host, args) => host.financeSettingInitialManage.exportReconcileResults(args as Parameters<FinanceSettingInitialManageCapability['exportReconcileResults']>[0]) },
  { capabilityId: 'finance-setting-initial-manage-operation-logs', sdkPath: 'financeSettingInitialManage.listOperationLogs', run: (host, args) => host.financeSettingInitialManage.listOperationLogs(args as Parameters<FinanceSettingInitialManageCapability['listOperationLogs']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-list', sdkPath: 'financeSettingOpeningSupplier.list', run: (host, args) => host.financeSettingOpeningSupplier.list(args as Parameters<FinanceSettingOpeningSupplierCapability['list']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-category-options', sdkPath: 'financeSettingOpeningSupplier.listCategoryOptions', run: (host) => host.financeSettingOpeningSupplier.listCategoryOptions() },
  { capabilityId: 'finance-setting-opening-supplier-company-tree', sdkPath: 'financeSettingOpeningSupplier.companyTree', run: (host) => host.financeSettingOpeningSupplier.companyTree() },
  { capabilityId: 'finance-setting-opening-supplier-get', sdkPath: 'financeSettingOpeningSupplier.get', run: (host, args) => host.financeSettingOpeningSupplier.get(args as Parameters<FinanceSettingOpeningSupplierCapability['get']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-original-options', sdkPath: 'financeSettingOpeningSupplier.originalOptions', run: (host, args) => host.financeSettingOpeningSupplier.originalOptions(args as Parameters<FinanceSettingOpeningSupplierCapability['originalOptions']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-generate-code', sdkPath: 'financeSettingOpeningSupplier.generateCode', run: (host, args) => host.financeSettingOpeningSupplier.generateCode(args as Parameters<FinanceSettingOpeningSupplierCapability['generateCode']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-prepare-create', sdkPath: 'financeSettingOpeningSupplier.prepareCreate', run: async (host, args) => host.financeSettingOpeningSupplier.prepareCreate(args as Parameters<FinanceSettingOpeningSupplierCapability['prepareCreate']>[0]) },
  {
    capabilityId: 'finance-setting-opening-supplier-create',
    sdkPath: 'financeSettingOpeningSupplier.createIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'finance-setting-opening-supplier-create')
      return host.financeSettingOpeningSupplier.createIdempotent({ ...args, requestId } as Parameters<FinanceSettingOpeningSupplierCapabilityWithIdempotency['createIdempotent']>[0])
    },
  },
  { capabilityId: 'finance-setting-opening-supplier-prepare-update', sdkPath: 'financeSettingOpeningSupplier.prepareUpdate', run: async (host, args) => host.financeSettingOpeningSupplier.prepareUpdate(args as Parameters<FinanceSettingOpeningSupplierCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-update', sdkPath: 'financeSettingOpeningSupplier.update', run: (host, args) => host.financeSettingOpeningSupplier.update(args as Parameters<FinanceSettingOpeningSupplierCapability['update']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-prepare-change-status', sdkPath: 'financeSettingOpeningSupplier.prepareChangeStatus', run: async (host, args) => host.financeSettingOpeningSupplier.prepareChangeStatus(args as Parameters<FinanceSettingOpeningSupplierCapability['prepareChangeStatus']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-change-status', sdkPath: 'financeSettingOpeningSupplier.changeStatus', run: (host, args) => host.financeSettingOpeningSupplier.changeStatus(args as Parameters<FinanceSettingOpeningSupplierCapability['changeStatus']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-prepare-delete', sdkPath: 'financeSettingOpeningSupplier.prepareDelete', run: async (host, args) => host.financeSettingOpeningSupplier.prepareDelete(args as Parameters<FinanceSettingOpeningSupplierCapability['prepareDelete']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-delete', sdkPath: 'financeSettingOpeningSupplier.delete', run: (host, args) => host.financeSettingOpeningSupplier.delete(args as Parameters<FinanceSettingOpeningSupplierCapability['delete']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-download-template', sdkPath: 'financeSettingOpeningSupplier.downloadTemplate', run: (host) => host.financeSettingOpeningSupplier.downloadTemplate() },
  { capabilityId: 'finance-setting-opening-supplier-prepare-import', sdkPath: 'financeSettingOpeningSupplier.prepareImport', run: async (host, args) => host.financeSettingOpeningSupplier.prepareImport(args as Parameters<FinanceSettingOpeningSupplierCapability['prepareImport']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-import', sdkPath: 'financeSettingOpeningSupplier.importFile', run: (host, args) => host.financeSettingOpeningSupplier.importFile(args as Parameters<FinanceSettingOpeningSupplierCapability['importFile']>[0]) },
  { capabilityId: 'finance-setting-opening-supplier-export', sdkPath: 'financeSettingOpeningSupplier.export', run: (host, args) => host.financeSettingOpeningSupplier.export(args as Parameters<FinanceSettingOpeningSupplierCapability['export']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-list', sdkPath: 'financeSettingFeePurpose.list', run: (host, args) => host.financeSettingFeePurpose.list(args as Parameters<FinanceSettingFeePurposeCapability['list']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-get', sdkPath: 'financeSettingFeePurpose.get', run: (host, args) => host.financeSettingFeePurpose.get(args as Parameters<FinanceSettingFeePurposeCapability['get']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-application-type-options', sdkPath: 'financeSettingFeePurpose.searchApplicationTypes', run: (host, args) => host.financeSettingFeePurpose.searchApplicationTypes(args as Parameters<FinanceSettingFeePurposeCapability['searchApplicationTypes']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-fee-options', sdkPath: 'financeSettingFeePurpose.searchFees', run: (host, args) => host.financeSettingFeePurpose.searchFees(args as Parameters<FinanceSettingFeePurposeCapability['searchFees']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-prepare-create', sdkPath: 'financeSettingFeePurpose.prepareCreate', run: async (host, args) => host.financeSettingFeePurpose.prepareCreate(args as Parameters<FinanceSettingFeePurposeCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-create', sdkPath: 'financeSettingFeePurpose.create', run: (host, args) => host.financeSettingFeePurpose.create(args as Parameters<FinanceSettingFeePurposeCapability['create']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-prepare-update', sdkPath: 'financeSettingFeePurpose.prepareUpdate', run: async (host, args) => host.financeSettingFeePurpose.prepareUpdate(args as Parameters<FinanceSettingFeePurposeCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-update', sdkPath: 'financeSettingFeePurpose.update', run: (host, args) => host.financeSettingFeePurpose.update(args as Parameters<FinanceSettingFeePurposeCapability['update']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-prepare-set-status', sdkPath: 'financeSettingFeePurpose.prepareSetStatus', run: async (host, args) => host.financeSettingFeePurpose.prepareSetStatus(args as Parameters<FinanceSettingFeePurposeCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-set-status', sdkPath: 'financeSettingFeePurpose.setStatus', run: (host, args) => host.financeSettingFeePurpose.setStatus(args as Parameters<FinanceSettingFeePurposeCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-prepare-remove', sdkPath: 'financeSettingFeePurpose.prepareRemove', run: async (host, args) => host.financeSettingFeePurpose.prepareRemove(args as Parameters<FinanceSettingFeePurposeCapability['prepareRemove']>[0]) },
  { capabilityId: 'finance-setting-fee-purpose-remove', sdkPath: 'financeSettingFeePurpose.remove', run: (host, args) => host.financeSettingFeePurpose.remove(args as Parameters<FinanceSettingFeePurposeCapability['remove']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-list', sdkPath: 'financeSettingInventoryAccount.list', run: (host, args) => host.financeSettingInventoryAccount.list(args as Parameters<FinanceSettingInventoryAccountCapability['list']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-material-category-tree', sdkPath: 'financeSettingInventoryAccount.materialCategoryTree', run: (host) => host.financeSettingInventoryAccount.materialCategoryTree() },
  { capabilityId: 'finance-setting-inventory-account-adjustment-type-tree', sdkPath: 'financeSettingInventoryAccount.adjustmentTypeTree', run: (host) => host.financeSettingInventoryAccount.adjustmentTypeTree() },
  { capabilityId: 'finance-setting-inventory-account-material-options', sdkPath: 'financeSettingInventoryAccount.searchMaterials', run: (host, args) => host.financeSettingInventoryAccount.searchMaterials(args as Parameters<FinanceSettingInventoryAccountCapability['searchMaterials']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-prepare-create', sdkPath: 'financeSettingInventoryAccount.prepareCreate', run: async (host, args) => host.financeSettingInventoryAccount.prepareCreate(args as Parameters<FinanceSettingInventoryAccountCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-create', sdkPath: 'financeSettingInventoryAccount.create', run: (host, args) => host.financeSettingInventoryAccount.create(args as Parameters<FinanceSettingInventoryAccountCapability['create']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-prepare-update', sdkPath: 'financeSettingInventoryAccount.prepareUpdate', run: async (host, args) => host.financeSettingInventoryAccount.prepareUpdate(args as Parameters<FinanceSettingInventoryAccountCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-update', sdkPath: 'financeSettingInventoryAccount.update', run: (host, args) => host.financeSettingInventoryAccount.update(args as Parameters<FinanceSettingInventoryAccountCapability['update']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-prepare-set-status', sdkPath: 'financeSettingInventoryAccount.prepareSetStatus', run: async (host, args) => host.financeSettingInventoryAccount.prepareSetStatus(args as Parameters<FinanceSettingInventoryAccountCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-set-status', sdkPath: 'financeSettingInventoryAccount.setStatus', run: (host, args) => host.financeSettingInventoryAccount.setStatus(args as Parameters<FinanceSettingInventoryAccountCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-export', sdkPath: 'financeSettingInventoryAccount.export', run: (host, args) => host.financeSettingInventoryAccount.export(args as Parameters<FinanceSettingInventoryAccountCapability['export']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-download-template', sdkPath: 'financeSettingInventoryAccount.downloadTemplate', run: (host) => host.financeSettingInventoryAccount.downloadTemplate() },
  { capabilityId: 'finance-setting-inventory-account-prepare-import', sdkPath: 'financeSettingInventoryAccount.prepareImport', run: async (host, args) => host.financeSettingInventoryAccount.prepareImport(args as Parameters<FinanceSettingInventoryAccountCapability['prepareImport']>[0]) },
  { capabilityId: 'finance-setting-inventory-account-import', sdkPath: 'financeSettingInventoryAccount.importFile', run: (host, args) => host.financeSettingInventoryAccount.importFile(args as Parameters<FinanceSettingInventoryAccountCapability['importFile']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-list', sdkPath: 'financeSettingLivestockAmortization.list', run: (host, args) => host.financeSettingLivestockAmortization.list(args as Parameters<FinanceSettingLivestockAmortizationCapability['list']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-get', sdkPath: 'financeSettingLivestockAmortization.get', run: (host, args) => host.financeSettingLivestockAmortization.get(args as Parameters<FinanceSettingLivestockAmortizationCapability['get']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-prepare-create', sdkPath: 'financeSettingLivestockAmortization.prepareCreate', run: async (host, args) => host.financeSettingLivestockAmortization.prepareCreate(args as Parameters<FinanceSettingLivestockAmortizationCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-create', sdkPath: 'financeSettingLivestockAmortization.create', run: (host, args) => host.financeSettingLivestockAmortization.create(args as Parameters<FinanceSettingLivestockAmortizationCapability['create']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-prepare-set-status', sdkPath: 'financeSettingLivestockAmortization.prepareSetStatus', run: async (host, args) => host.financeSettingLivestockAmortization.prepareSetStatus(args as Parameters<FinanceSettingLivestockAmortizationCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-set-status', sdkPath: 'financeSettingLivestockAmortization.setStatus', run: (host, args) => host.financeSettingLivestockAmortization.setStatus(args as Parameters<FinanceSettingLivestockAmortizationCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-livestock-amortization-calculate-coefficient', sdkPath: 'financeSettingLivestockAmortization.calculateAccrualAgeCoefficient', run: async (host, args) => host.financeSettingLivestockAmortization.calculateAccrualAgeCoefficient(args as Parameters<FinanceSettingLivestockAmortizationCapability['calculateAccrualAgeCoefficient']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-list', sdkPath: 'financeSettingSettlementSetting.list', run: (host, args) => host.financeSettingSettlementSetting.list(args as Parameters<FinanceSettingSettlementSettingCapability['list']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-get', sdkPath: 'financeSettingSettlementSetting.get', run: (host, args) => host.financeSettingSettlementSetting.get(args as Parameters<FinanceSettingSettlementSettingCapability['get']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-organization-tree', sdkPath: 'financeSettingSettlementSetting.organizationTree', run: (host) => host.financeSettingSettlementSetting.organizationTree() },
  { capabilityId: 'finance-setting-settlement-setting-prepare-create', sdkPath: 'financeSettingSettlementSetting.prepareCreate', run: async (host, args) => host.financeSettingSettlementSetting.prepareCreate(args as Parameters<FinanceSettingSettlementSettingCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-create', sdkPath: 'financeSettingSettlementSetting.create', run: (host, args) => host.financeSettingSettlementSetting.create(args as Parameters<FinanceSettingSettlementSettingCapability['create']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-prepare-update', sdkPath: 'financeSettingSettlementSetting.prepareUpdate', run: async (host, args) => host.financeSettingSettlementSetting.prepareUpdate(args as Parameters<FinanceSettingSettlementSettingCapability['prepareUpdate']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-update', sdkPath: 'financeSettingSettlementSetting.update', run: (host, args) => host.financeSettingSettlementSetting.update(args as Parameters<FinanceSettingSettlementSettingCapability['update']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-prepare-set-status', sdkPath: 'financeSettingSettlementSetting.prepareSetStatus', run: async (host, args) => host.financeSettingSettlementSetting.prepareSetStatus(args as Parameters<FinanceSettingSettlementSettingCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-settlement-setting-set-status', sdkPath: 'financeSettingSettlementSetting.setStatus', run: (host, args) => host.financeSettingSettlementSetting.setStatus(args as Parameters<FinanceSettingSettlementSettingCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-list', sdkPath: 'financeSettingVoucherTemplates.list', run: (host, args) => host.financeSettingVoucherTemplates.list(args as Parameters<FinanceSettingVoucherTemplatesCapability['list']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-get', sdkPath: 'financeSettingVoucherTemplates.get', run: (host, args) => host.financeSettingVoucherTemplates.get(args as Parameters<FinanceSettingVoucherTemplatesCapability['get']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-amount-options', sdkPath: 'financeSettingVoucherTemplates.amountOptions', run: (host, args) => host.financeSettingVoucherTemplates.amountOptions(args as Parameters<FinanceSettingVoucherTemplatesCapability['amountOptions']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-prepare-create', sdkPath: 'financeSettingVoucherTemplates.prepareCreate', run: async (host, args) => host.financeSettingVoucherTemplates.prepareCreate(args as Parameters<FinanceSettingVoucherTemplatesCapability['prepareCreate']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-create', sdkPath: 'financeSettingVoucherTemplates.create', run: (host, args) => host.financeSettingVoucherTemplates.create(args as Parameters<FinanceSettingVoucherTemplatesCapability['create']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-prepare-set-status', sdkPath: 'financeSettingVoucherTemplates.prepareSetStatus', run: async (host, args) => host.financeSettingVoucherTemplates.prepareSetStatus(args as Parameters<FinanceSettingVoucherTemplatesCapability['prepareSetStatus']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-set-status', sdkPath: 'financeSettingVoucherTemplates.setStatus', run: (host, args) => host.financeSettingVoucherTemplates.setStatus(args as Parameters<FinanceSettingVoucherTemplatesCapability['setStatus']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-export', sdkPath: 'financeSettingVoucherTemplates.exportExcel', run: (host, args) => host.financeSettingVoucherTemplates.exportExcel(args as Parameters<FinanceSettingVoucherTemplatesCapability['exportExcel']>[0]) },
  { capabilityId: 'finance-setting-voucher-templates-preview', sdkPath: 'financeSettingVoucherTemplates.preview', run: async (host, args) => host.financeSettingVoucherTemplates.preview(args as Parameters<FinanceSettingVoucherTemplatesCapability['preview']>[0]) },
  { capabilityId: 'fund-cost-list', sdkPath: 'fundSalaryFundCosts.costList', run: (host, args) => host.fundSalaryFundCosts.costList(args as Parameters<FundSalaryFundCostsCapability['costList']>[0]) },
  { capabilityId: 'fund-cost-organization-tree', sdkPath: 'fundSalaryFundCosts.organizationTree', run: (host) => host.fundSalaryFundCosts.organizationTree() },
  { capabilityId: 'fund-cost-prepare-archive', sdkPath: 'fundSalaryFundCosts.prepareArchive', run: async (host, args) => host.fundSalaryFundCosts.prepareArchive(args as Parameters<FundSalaryFundCostsCapability['prepareArchive']>[0]) },
  { capabilityId: 'fund-cost-archive', sdkPath: 'fundSalaryFundCosts.archive', run: (host, args) => host.fundSalaryFundCosts.archive(args as Parameters<FundSalaryFundCostsCapability['archive']>[0]) },
  { capabilityId: 'fund-cost-prepare-remove', sdkPath: 'fundSalaryFundCosts.prepareRemove', run: async (host, args) => host.fundSalaryFundCosts.prepareRemove(args as Parameters<FundSalaryFundCostsCapability['prepareRemove']>[0]) },
  { capabilityId: 'fund-cost-remove', sdkPath: 'fundSalaryFundCosts.remove', run: (host, args) => host.fundSalaryFundCosts.remove(args as Parameters<FundSalaryFundCostsCapability['remove']>[0]) },
  { capabilityId: 'fund-cost-export', sdkPath: 'fundSalaryFundCosts.costExport', run: (host, args) => host.fundSalaryFundCosts.costExport(args as Parameters<FundSalaryFundCostsCapability['costExport']>[0]) },
  { capabilityId: 'fund-cost-download-template', sdkPath: 'fundSalaryFundCosts.downloadTemplate', run: (host) => host.fundSalaryFundCosts.downloadTemplate() },
  { capabilityId: 'fund-cost-prepare-import', sdkPath: 'fundSalaryFundCosts.prepareImport', run: async (host, args) => host.fundSalaryFundCosts.prepareImport(args as Parameters<FundSalaryFundCostsCapability['prepareImport']>[0]) },
  { capabilityId: 'fund-cost-import', sdkPath: 'fundSalaryFundCosts.importExcel', run: (host, args) => host.fundSalaryFundCosts.importExcel(args as Parameters<FundSalaryFundCostsCapability['importExcel']>[0]) },
  { capabilityId: 'fund-cost-prepare-update-deposit-unit', sdkPath: 'fundSalaryFundCosts.prepareUpdateDepositUnit', run: async (host, args) => host.fundSalaryFundCosts.prepareUpdateDepositUnit(args as Parameters<FundSalaryFundCostsCapability['prepareUpdateDepositUnit']>[0]) },
  { capabilityId: 'fund-cost-update-deposit-unit', sdkPath: 'fundSalaryFundCosts.updateDepositUnit', run: (host, args) => host.fundSalaryFundCosts.updateDepositUnit(args as Parameters<FundSalaryFundCostsCapability['updateDepositUnit']>[0]) },
  { capabilityId: 'fund-cost-prepare-update-cost-center', sdkPath: 'fundSalaryFundCosts.prepareUpdateCostCenter', run: async (host, args) => host.fundSalaryFundCosts.prepareUpdateCostCenter(args as Parameters<FundSalaryFundCostsCapability['prepareUpdateCostCenter']>[0]) },
  { capabilityId: 'fund-cost-update-cost-center', sdkPath: 'fundSalaryFundCosts.updateCostCenter', run: (host, args) => host.fundSalaryFundCosts.updateCostCenter(args as Parameters<FundSalaryFundCostsCapability['updateCostCenter']>[0]) },
  { capabilityId: 'fund-cost-prepare-copy-archived-data', sdkPath: 'fundSalaryFundCosts.prepareCopyArchivedData', run: async (host, args) => host.fundSalaryFundCosts.prepareCopyArchivedData(args as Parameters<FundSalaryFundCostsCapability['prepareCopyArchivedData']>[0]) },
  { capabilityId: 'fund-cost-copy-archived-data', sdkPath: 'fundSalaryFundCosts.copyArchivedData', run: (host, args) => host.fundSalaryFundCosts.copyArchivedData(args as Parameters<FundSalaryFundCostsCapability['copyArchivedData']>[0]) },
  { capabilityId: 'fund-archive-list', sdkPath: 'fundSalaryFundCosts.archiveList', run: (host, args) => host.fundSalaryFundCosts.archiveList(args as Parameters<FundSalaryFundCostsCapability['archiveList']>[0]) },
  { capabilityId: 'fund-archive-organization-tree', sdkPath: 'fundSalaryFundCosts.organizationTree', run: (host) => host.fundSalaryFundCosts.organizationTree() },
  { capabilityId: 'fund-archive-prepare-unarchive', sdkPath: 'fundSalaryFundCosts.prepareUnarchive', run: async (host, args) => host.fundSalaryFundCosts.prepareUnarchive(args as Parameters<FundSalaryFundCostsCapability['prepareUnarchive']>[0]) },
  { capabilityId: 'fund-archive-unarchive', sdkPath: 'fundSalaryFundCosts.unarchive', run: (host, args) => host.fundSalaryFundCosts.unarchive(args as Parameters<FundSalaryFundCostsCapability['unarchive']>[0]) },
  { capabilityId: 'fund-archive-export', sdkPath: 'fundSalaryFundCosts.archiveExport', run: (host, args) => host.fundSalaryFundCosts.archiveExport(args as Parameters<FundSalaryFundCostsCapability['archiveExport']>[0]) },
  { capabilityId: 'fund-process-list', sdkPath: 'fundSalaryFundProcess.list', run: (host, args) => host.fundSalaryFundProcess.list(args as Parameters<FundSalaryFundProcessCapability['list']>[0]) },
  { capabilityId: 'fund-process-organization-tree', sdkPath: 'fundSalaryFundProcess.organizationTree', run: (host) => host.fundSalaryFundProcess.organizationTree() },
  { capabilityId: 'fund-process-area-tree', sdkPath: 'fundSalaryFundProcess.areaTree', run: (host) => host.fundSalaryFundProcess.areaTree() },
  { capabilityId: 'fund-process-prepare-insure', sdkPath: 'fundSalaryFundProcess.prepareInsure', run: (host, args) => Promise.resolve(host.fundSalaryFundProcess.prepareInsure(args as Parameters<FundSalaryFundProcessCapability['prepareInsure']>[0])) },
  { capabilityId: 'fund-process-insure', sdkPath: 'fundSalaryFundProcess.insure', run: (host, args) => host.fundSalaryFundProcess.insure(args as Parameters<FundSalaryFundProcessCapability['insure']>[0]) },
  { capabilityId: 'fund-process-cancel-insure', sdkPath: 'fundSalaryFundProcess.cancelInsure', run: host => Promise.resolve(host.fundSalaryFundProcess.cancelInsure()) },
  { capabilityId: 'fund-process-prepare-terminate', sdkPath: 'fundSalaryFundProcess.prepareTerminate', run: (host, args) => Promise.resolve(host.fundSalaryFundProcess.prepareTerminate(args as Parameters<FundSalaryFundProcessCapability['prepareTerminate']>[0])) },
  { capabilityId: 'fund-process-terminate', sdkPath: 'fundSalaryFundProcess.terminate', run: (host, args) => host.fundSalaryFundProcess.terminate(args as Parameters<FundSalaryFundProcessCapability['terminate']>[0]) },
  { capabilityId: 'fund-process-cancel-terminate', sdkPath: 'fundSalaryFundProcess.cancelTerminate', run: host => Promise.resolve(host.fundSalaryFundProcess.cancelTerminate()) },
  { capabilityId: 'fund-process-prepare-update-deposit-unit', sdkPath: 'fundSalaryFundProcess.prepareUpdateDepositUnit', run: async (host, args) => host.fundSalaryFundProcess.prepareUpdateDepositUnit(args as Parameters<FundSalaryFundProcessCapability['prepareUpdateDepositUnit']>[0]) },
  { capabilityId: 'fund-process-update-deposit-unit', sdkPath: 'fundSalaryFundProcess.updateDepositUnit', run: (host, args) => host.fundSalaryFundProcess.updateDepositUnit(args as Parameters<FundSalaryFundProcessCapability['updateDepositUnit']>[0]) },
  { capabilityId: 'fund-process-prepare-update-cost-center', sdkPath: 'fundSalaryFundProcess.prepareUpdateCostCenter', run: async (host, args) => host.fundSalaryFundProcess.prepareUpdateCostCenter(args as Parameters<FundSalaryFundProcessCapability['prepareUpdateCostCenter']>[0]) },
  { capabilityId: 'fund-process-update-cost-center', sdkPath: 'fundSalaryFundProcess.updateCostCenter', run: (host, args) => host.fundSalaryFundProcess.updateCostCenter(args as Parameters<FundSalaryFundProcessCapability['updateCostCenter']>[0]) },
  { capabilityId: 'fund-process-export', sdkPath: 'fundSalaryFundProcess.export', run: (host, args) => host.fundSalaryFundProcess.export(args as Parameters<FundSalaryFundProcessCapability['export']>[0]) },
  { capabilityId: 'insurance-cost-list', sdkPath: 'insuranceSalaryInsuranceCosts.costList', run: (host, args) => host.insuranceSalaryInsuranceCosts.costList(args as Parameters<InsuranceSalaryInsuranceCostsCapability['costList']>[0]) },
  { capabilityId: 'insurance-cost-organization-tree', sdkPath: 'insuranceSalaryInsuranceCosts.organizationTree', run: (host) => host.insuranceSalaryInsuranceCosts.organizationTree() },
  { capabilityId: 'insurance-cost-prepare-archive', sdkPath: 'insuranceSalaryInsuranceCosts.prepareArchive', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareArchive(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareArchive']>[0]) },
  { capabilityId: 'insurance-cost-archive', sdkPath: 'insuranceSalaryInsuranceCosts.archive', run: (host, args) => host.insuranceSalaryInsuranceCosts.archive(args as Parameters<InsuranceSalaryInsuranceCostsCapability['archive']>[0]) },
  { capabilityId: 'insurance-cost-prepare-remove', sdkPath: 'insuranceSalaryInsuranceCosts.prepareRemove', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareRemove(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareRemove']>[0]) },
  { capabilityId: 'insurance-cost-remove', sdkPath: 'insuranceSalaryInsuranceCosts.remove', run: (host, args) => host.insuranceSalaryInsuranceCosts.remove(args as Parameters<InsuranceSalaryInsuranceCostsCapability['remove']>[0]) },
  { capabilityId: 'insurance-cost-export', sdkPath: 'insuranceSalaryInsuranceCosts.costExport', run: (host, args) => host.insuranceSalaryInsuranceCosts.costExport(args as Parameters<InsuranceSalaryInsuranceCostsCapability['costExport']>[0]) },
  { capabilityId: 'insurance-cost-download-template', sdkPath: 'insuranceSalaryInsuranceCosts.downloadTemplate', run: (host) => host.insuranceSalaryInsuranceCosts.downloadTemplate() },
  { capabilityId: 'insurance-cost-prepare-import', sdkPath: 'insuranceSalaryInsuranceCosts.prepareImport', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareImport(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareImport']>[0]) },
  { capabilityId: 'insurance-cost-import', sdkPath: 'insuranceSalaryInsuranceCosts.importExcel', run: (host, args) => host.insuranceSalaryInsuranceCosts.importExcel(args as Parameters<InsuranceSalaryInsuranceCostsCapability['importExcel']>[0]) },
  { capabilityId: 'insurance-cost-prepare-update-deposit-unit', sdkPath: 'insuranceSalaryInsuranceCosts.prepareUpdateDepositUnit', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareUpdateDepositUnit(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareUpdateDepositUnit']>[0]) },
  { capabilityId: 'insurance-cost-update-deposit-unit', sdkPath: 'insuranceSalaryInsuranceCosts.updateDepositUnit', run: (host, args) => host.insuranceSalaryInsuranceCosts.updateDepositUnit(args as Parameters<InsuranceSalaryInsuranceCostsCapability['updateDepositUnit']>[0]) },
  { capabilityId: 'insurance-cost-prepare-update-cost-center', sdkPath: 'insuranceSalaryInsuranceCosts.prepareUpdateCostCenter', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareUpdateCostCenter(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareUpdateCostCenter']>[0]) },
  { capabilityId: 'insurance-cost-update-cost-center', sdkPath: 'insuranceSalaryInsuranceCosts.updateCostCenter', run: (host, args) => host.insuranceSalaryInsuranceCosts.updateCostCenter(args as Parameters<InsuranceSalaryInsuranceCostsCapability['updateCostCenter']>[0]) },
  { capabilityId: 'insurance-cost-prepare-copy-archived-data', sdkPath: 'insuranceSalaryInsuranceCosts.prepareCopyArchivedData', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareCopyArchivedData(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareCopyArchivedData']>[0]) },
  { capabilityId: 'insurance-cost-copy-archived-data', sdkPath: 'insuranceSalaryInsuranceCosts.copyArchivedData', run: (host, args) => host.insuranceSalaryInsuranceCosts.copyArchivedData(args as Parameters<InsuranceSalaryInsuranceCostsCapability['copyArchivedData']>[0]) },
  { capabilityId: 'insurance-archive-list', sdkPath: 'insuranceSalaryInsuranceCosts.archiveList', run: (host, args) => host.insuranceSalaryInsuranceCosts.archiveList(args as Parameters<InsuranceSalaryInsuranceCostsCapability['archiveList']>[0]) },
  { capabilityId: 'insurance-archive-organization-tree', sdkPath: 'insuranceSalaryInsuranceCosts.organizationTree', run: (host) => host.insuranceSalaryInsuranceCosts.organizationTree() },
  { capabilityId: 'insurance-archive-prepare-unarchive', sdkPath: 'insuranceSalaryInsuranceCosts.prepareUnarchive', run: async (host, args) => host.insuranceSalaryInsuranceCosts.prepareUnarchive(args as Parameters<InsuranceSalaryInsuranceCostsCapability['prepareUnarchive']>[0]) },
  { capabilityId: 'insurance-archive-unarchive', sdkPath: 'insuranceSalaryInsuranceCosts.unarchive', run: (host, args) => host.insuranceSalaryInsuranceCosts.unarchive(args as Parameters<InsuranceSalaryInsuranceCostsCapability['unarchive']>[0]) },
  { capabilityId: 'insurance-archive-export', sdkPath: 'insuranceSalaryInsuranceCosts.archiveExport', run: (host, args) => host.insuranceSalaryInsuranceCosts.archiveExport(args as Parameters<InsuranceSalaryInsuranceCostsCapability['archiveExport']>[0]) },
  { capabilityId: 'insurance-process-list', sdkPath: 'insuranceSalaryInsuranceProcess.list', run: (host, args) => host.insuranceSalaryInsuranceProcess.list(args as Parameters<InsuranceSalaryInsuranceProcessCapability['list']>[0]) },
  { capabilityId: 'insurance-process-organization-tree', sdkPath: 'insuranceSalaryInsuranceProcess.organizationTree', run: (host) => host.insuranceSalaryInsuranceProcess.organizationTree() },
  { capabilityId: 'insurance-process-area-tree', sdkPath: 'insuranceSalaryInsuranceProcess.areaTree', run: (host) => host.insuranceSalaryInsuranceProcess.areaTree() },
  { capabilityId: 'insurance-process-prepare-insure', sdkPath: 'insuranceSalaryInsuranceProcess.prepareInsure', run: (host, args) => Promise.resolve(host.insuranceSalaryInsuranceProcess.prepareInsure(args as Parameters<InsuranceSalaryInsuranceProcessCapability['prepareInsure']>[0])) },
  { capabilityId: 'insurance-process-insure', sdkPath: 'insuranceSalaryInsuranceProcess.insure', run: (host, args) => host.insuranceSalaryInsuranceProcess.insure(args as Parameters<InsuranceSalaryInsuranceProcessCapability['insure']>[0]) },
  { capabilityId: 'insurance-process-cancel-insure', sdkPath: 'insuranceSalaryInsuranceProcess.cancelInsure', run: host => Promise.resolve(host.insuranceSalaryInsuranceProcess.cancelInsure()) },
  { capabilityId: 'insurance-process-prepare-terminate', sdkPath: 'insuranceSalaryInsuranceProcess.prepareTerminate', run: (host, args) => Promise.resolve(host.insuranceSalaryInsuranceProcess.prepareTerminate(args as Parameters<InsuranceSalaryInsuranceProcessCapability['prepareTerminate']>[0])) },
  { capabilityId: 'insurance-process-terminate', sdkPath: 'insuranceSalaryInsuranceProcess.terminate', run: (host, args) => host.insuranceSalaryInsuranceProcess.terminate(args as Parameters<InsuranceSalaryInsuranceProcessCapability['terminate']>[0]) },
  { capabilityId: 'insurance-process-cancel-terminate', sdkPath: 'insuranceSalaryInsuranceProcess.cancelTerminate', run: host => Promise.resolve(host.insuranceSalaryInsuranceProcess.cancelTerminate()) },
  { capabilityId: 'insurance-process-prepare-update-deposit-unit', sdkPath: 'insuranceSalaryInsuranceProcess.prepareUpdateDepositUnit', run: async (host, args) => host.insuranceSalaryInsuranceProcess.prepareUpdateDepositUnit(args as Parameters<InsuranceSalaryInsuranceProcessCapability['prepareUpdateDepositUnit']>[0]) },
  { capabilityId: 'insurance-process-update-deposit-unit', sdkPath: 'insuranceSalaryInsuranceProcess.updateDepositUnit', run: (host, args) => host.insuranceSalaryInsuranceProcess.updateDepositUnit(args as Parameters<InsuranceSalaryInsuranceProcessCapability['updateDepositUnit']>[0]) },
  { capabilityId: 'insurance-process-prepare-update-cost-center', sdkPath: 'insuranceSalaryInsuranceProcess.prepareUpdateCostCenter', run: async (host, args) => host.insuranceSalaryInsuranceProcess.prepareUpdateCostCenter(args as Parameters<InsuranceSalaryInsuranceProcessCapability['prepareUpdateCostCenter']>[0]) },
  { capabilityId: 'insurance-process-update-cost-center', sdkPath: 'insuranceSalaryInsuranceProcess.updateCostCenter', run: (host, args) => host.insuranceSalaryInsuranceProcess.updateCostCenter(args as Parameters<InsuranceSalaryInsuranceProcessCapability['updateCostCenter']>[0]) },
  { capabilityId: 'insurance-process-export', sdkPath: 'insuranceSalaryInsuranceProcess.export', run: (host, args) => host.insuranceSalaryInsuranceProcess.export(args as Parameters<InsuranceSalaryInsuranceProcessCapability['export']>[0]) },
  { capabilityId: 'insurance-process-export-year-base', sdkPath: 'insuranceSalaryInsuranceProcess.exportYearBase', run: (host, args) => host.insuranceSalaryInsuranceProcess.exportYearBase(args as Parameters<InsuranceSalaryInsuranceProcessCapability['exportYearBase']>[0]) },
  { capabilityId: 'manage-cost-center-list', sdkPath: 'manageCostCenter.list', run: (host, args) => host.manageCostCenter.list(args as Parameters<ManageCostCenterCapability['list']>[0]) },
  { capabilityId: 'manage-cost-center-organization-tree', sdkPath: 'manageCostCenter.organizationTree', run: (host) => host.manageCostCenter.organizationTree() },
  { capabilityId: 'manage-cost-center-export', sdkPath: 'manageCostCenter.export', run: (host, args) => host.manageCostCenter.export(args as Parameters<ManageCostCenterCapability['export']>[0]) },
  { capabilityId: 'manage-cost-center-maintenance', sdkPath: 'manageCostCenter.maintenance', run: (host) => Promise.resolve(host.manageCostCenter.maintenance()) },
  { capabilityId: 'salary-item-list', sdkPath: 'salaryItem.list', run: (host, args) => host.salaryItem.list(args as Parameters<SalaryItemCapability['list']>[0]) },
  { capabilityId: 'salary-item-get', sdkPath: 'salaryItem.get', run: (host, args) => host.salaryItem.get(args as Parameters<SalaryItemCapability['get']>[0]) },
  { capabilityId: 'salary-item-all', sdkPath: 'salaryItem.all', run: (host) => host.salaryItem.all() },
  { capabilityId: 'salary-item-check-formula', sdkPath: 'salaryItem.checkFormula', run: (host, args) => host.salaryItem.checkFormula(args as Parameters<SalaryItemCapability['checkFormula']>[0]) },
  { capabilityId: 'salary-item-create', sdkPath: 'salaryItem.create', run: (host, args) => host.salaryItem.create(args as Parameters<SalaryItemCapability['create']>[0]) },
  { capabilityId: 'salary-item-update', sdkPath: 'salaryItem.update', run: (host, args) => host.salaryItem.update(args as Parameters<SalaryItemCapability['update']>[0]) },
  { capabilityId: 'salary-item-prepare-remove', sdkPath: 'salaryItem.prepareRemove', run: (host, args) => Promise.resolve(host.salaryItem.prepareRemove(args as Parameters<SalaryItemCapability['prepareRemove']>[0])) },
  { capabilityId: 'salary-item-remove', sdkPath: 'salaryItem.remove', run: (host, args) => host.salaryItem.remove(args as Parameters<SalaryItemCapability['remove']>[0]) },
  { capabilityId: 'me-pay-roll-list', sdkPath: 'mePayRoll.list', run: (host, args) => host.mePayRoll.list(args as MePayRollQuery) },
  { capabilityId: 'me-pay-roll-wages-chart', sdkPath: 'mePayRoll.wagesChart', run: (host) => host.mePayRoll.wagesChart() },
  { capabilityId: 'me-pay-roll-five-insurances-chart', sdkPath: 'mePayRoll.fiveInsurancesChart', run: (host) => host.mePayRoll.fiveInsurancesChart() },
  { capabilityId: 'platform-category-dict-list', sdkPath: 'platformCategoryDict.list', run: (host, args) => host.platformCategoryDict.list(args as PlatformCategoryDictQuery) },
  { capabilityId: 'platform-category-dict-create', sdkPath: 'platformCategoryDict.create', run: (host, args) => host.platformCategoryDict.create(args as PlatformCategoryDictCreateInput) },
  { capabilityId: 'platform-category-dict-update', sdkPath: 'platformCategoryDict.update', run: (host, args) => host.platformCategoryDict.update(args as PlatformCategoryDictUpdateInput) },
  { capabilityId: 'platform-category-dict-update-inline', sdkPath: 'platformCategoryDict.updateInline', run: (host, args) => host.platformCategoryDict.updateInline(args as PlatformCategoryDictUpdateInput) },
  { capabilityId: 'platform-category-dict-set-tenant-editable', sdkPath: 'platformCategoryDict.setTenantEditable', run: (host, args) => host.platformCategoryDict.setTenantEditable(args as PlatformCategoryDictUpdateInput) },
  { capabilityId: 'platform-category-dict-remove', sdkPath: 'platformCategoryDict.remove', run: (host, args) => host.platformCategoryDict.remove((args as { id: string | number }).id) },
  { capabilityId: 'hr-org-corporation-list', sdkPath: 'orgCorporation.list', run: (host, args) => host.orgCorporation.list(args as OrgCorporationQuery) },
  { capabilityId: 'hr-org-corporation-get', sdkPath: 'orgCorporation.get', run: (host, args) => host.orgCorporation.get(args as { id: string | number }) },
  { capabilityId: 'hr-org-corporation-main-invest-options', sdkPath: 'orgCorporation.mainInvestOptions', run: (host, args) => host.orgCorporation.mainInvestOptions(args as { keyword: string }) },
  { capabilityId: 'hr-org-corporation-create', sdkPath: 'orgCorporation.create', run: (host, args) => host.orgCorporation.create(args as OrgCorporationDraft) },
  { capabilityId: 'hr-org-corporation-update', sdkPath: 'orgCorporation.update', run: (host, args) => host.orgCorporation.update(args as OrgCorporationUpdateDraft) },
  { capabilityId: 'hr-org-corporation-prepare-remove', sdkPath: 'orgCorporation.prepareRemove', run: (host, args) => host.orgCorporation.prepareRemove(args as OrgCorporationIds) },
  { capabilityId: 'hr-org-corporation-send-delete-code', sdkPath: 'orgCorporation.sendDeleteCode', run: (host, args) => host.orgCorporation.sendDeleteCode(args as OrgCorporationIds) },
  { capabilityId: 'hr-org-corporation-remove', sdkPath: 'orgCorporation.remove', run: (host, args) => host.orgCorporation.remove(args as OrgCorporationDelete) },
  { capabilityId: 'hr-organization-setting-list', sdkPath: 'hrOrganizationSetting.list', run: (host, args) => host.hrOrganizationSetting.list(args as Parameters<HrOrganizationSettingCapability['list']>[0]) },
  { capabilityId: 'hr-organization-setting-detail', sdkPath: 'hrOrganizationSetting.detail', run: (host, args) => host.hrOrganizationSetting.detail((args as { id: Parameters<HrOrganizationSettingCapability['detail']>[0] }).id) },
  { capabilityId: 'hr-organization-setting-check-have-standard-unit', sdkPath: 'hrOrganizationSetting.checkHaveStandardUnit', run: (host, args) => host.hrOrganizationSetting.checkHaveStandardUnit((args as { pid: Parameters<HrOrganizationSettingCapability['checkHaveStandardUnit']>[0] }).pid) },
  { capabilityId: 'hr-organization-setting-prepare-create', sdkPath: 'hrOrganizationSetting.prepareCreate', run: (host, args) => Promise.resolve(host.hrOrganizationSetting.prepareCreate((args as { form: Parameters<HrOrganizationSettingCapability['prepareCreate']>[0] }).form)) },
  { capabilityId: 'hr-organization-setting-create', sdkPath: 'hrOrganizationSetting.create', run: (host, args) => host.hrOrganizationSetting.create((args as { form: Parameters<HrOrganizationSettingCapability['create']>[0] }).form) },
  { capabilityId: 'hr-organization-setting-prepare-update', sdkPath: 'hrOrganizationSetting.prepareUpdate', run: (host, args) => Promise.resolve(host.hrOrganizationSetting.prepareUpdate((args as { form: Parameters<HrOrganizationSettingCapability['prepareUpdate']>[0] }).form)) },
  { capabilityId: 'hr-organization-setting-update', sdkPath: 'hrOrganizationSetting.update', run: (host, args) => host.hrOrganizationSetting.update((args as { form: Parameters<HrOrganizationSettingCapability['update']>[0] }).form) },
  { capabilityId: 'hr-organization-setting-check-can-disable', sdkPath: 'hrOrganizationSetting.checkCanDisable', run: (host, args) => host.hrOrganizationSetting.checkCanDisable((args as { id: Parameters<HrOrganizationSettingCapability['checkCanDisable']>[0] }).id) },
  { capabilityId: 'hr-organization-setting-disable', sdkPath: 'hrOrganizationSetting.disable', run: (host, args) => host.hrOrganizationSetting.disable(args as Parameters<HrOrganizationSettingCapability['disable']>[0]) },
  { capabilityId: 'hr-organization-setting-enable', sdkPath: 'hrOrganizationSetting.enable', run: (host, args) => host.hrOrganizationSetting.enable(args as Parameters<HrOrganizationSettingCapability['enable']>[0]) },
  { capabilityId: 'hr-organization-setting-prepare-change-relation', sdkPath: 'hrOrganizationSetting.prepareChangeRelation', run: (host) => host.hrOrganizationSetting.prepareChangeRelation() },
  { capabilityId: 'hr-organization-setting-send-change-relation-code', sdkPath: 'hrOrganizationSetting.sendChangeRelationCode', run: (host, args) => host.hrOrganizationSetting.sendChangeRelationCode(args as Parameters<HrOrganizationSettingCapability['sendChangeRelationCode']>[0]) },
  { capabilityId: 'hr-organization-setting-verify-change-relation-code', sdkPath: 'hrOrganizationSetting.verifyChangeRelationCode', run: (host, args) => host.hrOrganizationSetting.verifyChangeRelationCode(args as Parameters<HrOrganizationSettingCapability['verifyChangeRelationCode']>[0]) },
  { capabilityId: 'hr-organization-setting-change-relation', sdkPath: 'hrOrganizationSetting.changeRelation', run: (host, args) => host.hrOrganizationSetting.changeRelation(args as Parameters<HrOrganizationSettingCapability['changeRelation']>[0]) },
  { capabilityId: 'hr-organization-setting-export', sdkPath: 'hrOrganizationSetting.export', run: (host, args) => host.hrOrganizationSetting.export(args as Parameters<HrOrganizationSettingCapability['export']>[0]) },
  { capabilityId: 'hr-organization-setting-prepare-import', sdkPath: 'hrOrganizationSetting.prepareImport', run: (host, args) => Promise.resolve(host.hrOrganizationSetting.prepareImport(args as Parameters<HrOrganizationSettingCapability['prepareImport']>[0])) },
  { capabilityId: 'hr-organization-setting-import', sdkPath: 'hrOrganizationSetting.importFile', run: (host, args) => host.hrOrganizationSetting.importFile(args as Parameters<HrOrganizationSettingCapability['importFile']>[0]) },
  { capabilityId: 'hr-organization-setting-download-template', sdkPath: 'hrOrganizationSetting.downloadTemplate', run: (host, args) => host.hrOrganizationSetting.downloadTemplate(args as Parameters<HrOrganizationSettingCapability['downloadTemplate']>[0]) },
  { capabilityId: 'hr-organization-setting-history-list', sdkPath: 'hrOrganizationSetting.historyList', run: (host, args) => host.hrOrganizationSetting.historyList(args as Parameters<HrOrganizationSettingCapability['historyList']>[0]) },
  { capabilityId: 'hr-organization-setting-history-detail', sdkPath: 'hrOrganizationSetting.historyDetail', run: (host, args) => host.hrOrganizationSetting.historyDetail((args as { id: Parameters<HrOrganizationSettingCapability['historyDetail']>[0] }).id) },
  { capabilityId: 'hr-organization-setting-part-time-posts', sdkPath: 'hrOrganizationSetting.partTimePosts', run: (host, args) => host.hrOrganizationSetting.partTimePosts((args as { organizationId: Parameters<HrOrganizationSettingCapability['partTimePosts']>[0] }).organizationId) },
  { capabilityId: 'hr-organization-setting-part-time-staff-page', sdkPath: 'hrOrganizationSetting.partTimeStaffPage', run: (host, args) => host.hrOrganizationSetting.partTimeStaffPage(args as Parameters<HrOrganizationSettingCapability['partTimeStaffPage']>[0]) },
  { capabilityId: 'hr-organization-setting-organization-types', sdkPath: 'hrOrganizationSetting.organizationTypes', run: (host) => host.hrOrganizationSetting.organizationTypes() },
  { capabilityId: 'hr-organization-setting-organization-properties', sdkPath: 'hrOrganizationSetting.organizationProperties', run: (host) => host.hrOrganizationSetting.organizationProperties() },
  { capabilityId: 'hr-organization-setting-license-categories', sdkPath: 'hrOrganizationSetting.licenseCategories', run: (host) => host.hrOrganizationSetting.licenseCategories() },
  { capabilityId: 'hr-organization-setting-search-post-options', sdkPath: 'hrOrganizationSetting.searchPostOptions', run: (host, args) => host.hrOrganizationSetting.searchPostOptions(args as Parameters<HrOrganizationSettingCapability['searchPostOptions']>[0]) },
  { capabilityId: 'hr-organization-setting-post-node-details', sdkPath: 'hrOrganizationSetting.postNodeDetails', run: (host, args) => host.hrOrganizationSetting.postNodeDetails(args as Parameters<HrOrganizationSettingCapability['postNodeDetails']>[0]) },
  { capabilityId: 'hr-organization-setting-search-users', sdkPath: 'hrOrganizationSetting.searchUsers', run: (host, args) => host.hrOrganizationSetting.searchUsers(args as Parameters<HrOrganizationSettingCapability['searchUsers']>[0]) },
  { capabilityId: 'hr-organization-setting-users-by-ids', sdkPath: 'hrOrganizationSetting.usersByIds', run: (host, args) => host.hrOrganizationSetting.usersByIds(args as Parameters<HrOrganizationSettingCapability['usersByIds']>[0]) },
  { capabilityId: 'hr-organization-setting-legal-persons', sdkPath: 'hrOrganizationSetting.legalPersons', run: (host) => host.hrOrganizationSetting.legalPersons() },
  { capabilityId: 'hr-organization-setting-cost-centers', sdkPath: 'hrOrganizationSetting.costCenters', run: (host) => host.hrOrganizationSetting.costCenters() },
  { capabilityId: 'hr-organization-chart-tree', sdkPath: 'hrOrganizationChart.tree', run: (host) => host.hrOrganizationChart.tree() },
  { capabilityId: 'hr-organization-chart-export-text', sdkPath: 'hrOrganizationChart.exportText', run: (host, args) => Promise.resolve(host.hrOrganizationChart.exportText(args as Parameters<HrOrganizationChartCapability['exportText']>[0])) },
  { capabilityId: 'hr-organization-chart-export-drawio', sdkPath: 'hrOrganizationChart.exportDrawIo', run: (host, args) => Promise.resolve(host.hrOrganizationChart.exportDrawIo(args as Parameters<HrOrganizationChartCapability['exportDrawIo']>[0])) },
  { capabilityId: 'hr-organization-chart-prepare-edit', sdkPath: 'hrOrganizationChart.prepareEdit', run: (host, args) => Promise.resolve(host.hrOrganizationChart.prepareEdit(args as Parameters<HrOrganizationChartCapability['prepareEdit']>[0])) },
  { capabilityId: 'hr-transfer-in-plan-organization-tree', sdkPath: 'hrTransferInPlan.organizationTree', run: host => host.hrTransferInPlan.organizationTree() },
  { capabilityId: 'hr-transfer-in-plan-overview', sdkPath: 'hrTransferInPlan.overview', run: host => host.hrTransferInPlan.overview() },
  { capabilityId: 'hr-transfer-in-plan-detail', sdkPath: 'hrTransferInPlan.detail', run: (host, args) => host.hrTransferInPlan.detail(args as Parameters<HrTransferInPlanCapability['detail']>[0]) },
  { capabilityId: 'hr-transfer-in-plan-post-requirement', sdkPath: 'hrTransferInPlan.postRequirement', run: (host, args) => host.hrTransferInPlan.postRequirement(args as Parameters<HrTransferInPlanCapability['postRequirement']>[0]) },
  { capabilityId: 'hr-transfer-in-plan-prepare-detail', sdkPath: 'hrTransferInPlan.prepareDetail', run: (host, args) => Promise.resolve(host.hrTransferInPlan.prepareDetail(args as Parameters<HrTransferInPlanCapability['prepareDetail']>[0])) },
  { capabilityId: 'hr-transfer-in-plan-prepare-resume', sdkPath: 'hrTransferInPlan.prepareResume', run: (host, args) => Promise.resolve(host.hrTransferInPlan.prepareResume(args as Parameters<HrTransferInPlanCapability['prepareResume']>[0])) },
  { capabilityId: 'platform-system-custom-list', sdkPath: 'platformSystemCustom.list', run: (host, args) => host.platformSystemCustom.list(args as Parameters<PlatformSystemCustomCapability['list']>[0]) },
  { capabilityId: 'platform-system-custom-prepare-create', sdkPath: 'platformSystemCustom.prepareCreate', run: (host, args) => Promise.resolve(host.platformSystemCustom.prepareCreate((args as { form: Parameters<PlatformSystemCustomCapability['prepareCreate']>[0] }).form)) },
  { capabilityId: 'platform-system-custom-create', sdkPath: 'platformSystemCustom.create', run: (host, args) => host.platformSystemCustom.create((args as { form: Parameters<PlatformSystemCustomCapability['create']>[0] }).form) },
  { capabilityId: 'platform-system-custom-prepare-update', sdkPath: 'platformSystemCustom.prepareUpdate', run: (host, args) => Promise.resolve(host.platformSystemCustom.prepareUpdate((args as { form: Parameters<PlatformSystemCustomCapability['prepareUpdate']>[0] }).form)) },
  { capabilityId: 'platform-system-custom-update', sdkPath: 'platformSystemCustom.update', run: (host, args) => host.platformSystemCustom.update((args as { form: Parameters<PlatformSystemCustomCapability['update']>[0] }).form) },
  { capabilityId: 'platform-system-security-config-list', sdkPath: 'platformSystemSecurityConfig.list', run: host => host.platformSystemSecurityConfig.list() },
  { capabilityId: 'platform-system-security-config-prepare-update-values', sdkPath: 'platformSystemSecurityConfig.prepareUpdateValues', run: (host, args) => Promise.resolve(host.platformSystemSecurityConfig.prepareUpdateValues(args.configs as Parameters<PlatformSystemSecurityConfigCapability['prepareUpdateValues']>[0])) },
  { capabilityId: 'platform-system-security-config-update-values', sdkPath: 'platformSystemSecurityConfig.updateValues', run: (host, args) => host.platformSystemSecurityConfig.updateValues(args.configs as Parameters<PlatformSystemSecurityConfigCapability['updateValues']>[0]) },
  { capabilityId: 'platform-system-security-config-prepare-create', sdkPath: 'platformSystemSecurityConfig.prepareCreate', run: (host, args) => Promise.resolve(host.platformSystemSecurityConfig.prepareCreate((args as { form: Parameters<PlatformSystemSecurityConfigCapability['prepareCreate']>[0] }).form)) },
  { capabilityId: 'platform-system-security-config-create', sdkPath: 'platformSystemSecurityConfig.create', run: (host, args) => host.platformSystemSecurityConfig.create((args as { form: Parameters<PlatformSystemSecurityConfigCapability['create']>[0] }).form) },
  { capabilityId: 'platform-system-security-config-prepare-update', sdkPath: 'platformSystemSecurityConfig.prepareUpdate', run: (host, args) => Promise.resolve(host.platformSystemSecurityConfig.prepareUpdate((args as { form: Parameters<PlatformSystemSecurityConfigCapability['prepareUpdate']>[0] }).form)) },
  { capabilityId: 'platform-system-security-config-update', sdkPath: 'platformSystemSecurityConfig.update', run: (host, args) => host.platformSystemSecurityConfig.update((args as { form: Parameters<PlatformSystemSecurityConfigCapability['update']>[0] }).form) },
  { capabilityId: 'platform-system-security-config-prepare-remove', sdkPath: 'platformSystemSecurityConfig.prepareRemove', run: (host, args) => Promise.resolve(host.platformSystemSecurityConfig.prepareRemove((args as { record: Parameters<PlatformSystemSecurityConfigCapability['prepareRemove']>[0] }).record)) },
  { capabilityId: 'platform-system-security-config-remove', sdkPath: 'platformSystemSecurityConfig.remove', run: (host, args) => host.platformSystemSecurityConfig.remove((args as { record: Parameters<PlatformSystemSecurityConfigCapability['remove']>[0] }).record) },
  { capabilityId: 'platform-system-queue-storage-get', sdkPath: 'platformSystemQueueStorage.get', run: host => host.platformSystemQueueStorage.get() },
  { capabilityId: 'platform-system-queue-storage-prepare-save', sdkPath: 'platformSystemQueueStorage.prepareSave', run: (host, args) => Promise.resolve(host.platformSystemQueueStorage.prepareSave(args as Parameters<PlatformSystemQueueStorageCapability['prepareSave']>[0])) },
  { capabilityId: 'platform-system-queue-storage-save', sdkPath: 'platformSystemQueueStorage.save', run: (host, args) => host.platformSystemQueueStorage.save(args as Parameters<PlatformSystemQueueStorageCapability['save']>[0]) },
  { capabilityId: 'platform-system-email-list', sdkPath: 'platformSystemEmail.list', run: host => host.platformSystemEmail.list() },
  { capabilityId: 'platform-system-email-prepare-set-account', sdkPath: 'platformSystemEmail.prepareSetAccount', run: (host, args) => Promise.resolve(host.platformSystemEmail.prepareSetAccount(args as Parameters<PlatformSystemEmailCapability['prepareSetAccount']>[0])) },
  { capabilityId: 'platform-system-email-set-account', sdkPath: 'platformSystemEmail.setAccount', run: (host, args) => host.platformSystemEmail.setAccount(args as Parameters<PlatformSystemEmailCapability['setAccount']>[0]) },
  { capabilityId: 'platform-system-email-maintain-template', sdkPath: 'platformSystemEmail.maintainTemplate', run: host => host.platformSystemEmail.maintainTemplate() },
  { capabilityId: 'platform-system-email-get-sms-signature', sdkPath: 'platformSystemEmail.getSmsSignature', run: (host, args) => host.platformSystemEmail.getSmsSignature(args as Parameters<PlatformSystemEmailCapability['getSmsSignature']>[0]) },
  { capabilityId: 'platform-system-email-prepare-save-sms-signature', sdkPath: 'platformSystemEmail.prepareSaveSmsSignature', run: (host, args) => Promise.resolve(host.platformSystemEmail.prepareSaveSmsSignature(args as Parameters<PlatformSystemEmailCapability['prepareSaveSmsSignature']>[0])) },
  { capabilityId: 'platform-system-email-save-sms-signature', sdkPath: 'platformSystemEmail.saveSmsSignature', run: (host, args) => host.platformSystemEmail.saveSmsSignature(args as Parameters<PlatformSystemEmailCapability['saveSmsSignature']>[0]) },
  { capabilityId: 'platform-system-email-get-email-account', sdkPath: 'platformSystemEmail.getEmailAccount', run: host => host.platformSystemEmail.getEmailAccount() },
  { capabilityId: 'platform-system-email-prepare-save-email-account', sdkPath: 'platformSystemEmail.prepareSaveEmailAccount', run: (host, args) => Promise.resolve(host.platformSystemEmail.prepareSaveEmailAccount(args as Parameters<PlatformSystemEmailCapability['prepareSaveEmailAccount']>[0])) },
  { capabilityId: 'platform-system-email-save-email-account', sdkPath: 'platformSystemEmail.saveEmailAccount', run: (host, args) => host.platformSystemEmail.saveEmailAccount(args as Parameters<PlatformSystemEmailCapability['saveEmailAccount']>[0]) },
  { capabilityId: 'platform-system-email-get-template', sdkPath: 'platformSystemEmail.getTemplate', run: (host, args) => host.platformSystemEmail.getTemplate(args as Parameters<PlatformSystemEmailCapability['getTemplate']>[0]) },
  { capabilityId: 'platform-system-email-prepare-update-template', sdkPath: 'platformSystemEmail.prepareUpdateTemplate', run: (host, args) => Promise.resolve(host.platformSystemEmail.prepareUpdateTemplate(args as Parameters<PlatformSystemEmailCapability['prepareUpdateTemplate']>[0])) },
  { capabilityId: 'platform-system-email-update-template', sdkPath: 'platformSystemEmail.updateTemplate', run: (host, args) => host.platformSystemEmail.updateTemplate(args as Parameters<PlatformSystemEmailCapability['updateTemplate']>[0]) },
  { capabilityId: 'platform-system-queue-export-list', sdkPath: 'platformSystemQueueExport.list', run: (host, args) => host.platformSystemQueueExport.list(args as Parameters<PlatformSystemQueueExportCapability['list']>[0]) },
  { capabilityId: 'platform-system-queue-export-prepare-remove', sdkPath: 'platformSystemQueueExport.prepareRemove', run: (host, args) => Promise.resolve(host.platformSystemQueueExport.prepareRemove(args as Parameters<PlatformSystemQueueExportCapability['prepareRemove']>[0])) },
  { capabilityId: 'platform-system-queue-export-remove', sdkPath: 'platformSystemQueueExport.remove', run: (host, args) => host.platformSystemQueueExport.remove(args as Parameters<PlatformSystemQueueExportCapability['remove']>[0]) },
  { capabilityId: 'platform-system-queue-failed-list', sdkPath: 'platformSystemQueueFailed.list', run: (host, args) => host.platformSystemQueueFailed.list(args as Parameters<PlatformSystemQueueFailedCapability['list']>[0]) },
  { capabilityId: 'platform-system-queue-failed-prepare-remove', sdkPath: 'platformSystemQueueFailed.prepareRemove', run: (host, args) => Promise.resolve(host.platformSystemQueueFailed.prepareRemove(args as Parameters<PlatformSystemQueueFailedCapability['prepareRemove']>[0])) },
  { capabilityId: 'platform-system-queue-failed-remove', sdkPath: 'platformSystemQueueFailed.remove', run: (host, args) => host.platformSystemQueueFailed.remove(args as Parameters<PlatformSystemQueueFailedCapability['remove']>[0]) },
  { capabilityId: 'platform-system-queue-failed-prepare-run', sdkPath: 'platformSystemQueueFailed.prepareRun', run: (host, args) => Promise.resolve(host.platformSystemQueueFailed.prepareRun(args as Parameters<PlatformSystemQueueFailedCapability['prepareRun']>[0])) },
  { capabilityId: 'platform-system-queue-failed-run', sdkPath: 'platformSystemQueueFailed.run', run: (host, args) => host.platformSystemQueueFailed.run(args as Parameters<PlatformSystemQueueFailedCapability['run']>[0]) },
  { capabilityId: 'platform-system-queue-mysql-list', sdkPath: 'platformSystemQueueMysql.list', run: (host, args) => host.platformSystemQueueMysql.list(args as Parameters<PlatformSystemQueueMysqlCapability['list']>[0]) },
  { capabilityId: 'platform-system-queue-mysql-prepare-remove', sdkPath: 'platformSystemQueueMysql.prepareRemove', run: (host, args) => Promise.resolve(host.platformSystemQueueMysql.prepareRemove(args as Parameters<PlatformSystemQueueMysqlCapability['prepareRemove']>[0])) },
  { capabilityId: 'platform-system-queue-mysql-remove', sdkPath: 'platformSystemQueueMysql.remove', run: (host, args) => host.platformSystemQueueMysql.remove(args as Parameters<PlatformSystemQueueMysqlCapability['remove']>[0]) },
  { capabilityId: 'platform-system-schedule-list', sdkPath: 'platformSystemSchedule.list', run: (host, args) => host.platformSystemSchedule.list(args as Parameters<PlatformSystemScheduleCapability['list']>[0]) },
  { capabilityId: 'platform-system-schedule-prepare-update', sdkPath: 'platformSystemSchedule.prepareUpdate', run: (host, args) => Promise.resolve(host.platformSystemSchedule.prepareUpdate(args as Parameters<PlatformSystemScheduleCapability['prepareUpdate']>[0])) },
  { capabilityId: 'platform-system-schedule-update', sdkPath: 'platformSystemSchedule.update', run: (host, args) => host.platformSystemSchedule.update(args as Parameters<PlatformSystemScheduleCapability['update']>[0]) },
  { capabilityId: 'platform-system-schedule-prepare-run', sdkPath: 'platformSystemSchedule.prepareRun', run: (host, args) => Promise.resolve(host.platformSystemSchedule.prepareRun(args as Parameters<PlatformSystemScheduleCapability['prepareRun']>[0])) },
  { capabilityId: 'platform-system-schedule-run', sdkPath: 'platformSystemSchedule.run', run: (host, args) => host.platformSystemSchedule.run(args as Parameters<PlatformSystemScheduleCapability['run']>[0]) },
  { capabilityId: 'report-bank-pay-list', sdkPath: 'reportBankPay.list', run: (host, args) => host.reportBankPay.list(args as Parameters<ReportBankPayCapability['list']>[0]) },
  { capabilityId: 'report-bank-pay-export', sdkPath: 'reportBankPay.export', run: (host, args) => host.reportBankPay.export(args as Parameters<ReportBankPayCapability['export']>[0]) },
  { capabilityId: 'report-bank-pay-export-by-bank', sdkPath: 'reportBankPay.exportByBank', run: (host, args) => host.reportBankPay.exportByBank(args as Parameters<ReportBankPayCapability['exportByBank']>[0]) },
  { capabilityId: 'report-bank-summary-list', sdkPath: 'reportBankSummary.list', run: (host, args) => host.reportBankSummary.list(args as Parameters<ReportBankSummaryCapability['list']>[0]) },
  { capabilityId: 'report-bank-summary-export', sdkPath: 'reportBankSummary.export', run: (host, args) => host.reportBankSummary.export(args as Parameters<ReportBankSummaryCapability['export']>[0]) },
  { capabilityId: 'report-center-insurance-list', sdkPath: 'reportCenterInsurance.list', run: (host, args) => host.reportCenterInsurance.list(args as Parameters<ReportCenterInsuranceCapability['list']>[0]) },
  { capabilityId: 'report-center-insurance-export', sdkPath: 'reportCenterInsurance.export', run: (host, args) => host.reportCenterInsurance.export(args as Parameters<ReportCenterInsuranceCapability['export']>[0]) },
  { capabilityId: 'report-cost-center-salary-list', sdkPath: 'reportCostCenterSalary.list', run: (host, args) => host.reportCostCenterSalary.list(args as Parameters<ReportCostCenterSalaryCapability['list']>[0]) },
  { capabilityId: 'report-cost-center-salary-export', sdkPath: 'reportCostCenterSalary.export', run: (host, args) => host.reportCostCenterSalary.export(args as Parameters<ReportCostCenterSalaryCapability['export']>[0]) },
  { capabilityId: 'report-department-salary-detail-list', sdkPath: 'reportDepartmentSalaryDetail.list', run: (host, args) => host.reportDepartmentSalaryDetail.list(args as Parameters<ReportDepartmentSalaryDetailCapability['list']>[0]) },
  { capabilityId: 'report-department-salary-detail-export', sdkPath: 'reportDepartmentSalaryDetail.export', run: (host, args) => host.reportDepartmentSalaryDetail.export(args as Parameters<ReportDepartmentSalaryDetailCapability['export']>[0]) },
  { capabilityId: 'report-department-salary-list', sdkPath: 'reportDepartmentSalary.list', run: (host, args) => host.reportDepartmentSalary.list(args as Parameters<ReportDepartmentSalaryCapability['list']>[0]) },
  { capabilityId: 'report-department-salary-export', sdkPath: 'reportDepartmentSalary.export', run: (host, args) => host.reportDepartmentSalary.export(args as Parameters<ReportDepartmentSalaryCapability['export']>[0]) },
  { capabilityId: 'report-fund-payment-summary-list', sdkPath: 'reportFundPaymentSummary.list', run: (host, args) => host.reportFundPaymentSummary.list(args as Parameters<ReportFundPaymentSummaryCapability['list']>[0]) },
  { capabilityId: 'report-fund-payment-summary-person-detail', sdkPath: 'reportFundPaymentSummary.personDetail', run: (host, args) => host.reportFundPaymentSummary.personDetail(args as Parameters<ReportFundPaymentSummaryCapability['personDetail']>[0]) },
  { capabilityId: 'report-fund-payment-summary-prepare', sdkPath: 'reportFundPaymentSummary.prepare', run: (host, args) => Promise.resolve(host.reportFundPaymentSummary.prepare(args as Parameters<ReportFundPaymentSummaryCapability['prepare']>[0])) },
  { capabilityId: 'report-fund-payment-summary-submit', sdkPath: 'reportFundPaymentSummary.submit', run: (host, args) => host.reportFundPaymentSummary.submit((args as { draft: Parameters<ReportFundPaymentSummaryCapability['submit']>[0]; startUserSelectAssignees?: Parameters<ReportFundPaymentSummaryCapability['submit']>[1] }).draft, (args as { draft: Parameters<ReportFundPaymentSummaryCapability['submit']>[0]; startUserSelectAssignees?: Parameters<ReportFundPaymentSummaryCapability['submit']>[1] }).startUserSelectAssignees) },
  { capabilityId: 'report-fund-payment-summary-payment-detail', sdkPath: 'reportFundPaymentSummary.paymentDetail', run: (host, args) => host.reportFundPaymentSummary.paymentDetail((args as { id: Parameters<ReportFundPaymentSummaryCapability['paymentDetail']>[0] }).id) },
  { capabilityId: 'report-fund-payment-summary-cancel', sdkPath: 'reportFundPaymentSummary.cancel', run: (host, args) => host.reportFundPaymentSummary.cancel((args as { id: Parameters<ReportFundPaymentSummaryCapability['cancel']>[0] }).id) },
  { capabilityId: 'report-insurance-payment-summary-list', sdkPath: 'reportInsurancePaymentSummary.list', run: (host, args) => host.reportInsurancePaymentSummary.list(args as Parameters<ReportInsurancePaymentSummaryCapability['list']>[0]) },
  { capabilityId: 'report-insurance-payment-summary-person-detail', sdkPath: 'reportInsurancePaymentSummary.personDetail', run: (host, args) => host.reportInsurancePaymentSummary.personDetail(args as Parameters<ReportInsurancePaymentSummaryCapability['personDetail']>[0]) },
  { capabilityId: 'report-insurance-payment-summary-prepare', sdkPath: 'reportInsurancePaymentSummary.prepare', run: (host, args) => Promise.resolve(host.reportInsurancePaymentSummary.prepare(args as Parameters<ReportInsurancePaymentSummaryCapability['prepare']>[0])) },
  { capabilityId: 'report-insurance-payment-summary-submit', sdkPath: 'reportInsurancePaymentSummary.submit', run: (host, args) => host.reportInsurancePaymentSummary.submit((args as { draft: Parameters<ReportInsurancePaymentSummaryCapability['submit']>[0]; startUserSelectAssignees?: Parameters<ReportInsurancePaymentSummaryCapability['submit']>[1] }).draft, (args as { draft: Parameters<ReportInsurancePaymentSummaryCapability['submit']>[0]; startUserSelectAssignees?: Parameters<ReportInsurancePaymentSummaryCapability['submit']>[1] }).startUserSelectAssignees) },
  { capabilityId: 'report-insurance-payment-summary-payment-detail', sdkPath: 'reportInsurancePaymentSummary.paymentDetail', run: (host, args) => host.reportInsurancePaymentSummary.paymentDetail((args as { id: Parameters<ReportInsurancePaymentSummaryCapability['paymentDetail']>[0] }).id) },
  { capabilityId: 'report-insurance-payment-summary-cancel', sdkPath: 'reportInsurancePaymentSummary.cancel', run: (host, args) => host.reportInsurancePaymentSummary.cancel((args as { id: Parameters<ReportInsurancePaymentSummaryCapability['cancel']>[0] }).id) },
  { capabilityId: 'report-person-tax-list', sdkPath: 'reportPersonTax.list', run: (host, args) => host.reportPersonTax.list(args as Parameters<ReportPersonTaxCapability['list']>[0]) },
  { capabilityId: 'report-person-tax-export', sdkPath: 'reportPersonTax.export', run: (host, args) => host.reportPersonTax.export(args as Parameters<ReportPersonTaxCapability['export']>[0]) },
  { capabilityId: 'report-post-salary-list', sdkPath: 'reportPostSalary.list', run: (host, args) => host.reportPostSalary.list(args as Parameters<ReportPostSalaryCapability['list']>[0]) },
  { capabilityId: 'report-post-salary-export', sdkPath: 'reportPostSalary.export', run: (host, args) => host.reportPostSalary.export(args as Parameters<ReportPostSalaryCapability['export']>[0]) },
  { capabilityId: 'report-configuration-list', sdkPath: 'reportConfiguration.list', run: (host, args) => host.reportConfiguration.list(args as Parameters<ReportConfigurationCapability['list']>[0]) },
  { capabilityId: 'report-configuration-all', sdkPath: 'reportConfiguration.all', run: (host) => host.reportConfiguration.all() },
  { capabilityId: 'report-configuration-report-fields', sdkPath: 'reportConfiguration.reportFields', run: (host, args) => host.reportConfiguration.reportFields((args as { type?: Parameters<ReportConfigurationCapability['reportFields']>[0] }).type) },
  { capabilityId: 'report-configuration-get', sdkPath: 'reportConfiguration.get', run: (host, args) => host.reportConfiguration.get(args as Parameters<ReportConfigurationCapability['get']>[0]) },
  { capabilityId: 'report-configuration-get-detail', sdkPath: 'reportConfiguration.getDetail', run: (host, args) => host.reportConfiguration.getDetail(args as Parameters<ReportConfigurationCapability['getDetail']>[0]) },
  { capabilityId: 'report-configuration-export', sdkPath: 'reportConfiguration.export', run: (host, args) => host.reportConfiguration.export(args as Parameters<ReportConfigurationCapability['export']>[0]) },
  { capabilityId: 'report-configuration-prepare-create', sdkPath: 'reportConfiguration.prepareCreate', run: (host, args) => Promise.resolve(host.reportConfiguration.prepareCreate(args as Parameters<ReportConfigurationCapability['prepareCreate']>[0])) },
  { capabilityId: 'report-configuration-create', sdkPath: 'reportConfiguration.create', run: (host, args) => host.reportConfiguration.create(args as Parameters<ReportConfigurationCapability['create']>[0]) },
  { capabilityId: 'report-configuration-prepare-update', sdkPath: 'reportConfiguration.prepareUpdate', run: (host, args) => Promise.resolve(host.reportConfiguration.prepareUpdate(args as Parameters<ReportConfigurationCapability['prepareUpdate']>[0])) },
  { capabilityId: 'report-configuration-update', sdkPath: 'reportConfiguration.update', run: (host, args) => host.reportConfiguration.update(args as Parameters<ReportConfigurationCapability['update']>[0]) },
  { capabilityId: 'report-configuration-prepare-remove', sdkPath: 'reportConfiguration.prepareRemove', run: (host, args) => Promise.resolve(host.reportConfiguration.prepareRemove(args as Parameters<ReportConfigurationCapability['prepareRemove']>[0])) },
  { capabilityId: 'report-configuration-remove', sdkPath: 'reportConfiguration.remove', run: (host, args) => host.reportConfiguration.remove(args as Parameters<ReportConfigurationCapability['remove']>[0]) },
  { capabilityId: 'report-configuration-prepare-copy', sdkPath: 'reportConfiguration.prepareCopy', run: (host, args) => Promise.resolve(host.reportConfiguration.prepareCopy(args as Parameters<ReportConfigurationCapability['prepareCopy']>[0])) },
  { capabilityId: 'report-configuration-copy', sdkPath: 'reportConfiguration.copy', run: (host, args) => host.reportConfiguration.copy(args as Parameters<ReportConfigurationCapability['copy']>[0]) },
  { capabilityId: 'report-retirement-salary-summary-list', sdkPath: 'reportRetirementSalarySummary.list', run: (host, args) => host.reportRetirementSalarySummary.list(args as Parameters<ReportRetirementSalarySummaryCapability['list']>[0]) },
  { capabilityId: 'report-retirement-salary-summary-detail', sdkPath: 'reportRetirementSalarySummary.detail', run: (host, args) => host.reportRetirementSalarySummary.detail(args as Parameters<ReportRetirementSalarySummaryCapability['detail']>[0]) },
  { capabilityId: 'report-temporary-salary-summary-list', sdkPath: 'reportTemporarySalarySummary.list', run: (host, args) => host.reportTemporarySalarySummary.list(args as Parameters<ReportTemporarySalarySummaryCapability['list']>[0]) },
  { capabilityId: 'report-temporary-salary-summary-detail', sdkPath: 'reportTemporarySalarySummary.detail', run: (host, args) => host.reportTemporarySalarySummary.detail(args as Parameters<ReportTemporarySalarySummaryCapability['detail']>[0]) },
  { capabilityId: 'report-temporary-salary-list', sdkPath: 'reportTemporarySalary.list', run: (host, args) => host.reportTemporarySalary.list(args as Parameters<ReportTemporarySalaryCapability['list']>[0]) },
  { capabilityId: 'report-temporary-salary-get', sdkPath: 'reportTemporarySalary.get', run: (host, args) => host.reportTemporarySalary.get(args as Parameters<ReportTemporarySalaryCapability['get']>[0]) },
  { capabilityId: 'report-temporary-salary-prepare-create', sdkPath: 'reportTemporarySalary.prepareCreate', run: (host, args) => Promise.resolve(host.reportTemporarySalary.prepareCreate(args as Parameters<ReportTemporarySalaryCapability['prepareCreate']>[0])) },
  { capabilityId: 'report-temporary-salary-create', sdkPath: 'reportTemporarySalary.create', run: (host, args) => host.reportTemporarySalary.create(args as Parameters<ReportTemporarySalaryCapability['create']>[0]) },
  { capabilityId: 'report-temporary-salary-prepare-update', sdkPath: 'reportTemporarySalary.prepareUpdate', run: (host, args) => Promise.resolve(host.reportTemporarySalary.prepareUpdate(args as Parameters<ReportTemporarySalaryCapability['prepareUpdate']>[0])) },
  { capabilityId: 'report-temporary-salary-update', sdkPath: 'reportTemporarySalary.update', run: (host, args) => host.reportTemporarySalary.update(args as Parameters<ReportTemporarySalaryCapability['update']>[0]) },
  { capabilityId: 'report-temporary-salary-prepare-remove', sdkPath: 'reportTemporarySalary.prepareRemove', run: (host, args) => Promise.resolve(host.reportTemporarySalary.prepareRemove(args as Parameters<ReportTemporarySalaryCapability['prepareRemove']>[0])) },
  { capabilityId: 'report-temporary-salary-remove', sdkPath: 'reportTemporarySalary.remove', run: (host, args) => host.reportTemporarySalary.remove(args as Parameters<ReportTemporarySalaryCapability['remove']>[0]) },
  { capabilityId: 'report-temporary-salary-download-template', sdkPath: 'reportTemporarySalary.downloadTemplate', run: host => host.reportTemporarySalary.downloadTemplate() },
  { capabilityId: 'report-temporary-salary-prepare-import', sdkPath: 'reportTemporarySalary.prepareImport', run: (host, args) => Promise.resolve(host.reportTemporarySalary.prepareImport(args as Parameters<ReportTemporarySalaryCapability['prepareImport']>[0])) },
  { capabilityId: 'report-temporary-salary-import', sdkPath: 'reportTemporarySalary.importExcel', run: (host, args) => host.reportTemporarySalary.importExcel(args as Parameters<ReportTemporarySalaryCapability['importExcel']>[0]) },
  { capabilityId: 'report-temporary-salary-prepare-create-summary', sdkPath: 'reportTemporarySalary.prepareCreateSummary', run: (host, args) => Promise.resolve(host.reportTemporarySalary.prepareCreateSummary(args as Parameters<ReportTemporarySalaryCapability['prepareCreateSummary']>[0])) },
  { capabilityId: 'report-temporary-salary-create-summary', sdkPath: 'reportTemporarySalary.createSummary', run: (host, args) => host.reportTemporarySalary.createSummary(args as Parameters<ReportTemporarySalaryCapability['createSummary']>[0]) },
  { capabilityId: 'report-retirement-salary-list', sdkPath: 'reportRetirementSalary.list', run: (host, args) => host.reportRetirementSalary.list(args as Parameters<ReportRetirementSalaryCapability['list']>[0]) },
  { capabilityId: 'report-retirement-salary-get', sdkPath: 'reportRetirementSalary.get', run: (host, args) => host.reportRetirementSalary.get(args as Parameters<ReportRetirementSalaryCapability['get']>[0]) },
  { capabilityId: 'report-retirement-salary-prepare-create', sdkPath: 'reportRetirementSalary.prepareCreate', run: (host, args) => Promise.resolve(host.reportRetirementSalary.prepareCreate(args as Parameters<ReportRetirementSalaryCapability['prepareCreate']>[0])) },
  { capabilityId: 'report-retirement-salary-create', sdkPath: 'reportRetirementSalary.create', run: (host, args) => host.reportRetirementSalary.create(args as Parameters<ReportRetirementSalaryCapability['create']>[0]) },
  { capabilityId: 'report-retirement-salary-prepare-update', sdkPath: 'reportRetirementSalary.prepareUpdate', run: (host, args) => Promise.resolve(host.reportRetirementSalary.prepareUpdate(args as Parameters<ReportRetirementSalaryCapability['prepareUpdate']>[0])) },
  { capabilityId: 'report-retirement-salary-update', sdkPath: 'reportRetirementSalary.update', run: (host, args) => host.reportRetirementSalary.update(args as Parameters<ReportRetirementSalaryCapability['update']>[0]) },
  { capabilityId: 'report-retirement-salary-prepare-remove', sdkPath: 'reportRetirementSalary.prepareRemove', run: (host, args) => Promise.resolve(host.reportRetirementSalary.prepareRemove(args as Parameters<ReportRetirementSalaryCapability['prepareRemove']>[0])) },
  { capabilityId: 'report-retirement-salary-remove', sdkPath: 'reportRetirementSalary.remove', run: (host, args) => host.reportRetirementSalary.remove(args as Parameters<ReportRetirementSalaryCapability['remove']>[0]) },
  { capabilityId: 'report-retirement-salary-download-template', sdkPath: 'reportRetirementSalary.downloadTemplate', run: (host) => host.reportRetirementSalary.downloadTemplate() },
  { capabilityId: 'report-retirement-salary-prepare-import', sdkPath: 'reportRetirementSalary.prepareImport', run: (host, args) => Promise.resolve(host.reportRetirementSalary.prepareImport(args as Parameters<ReportRetirementSalaryCapability['prepareImport']>[0])) },
  { capabilityId: 'report-retirement-salary-import', sdkPath: 'reportRetirementSalary.importExcel', run: (host, args) => host.reportRetirementSalary.importExcel(args as Parameters<ReportRetirementSalaryCapability['importExcel']>[0]) },
  { capabilityId: 'report-retirement-salary-prepare-create-summary', sdkPath: 'reportRetirementSalary.prepareCreateSummary', run: (host, args) => Promise.resolve(host.reportRetirementSalary.prepareCreateSummary(args as Parameters<ReportRetirementSalaryCapability['prepareCreateSummary']>[0])) },
  { capabilityId: 'report-retirement-salary-create-summary', sdkPath: 'reportRetirementSalary.createSummary', run: (host, args) => host.reportRetirementSalary.createSummary(args as Parameters<ReportRetirementSalaryCapability['createSummary']>[0]) },
  { capabilityId: 'report-salary-bill-list', sdkPath: 'reportSalaryBill.list', run: (host, args) => host.reportSalaryBill.list(args as Parameters<ReportSalaryBillCapability['list']>[0]) },
  { capabilityId: 'report-salary-bill-export', sdkPath: 'reportSalaryBill.export', run: (host, args) => host.reportSalaryBill.export(args as Parameters<ReportSalaryBillCapability['export']>[0]) },
  { capabilityId: 'report-salary-cost-list', sdkPath: 'reportSalaryCost.list', run: (host, args) => host.reportSalaryCost.list(args as Parameters<ReportSalaryCostCapability['list']>[0]) },
  { capabilityId: 'report-salary-cost-export', sdkPath: 'reportSalaryCost.export', run: (host, args) => host.reportSalaryCost.export(args as Parameters<ReportSalaryCostCapability['export']>[0]) },
  ...Object.entries(REPORT_LABOR_COST_ALLOCATION_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `reportLaborCostAllocation.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.reportLaborCostAllocation as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`人工成本计提分配表调用方法不存在：reportLaborCostAllocation.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.reportLaborCostAllocation, input))
    },
  })),
  ...Object.entries(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `reportLeadershipProfitSalary.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.reportLeadershipProfitSalary as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`领导利润工资计提表调用方法不存在：reportLeadershipProfitSalary.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.reportLeadershipProfitSalary, input))
    },
  })),
  ...Object.entries(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `reportUnitInterferenceCostAllocation.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.reportUnitInterferenceCostAllocation as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`单元间人员混用费用分摊表调用方法不存在：reportUnitInterferenceCostAllocation.${method}`)
      const input = method === 'prepareCreate' ? args.form : args
      return Promise.resolve(fn.call(host.reportUnitInterferenceCostAllocation, input))
    },
  })),
  { capabilityId: 'report-salary-item-list', sdkPath: 'reportSalaryItem.list', run: (host, args) => host.reportSalaryItem.list(args as Parameters<ReportSalaryItemCapability['list']>[0]) },
  { capabilityId: 'report-salary-item-export', sdkPath: 'reportSalaryItem.export', run: (host, args) => host.reportSalaryItem.export(args as Parameters<ReportSalaryItemCapability['export']>[0]) },
  { capabilityId: 'salary-process-list', sdkPath: 'salaryProcess.list', run: (host, args) => host.salaryProcess.list(args as Parameters<SalaryProcessCapability['list']>[0]) },
  { capabilityId: 'salary-process-get', sdkPath: 'salaryProcess.get', run: (host, args) => host.salaryProcess.get(args as Parameters<SalaryProcessCapability['get']>[0]) },
  { capabilityId: 'salary-process-ledger-options', sdkPath: 'salaryProcess.ledgerOptions', run: host => host.salaryProcess.ledgerOptions() },
  { capabilityId: 'salary-process-legal-person-options', sdkPath: 'salaryProcess.legalPersonOptions', run: host => host.salaryProcess.legalPersonOptions() },
  { capabilityId: 'salary-process-cost-center-options', sdkPath: 'salaryProcess.costCenterOptions', run: host => host.salaryProcess.costCenterOptions() },
  { capabilityId: 'salary-process-salary-level-options', sdkPath: 'salaryProcess.salaryLevelOptions', run: host => host.salaryProcess.salaryLevelOptions() },
  { capabilityId: 'salary-process-check-start', sdkPath: 'salaryProcess.checkStart', run: (host, args) => host.salaryProcess.checkStart(args as Parameters<SalaryProcessCapability['checkStart']>[0]) },
  { capabilityId: 'salary-process-prepare-start', sdkPath: 'salaryProcess.prepareStart', run: (host, args) => Promise.resolve(host.salaryProcess.prepareStart(args as Parameters<SalaryProcessCapability['prepareStart']>[0])) },
  { capabilityId: 'salary-process-start', sdkPath: 'salaryProcess.start', run: (host, args) => host.salaryProcess.start(args as Parameters<SalaryProcessCapability['start']>[0]) },
  { capabilityId: 'salary-process-prepare-update', sdkPath: 'salaryProcess.prepareUpdate', run: (host, args) => Promise.resolve(host.salaryProcess.prepareUpdate(args as Parameters<SalaryProcessCapability['prepareUpdate']>[0])) },
  { capabilityId: 'salary-process-update', sdkPath: 'salaryProcess.update', run: (host, args) => host.salaryProcess.update(args as Parameters<SalaryProcessCapability['update']>[0]) },
  { capabilityId: 'salary-process-prepare-stop', sdkPath: 'salaryProcess.prepareStop', run: (host, args) => Promise.resolve(host.salaryProcess.prepareStop(args as Parameters<SalaryProcessCapability['prepareStop']>[0])) },
  { capabilityId: 'salary-process-stop', sdkPath: 'salaryProcess.stop', run: (host, args) => host.salaryProcess.stop(args as Parameters<SalaryProcessCapability['stop']>[0]) },
  { capabilityId: 'salary-process-prepare-edit-legal-person', sdkPath: 'salaryProcess.prepareEditLegalPerson', run: (host, args) => Promise.resolve(host.salaryProcess.prepareEditLegalPerson(args as Parameters<SalaryProcessCapability['prepareEditLegalPerson']>[0])) },
  { capabilityId: 'salary-process-edit-legal-person', sdkPath: 'salaryProcess.editLegalPerson', run: (host, args) => host.salaryProcess.editLegalPerson(args as Parameters<SalaryProcessCapability['editLegalPerson']>[0]) },
  { capabilityId: 'salary-process-prepare-edit-cost-center', sdkPath: 'salaryProcess.prepareEditCostCenter', run: (host, args) => Promise.resolve(host.salaryProcess.prepareEditCostCenter(args as Parameters<SalaryProcessCapability['prepareEditCostCenter']>[0])) },
  { capabilityId: 'salary-process-edit-cost-center', sdkPath: 'salaryProcess.editCostCenter', run: (host, args) => host.salaryProcess.editCostCenter(args as Parameters<SalaryProcessCapability['editCostCenter']>[0]) },
  { capabilityId: 'salary-process-prepare-clear-tax-date', sdkPath: 'salaryProcess.prepareClearTaxDate', run: (host, args) => Promise.resolve(host.salaryProcess.prepareClearTaxDate(args as Parameters<SalaryProcessCapability['prepareClearTaxDate']>[0])) },
  { capabilityId: 'salary-process-clear-tax-date', sdkPath: 'salaryProcess.clearTaxDate', run: (host, args) => host.salaryProcess.clearTaxDate(args as Parameters<SalaryProcessCapability['clearTaxDate']>[0]) },
  { capabilityId: 'salary-process-export', sdkPath: 'salaryProcess.export', run: (host, args) => host.salaryProcess.export(args as Parameters<SalaryProcessCapability['export']>[0]) },
  { capabilityId: 'salary-process-download-batch-start-template', sdkPath: 'salaryProcess.downloadBatchStartTemplate', run: host => host.salaryProcess.downloadBatchStartTemplate() },
  { capabilityId: 'salary-process-prepare-batch-start', sdkPath: 'salaryProcess.prepareBatchStart', run: (host, args) => Promise.resolve(host.salaryProcess.prepareBatchStart(args as Parameters<SalaryProcessCapability['prepareBatchStart']>[0])) },
  { capabilityId: 'salary-process-batch-start', sdkPath: 'salaryProcess.batchStart', run: (host, args) => host.salaryProcess.batchStart(args as Parameters<SalaryProcessCapability['batchStart']>[0]) },
  { capabilityId: 'salary-process-download-batch-stop-template', sdkPath: 'salaryProcess.downloadBatchStopTemplate', run: host => host.salaryProcess.downloadBatchStopTemplate() },
  { capabilityId: 'salary-process-prepare-batch-stop', sdkPath: 'salaryProcess.prepareBatchStop', run: (host, args) => Promise.resolve(host.salaryProcess.prepareBatchStop(args as Parameters<SalaryProcessCapability['prepareBatchStop']>[0])) },
  { capabilityId: 'salary-process-batch-stop', sdkPath: 'salaryProcess.batchStop', run: (host, args) => host.salaryProcess.batchStop(args as Parameters<SalaryProcessCapability['batchStop']>[0]) },
  { capabilityId: 'salary-accounting-list', sdkPath: 'salaryAccounting.list', run: (host, args) => host.salaryAccounting.list(args as Parameters<SalaryAccountingCapability['list']>[0]) },
  { capabilityId: 'salary-accounting-get', sdkPath: 'salaryAccounting.get', run: (host, args) => host.salaryAccounting.get(args as Parameters<SalaryAccountingCapability['get']>[0]) },
  { capabilityId: 'salary-accounting-step-info', sdkPath: 'salaryAccounting.stepInfo', run: (host, args) => host.salaryAccounting.stepInfo(args as Parameters<SalaryAccountingCapability['stepInfo']>[0]) },
  { capabilityId: 'salary-accounting-ledger-item-list', sdkPath: 'salaryAccounting.ledgerItemList', run: (host, args) => host.salaryAccounting.ledgerItemList(args as Parameters<SalaryAccountingCapability['ledgerItemList']>[0]) },
  { capabilityId: 'salary-accounting-prepare-create', sdkPath: 'salaryAccounting.prepareCreate', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareCreate(args as Parameters<SalaryAccountingCapability['prepareCreate']>[0])) },
  { capabilityId: 'salary-accounting-create', sdkPath: 'salaryAccounting.create', run: (host, args) => host.salaryAccounting.create(args as Parameters<SalaryAccountingCapability['create']>[0]) },
  { capabilityId: 'salary-accounting-prepare-save-staff', sdkPath: 'salaryAccounting.prepareSaveStaff', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareSaveStaff(args as Parameters<SalaryAccountingCapability['prepareSaveStaff']>[0])) },
  { capabilityId: 'salary-accounting-save-staff', sdkPath: 'salaryAccounting.saveStaff', run: (host, args) => host.salaryAccounting.saveStaff(args as Parameters<SalaryAccountingCapability['saveStaff']>[0]) },
  { capabilityId: 'salary-accounting-prepare-calculate', sdkPath: 'salaryAccounting.prepareCalculate', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareCalculate(args as Parameters<SalaryAccountingCapability['prepareCalculate']>[0])) },
  { capabilityId: 'salary-accounting-calculate', sdkPath: 'salaryAccounting.calculate', run: (host, args) => host.salaryAccounting.calculate(args as Parameters<SalaryAccountingCapability['calculate']>[0]) },
  { capabilityId: 'salary-accounting-prepare-remove', sdkPath: 'salaryAccounting.prepareRemove', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareRemove(args as Parameters<SalaryAccountingCapability['prepareRemove']>[0])) },
  { capabilityId: 'salary-accounting-remove', sdkPath: 'salaryAccounting.remove', run: (host, args) => host.salaryAccounting.remove(args as Parameters<SalaryAccountingCapability['remove']>[0]) },
  { capabilityId: 'salary-accounting-prepare-checkout', sdkPath: 'salaryAccounting.prepareCheckout', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareCheckout(args as Parameters<SalaryAccountingCapability['prepareCheckout']>[0])) },
  { capabilityId: 'salary-accounting-checkout', sdkPath: 'salaryAccounting.checkout', run: (host, args) => host.salaryAccounting.checkout(args as Parameters<SalaryAccountingCapability['checkout']>[0]) },
  { capabilityId: 'salary-accounting-cancel-checkout', sdkPath: 'salaryAccounting.cancelCheckout', run: (host, args) => host.salaryAccounting.cancelCheckout(args as Parameters<SalaryAccountingCapability['cancelCheckout']>[0]) },
  { capabilityId: 'salary-accounting-document-users', sdkPath: 'salaryAccounting.documentUsers', run: (host, args) => host.salaryAccounting.documentUsers(args as Parameters<SalaryAccountingCapability['documentUsers']>[0]) },
  { capabilityId: 'salary-accounting-history-users', sdkPath: 'salaryAccounting.historyUsers', run: host => host.salaryAccounting.historyUsers() },
  { capabilityId: 'salary-accounting-organization-tree', sdkPath: 'salaryAccounting.organizationTree', run: host => host.salaryAccounting.organizationTree() },
  { capabilityId: 'salary-accounting-staff-list', sdkPath: 'salaryAccounting.staffList', run: (host, args) => host.salaryAccounting.staffList(args as Parameters<SalaryAccountingCapability['staffList']>[0]) },
  { capabilityId: 'salary-accounting-last-staff', sdkPath: 'salaryAccounting.lastStaff', run: (host, args) => host.salaryAccounting.lastStaff(args as Parameters<SalaryAccountingCapability['lastStaff']>[0]) },
  { capabilityId: 'salary-accounting-prepare-staff-import', sdkPath: 'salaryAccounting.prepareStaffImport', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareStaffImport(args as Parameters<SalaryAccountingCapability['prepareStaffImport']>[0])) },
  { capabilityId: 'salary-accounting-staff-import', sdkPath: 'salaryAccounting.staffImport', run: (host, args) => host.salaryAccounting.staffImport(args as Parameters<SalaryAccountingCapability['staffImport']>[0]) },
  { capabilityId: 'salary-accounting-second-template', sdkPath: 'salaryAccounting.secondTemplate', run: host => host.salaryAccounting.secondTemplate() },
  { capabilityId: 'salary-accounting-external-items', sdkPath: 'salaryAccounting.externalItems', run: (host, args) => host.salaryAccounting.externalItems(args as Parameters<SalaryAccountingCapability['externalItems']>[0]) },
  { capabilityId: 'salary-accounting-existing-external-items', sdkPath: 'salaryAccounting.existingExternalItems', run: (host, args) => host.salaryAccounting.existingExternalItems(args as Parameters<SalaryAccountingCapability['existingExternalItems']>[0]) },
  { capabilityId: 'salary-accounting-prepare-external-import', sdkPath: 'salaryAccounting.prepareExternalImport', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareExternalImport(args as Parameters<SalaryAccountingCapability['prepareExternalImport']>[0])) },
  { capabilityId: 'salary-accounting-external-account-result', sdkPath: 'salaryAccounting.externalAccountResult', run: (host, args) => host.salaryAccounting.externalAccountResult(args as Parameters<SalaryAccountingCapability['externalAccountResult']>[0]) },
  { capabilityId: 'salary-accounting-import-result', sdkPath: 'salaryAccounting.importExternalResult', run: (host, args) => host.salaryAccounting.importExternalResult(args as Parameters<SalaryAccountingCapability['importExternalResult']>[0]) },
  { capabilityId: 'salary-accounting-external-template', sdkPath: 'salaryAccounting.externalTemplate', run: (host, args) => host.salaryAccounting.externalTemplate(args as Parameters<SalaryAccountingCapability['externalTemplate']>[0]) },
  { capabilityId: 'salary-accounting-detail', sdkPath: 'salaryAccounting.detail', run: (host, args) => host.salaryAccounting.detail(args as Parameters<SalaryAccountingCapability['detail']>[0]) },
  { capabilityId: 'salary-accounting-detail-users', sdkPath: 'salaryAccounting.detailUsers', run: (host, args) => host.salaryAccounting.detailUsers(args as Parameters<SalaryAccountingCapability['detailUsers']>[0]) },
  { capabilityId: 'salary-accounting-detail-export', sdkPath: 'salaryAccounting.detailExport', run: (host, args) => host.salaryAccounting.detailExport(args as Parameters<SalaryAccountingCapability['detailExport']>[0]) },
  { capabilityId: 'salary-accounting-prepare-pay', sdkPath: 'salaryAccounting.preparePay', run: (host, args) => Promise.resolve(host.salaryAccounting.preparePay(args as Parameters<SalaryAccountingCapability['preparePay']>[0])) },
  { capabilityId: 'salary-accounting-pay', sdkPath: 'salaryAccounting.pay', run: (host, args) => host.salaryAccounting.pay(args as Parameters<SalaryAccountingCapability['pay']>[0]) },
  { capabilityId: 'salary-accounting-prepare-rename', sdkPath: 'salaryAccounting.prepareRename', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareRename(args as Parameters<SalaryAccountingCapability['prepareRename']>[0])) },
  { capabilityId: 'salary-accounting-rename', sdkPath: 'salaryAccounting.rename', run: (host, args) => host.salaryAccounting.rename(args as Parameters<SalaryAccountingCapability['rename']>[0]) },
  { capabilityId: 'salary-accounting-cancel-rename', sdkPath: 'salaryAccounting.cancelRename', run: host => Promise.resolve(host.salaryAccounting.cancelRename()) },
  { capabilityId: 'salary-accounting-prepare-split', sdkPath: 'salaryAccounting.prepareSplit', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareSplit(args as Parameters<SalaryAccountingCapability['prepareSplit']>[0])) },
  { capabilityId: 'salary-accounting-split', sdkPath: 'salaryAccounting.split', run: (host, args) => host.salaryAccounting.split(args as Parameters<SalaryAccountingCapability['split']>[0]) },
  { capabilityId: 'salary-accounting-temporary-detail-list', sdkPath: 'salaryAccounting.temporaryDetailList', run: (host, args) => host.salaryAccounting.temporaryDetailList(args as Parameters<SalaryAccountingCapability['temporaryDetailList']>[0]) },
  { capabilityId: 'salary-accounting-prepare-temporary-detail-update', sdkPath: 'salaryAccounting.prepareTemporaryDetailUpdate', run: (host, args) => Promise.resolve(host.salaryAccounting.prepareTemporaryDetailUpdate(args as Parameters<SalaryAccountingCapability['prepareTemporaryDetailUpdate']>[0])) },
  { capabilityId: 'salary-accounting-temporary-detail-update', sdkPath: 'salaryAccounting.temporaryDetailUpdate', run: (host, args) => host.salaryAccounting.temporaryDetailUpdate(args as Parameters<SalaryAccountingCapability['temporaryDetailUpdate']>[0]) },
  { capabilityId: 'salary-package-list', sdkPath: 'salaryPackage.list', run: host => host.salaryPackage.list() },
  { capabilityId: 'salary-package-get', sdkPath: 'salaryPackage.get', run: (host, args) => host.salaryPackage.get(args as Parameters<SalaryPackageCapability['get']>[0]) },
  { capabilityId: 'salary-package-prepare-create', sdkPath: 'salaryPackage.prepareCreate', run: (host, args) => Promise.resolve(host.salaryPackage.prepareCreate(args as Parameters<SalaryPackageCapability['prepareCreate']>[0])) },
  { capabilityId: 'salary-package-create', sdkPath: 'salaryPackage.create', run: (host, args) => host.salaryPackage.create(args as Parameters<SalaryPackageCapability['create']>[0]) },
  { capabilityId: 'salary-package-prepare-update', sdkPath: 'salaryPackage.prepareUpdate', run: (host, args) => Promise.resolve(host.salaryPackage.prepareUpdate(args as Parameters<SalaryPackageCapability['prepareUpdate']>[0])) },
  { capabilityId: 'salary-package-update', sdkPath: 'salaryPackage.update', run: (host, args) => host.salaryPackage.update(args as Parameters<SalaryPackageCapability['update']>[0]) },
  { capabilityId: 'salary-package-prepare-copy', sdkPath: 'salaryPackage.prepareCopy', run: (host, args) => Promise.resolve(host.salaryPackage.prepareCopy(args as Parameters<SalaryPackageCapability['prepareCopy']>[0])) },
  { capabilityId: 'salary-package-copy', sdkPath: 'salaryPackage.copy', run: (host, args) => host.salaryPackage.copy(args as Parameters<SalaryPackageCapability['copy']>[0]) },
  { capabilityId: 'salary-package-prepare-remove', sdkPath: 'salaryPackage.prepareRemove', run: (host, args) => Promise.resolve(host.salaryPackage.prepareRemove(args as Parameters<SalaryPackageCapability['prepareRemove']>[0])) },
  { capabilityId: 'salary-package-remove', sdkPath: 'salaryPackage.remove', run: (host, args) => host.salaryPackage.remove(args as Parameters<SalaryPackageCapability['remove']>[0]) },
  { capabilityId: 'salary-package-organization-tree', sdkPath: 'salaryPackage.organizationTree', run: host => host.salaryPackage.organizationTree() },
  { capabilityId: 'salary-package-organization-page', sdkPath: 'salaryPackage.organizationPage', run: (host, args) => host.salaryPackage.organizationPage(args as Parameters<SalaryPackageCapability['organizationPage']>[0]) },
  { capabilityId: 'salary-package-role-options', sdkPath: 'salaryPackage.roleOptions', run: host => host.salaryPackage.roleOptions() },
  { capabilityId: 'salary-package-item-list', sdkPath: 'salaryPackage.itemList', run: (host, args) => host.salaryPackage.itemList(args as Parameters<SalaryPackageCapability['itemList']>[0]) },
  { capabilityId: 'salary-package-item-get', sdkPath: 'salaryPackage.itemGet', run: (host, args) => host.salaryPackage.itemGet(args as Parameters<SalaryPackageCapability['itemGet']>[0]) },
  { capabilityId: 'salary-package-item-formula-options', sdkPath: 'salaryPackage.itemFormulaOptions', run: host => host.salaryPackage.itemFormulaOptions() },
  { capabilityId: 'salary-package-item-check-formula', sdkPath: 'salaryPackage.itemCheckFormula', run: (host, args) => host.salaryPackage.itemCheckFormula(args as Parameters<SalaryPackageCapability['itemCheckFormula']>[0]) },
  { capabilityId: 'salary-package-item-prepare-update', sdkPath: 'salaryPackage.prepareItemUpdate', run: (host, args) => Promise.resolve(host.salaryPackage.prepareItemUpdate(args as Parameters<SalaryPackageCapability['prepareItemUpdate']>[0])) },
  { capabilityId: 'salary-package-item-update', sdkPath: 'salaryPackage.itemUpdate', run: (host, args) => host.salaryPackage.itemUpdate(args as Parameters<SalaryPackageCapability['itemUpdate']>[0]) },
  { capabilityId: 'salary-package-item-available', sdkPath: 'salaryPackage.itemAvailable', run: (host, args) => host.salaryPackage.itemAvailable(args as Parameters<SalaryPackageCapability['itemAvailable']>[0]) },
  { capabilityId: 'salary-package-item-prepare-import', sdkPath: 'salaryPackage.prepareItemImport', run: (host, args) => Promise.resolve(host.salaryPackage.prepareItemImport(args as Parameters<SalaryPackageCapability['prepareItemImport']>[0])) },
  { capabilityId: 'salary-package-item-import', sdkPath: 'salaryPackage.itemImport', run: (host, args) => host.salaryPackage.itemImport(args as Parameters<SalaryPackageCapability['itemImport']>[0]) },
  { capabilityId: 'salary-package-item-prepare-remove', sdkPath: 'salaryPackage.prepareItemRemove', run: (host, args) => Promise.resolve(host.salaryPackage.prepareItemRemove(args as Parameters<SalaryPackageCapability['prepareItemRemove']>[0])) },
  { capabilityId: 'salary-package-item-remove', sdkPath: 'salaryPackage.itemRemove', run: (host, args) => host.salaryPackage.itemRemove(args as Parameters<SalaryPackageCapability['itemRemove']>[0]) },
  ...Object.entries(SALARY_ADJUST_IMPORT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salaryAdjustImport.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salaryAdjustImport as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`工资导入调用方法不存在：salaryAdjustImport.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salaryAdjustImport) : fn.call(host.salaryAdjustImport, args))
    },
  })),
  ...Object.entries(SALARY_PERSON_TAX_FILE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salaryPersonTaxFile.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salaryPersonTaxFile as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`扣款归档调用方法不存在：salaryPersonTaxFile.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salaryPersonTaxFile) : fn.call(host.salaryPersonTaxFile, args))
    },
  })),
  ...Object.entries(SALARY_PERSON_TAX_HANDLE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salaryPersonTaxHandle.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salaryPersonTaxHandle as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`扣款办理调用方法不存在：salaryPersonTaxHandle.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salaryPersonTaxHandle) : fn.call(host.salaryPersonTaxHandle, args))
    },
  })),
  ...Object.entries(SALARY_PERSON_TAX_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salaryPersonTax.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salaryPersonTax as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`扣款费用调用方法不存在：salaryPersonTax.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salaryPersonTax) : fn.call(host.salaryPersonTax, args))
    },
  })),
  { capabilityId: 'salary-level-list', sdkPath: 'salaryLevel.list', run: (host, args) => host.salaryLevel.list(args as Parameters<SalaryLevelCapability['list']>[0]) },
  { capabilityId: 'salary-level-get', sdkPath: 'salaryLevel.get', run: (host, args) => host.salaryLevel.get(args as Parameters<SalaryLevelCapability['get']>[0]) },
  { capabilityId: 'salary-level-create', sdkPath: 'salaryLevel.create', run: (host, args) => host.salaryLevel.create(args as Parameters<SalaryLevelCapability['create']>[0]) },
  { capabilityId: 'salary-level-update', sdkPath: 'salaryLevel.update', run: (host, args) => host.salaryLevel.update(args as Parameters<SalaryLevelCapability['update']>[0]) },
  { capabilityId: 'salary-level-prepare-remove', sdkPath: 'salaryLevel.prepareRemove', run: (host, args) => host.salaryLevel.prepareRemove(args as Parameters<SalaryLevelCapability['prepareRemove']>[0]) },
  { capabilityId: 'salary-level-send-delete-code', sdkPath: 'salaryLevel.sendDeleteCode', run: (host, args) => host.salaryLevel.sendDeleteCode(args as Parameters<SalaryLevelCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'salary-level-remove', sdkPath: 'salaryLevel.remove', run: (host, args) => host.salaryLevel.remove(args as Parameters<SalaryLevelCapability['remove']>[0]) },
  { capabilityId: 'setting-category-dict-list', sdkPath: 'settingCategoryDict.list', run: (host, args) => host.settingCategoryDict.list(args as Parameters<SettingCategoryDictCapability['list']>[0]) },
  { capabilityId: 'setting-category-dict-create', sdkPath: 'settingCategoryDict.create', run: (host, args) => host.settingCategoryDict.create(args as Parameters<SettingCategoryDictCapability['create']>[0]) },
  { capabilityId: 'setting-category-dict-update', sdkPath: 'settingCategoryDict.update', run: (host, args) => host.settingCategoryDict.update(args as Parameters<SettingCategoryDictCapability['update']>[0]) },
  { capabilityId: 'setting-category-dict-remove', sdkPath: 'settingCategoryDict.remove', run: (host, args) => host.settingCategoryDict.remove((args as { id: string | number }).id) },
  { capabilityId: 'sale-setting-dict-list', sdkPath: 'saleSettingDict.list', run: (host, args) => host.saleSettingDict.list(args as Parameters<SaleSettingDictCapability['list']>[0]) },
  { capabilityId: 'sale-setting-dict-get', sdkPath: 'saleSettingDict.get', run: (host, args) => host.saleSettingDict.get(args as Parameters<SaleSettingDictCapability['get']>[0]) },
  { capabilityId: 'sale-setting-dict-create', sdkPath: 'saleSettingDict.create', run: (host, args) => host.saleSettingDict.create(args as Parameters<SaleSettingDictCapability['create']>[0]) },
  { capabilityId: 'sale-setting-dict-update', sdkPath: 'saleSettingDict.update', run: (host, args) => host.saleSettingDict.update(args as Parameters<SaleSettingDictCapability['update']>[0]) },
  { capabilityId: 'sale-setting-dict-remove', sdkPath: 'saleSettingDict.remove', run: (host, args) => host.saleSettingDict.remove(args as Parameters<SaleSettingDictCapability['remove']>[0]) },
  { capabilityId: 'sale-setting-dict-data-prepare-remove', sdkPath: 'saleSettingDict.prepareRemoveData', run: (host, args) => Promise.resolve(host.saleSettingDict.prepareRemoveData(args as Parameters<SaleSettingDictCapability['prepareRemoveData']>[0])) },
  { capabilityId: 'sale-setting-dict-data-remove', sdkPath: 'saleSettingDict.removeData', run: (host, args) => host.saleSettingDict.removeData(args as Parameters<SaleSettingDictCapability['removeData']>[0]) },
  { capabilityId: 'sale-setting-dict-data-cancel-remove', sdkPath: 'saleSettingDict.cancelRemoveData', run: (host) => Promise.resolve(host.saleSettingDict.cancelRemoveData()) },
  ...Object.entries(SALE_SYS_DICT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleSysDict.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleSysDict as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`字典配置调用方法不存在：saleSysDict.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleSysDict) : fn.call(host.saleSysDict, args))
    },
  })),
  ...Object.entries(SALE_SERVICE_SUBJECT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleServiceSubject.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleServiceSubject as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`设置服务主体调用方法不存在：saleServiceSubject.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleServiceSubject) : fn.call(host.saleServiceSubject, args))
    },
  })),
  ...Object.entries(SALE_SCHEDULE_JOB_LOG_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleScheduleJobLog.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleScheduleJobLog as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`任务日志调用方法不存在：saleScheduleJobLog.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleScheduleJobLog) : fn.call(host.saleScheduleJobLog, args))
    },
  })),
  ...Object.entries(SALE_SCHEDULE_JOB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleScheduleJob.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleScheduleJob as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`任务管理调用方法不存在：saleScheduleJob.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleScheduleJob) : fn.call(host.saleScheduleJob, args))
    },
  })),
  ...Object.entries(SALE_CCB_ACCOUNT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleCcbAccount.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleCcbAccount as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`SAP收款账号调用方法不存在：saleCcbAccount.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleCcbAccount) : fn.call(host.saleCcbAccount, args))
    },
  })),
  ...Object.entries(SALE_PAYMENT_ACCOUNT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salePaymentAccount.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salePaymentAccount as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`收款账号调用方法不存在：salePaymentAccount.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salePaymentAccount) : fn.call(host.salePaymentAccount, args))
    },
  })),
  ...Object.entries(SALE_SYS_OFFICE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleSysOffice.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleSysOffice as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`机构扩展调用方法不存在：saleSysOffice.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleSysOffice) : fn.call(host.saleSysOffice, args))
    },
  })),
  ...Object.entries(SALE_SYS_USER_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleSysUser.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleSysUser as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`用户扩展调用方法不存在：saleSysUser.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleSysUser) : fn.call(host.saleSysUser, args))
    },
  })),
  ...Object.entries(SALE_TRADE_STOREROOM_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleTradeStoreroom.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleTradeStoreroom as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`工厂管理调用方法不存在：saleTradeStoreroom.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleTradeStoreroom) : fn.call(host.saleTradeStoreroom, args))
    },
  })),
  ...Object.entries(SALE_CLAIM_SETTING_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleClaimSetting.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleClaimSetting as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`理赔配置调用方法不存在：saleClaimSetting.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleClaimSetting) : fn.call(host.saleClaimSetting, args))
    },
  })),
  ...Object.entries(SALE_OLD_CHICKEN_SALE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleOldChickenSale.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleOldChickenSale as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`老母鸡销售调用方法不存在：saleOldChickenSale.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleOldChickenSale) : fn.call(host.saleOldChickenSale, args))
    },
  })),
  ...Object.entries(SALE_PRICE_CONTROL_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `salePriceControl.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.salePriceControl as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`价格管控调用方法不存在：salePriceControl.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.salePriceControl) : fn.call(host.salePriceControl, args))
    },
  })),
  ...Object.entries(SALE_LOW_PRICE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleLowPrice.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleLowPrice as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`低价设置调用方法不存在：saleLowPrice.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleLowPrice) : fn.call(host.saleLowPrice, args))
    },
  })),
  ...Object.entries(SALE_REGISTER_CODE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleRegisterCode.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.saleRegisterCode as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`国家代码管理调用方法不存在：saleRegisterCode.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.saleRegisterCode) : fn.call(host.saleRegisterCode, args))
    },
  })),
  { capabilityId: 'setting-dict-type-list', sdkPath: 'settingDictPlatform.list', run: (host, args) => host.settingDictPlatform.list(args as Parameters<SettingDictPlatformCapability['list']>[0]) },
  { capabilityId: 'setting-dict-data-list', sdkPath: 'settingDictPlatform.dataList', run: (host, args) => host.settingDictPlatform.dataList(args as Parameters<SettingDictPlatformCapability['dataList']>[0]) },
  { capabilityId: 'setting-dict-data-get', sdkPath: 'settingDictPlatform.dataGet', run: (host, args) => host.settingDictPlatform.dataGet(args as Parameters<SettingDictPlatformCapability['dataGet']>[0]) },
  { capabilityId: 'setting-dict-data-create', sdkPath: 'settingDictPlatform.dataCreate', run: (host, args) => host.settingDictPlatform.dataCreate(args as Parameters<SettingDictPlatformCapability['dataCreate']>[0]) },
  { capabilityId: 'setting-dict-data-update', sdkPath: 'settingDictPlatform.dataUpdate', run: (host, args) => host.settingDictPlatform.dataUpdate(args as Parameters<SettingDictPlatformCapability['dataUpdate']>[0]) },
  { capabilityId: 'setting-dict-data-remove', sdkPath: 'settingDictPlatform.dataRemove', run: (host, args) => host.settingDictPlatform.dataRemove(args as Parameters<SettingDictPlatformCapability['dataRemove']>[0]) },
  ...Object.entries(PLATFORM_DICT_MALL_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMall.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMall as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`平台字典调用方法不存在：platformDictMall.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMall) : fn.call(host.platformDictMall, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_COMMON_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallCommon.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallCommon as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`公共字典调用方法不存在：platformDictMallCommon.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallCommon) : fn.call(host.platformDictMallCommon, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_FINANCE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallFinance.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallFinance as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`财务字典调用方法不存在：platformDictMallFinance.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallFinance) : fn.call(host.platformDictMallFinance, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_HR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallHr.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallHr as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`人力字典调用方法不存在：platformDictMallHr.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallHr) : fn.call(host.platformDictMallHr, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_MATERIAL_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallMaterial.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallMaterial as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`资产字典调用方法不存在：platformDictMallMaterial.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallMaterial) : fn.call(host.platformDictMallMaterial, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_PRODUCT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallProduct.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallProduct as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`生产字典调用方法不存在：platformDictMallProduct.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallProduct) : fn.call(host.platformDictMallProduct, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_SALE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallSale.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallSale as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`销售字典调用方法不存在：platformDictMallSale.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallSale) : fn.call(host.platformDictMallSale, args))
    },
  })),
  ...Object.entries(PLATFORM_DICT_MALL_SUPPLY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `platformDictMallSupply.${method}`,
    run: (host: CapabilityHost, args: unknown) => {
      const fn = (host.platformDictMallSupply as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`采购字典调用方法不存在：platformDictMallSupply.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.platformDictMallSupply) : fn.call(host.platformDictMallSupply, args))
    },
  })),
  { capabilityId: 'setting-frontend-log-list', sdkPath: 'settingFrontendLog.list', run: (host, args) => host.settingFrontendLog.list(args as Parameters<SettingFrontendLogCapability['list']>[0]) },
  { capabilityId: 'setting-material-list', sdkPath: 'settingMaterial.list', run: (host, args) => host.settingMaterial.list(args as Parameters<SettingMaterialCapability['list']>[0]) },
  { capabilityId: 'setting-material-prepare-create', sdkPath: 'settingMaterial.prepareCreate', run: host => host.settingMaterial.prepareCreate() },
  { capabilityId: 'setting-material-create', sdkPath: 'settingMaterial.create', run: (host, args) => host.settingMaterial.create((args as { materials: Parameters<SettingMaterialCapability['create']>[0]['materials'] })) },
  { capabilityId: 'setting-material-remove', sdkPath: 'settingMaterial.remove', run: (host, args) => host.settingMaterial.remove(args as Parameters<SettingMaterialCapability['remove']>[0]) },
  { capabilityId: 'setting-material-platform-list', sdkPath: 'settingMaterial.platformList', run: (host, args) => host.settingMaterial.platformList(args as Parameters<SettingMaterialCapability['platformList']>[0]) },
  { capabilityId: 'setting-material-add-platform', sdkPath: 'settingMaterial.addPlatform', run: (host, args) => host.settingMaterial.addPlatform(args as Parameters<SettingMaterialCapability['addPlatform']>[0]) },
  { capabilityId: 'setting-material-get', sdkPath: 'settingMaterial.get', run: (host, args) => host.settingMaterial.get(args as Parameters<SettingMaterialCapability['get']>[0]) },
  { capabilityId: 'setting-material-view-lookups', sdkPath: 'settingMaterial.viewLookups', run: (host, args) => host.settingMaterial.viewLookups(args as Parameters<SettingMaterialCapability['viewLookups']>[0]) },
  { capabilityId: 'setting-material-receive-config-list', sdkPath: 'settingMaterial.receiveConfigList', run: (host, args) => host.settingMaterial.receiveConfigList(args as Parameters<SettingMaterialCapability['receiveConfigList']>[0]) },
  { capabilityId: 'setting-material-conversion-context', sdkPath: 'settingMaterial.conversionContext', run: (host, args) => host.settingMaterial.conversionContext(args as Parameters<SettingMaterialCapability['conversionContext']>[0]) },
  { capabilityId: 'setting-material-conversion-save', sdkPath: 'settingMaterial.conversionSave', run: (host, args) => host.settingMaterial.conversionSave(args as Parameters<SettingMaterialCapability['conversionSave']>[0]) },
  { capabilityId: 'setting-material-conversion-remove', sdkPath: 'settingMaterial.conversionRemove', run: (host, args) => host.settingMaterial.conversionRemove(args as Parameters<SettingMaterialCapability['conversionRemove']>[0]) },
  { capabilityId: 'setting-menu-list', sdkPath: 'settingMenu.list', run: host => host.settingMenu.list() },
  { capabilityId: 'setting-menu-get', sdkPath: 'settingMenu.get', run: (host, args) => host.settingMenu.get(args as Parameters<SettingMenuCapability['get']>[0]) },
  { capabilityId: 'setting-menu-create', sdkPath: 'settingMenu.create', run: (host, args) => host.settingMenu.create(args as Parameters<SettingMenuCapability['create']>[0]) },
  { capabilityId: 'setting-menu-create-many', sdkPath: 'settingMenu.createMany', run: (host, args) => host.settingMenu.createMany(args as Parameters<SettingMenuCapability['createMany']>[0]) },
  { capabilityId: 'setting-menu-import-tree', sdkPath: 'settingMenu.importTree', run: (host, args) => host.settingMenu.importTree(args as Parameters<SettingMenuCapability['importTree']>[0]) },
  { capabilityId: 'setting-menu-update', sdkPath: 'settingMenu.update', run: (host, args) => host.settingMenu.update(args as Parameters<SettingMenuCapability['update']>[0]) },
  { capabilityId: 'setting-menu-update-many', sdkPath: 'settingMenu.updateMany', run: (host, args) => host.settingMenu.updateMany(args as Parameters<SettingMenuCapability['updateMany']>[0]) },
  { capabilityId: 'setting-menu-remove', sdkPath: 'settingMenu.remove', run: (host, args) => host.settingMenu.remove(args as Parameters<SettingMenuCapability['remove']>[0]) },
  { capabilityId: 'setting-supplier-list', sdkPath: 'settingSupplier.list', run: (host, args) => host.settingSupplier.list(args as Parameters<SettingSupplierCapability['list']>[0]) },
  { capabilityId: 'setting-supplier-export', sdkPath: 'settingSupplier.export', run: (host, args) => host.settingSupplier.export(args as Parameters<SettingSupplierCapability['export']>[0]) },
  { capabilityId: 'setting-supplier-create', sdkPath: 'settingSupplier.create', run: (host, args) => host.settingSupplier.create(args as Parameters<SettingSupplierCapability['create']>[0]) },
  { capabilityId: 'setting-supplier-remove', sdkPath: 'settingSupplier.remove', run: (host, args) => host.settingSupplier.remove(args as Parameters<SettingSupplierCapability['remove']>[0]) },
  { capabilityId: 'setting-supplier-platform-list', sdkPath: 'settingSupplier.platformList', run: (host, args) => host.settingSupplier.platformList(args as Parameters<SettingSupplierCapability['platformList']>[0]) },
  { capabilityId: 'setting-supplier-add-platform', sdkPath: 'settingSupplier.addPlatform', run: (host, args) => host.settingSupplier.addPlatform(args as Parameters<SettingSupplierCapability['addPlatform']>[0]) },
  { capabilityId: 'setting-system-accounting-parameters-list', sdkPath: 'settingSystemAccountingParameters.list', run: (host, args) => host.settingSystemAccountingParameters.list(args as Parameters<SettingSystemAccountingParametersCapability['list']>[0]) },
  { capabilityId: 'system-integration-list', sdkPath: 'systemIntegration.list', run: (host, args) => host.systemIntegration.list(args as Parameters<SystemIntegrationCapability['list']>[0]) },
  { capabilityId: 'system-integration-get', sdkPath: 'systemIntegration.get', run: (host, args) => host.systemIntegration.get(args as Parameters<SystemIntegrationCapability['get']>[0]) },
  { capabilityId: 'system-integration-prepare-create', sdkPath: 'systemIntegration.prepareCreate', run: (host, args) => Promise.resolve(host.systemIntegration.prepareCreate((args as { form: Parameters<SystemIntegrationCapability['prepareCreate']>[0] }).form)) },
  { capabilityId: 'system-integration-create', sdkPath: 'systemIntegration.create', run: (host, args) => host.systemIntegration.create(args as Parameters<SystemIntegrationCapability['create']>[0]) },
  { capabilityId: 'system-integration-prepare-update', sdkPath: 'systemIntegration.prepareUpdate', run: (host, args) => Promise.resolve(host.systemIntegration.prepareUpdate((args as { form: Parameters<SystemIntegrationCapability['prepareUpdate']>[0] }).form)) },
  { capabilityId: 'system-integration-update', sdkPath: 'systemIntegration.update', run: (host, args) => host.systemIntegration.update(args as Parameters<SystemIntegrationCapability['update']>[0]) },
  { capabilityId: 'setting-role-post-list', sdkPath: 'settingRolePost.list', run: (host, args) => host.settingRolePost.list(args as Parameters<SettingRolePostCapability['list']>[0]) },
  { capabilityId: 'setting-role-post-role-filter-options', sdkPath: 'settingRolePost.roleFilterOptions', run: host => host.settingRolePost.roleFilterOptions() },
  { capabilityId: 'setting-role-post-roles', sdkPath: 'settingRolePost.roles', run: (host, args) => host.settingRolePost.roles(args as Parameters<SettingRolePostCapability['roles']>[0]) },
  { capabilityId: 'setting-role-post-role-options-by-system', sdkPath: 'settingRolePost.roleOptionsBySystem', run: (host, args) => host.settingRolePost.roleOptionsBySystem(args as Parameters<SettingRolePostCapability['roleOptionsBySystem']>[0]) },
  { capabilityId: 'setting-role-post-users', sdkPath: 'settingRolePost.users', run: (host, args) => host.settingRolePost.users(args as Parameters<SettingRolePostCapability['users']>[0]) },
  { capabilityId: 'setting-role-post-prepare-replace', sdkPath: 'settingRolePost.prepareReplace', run: (host, args) => Promise.resolve(host.settingRolePost.prepareReplace(args as Parameters<SettingRolePostCapability['prepareReplace']>[0])) },
  { capabilityId: 'setting-role-post-replace', sdkPath: 'settingRolePost.replace', run: (host, args) => host.settingRolePost.replace(args as Parameters<SettingRolePostCapability['replace']>[0]) },
  { capabilityId: 'setting-role-list', sdkPath: 'settingRole.list', run: (host, args) => host.settingRole.list(args as Parameters<SettingRoleCapability['list']>[0]) },
  { capabilityId: 'setting-role-get-info', sdkPath: 'settingRole.getInfo', run: (host, args) => host.settingRole.getInfo(args as Parameters<SettingRoleCapability['getInfo']>[0]) },
  { capabilityId: 'setting-role-menu-options', sdkPath: 'settingRole.menuOptions', run: (host, args) => host.settingRole.menuOptions(args as Parameters<SettingRoleCapability['menuOptions']>[0]) },
  { capabilityId: 'setting-role-organization-tree', sdkPath: 'settingRole.organizationTree', run: host => host.settingRole.organizationTree() },
  { capabilityId: 'setting-role-standard-tree', sdkPath: 'settingRole.standardTree', run: host => host.settingRole.standardTree() },
  { capabilityId: 'setting-role-organization-type-options', sdkPath: 'settingRole.organizationTypeOptions', run: host => host.settingRole.organizationTypeOptions() },
  { capabilityId: 'setting-role-legal-person-options', sdkPath: 'settingRole.legalPersonOptions', run: host => host.settingRole.legalPersonOptions() },
  { capabilityId: 'setting-role-grade-options', sdkPath: 'settingRole.gradeOptions', run: (host, args) => host.settingRole.gradeOptions(args as Parameters<SettingRoleCapability['gradeOptions']>[0]) },
  { capabilityId: 'setting-role-prepare-create', sdkPath: 'settingRole.prepareCreate', run: (host, args) => Promise.resolve(host.settingRole.prepareCreate(args as Parameters<SettingRoleCapability['prepareCreate']>[0])) },
  {
    capabilityId: 'setting-role-create',
    sdkPath: 'settingRole.createIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'setting-role-create')
      return host.settingRole.createIdempotent({ ...args, requestId } as Parameters<SettingRoleCapabilityWithIdempotency['createIdempotent']>[0])
    },
  },
  { capabilityId: 'setting-role-prepare-update', sdkPath: 'settingRole.prepareUpdate', run: (host, args) => Promise.resolve(host.settingRole.prepareUpdate(args as Parameters<SettingRoleCapability['prepareUpdate']>[0])) },
  { capabilityId: 'setting-role-update', sdkPath: 'settingRole.update', run: (host, args) => host.settingRole.update(args as Parameters<SettingRoleCapability['update']>[0]) },
  { capabilityId: 'setting-role-prepare-delete', sdkPath: 'settingRole.prepareDelete', run: (host, args) => Promise.resolve(host.settingRole.prepareDelete(args as Parameters<SettingRoleCapability['prepareDelete']>[0])) },
  { capabilityId: 'setting-role-remove', sdkPath: 'settingRole.remove', run: (host, args) => host.settingRole.remove(args as Parameters<SettingRoleCapability['remove']>[0]) },
  { capabilityId: 'setting-user-list', sdkPath: 'settingUser.list', run: (host, args) => host.settingUser.list(args as Parameters<SettingUserCapability['list']>[0]) },
  { capabilityId: 'setting-user-get-info', sdkPath: 'settingUser.getInfo', run: (host, args) => host.settingUser.getInfo(args as Parameters<SettingUserCapability['getInfo']>[0]) },
  { capabilityId: 'setting-user-phone-is-exist', sdkPath: 'settingUser.phoneIsExist', run: (host, args) => host.settingUser.phoneIsExist(args as Parameters<SettingUserCapability['phoneIsExist']>[0]) },
  { capabilityId: 'setting-user-prepare-update', sdkPath: 'settingUser.prepareUpdate', run: (host, args) => Promise.resolve(host.settingUser.prepareUpdate(args as Parameters<SettingUserCapability['prepareUpdate']>[0])) },
  { capabilityId: 'setting-user-update', sdkPath: 'settingUser.update', run: (host, args) => host.settingUser.update(args as Parameters<SettingUserCapability['update']>[0]) },
  { capabilityId: 'setting-user-prepare-synchronous', sdkPath: 'settingUser.prepareSynchronous', run: host => Promise.resolve(host.settingUser.prepareSynchronous()) },
  { capabilityId: 'setting-user-synchronous', sdkPath: 'settingUser.submitSynchronous', run: (host, args) => host.settingUser.submitSynchronous(args as Parameters<SettingUserCapability['submitSynchronous']>[0]) },
  { capabilityId: 'setting-user-cancel-synchronous', sdkPath: 'settingUser.cancelSynchronous', run: (host, args) => Promise.resolve(host.settingUser.cancelSynchronous(args as Parameters<SettingUserCapability['cancelSynchronous']>[0])) },
  { capabilityId: 'hr-external-staff-list', sdkPath: 'hrExternalStaff.list', run: (host, args) => host.hrExternalStaff.list(args as Parameters<HrExternalStaffCapability['list']>[0]) },
  { capabilityId: 'hr-external-staff-get', sdkPath: 'hrExternalStaff.get', run: (host, args) => host.hrExternalStaff.get(args as Parameters<HrExternalStaffCapability['get']>[0]) },
  { capabilityId: 'hr-external-staff-prepare-create', sdkPath: 'hrExternalStaff.prepareCreate', run: (host, args) => Promise.resolve(host.hrExternalStaff.prepareCreate(args as Parameters<HrExternalStaffCapability['prepareCreate']>[0])) },
  { capabilityId: 'hr-external-staff-create', sdkPath: 'hrExternalStaff.create', run: (host, args) => host.hrExternalStaff.create(args as Parameters<HrExternalStaffCapability['create']>[0]) },
  { capabilityId: 'hr-external-staff-prepare-update', sdkPath: 'hrExternalStaff.prepareUpdate', run: (host, args) => Promise.resolve(host.hrExternalStaff.prepareUpdate(args as Parameters<HrExternalStaffCapability['prepareUpdate']>[0])) },
  { capabilityId: 'hr-external-staff-update', sdkPath: 'hrExternalStaff.update', run: (host, args) => host.hrExternalStaff.update(args as Parameters<HrExternalStaffCapability['update']>[0]) },
  { capabilityId: 'hr-external-staff-prepare-remove', sdkPath: 'hrExternalStaff.prepareRemove', run: (host, args) => host.hrExternalStaff.prepareRemove(args as Parameters<HrExternalStaffCapability['prepareRemove']>[0]) },
  { capabilityId: 'hr-external-staff-send-delete-code', sdkPath: 'hrExternalStaff.sendDeleteCode', run: (host, args) => host.hrExternalStaff.sendDeleteCode(args as Parameters<HrExternalStaffCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'hr-external-staff-remove', sdkPath: 'hrExternalStaff.remove', run: (host, args) => host.hrExternalStaff.remove(args as Parameters<HrExternalStaffCapability['remove']>[0]) },
  { capabilityId: 'hr-internal-staff-list', sdkPath: 'hrInternalStaff.list', run: (host, args) => host.hrInternalStaff.list(args as Parameters<HrInternalStaffCapability['list']>[0]) },
  { capabilityId: 'hr-internal-staff-get', sdkPath: 'hrInternalStaff.get', run: (host, args) => host.hrInternalStaff.get(args as Parameters<HrInternalStaffCapability['get']>[0]) },
  { capabilityId: 'hr-internal-staff-prepare-create', sdkPath: 'hrInternalStaff.prepareCreate', run: (host, args) => Promise.resolve(host.hrInternalStaff.prepareCreate(args as Parameters<HrInternalStaffCapability['prepareCreate']>[0])) },
  { capabilityId: 'hr-internal-staff-create', sdkPath: 'hrInternalStaff.create', run: (host, args) => host.hrInternalStaff.create(args as Parameters<HrInternalStaffCapability['create']>[0]) },
  { capabilityId: 'hr-internal-staff-prepare-update', sdkPath: 'hrInternalStaff.prepareUpdate', run: (host, args) => Promise.resolve(host.hrInternalStaff.prepareUpdate(args as Parameters<HrInternalStaffCapability['prepareUpdate']>[0])) },
  { capabilityId: 'hr-internal-staff-update', sdkPath: 'hrInternalStaff.update', run: (host, args) => host.hrInternalStaff.update(args as Parameters<HrInternalStaffCapability['update']>[0]) },
  { capabilityId: 'hr-internal-staff-prepare-remove', sdkPath: 'hrInternalStaff.prepareRemove', run: (host, args) => host.hrInternalStaff.prepareRemove(args as Parameters<HrInternalStaffCapability['prepareRemove']>[0]) },
  { capabilityId: 'hr-internal-staff-send-delete-code', sdkPath: 'hrInternalStaff.sendDeleteCode', run: (host, args) => host.hrInternalStaff.sendDeleteCode(args as Parameters<HrInternalStaffCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'hr-internal-staff-remove', sdkPath: 'hrInternalStaff.remove', run: (host, args) => host.hrInternalStaff.remove(args as Parameters<HrInternalStaffCapability['remove']>[0]) },
  { capabilityId: 'hr-internal-staff-custom-info', sdkPath: 'hrInternalStaff.customInfo', run: (host) => host.hrInternalStaff.customInfo() },
  { capabilityId: 'hr-internal-staff-custom-export', sdkPath: 'hrInternalStaff.customExport', run: (host, args) => host.hrInternalStaff.customExport(args as Parameters<HrInternalStaffCapability['customExport']>[0]) },
  { capabilityId: 'hr-internal-staff-prepare-import', sdkPath: 'hrInternalStaff.prepareImport', run: (host, args) => Promise.resolve(host.hrInternalStaff.prepareImport(args as Parameters<HrInternalStaffCapability['prepareImport']>[0])) },
  { capabilityId: 'hr-internal-staff-import-precheck', sdkPath: 'hrInternalStaff.importPrecheck', run: (host, args) => host.hrInternalStaff.importPrecheck(args as Parameters<HrInternalStaffCapability['importPrecheck']>[0]) },
  { capabilityId: 'hr-internal-staff-import', sdkPath: 'hrInternalStaff.importStaff', run: (host, args) => host.hrInternalStaff.importStaff(args as Parameters<HrInternalStaffCapability['importStaff']>[0]) },
  { capabilityId: 'hr-internal-staff-download-template', sdkPath: 'hrInternalStaff.downloadTemplate', run: (host, args) => host.hrInternalStaff.downloadTemplate(args as Parameters<HrInternalStaffCapability['downloadTemplate']>[0]) },
  { capabilityId: 'hr-internal-staff-download-contract-template', sdkPath: 'hrInternalStaff.downloadContractTemplate', run: (host) => host.hrInternalStaff.downloadContractTemplate() },
  { capabilityId: 'hr-internal-staff-prepare-contract-import', sdkPath: 'hrInternalStaff.prepareContractImport', run: (host, args) => Promise.resolve(host.hrInternalStaff.prepareContractImport(args as Parameters<HrInternalStaffCapability['prepareContractImport']>[0])) },
  { capabilityId: 'hr-internal-staff-import-contract', sdkPath: 'hrInternalStaff.importContract', run: (host, args) => host.hrInternalStaff.importContract(args as Parameters<HrInternalStaffCapability['importContract']>[0]) },
  { capabilityId: 'hr-internal-staff-download-post-transfer-template', sdkPath: 'hrInternalStaff.downloadPostTransferTemplate', run: (host) => host.hrInternalStaff.downloadPostTransferTemplate() },
  { capabilityId: 'hr-internal-staff-prepare-post-transfer-import', sdkPath: 'hrInternalStaff.preparePostTransferImport', run: (host, args) => Promise.resolve(host.hrInternalStaff.preparePostTransferImport(args as Parameters<HrInternalStaffCapability['preparePostTransferImport']>[0])) },
  { capabilityId: 'hr-internal-staff-import-post-transfer', sdkPath: 'hrInternalStaff.importPostTransfer', run: (host, args) => host.hrInternalStaff.importPostTransfer(args as Parameters<HrInternalStaffCapability['importPostTransfer']>[0]) },
  { capabilityId: 'hr-internal-staff-history-list', sdkPath: 'hrInternalStaff.historyList', run: (host, args) => host.hrInternalStaff.historyList(args as Parameters<HrInternalStaffCapability['historyList']>[0]) },
  { capabilityId: 'hr-internal-staff-history-detail', sdkPath: 'hrInternalStaff.historyDetail', run: (host, args) => host.hrInternalStaff.historyDetail(args as Parameters<HrInternalStaffCapability['historyDetail']>[0]) },
  { capabilityId: 'history-archive-organization-list', sdkPath: 'historyArchive.listOrganizationArchives', run: (host, args) => host.historyArchive.listOrganizationArchives(args as Parameters<HistoryArchiveCapability['listOrganizationArchives']>[0]) },
  { capabilityId: 'history-archive-people-list', sdkPath: 'historyArchive.listStaffSnapshots', run: (host, args) => host.historyArchive.listStaffSnapshots(args as Parameters<HistoryArchiveCapability['listStaffSnapshots']>[0]) },
  { capabilityId: 'history-archive-staff-list', sdkPath: 'historyArchive.listStaff', run: (host, args) => host.historyArchive.listStaff(args as Parameters<HistoryArchiveCapability['listStaff']>[0]) },
  { capabilityId: 'history-archive-staff-detail', sdkPath: 'historyArchive.getStaffDetail', run: (host, args) => host.historyArchive.getStaffDetail(args as Parameters<HistoryArchiveCapability['getStaffDetail']>[0]) },
  { capabilityId: 'history-archive-staff-custom-info', sdkPath: 'historyArchive.getCustomInfo', run: (host) => host.historyArchive.getCustomInfo() },
  { capabilityId: 'history-archive-organization-tree-page', sdkPath: 'historyArchive.organizationTreePage', run: (host, args) => host.historyArchive.organizationTreePage(args as Parameters<HistoryArchiveCapability['organizationTreePage']>[0]) },
  { capabilityId: 'history-archive-organization-tree-search', sdkPath: 'historyArchive.searchOrganizationTree', run: (host, args) => host.historyArchive.searchOrganizationTree(args as Parameters<HistoryArchiveCapability['searchOrganizationTree']>[0]) },
  { capabilityId: 'history-archive-organization-tree-export', sdkPath: 'historyArchive.exportOrganizationTree', run: (host, args) => host.historyArchive.exportOrganizationTree(args as Parameters<HistoryArchiveCapability['exportOrganizationTree']>[0]) },
  { capabilityId: 'me-organization-direct-org-list', sdkPath: 'meOrganization.listDirectOrganizations', run: (host) => host.meOrganization.listDirectOrganizations() },
  { capabilityId: 'me-organization-staff-base-info', sdkPath: 'meOrganization.getStaffBaseInfo', run: (host) => host.meOrganization.getStaffBaseInfo() },
  { capabilityId: 'me-organization-organization-tree', sdkPath: 'meOrganization.organizationTree', run: (host) => host.meOrganization.organizationTree() },
  { capabilityId: 'me-organization-duty-options', sdkPath: 'meOrganization.dutyOptions', run: (host) => host.meOrganization.dutyOptions() },
  { capabilityId: 'me-organization-establishment-chart', sdkPath: 'meOrganization.getEstablishmentChart', run: (host, args) => host.meOrganization.getEstablishmentChart(args as Parameters<MeOrganizationCapability['getEstablishmentChart']>[0]) },
  { capabilityId: 'me-organization-employee-statistics', sdkPath: 'meOrganization.getEmployeeStatistics', run: (host, args) => host.meOrganization.getEmployeeStatistics(args as Parameters<MeOrganizationCapability['getEmployeeStatistics']>[0]) },
  { capabilityId: 'me-organization-organization-statistics', sdkPath: 'meOrganization.getOrganizationStatistics', run: (host, args) => host.meOrganization.getOrganizationStatistics(args as Parameters<MeOrganizationCapability['getOrganizationStatistics']>[0]) },
  { capabilityId: 'me-personal-get', sdkPath: 'mePersonal.get', run: (host, args) => host.mePersonal.get(args as Parameters<MePersonalCapability['get']>[0]) },
  { capabilityId: 'me-personal-prepare-edit', sdkPath: 'mePersonal.prepareEdit', run: (host) => Promise.resolve(host.mePersonal.prepareEdit()) },
  { capabilityId: 'me-personal-prepare', sdkPath: 'mePersonal.prepare', run: (host, args) => host.mePersonal.prepare(args as Parameters<MePersonalCapability['prepare']>[0]) },
  { capabilityId: 'me-personal-submit', sdkPath: 'mePersonal.submit', run: (host, args) => host.mePersonal.submit(args as Parameters<MePersonalCapability['submit']>[0]) },
  { capabilityId: 'me-personal-change-get', sdkPath: 'mePersonal.getChange', run: (host, args) => host.mePersonal.getChange(args as Parameters<MePersonalCapability['getChange']>[0]) },
  ...Object.entries(RECRUITMENT_PLAN_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `recruitmentPlan.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.recruitmentPlan as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`招聘计划调用方法不存在：recruitmentPlan.${method}`)
      return Promise.resolve(fn.call(host.recruitmentPlan, args))
    },
  })),
  ...Object.entries(MY_TODO_URGE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `myTodoUrge.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.myTodoUrge as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`我的待办调用方法不存在：myTodoUrge.${method}`)
      return Promise.resolve(fn.call(host.myTodoUrge, args))
    },
  })),
  ...Object.entries(MY_URGE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `myUrge.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.myUrge as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`我的督办调用方法不存在：myUrge.${method}`)
      return Promise.resolve(fn.call(host.myUrge, args))
    },
  })),
  ...Object.entries(CONTRACT_CODE_RULE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `contractCodeRule.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.contractCodeRule as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`合同编码规则调用方法不存在：contractCodeRule.${method}`)
      return Promise.resolve(fn.call(host.contractCodeRule, args))
    },
  })),
  ...Object.entries(CHAT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `chat.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.chat as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`智能助手调用方法不存在：chat.${method}`)
      return Promise.resolve(fn.call(host.chat, args))
    },
  })),
  { capabilityId: 'supply-personnel-config-list', sdkPath: 'supplyPersonnelConfig.list', run: (host, args) => host.supplyPersonnelConfig.list(args as Parameters<SupplyPersonnelConfigCapability['list']>[0]) },
  { capabilityId: 'supply-personnel-config-get', sdkPath: 'supplyPersonnelConfig.get', run: (host, args) => host.supplyPersonnelConfig.get(args as Parameters<SupplyPersonnelConfigCapability['get']>[0]) },
  { capabilityId: 'supply-personnel-config-organization-tree', sdkPath: 'supplyPersonnelConfig.organizationTree', run: (host) => host.supplyPersonnelConfig.organizationTree() },
  { capabilityId: 'supply-personnel-config-staff-search', sdkPath: 'supplyPersonnelConfig.staffSearch', run: (host, args) => host.supplyPersonnelConfig.staffSearch(args as Parameters<SupplyPersonnelConfigCapability['staffSearch']>[0]) },
  { capabilityId: 'supply-personnel-config-prepare-create', sdkPath: 'supplyPersonnelConfig.prepareCreate', run: (host, args) => Promise.resolve(host.supplyPersonnelConfig.prepareCreate(args as Parameters<SupplyPersonnelConfigCapability['prepareCreate']>[0])) },
  { capabilityId: 'supply-personnel-config-create', sdkPath: 'supplyPersonnelConfig.create', run: (host, args) => host.supplyPersonnelConfig.create(args as Parameters<SupplyPersonnelConfigCapability['create']>[0]) },
  { capabilityId: 'supply-personnel-config-prepare-update', sdkPath: 'supplyPersonnelConfig.prepareUpdate', run: (host, args) => Promise.resolve(host.supplyPersonnelConfig.prepareUpdate(args as Parameters<SupplyPersonnelConfigCapability['prepareUpdate']>[0])) },
  { capabilityId: 'supply-personnel-config-update', sdkPath: 'supplyPersonnelConfig.update', run: (host, args) => host.supplyPersonnelConfig.update(args as Parameters<SupplyPersonnelConfigCapability['update']>[0]) },
  { capabilityId: 'supply-personnel-config-remove', sdkPath: 'supplyPersonnelConfig.remove', run: (host, args) => host.supplyPersonnelConfig.remove(args as Parameters<SupplyPersonnelConfigCapability['remove']>[0]) },
  { capabilityId: 'attendance-annual-leave-list', sdkPath: 'attendanceAnnualLeave.list', run: (host, args) => host.attendanceAnnualLeave.list(args as AttendanceAnnualLeaveQuery) },
  { capabilityId: 'attendance-annual-leave-export', sdkPath: 'attendanceAnnualLeave.export', run: (host, args) => host.attendanceAnnualLeave.export(args as AttendanceAnnualLeaveQuery) },
  { capabilityId: 'attendance-exception-list', sdkPath: 'attendanceException.list', run: (host, args) => host.attendanceException.list(args as AttendanceExceptionQuery) },
  { capabilityId: 'attendance-exception-detail', sdkPath: 'attendanceException.detail', run: (host, args) => host.attendanceException.detail((args as { absentId: AttendanceExceptionId }).absentId) },
  { capabilityId: 'attendance-exception-upload-file', sdkPath: 'attendanceException.uploadFile', run: (host, args) => host.attendanceException.uploadFile(args as Parameters<AttendanceExceptionCapability['uploadFile']>[0]) },
  { capabilityId: 'attendance-schedual-information-list', sdkPath: 'attendanceSchedualInformation.list', run: (host, args) => host.attendanceSchedualInformation.list(args as AttendanceSchedualInformationListQuery) },
  { capabilityId: 'attendance-schedual-information-calendar', sdkPath: 'attendanceSchedualInformation.calendar', run: (host, args) => host.attendanceSchedualInformation.calendar(args as AttendanceSchedualInformationCalendarQuery) },
  { capabilityId: 'attendance-schedual-information-absence-user', sdkPath: 'attendanceSchedualInformation.absenceUser', run: (host, args) => host.attendanceSchedualInformation.absenceUser(args as AttendanceSchedualInformationAbsenceInput) },
  { capabilityId: 'certificate-license-list', sdkPath: 'certificateLicense.list', run: (host, args) => host.certificateLicense.list(args as CertificateLicenseQuery) },
  { capabilityId: 'certificate-license-get', sdkPath: 'certificateLicense.get', run: (host, args) => host.certificateLicense.get(args as Parameters<CertificateLicenseCapability['get']>[0]) },
  { capabilityId: 'certificate-license-category-list', sdkPath: 'certificateLicense.categoryList', run: (host) => host.certificateLicense.categoryList() },
  { capabilityId: 'certificate-license-prepare-create-folder', sdkPath: 'certificateLicense.prepareCreateFolder', run: (host, args) => Promise.resolve(host.certificateLicense.prepareCreateFolder(args as Parameters<CertificateLicenseCapability['prepareCreateFolder']>[0])) },
  { capabilityId: 'certificate-license-create-folder', sdkPath: 'certificateLicense.createFolder', run: (host, args) => host.certificateLicense.createFolder(args as Parameters<CertificateLicenseCapability['createFolder']>[0]) },
  { capabilityId: 'certificate-license-prepare-update-folder', sdkPath: 'certificateLicense.prepareUpdateFolder', run: (host, args) => Promise.resolve(host.certificateLicense.prepareUpdateFolder(args as Parameters<CertificateLicenseCapability['prepareUpdateFolder']>[0])) },
  { capabilityId: 'certificate-license-update-folder', sdkPath: 'certificateLicense.updateFolder', run: (host, args) => host.certificateLicense.updateFolder(args as Parameters<CertificateLicenseCapability['updateFolder']>[0]) },
  { capabilityId: 'certificate-license-prepare-create', sdkPath: 'certificateLicense.prepareCreate', run: (host, args) => Promise.resolve(host.certificateLicense.prepareCreate(args as Parameters<CertificateLicenseCapability['prepareCreate']>[0])) },
  { capabilityId: 'certificate-license-create', sdkPath: 'certificateLicense.create', run: (host, args) => host.certificateLicense.create(args as Parameters<CertificateLicenseCapability['create']>[0]) },
  { capabilityId: 'certificate-license-prepare-update', sdkPath: 'certificateLicense.prepareUpdate', run: (host, args) => Promise.resolve(host.certificateLicense.prepareUpdate(args as Parameters<CertificateLicenseCapability['prepareUpdate']>[0])) },
  { capabilityId: 'certificate-license-update', sdkPath: 'certificateLicense.update', run: (host, args) => host.certificateLicense.update(args as Parameters<CertificateLicenseCapability['update']>[0]) },
  { capabilityId: 'certificate-license-remove', sdkPath: 'certificateLicense.remove', run: (host, args) => host.certificateLicense.remove(args as Parameters<CertificateLicenseCapability['remove']>[0]) },
  { capabilityId: 'certificate-license-tip-template', sdkPath: 'certificateLicense.tipTemplate', run: (host, args) => host.certificateLicense.tipTemplate(args as Parameters<CertificateLicenseCapability['tipTemplate']>[0]) },
  { capabilityId: 'certificate-license-picture-recognition', sdkPath: 'certificateLicense.pictureRecognition', run: (host, args) => host.certificateLicense.pictureRecognition(args as Parameters<CertificateLicenseCapability['pictureRecognition']>[0]) },
  { capabilityId: 'certificate-license-get-share', sdkPath: 'certificateLicense.getShare', run: (host, args) => host.certificateLicense.getShare(args as Parameters<CertificateLicenseCapability['getShare']>[0]) },
  { capabilityId: 'certificate-license-save-share', sdkPath: 'certificateLicense.saveShare', run: (host, args) => host.certificateLicense.saveShare(args as Parameters<CertificateLicenseCapability['saveShare']>[0]) },
  { capabilityId: 'certificate-type-list', sdkPath: 'certificateType.list', run: (host, args) => host.certificateType.list(args as CertificateTypeQuery) },
  { capabilityId: 'certificate-type-get', sdkPath: 'certificateType.get', run: (host, args) => host.certificateType.get(args as Parameters<CertificateTypeCapability['get']>[0]) },
  { capabilityId: 'certificate-type-tip-templates', sdkPath: 'certificateType.tipTemplates', run: (host) => host.certificateType.tipTemplates() },
  { capabilityId: 'certificate-type-prepare-create', sdkPath: 'certificateType.prepareCreate', run: (host, args) => Promise.resolve(host.certificateType.prepareCreate(args as Parameters<CertificateTypeCapability['prepareCreate']>[0])) },
  { capabilityId: 'certificate-type-create', sdkPath: 'certificateType.create', run: (host, args) => host.certificateType.create(args as Parameters<CertificateTypeCapability['create']>[0]) },
  { capabilityId: 'certificate-type-prepare-update', sdkPath: 'certificateType.prepareUpdate', run: (host, args) => Promise.resolve(host.certificateType.prepareUpdate(args as Parameters<CertificateTypeCapability['prepareUpdate']>[0])) },
  { capabilityId: 'certificate-type-update', sdkPath: 'certificateType.update', run: (host, args) => host.certificateType.update(args as Parameters<CertificateTypeCapability['update']>[0]) },
  { capabilityId: 'certificate-type-remove', sdkPath: 'certificateType.remove', run: (host, args) => host.certificateType.remove(args as Parameters<CertificateTypeCapability['remove']>[0]) },
  { capabilityId: 'institution-type-list', sdkPath: 'institutionType.list', run: (host, args) => host.institutionType.list(args as Parameters<InstitutionTypeCapability['list']>[0]) },
  { capabilityId: 'institution-type-get', sdkPath: 'institutionType.get', run: (host, args) => host.institutionType.get(args as Parameters<InstitutionTypeCapability['get']>[0]) },
  { capabilityId: 'institution-type-prepare-create', sdkPath: 'institutionType.prepareCreate', run: (host, args) => Promise.resolve(host.institutionType.prepareCreate(args as Parameters<InstitutionTypeCapability['prepareCreate']>[0])) },
  { capabilityId: 'institution-type-create', sdkPath: 'institutionType.create', run: (host, args) => host.institutionType.create(args as Parameters<InstitutionTypeCapability['create']>[0]) },
  { capabilityId: 'institution-type-prepare-update', sdkPath: 'institutionType.prepareUpdate', run: (host, args) => Promise.resolve(host.institutionType.prepareUpdate(args as Parameters<InstitutionTypeCapability['prepareUpdate']>[0])) },
  { capabilityId: 'institution-type-update', sdkPath: 'institutionType.update', run: (host, args) => host.institutionType.update(args as Parameters<InstitutionTypeCapability['update']>[0]) },
  { capabilityId: 'institution-type-remove', sdkPath: 'institutionType.remove', run: (host, args) => host.institutionType.remove(args as Parameters<InstitutionTypeCapability['remove']>[0]) },
  { capabilityId: 'piece-list', sdkPath: 'piece.list', run: (host, args) => host.piece.list(args as PieceQuery) },
  { capabilityId: 'piece-get', sdkPath: 'piece.get', run: (host, args) => host.piece.get(args as Parameters<PieceCapability['get']>[0]) },
  { capabilityId: 'piece-prepare-create', sdkPath: 'piece.prepareCreate', run: (host, args) => Promise.resolve(host.piece.prepareCreate(args as Parameters<PieceCapability['prepareCreate']>[0])) },
  { capabilityId: 'piece-create', sdkPath: 'piece.create', run: (host, args) => host.piece.create(args as Parameters<PieceCapability['create']>[0]) },
  { capabilityId: 'piece-prepare-update', sdkPath: 'piece.prepareUpdate', run: (host, args) => Promise.resolve(host.piece.prepareUpdate(args as Parameters<PieceCapability['prepareUpdate']>[0])) },
  { capabilityId: 'piece-update', sdkPath: 'piece.update', run: (host, args) => host.piece.update(args as Parameters<PieceCapability['update']>[0]) },
  { capabilityId: 'piece-remove', sdkPath: 'piece.remove', run: (host, args) => host.piece.remove(args as Parameters<PieceCapability['remove']>[0]) },
  { capabilityId: 'piece-get-share', sdkPath: 'piece.getShare', run: (host, args) => host.piece.getShare(args as Parameters<PieceCapability['getShare']>[0]) },
  { capabilityId: 'piece-save-share', sdkPath: 'piece.saveShare', run: (host, args) => host.piece.saveShare(args as Parameters<PieceCapability['saveShare']>[0]) },
  { capabilityId: 'business-registration-list', sdkPath: 'businessRegistration.list', run: (host, args) => host.businessRegistration.list(args as BusinessRegistrationQuery) },
  { capabilityId: 'business-registration-get', sdkPath: 'businessRegistration.get', run: (host, args) => host.businessRegistration.get(args as Parameters<BusinessRegistrationCapability['get']>[0]) },
  { capabilityId: 'business-registration-export', sdkPath: 'businessRegistration.export', run: (host, args) => host.businessRegistration.export(args as BusinessRegistrationQuery) },
  { capabilityId: 'business-registration-prepare-create', sdkPath: 'businessRegistration.prepareCreate', run: (host, args) => Promise.resolve(host.businessRegistration.prepareCreate(args as Parameters<BusinessRegistrationCapability['prepareCreate']>[0])) },
  { capabilityId: 'business-registration-create', sdkPath: 'businessRegistration.create', run: (host, args) => host.businessRegistration.create(args as Parameters<BusinessRegistrationCapability['create']>[0]) },
  { capabilityId: 'business-registration-prepare-update', sdkPath: 'businessRegistration.prepareUpdate', run: (host, args) => Promise.resolve(host.businessRegistration.prepareUpdate(args as Parameters<BusinessRegistrationCapability['prepareUpdate']>[0])) },
  { capabilityId: 'business-registration-update', sdkPath: 'businessRegistration.update', run: (host, args) => host.businessRegistration.update(args as Parameters<BusinessRegistrationCapability['update']>[0]) },
  { capabilityId: 'business-registration-remove', sdkPath: 'businessRegistration.remove', run: (host, args) => host.businessRegistration.remove(args as Parameters<BusinessRegistrationCapability['remove']>[0]) },
  { capabilityId: 'business-registration-prepare-change', sdkPath: 'businessRegistration.prepareChange', run: (host, args) => Promise.resolve(host.businessRegistration.prepareChange(args as Parameters<BusinessRegistrationCapability['prepareChange']>[0])) },
  { capabilityId: 'business-registration-submit-change', sdkPath: 'businessRegistration.submitChange', run: (host, args) => host.businessRegistration.submitChange(args as Parameters<BusinessRegistrationCapability['submitChange']>[0]) },
  { capabilityId: 'business-registration-get-change-record', sdkPath: 'businessRegistration.getChangeRecord', run: (host, args) => host.businessRegistration.getChangeRecord(args as Parameters<BusinessRegistrationCapability['getChangeRecord']>[0]) },
  { capabilityId: 'business-registration-remove-change-record', sdkPath: 'businessRegistration.removeChangeRecord', run: (host, args) => host.businessRegistration.removeChangeRecord(args as Parameters<BusinessRegistrationCapability['removeChangeRecord']>[0]) },
  { capabilityId: 'business-registration-get-share', sdkPath: 'businessRegistration.getShare', run: (host, args) => host.businessRegistration.getShare(args as Parameters<BusinessRegistrationCapability['getShare']>[0]) },
  { capabilityId: 'business-registration-save-share', sdkPath: 'businessRegistration.saveShare', run: (host, args) => host.businessRegistration.saveShare(args as Parameters<BusinessRegistrationCapability['saveShare']>[0]) },
  { capabilityId: 'company-policy-list', sdkPath: 'companyPolicy.list', run: (host, args) => host.companyPolicy.list(args as CompanyPolicyQuery) },
  { capabilityId: 'company-policy-get', sdkPath: 'companyPolicy.get', run: (host, args) => host.companyPolicy.get(args as Parameters<CompanyPolicyCapability['get']>[0]) },
  { capabilityId: 'company-policy-parent-list', sdkPath: 'companyPolicy.parentList', run: (host) => host.companyPolicy.parentList() },
  { capabilityId: 'company-policy-category-list', sdkPath: 'companyPolicy.categoryList', run: (host) => host.companyPolicy.categoryList() },
  { capabilityId: 'company-policy-prepare-create-folder', sdkPath: 'companyPolicy.prepareCreateFolder', run: (host, args) => Promise.resolve(host.companyPolicy.prepareCreateFolder(args as Parameters<CompanyPolicyCapability['prepareCreateFolder']>[0])) },
  { capabilityId: 'company-policy-create-folder', sdkPath: 'companyPolicy.createFolder', run: (host, args) => host.companyPolicy.createFolder(args as Parameters<CompanyPolicyCapability['createFolder']>[0]) },
  { capabilityId: 'company-policy-prepare-update-folder', sdkPath: 'companyPolicy.prepareUpdateFolder', run: (host, args) => Promise.resolve(host.companyPolicy.prepareUpdateFolder(args as Parameters<CompanyPolicyCapability['prepareUpdateFolder']>[0])) },
  { capabilityId: 'company-policy-update-folder', sdkPath: 'companyPolicy.updateFolder', run: (host, args) => host.companyPolicy.updateFolder(args as Parameters<CompanyPolicyCapability['updateFolder']>[0]) },
  { capabilityId: 'company-policy-prepare-create', sdkPath: 'companyPolicy.prepareCreate', run: (host, args) => Promise.resolve(host.companyPolicy.prepareCreate(args as Parameters<CompanyPolicyCapability['prepareCreate']>[0])) },
  { capabilityId: 'company-policy-create', sdkPath: 'companyPolicy.create', run: (host, args) => host.companyPolicy.create(args as Parameters<CompanyPolicyCapability['create']>[0]) },
  { capabilityId: 'company-policy-prepare-update', sdkPath: 'companyPolicy.prepareUpdate', run: (host, args) => Promise.resolve(host.companyPolicy.prepareUpdate(args as Parameters<CompanyPolicyCapability['prepareUpdate']>[0])) },
  { capabilityId: 'company-policy-update', sdkPath: 'companyPolicy.update', run: (host, args) => host.companyPolicy.update(args as Parameters<CompanyPolicyCapability['update']>[0]) },
  { capabilityId: 'company-policy-remove', sdkPath: 'companyPolicy.remove', run: (host, args) => host.companyPolicy.remove(args as Parameters<CompanyPolicyCapability['remove']>[0]) },
  { capabilityId: 'company-policy-download', sdkPath: 'companyPolicy.download', run: (host, args) => host.companyPolicy.download(args as Parameters<CompanyPolicyCapability['download']>[0]) },
  { capabilityId: 'company-policy-student-list', sdkPath: 'companyPolicy.studentList', run: (host, args) => host.companyPolicy.studentList(args as CompanyPolicyStudentQuery) },
  { capabilityId: 'company-policy-get-power-content', sdkPath: 'companyPolicy.getPowerContent', run: (host) => host.companyPolicy.getPowerContent() },
  { capabilityId: 'company-policy-update-power-content', sdkPath: 'companyPolicy.updatePowerContent', run: (host, args) => host.companyPolicy.updatePowerContent(args as Parameters<CompanyPolicyCapability['updatePowerContent']>[0]) },
  { capabilityId: 'company-policy-get-share', sdkPath: 'companyPolicy.getShare', run: (host, args) => host.companyPolicy.getShare(args as Parameters<CompanyPolicyCapability['getShare']>[0]) },
  { capabilityId: 'company-policy-save-share', sdkPath: 'companyPolicy.saveShare', run: (host, args) => host.companyPolicy.saveShare(args as Parameters<CompanyPolicyCapability['saveShare']>[0]) },
  { capabilityId: 'honor-list', sdkPath: 'honor.list', run: (host, args) => host.honor.list(args as HonorQuery) },
  { capabilityId: 'honor-get', sdkPath: 'honor.get', run: (host, args) => host.honor.get(args as Parameters<HonorCapability['get']>[0]) },
  { capabilityId: 'honor-prepare-create', sdkPath: 'honor.prepareCreate', run: (host, args) => Promise.resolve(host.honor.prepareCreate(args as Parameters<HonorCapability['prepareCreate']>[0])) },
  { capabilityId: 'honor-create', sdkPath: 'honor.create', run: (host, args) => host.honor.create(args as Parameters<HonorCapability['create']>[0]) },
  { capabilityId: 'honor-prepare-update', sdkPath: 'honor.prepareUpdate', run: (host, args) => Promise.resolve(host.honor.prepareUpdate(args as Parameters<HonorCapability['prepareUpdate']>[0])) },
  { capabilityId: 'honor-update', sdkPath: 'honor.update', run: (host, args) => host.honor.update(args as Parameters<HonorCapability['update']>[0]) },
  { capabilityId: 'honor-remove', sdkPath: 'honor.remove', run: (host, args) => host.honor.remove(args as Parameters<HonorCapability['remove']>[0]) },
  { capabilityId: 'honor-get-share', sdkPath: 'honor.getShare', run: (host, args) => host.honor.getShare(args as Parameters<HonorCapability['getShare']>[0]) },
  { capabilityId: 'honor-save-share', sdkPath: 'honor.saveShare', run: (host, args) => host.honor.saveShare(args as Parameters<HonorCapability['saveShare']>[0]) },
  { capabilityId: 'legal-dispute-list', sdkPath: 'legalDispute.list', run: (host, args) => host.legalDispute.list(args as LegalDisputeQuery) },
  { capabilityId: 'legal-dispute-get', sdkPath: 'legalDispute.get', run: (host, args) => host.legalDispute.get(args as Parameters<LegalDisputeCapability['get']>[0]) },
  { capabilityId: 'legal-dispute-export', sdkPath: 'legalDispute.export', run: (host, args) => host.legalDispute.export(args as LegalDisputeQuery) },
  { capabilityId: 'legal-dispute-prepare-create', sdkPath: 'legalDispute.prepareCreate', run: (host, args) => Promise.resolve(host.legalDispute.prepareCreate(args as Parameters<LegalDisputeCapability['prepareCreate']>[0])) },
  { capabilityId: 'legal-dispute-create', sdkPath: 'legalDispute.create', run: (host, args) => host.legalDispute.create(args as Parameters<LegalDisputeCapability['create']>[0]) },
  { capabilityId: 'legal-dispute-prepare-update', sdkPath: 'legalDispute.prepareUpdate', run: (host, args) => Promise.resolve(host.legalDispute.prepareUpdate(args as Parameters<LegalDisputeCapability['prepareUpdate']>[0])) },
  { capabilityId: 'legal-dispute-update', sdkPath: 'legalDispute.update', run: (host, args) => host.legalDispute.update(args as Parameters<LegalDisputeCapability['update']>[0]) },
  { capabilityId: 'legal-dispute-remove', sdkPath: 'legalDispute.remove', run: (host, args) => host.legalDispute.remove(args as Parameters<LegalDisputeCapability['remove']>[0]) },
  { capabilityId: 'legal-dispute-get-share', sdkPath: 'legalDispute.getShare', run: (host, args) => host.legalDispute.getShare(args as Parameters<LegalDisputeCapability['getShare']>[0]) },
  { capabilityId: 'legal-dispute-save-share', sdkPath: 'legalDispute.saveShare', run: (host, args) => host.legalDispute.saveShare(args as Parameters<LegalDisputeCapability['saveShare']>[0]) },
  { capabilityId: 'qualification-list', sdkPath: 'qualification.list', run: (host, args) => host.qualification.list(args as QualificationQuery) },
  { capabilityId: 'qualification-get', sdkPath: 'qualification.get', run: (host, args) => host.qualification.get(args as Parameters<QualificationCapability['get']>[0]) },
  { capabilityId: 'qualification-prepare-create', sdkPath: 'qualification.prepareCreate', run: (host, args) => Promise.resolve(host.qualification.prepareCreate(args as Parameters<QualificationCapability['prepareCreate']>[0])) },
  { capabilityId: 'qualification-create', sdkPath: 'qualification.create', run: (host, args) => host.qualification.create(args as Parameters<QualificationCapability['create']>[0]) },
  { capabilityId: 'qualification-prepare-update', sdkPath: 'qualification.prepareUpdate', run: (host, args) => Promise.resolve(host.qualification.prepareUpdate(args as Parameters<QualificationCapability['prepareUpdate']>[0])) },
  { capabilityId: 'qualification-update', sdkPath: 'qualification.update', run: (host, args) => host.qualification.update(args as Parameters<QualificationCapability['update']>[0]) },
  { capabilityId: 'qualification-remove', sdkPath: 'qualification.remove', run: (host, args) => host.qualification.remove(args as Parameters<QualificationCapability['remove']>[0]) },
  { capabilityId: 'qualification-get-share', sdkPath: 'qualification.getShare', run: (host, args) => host.qualification.getShare(args as Parameters<QualificationCapability['getShare']>[0]) },
  { capabilityId: 'qualification-save-share', sdkPath: 'qualification.saveShare', run: (host, args) => host.qualification.saveShare(args as Parameters<QualificationCapability['saveShare']>[0]) },
  { capabilityId: 'patent-list', sdkPath: 'patent.list', run: (host, args) => host.patent.list(args as PatentQuery) },
  { capabilityId: 'patent-get', sdkPath: 'patent.get', run: (host, args) => host.patent.get(args as Parameters<PatentCapability['get']>[0]) },
  { capabilityId: 'patent-prepare-create', sdkPath: 'patent.prepareCreate', run: (host, args) => Promise.resolve(host.patent.prepareCreate(args as Parameters<PatentCapability['prepareCreate']>[0])) },
  { capabilityId: 'patent-create', sdkPath: 'patent.create', run: (host, args) => host.patent.create(args as Parameters<PatentCapability['create']>[0]) },
  { capabilityId: 'patent-prepare-update', sdkPath: 'patent.prepareUpdate', run: (host, args) => Promise.resolve(host.patent.prepareUpdate(args as Parameters<PatentCapability['prepareUpdate']>[0])) },
  { capabilityId: 'patent-update', sdkPath: 'patent.update', run: (host, args) => host.patent.update(args as Parameters<PatentCapability['update']>[0]) },
  { capabilityId: 'patent-remove', sdkPath: 'patent.remove', run: (host, args) => host.patent.remove(args as Parameters<PatentCapability['remove']>[0]) },
  { capabilityId: 'patent-get-share', sdkPath: 'patent.getShare', run: (host, args) => host.patent.getShare(args as Parameters<PatentCapability['getShare']>[0]) },
  { capabilityId: 'patent-save-share', sdkPath: 'patent.saveShare', run: (host, args) => host.patent.saveShare(args as Parameters<PatentCapability['saveShare']>[0]) },
  { capabilityId: 'software-list', sdkPath: 'software.list', run: (host, args) => host.software.list(args as SoftwareQuery) },
  { capabilityId: 'software-get', sdkPath: 'software.get', run: (host, args) => host.software.get(args as Parameters<SoftwareCapability['get']>[0]) },
  { capabilityId: 'software-prepare-create', sdkPath: 'software.prepareCreate', run: (host, args) => Promise.resolve(host.software.prepareCreate(args as Parameters<SoftwareCapability['prepareCreate']>[0])) },
  { capabilityId: 'software-create', sdkPath: 'software.create', run: (host, args) => host.software.create(args as Parameters<SoftwareCapability['create']>[0]) },
  { capabilityId: 'software-prepare-update', sdkPath: 'software.prepareUpdate', run: (host, args) => Promise.resolve(host.software.prepareUpdate(args as Parameters<SoftwareCapability['prepareUpdate']>[0])) },
  { capabilityId: 'software-update', sdkPath: 'software.update', run: (host, args) => host.software.update(args as Parameters<SoftwareCapability['update']>[0]) },
  { capabilityId: 'software-remove', sdkPath: 'software.remove', run: (host, args) => host.software.remove(args as Parameters<SoftwareCapability['remove']>[0]) },
  { capabilityId: 'software-get-share', sdkPath: 'software.getShare', run: (host, args) => host.software.getShare(args as Parameters<SoftwareCapability['getShare']>[0]) },
  { capabilityId: 'software-save-share', sdkPath: 'software.saveShare', run: (host, args) => host.software.saveShare(args as Parameters<SoftwareCapability['saveShare']>[0]) },
  { capabilityId: 'standard-document-list', sdkPath: 'standardDocument.list', run: (host, args) => host.standardDocument.list(args as StandardDocumentQuery) },
  { capabilityId: 'standard-document-get', sdkPath: 'standardDocument.get', run: (host, args) => host.standardDocument.get(args as Parameters<StandardDocumentCapability['get']>[0]) },
  { capabilityId: 'standard-document-prepare-create', sdkPath: 'standardDocument.prepareCreate', run: (host, args) => Promise.resolve(host.standardDocument.prepareCreate(args as Parameters<StandardDocumentCapability['prepareCreate']>[0])) },
  { capabilityId: 'standard-document-create', sdkPath: 'standardDocument.create', run: (host, args) => host.standardDocument.create(args as Parameters<StandardDocumentCapability['create']>[0]) },
  { capabilityId: 'standard-document-prepare-update', sdkPath: 'standardDocument.prepareUpdate', run: (host, args) => Promise.resolve(host.standardDocument.prepareUpdate(args as Parameters<StandardDocumentCapability['prepareUpdate']>[0])) },
  { capabilityId: 'standard-document-update', sdkPath: 'standardDocument.update', run: (host, args) => host.standardDocument.update(args as Parameters<StandardDocumentCapability['update']>[0]) },
  { capabilityId: 'standard-document-remove', sdkPath: 'standardDocument.remove', run: (host, args) => host.standardDocument.remove(args as Parameters<StandardDocumentCapability['remove']>[0]) },
  { capabilityId: 'standard-document-get-share', sdkPath: 'standardDocument.getShare', run: (host, args) => host.standardDocument.getShare(args as Parameters<StandardDocumentCapability['getShare']>[0]) },
  { capabilityId: 'standard-document-save-share', sdkPath: 'standardDocument.saveShare', run: (host, args) => host.standardDocument.saveShare(args as Parameters<StandardDocumentCapability['saveShare']>[0]) },
  { capabilityId: 'trademark-list', sdkPath: 'trademark.list', run: (host, args) => host.trademark.list(args as TrademarkQuery) },
  { capabilityId: 'trademark-get', sdkPath: 'trademark.get', run: (host, args) => host.trademark.get(args as Parameters<TrademarkCapability['get']>[0]) },
  { capabilityId: 'trademark-prepare-create', sdkPath: 'trademark.prepareCreate', run: (host, args) => Promise.resolve(host.trademark.prepareCreate(args as Parameters<TrademarkCapability['prepareCreate']>[0])) },
  { capabilityId: 'trademark-create', sdkPath: 'trademark.create', run: (host, args) => host.trademark.create(args as Parameters<TrademarkCapability['create']>[0]) },
  { capabilityId: 'trademark-prepare-update', sdkPath: 'trademark.prepareUpdate', run: (host, args) => Promise.resolve(host.trademark.prepareUpdate(args as Parameters<TrademarkCapability['prepareUpdate']>[0])) },
  { capabilityId: 'trademark-update', sdkPath: 'trademark.update', run: (host, args) => host.trademark.update(args as Parameters<TrademarkCapability['update']>[0]) },
  { capabilityId: 'trademark-remove', sdkPath: 'trademark.remove', run: (host, args) => host.trademark.remove(args as Parameters<TrademarkCapability['remove']>[0]) },
  { capabilityId: 'trademark-export', sdkPath: 'trademark.export', run: (host, args) => host.trademark.export(args as Parameters<TrademarkCapability['export']>[0]) },
  { capabilityId: 'trademark-get-share', sdkPath: 'trademark.getShare', run: (host, args) => host.trademark.getShare(args as Parameters<TrademarkCapability['getShare']>[0]) },
  { capabilityId: 'trademark-save-share', sdkPath: 'trademark.saveShare', run: (host, args) => host.trademark.saveShare(args as Parameters<TrademarkCapability['saveShare']>[0]) },
  { capabilityId: 'trademark-renewal-records', sdkPath: 'trademark.getRenewalRecords', run: (host, args) => host.trademark.getRenewalRecords(args as Parameters<TrademarkCapability['getRenewalRecords']>[0]) },
  { capabilityId: 'trademark-prepare-renewal', sdkPath: 'trademark.prepareRenewal', run: (host, args) => Promise.resolve(host.trademark.prepareRenewal(args as Parameters<TrademarkCapability['prepareRenewal']>[0])) },
  { capabilityId: 'trademark-renewal', sdkPath: 'trademark.renewal', run: (host, args) => host.trademark.renewal(args as Parameters<TrademarkCapability['renewal']>[0]) },
  { capabilityId: 'attendance-overtime-list', sdkPath: 'attendanceOvertime.list', run: (host, args) => host.attendanceOvertime.list(args as AttendanceOvertimeQuery) },
  { capabilityId: 'attendance-overtime-detail', sdkPath: 'attendanceOvertime.detail', run: (host, args) => host.attendanceOvertime.detail(args as AttendanceOvertimeDetailInput) },
  { capabilityId: 'report-standard-unit-insurance-list', sdkPath: 'reportStandardUnitInsurance.list', run: (host, args) => host.reportStandardUnitInsurance.list(args as Parameters<ReportStandardUnitInsuranceCapability['list']>[0]) },
  { capabilityId: 'inventory-organization-config-list', sdkPath: 'inventoryOrganizationConfig.list', run: (host, args) => host.inventoryOrganizationConfig.list(args as Parameters<InventoryOrganizationConfigCapability['list']>[0]) },
  { capabilityId: 'inventory-organization-config-corporations', sdkPath: 'inventoryOrganizationConfig.corporations', run: (host) => host.inventoryOrganizationConfig.corporations() },
  { capabilityId: 'inventory-organization-config-prepare-create', sdkPath: 'inventoryOrganizationConfig.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryOrganizationConfig.prepareCreate(args as Parameters<InventoryOrganizationConfigCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-organization-config-create', sdkPath: 'inventoryOrganizationConfig.create', run: (host, args) => host.inventoryOrganizationConfig.create(args as Parameters<InventoryOrganizationConfigCapability['create']>[0]) },
  { capabilityId: 'inventory-organization-config-prepare-remove', sdkPath: 'inventoryOrganizationConfig.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryOrganizationConfig.prepareRemove(args as Parameters<InventoryOrganizationConfigCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-organization-config-remove', sdkPath: 'inventoryOrganizationConfig.remove', run: (host, args) => host.inventoryOrganizationConfig.remove(args as Parameters<InventoryOrganizationConfigCapability['remove']>[0]) },
  { capabilityId: 'inventory-asset-depreciation-config-list', sdkPath: 'inventoryAssetDepreciationConfig.list', run: (host, args) => host.inventoryAssetDepreciationConfig.list(args as Parameters<InventoryAssetDepreciationConfigCapability['list']>[0]) },
  { capabilityId: 'inventory-asset-depreciation-config-get', sdkPath: 'inventoryAssetDepreciationConfig.get', run: (host, args) => host.inventoryAssetDepreciationConfig.get(args as Parameters<InventoryAssetDepreciationConfigCapability['get']>[0]) },
  { capabilityId: 'inventory-asset-depreciation-config-asset-categories', sdkPath: 'inventoryAssetDepreciationConfig.assetCategories', run: (host) => host.inventoryAssetDepreciationConfig.assetCategories() },
  { capabilityId: 'inventory-asset-depreciation-config-material-category-tree', sdkPath: 'inventoryAssetDepreciationConfig.materialCategoryTree', run: (host, args) => host.inventoryAssetDepreciationConfig.materialCategoryTree(args.level as number | undefined) },
  { capabilityId: 'inventory-asset-depreciation-config-prepare-create', sdkPath: 'inventoryAssetDepreciationConfig.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryAssetDepreciationConfig.prepareCreate(args as Parameters<InventoryAssetDepreciationConfigCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-asset-depreciation-config-create', sdkPath: 'inventoryAssetDepreciationConfig.create', run: (host, args) => host.inventoryAssetDepreciationConfig.create(args as Parameters<InventoryAssetDepreciationConfigCapability['create']>[0]) },
  { capabilityId: 'inventory-asset-depreciation-config-prepare-update', sdkPath: 'inventoryAssetDepreciationConfig.prepareUpdate', run: (host, args) => Promise.resolve(host.inventoryAssetDepreciationConfig.prepareUpdate(args as Parameters<InventoryAssetDepreciationConfigCapability['prepareUpdate']>[0])) },
  { capabilityId: 'inventory-asset-depreciation-config-update', sdkPath: 'inventoryAssetDepreciationConfig.update', run: (host, args) => host.inventoryAssetDepreciationConfig.update(args as Parameters<InventoryAssetDepreciationConfigCapability['update']>[0]) },
  { capabilityId: 'inventory-asset-depreciation-config-prepare-remove', sdkPath: 'inventoryAssetDepreciationConfig.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryAssetDepreciationConfig.prepareRemove(args as Parameters<InventoryAssetDepreciationConfigCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-asset-depreciation-config-remove', sdkPath: 'inventoryAssetDepreciationConfig.remove', run: (host, args) => host.inventoryAssetDepreciationConfig.remove(args as Parameters<InventoryAssetDepreciationConfigCapability['remove']>[0]) },
  { capabilityId: 'inventory-stock-rule-list', sdkPath: 'inventoryStockRule.list', run: (host, args) => host.inventoryStockRule.list(args as Parameters<InventoryStockRuleCapability['list']>[0]) },
  { capabilityId: 'inventory-stock-rule-get', sdkPath: 'inventoryStockRule.get', run: (host, args) => host.inventoryStockRule.get(args as Parameters<InventoryStockRuleCapability['get']>[0]) },
  { capabilityId: 'inventory-stock-rule-type-list', sdkPath: 'inventoryStockRule.typeList', run: (host) => host.inventoryStockRule.typeList() },
  { capabilityId: 'inventory-stock-rule-material-category-tree', sdkPath: 'inventoryStockRule.materialCategoryTree', run: (host) => host.inventoryStockRule.materialCategoryTree() },
  { capabilityId: 'inventory-stock-rule-prepare-create', sdkPath: 'inventoryStockRule.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryStockRule.prepareCreate(args as Parameters<InventoryStockRuleCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-stock-rule-create', sdkPath: 'inventoryStockRule.create', run: (host, args) => host.inventoryStockRule.create(args as Parameters<InventoryStockRuleCapability['create']>[0]) },
  { capabilityId: 'inventory-stock-rule-prepare-update', sdkPath: 'inventoryStockRule.prepareUpdate', run: (host, args) => Promise.resolve(host.inventoryStockRule.prepareUpdate(args as Parameters<InventoryStockRuleCapability['prepareUpdate']>[0])) },
  { capabilityId: 'inventory-stock-rule-update', sdkPath: 'inventoryStockRule.update', run: (host, args) => host.inventoryStockRule.update(args as Parameters<InventoryStockRuleCapability['update']>[0]) },
  { capabilityId: 'inventory-stock-rule-prepare-remove', sdkPath: 'inventoryStockRule.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryStockRule.prepareRemove(args as Parameters<InventoryStockRuleCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-stock-rule-remove', sdkPath: 'inventoryStockRule.remove', run: (host, args) => host.inventoryStockRule.remove(args as Parameters<InventoryStockRuleCapability['remove']>[0]) },
  { capabilityId: 'inventory-stock-location-list', sdkPath: 'inventoryStockLocation.list', run: (host, args) => host.inventoryStockLocation.list(args as Parameters<InventoryStockLocationCapability['list']>[0]) },
  { capabilityId: 'inventory-stock-location-unit-tree', sdkPath: 'inventoryStockLocation.unitTree', run: (host) => host.inventoryStockLocation.unitTree() },
  { capabilityId: 'inventory-stock-location-material-category-tree', sdkPath: 'inventoryStockLocation.materialCategoryTree', run: (host) => host.inventoryStockLocation.materialCategoryTree() },
  { capabilityId: 'inventory-stock-location-prepare-create', sdkPath: 'inventoryStockLocation.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryStockLocation.prepareCreate(args as Parameters<InventoryStockLocationCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-stock-location-create', sdkPath: 'inventoryStockLocation.create', run: (host, args) => host.inventoryStockLocation.create(args as Parameters<InventoryStockLocationCapability['create']>[0]) },
  { capabilityId: 'inventory-stock-location-prepare-set-status', sdkPath: 'inventoryStockLocation.prepareSetStatus', run: (host, args) => Promise.resolve(host.inventoryStockLocation.prepareSetStatus(args as Parameters<InventoryStockLocationCapability['prepareSetStatus']>[0])) },
  { capabilityId: 'inventory-stock-location-set-status', sdkPath: 'inventoryStockLocation.setStatus', run: (host, args) => host.inventoryStockLocation.setStatus(args as Parameters<InventoryStockLocationCapability['setStatus']>[0]) },
  { capabilityId: 'inventory-stock-location-cancel-set-status', sdkPath: 'inventoryStockLocation.cancelSetStatus', run: (host) => Promise.resolve(host.inventoryStockLocation.cancelSetStatus()) },
  { capabilityId: 'inventory-approval-config-list', sdkPath: 'inventoryApprovalConfig.list', run: (host, args) => host.inventoryApprovalConfig.list(args as Parameters<InventoryApprovalConfigCapability['list']>[0]) },
  { capabilityId: 'inventory-approval-config-type-list', sdkPath: 'inventoryApprovalConfig.typeList', run: host => host.inventoryApprovalConfig.typeList() },
  { capabilityId: 'inventory-approval-config-prepare-create', sdkPath: 'inventoryApprovalConfig.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryApprovalConfig.prepareCreate(args as Parameters<InventoryApprovalConfigCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-approval-config-create', sdkPath: 'inventoryApprovalConfig.create', run: (host, args) => host.inventoryApprovalConfig.create(args as Parameters<InventoryApprovalConfigCapability['create']>[0]) },
  { capabilityId: 'inventory-approval-config-prepare-set-approval', sdkPath: 'inventoryApprovalConfig.prepareSetApproval', run: (host, args) => Promise.resolve(host.inventoryApprovalConfig.prepareSetApproval(args as Parameters<InventoryApprovalConfigCapability['prepareSetApproval']>[0])) },
  { capabilityId: 'inventory-approval-config-set-approval', sdkPath: 'inventoryApprovalConfig.setApproval', run: (host, args) => host.inventoryApprovalConfig.setApproval(args as Parameters<InventoryApprovalConfigCapability['setApproval']>[0]) },
  { capabilityId: 'inventory-asset-stocktaking-config-list', sdkPath: 'inventoryAssetStocktakingConfig.list', run: (host, args) => host.inventoryAssetStocktakingConfig.list(args as Parameters<InventoryAssetStocktakingConfigCapability['list']>[0]) },
  { capabilityId: 'inventory-asset-stocktaking-config-search-users', sdkPath: 'inventoryAssetStocktakingConfig.searchStocktakerUsers', run: (host, args) => host.inventoryAssetStocktakingConfig.searchStocktakerUsers(args as Parameters<InventoryAssetStocktakingConfigCapability['searchStocktakerUsers']>[0]) },
  { capabilityId: 'inventory-asset-stocktaking-config-prepare-create', sdkPath: 'inventoryAssetStocktakingConfig.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryAssetStocktakingConfig.prepareCreate(args as Parameters<InventoryAssetStocktakingConfigCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-asset-stocktaking-config-create', sdkPath: 'inventoryAssetStocktakingConfig.create', run: (host, args) => host.inventoryAssetStocktakingConfig.create(args as Parameters<InventoryAssetStocktakingConfigCapability['create']>[0]) },
  { capabilityId: 'inventory-asset-stocktaking-config-prepare-update', sdkPath: 'inventoryAssetStocktakingConfig.prepareUpdate', run: (host, args) => Promise.resolve(host.inventoryAssetStocktakingConfig.prepareUpdate(args as Parameters<InventoryAssetStocktakingConfigCapability['prepareUpdate']>[0])) },
  { capabilityId: 'inventory-asset-stocktaking-config-update', sdkPath: 'inventoryAssetStocktakingConfig.update', run: (host, args) => host.inventoryAssetStocktakingConfig.update(args as Parameters<InventoryAssetStocktakingConfigCapability['update']>[0]) },
  { capabilityId: 'inventory-asset-stocktaking-config-prepare-remove', sdkPath: 'inventoryAssetStocktakingConfig.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryAssetStocktakingConfig.prepareRemove(args as Parameters<InventoryAssetStocktakingConfigCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-asset-stocktaking-config-remove', sdkPath: 'inventoryAssetStocktakingConfig.remove', run: (host, args) => host.inventoryAssetStocktakingConfig.remove(args as Parameters<InventoryAssetStocktakingConfigCapability['remove']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-list', sdkPath: 'inventoryAssetBatchConfig.list', run: (host, args) => host.inventoryAssetBatchConfig.list(args as Parameters<InventoryAssetBatchConfigCapability['list']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-search-materials', sdkPath: 'inventoryAssetBatchConfig.searchMaterials', run: (host, args) => host.inventoryAssetBatchConfig.searchMaterials(args as Parameters<InventoryAssetBatchConfigCapability['searchMaterials']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-material-category-tree', sdkPath: 'inventoryAssetBatchConfig.materialCategoryTree', run: host => host.inventoryAssetBatchConfig.materialCategoryTree() },
  { capabilityId: 'inventory-asset-batch-config-unit-tree', sdkPath: 'inventoryAssetBatchConfig.unitTree', run: host => host.inventoryAssetBatchConfig.unitTree() },
  { capabilityId: 'inventory-asset-batch-config-prepare-create-materiel', sdkPath: 'inventoryAssetBatchConfig.prepareCreateMateriel', run: (host, args) => Promise.resolve(host.inventoryAssetBatchConfig.prepareCreateMateriel(args as Parameters<InventoryAssetBatchConfigCapability['prepareCreateMateriel']>[0])) },
  { capabilityId: 'inventory-asset-batch-config-create-materiel', sdkPath: 'inventoryAssetBatchConfig.createMateriel', run: (host, args) => host.inventoryAssetBatchConfig.createMateriel(args as Parameters<InventoryAssetBatchConfigCapability['createMateriel']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-prepare-create-category', sdkPath: 'inventoryAssetBatchConfig.prepareCreateCategory', run: (host, args) => Promise.resolve(host.inventoryAssetBatchConfig.prepareCreateCategory(args as Parameters<InventoryAssetBatchConfigCapability['prepareCreateCategory']>[0])) },
  { capabilityId: 'inventory-asset-batch-config-create-category', sdkPath: 'inventoryAssetBatchConfig.createCategory', run: (host, args) => host.inventoryAssetBatchConfig.createCategory(args as Parameters<InventoryAssetBatchConfigCapability['createCategory']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-prepare-enable-batch', sdkPath: 'inventoryAssetBatchConfig.prepareEnableBatch', run: (host, args) => Promise.resolve(host.inventoryAssetBatchConfig.prepareEnableBatch(args as Parameters<InventoryAssetBatchConfigCapability['prepareEnableBatch']>[0])) },
  { capabilityId: 'inventory-asset-batch-config-enable-batch', sdkPath: 'inventoryAssetBatchConfig.enableBatch', run: (host, args) => host.inventoryAssetBatchConfig.enableBatch(args as Parameters<InventoryAssetBatchConfigCapability['enableBatch']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-prepare-disable-batch', sdkPath: 'inventoryAssetBatchConfig.prepareDisableBatch', run: (host, args) => Promise.resolve(host.inventoryAssetBatchConfig.prepareDisableBatch(args as Parameters<InventoryAssetBatchConfigCapability['prepareDisableBatch']>[0])) },
  { capabilityId: 'inventory-asset-batch-config-disable-batch', sdkPath: 'inventoryAssetBatchConfig.disableBatch', run: (host, args) => host.inventoryAssetBatchConfig.disableBatch(args as Parameters<InventoryAssetBatchConfigCapability['disableBatch']>[0]) },
  { capabilityId: 'inventory-asset-batch-config-prepare-remove', sdkPath: 'inventoryAssetBatchConfig.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryAssetBatchConfig.prepareRemove(args as Parameters<InventoryAssetBatchConfigCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-asset-batch-config-remove', sdkPath: 'inventoryAssetBatchConfig.remove', run: (host, args) => host.inventoryAssetBatchConfig.remove(args as Parameters<InventoryAssetBatchConfigCapability['remove']>[0]) },
  { capabilityId: 'inventory-valuation-list', sdkPath: 'inventoryValuation.list', run: (host, args) => host.inventoryValuation.list(args as Parameters<InventoryValuationCapability['list']>[0]) },
  { capabilityId: 'inventory-valuation-type-list', sdkPath: 'inventoryValuation.typeList', run: host => host.inventoryValuation.typeList() },
  { capabilityId: 'inventory-valuation-material-category-tree', sdkPath: 'inventoryValuation.materialCategoryTree', run: host => host.inventoryValuation.materialCategoryTree() },
  { capabilityId: 'inventory-valuation-unit-tree', sdkPath: 'inventoryValuation.unitTree', run: host => host.inventoryValuation.unitTree() },
  { capabilityId: 'inventory-valuation-get', sdkPath: 'inventoryValuation.get', run: (host, args) => host.inventoryValuation.get(args as Parameters<InventoryValuationCapability['get']>[0]) },
  { capabilityId: 'inventory-valuation-prepare-create', sdkPath: 'inventoryValuation.prepareCreate', run: (host, args) => Promise.resolve(host.inventoryValuation.prepareCreate(args as Parameters<InventoryValuationCapability['prepareCreate']>[0])) },
  { capabilityId: 'inventory-valuation-create', sdkPath: 'inventoryValuation.create', run: (host, args) => host.inventoryValuation.create(args as Parameters<InventoryValuationCapability['create']>[0]) },
  { capabilityId: 'inventory-valuation-prepare-update', sdkPath: 'inventoryValuation.prepareUpdate', run: (host, args) => Promise.resolve(host.inventoryValuation.prepareUpdate(args as Parameters<InventoryValuationCapability['prepareUpdate']>[0])) },
  { capabilityId: 'inventory-valuation-update', sdkPath: 'inventoryValuation.update', run: (host, args) => host.inventoryValuation.update(args as Parameters<InventoryValuationCapability['update']>[0]) },
  { capabilityId: 'inventory-valuation-prepare-remove', sdkPath: 'inventoryValuation.prepareRemove', run: (host, args) => Promise.resolve(host.inventoryValuation.prepareRemove(args as Parameters<InventoryValuationCapability['prepareRemove']>[0])) },
  { capabilityId: 'inventory-valuation-remove', sdkPath: 'inventoryValuation.remove', run: (host, args) => host.inventoryValuation.remove(args as Parameters<InventoryValuationCapability['remove']>[0]) },
  { capabilityId: 'inventory-valuation-change-logs', sdkPath: 'inventoryValuation.changeLogs', run: (host, args) => host.inventoryValuation.changeLogs(args as Parameters<InventoryValuationCapability['changeLogs']>[0]) },
  { capabilityId: 'inventory-valuation-price-history-list', sdkPath: 'inventoryValuation.priceHistoryList', run: (host, args) => host.inventoryValuation.priceHistoryList(args as Parameters<InventoryValuationCapability['priceHistoryList']>[0]) },
  { capabilityId: 'platform-rule-management-list', sdkPath: 'platformRuleManagement.list', run: (host, args) => host.platformRuleManagement.list(args as Parameters<PlatformRuleManagementCapability['list']>[0]) },
  { capabilityId: 'platform-rule-management-get', sdkPath: 'platformRuleManagement.get', run: (host, args) => host.platformRuleManagement.get(args as Parameters<PlatformRuleManagementCapability['get']>[0]) },
  { capabilityId: 'platform-rule-management-validate', sdkPath: 'platformRuleManagement.validate', run: (host, args) => host.platformRuleManagement.validate(args as Parameters<PlatformRuleManagementCapability['validate']>[0]) },
  { capabilityId: 'platform-rule-management-prepare-create', sdkPath: 'platformRuleManagement.prepareCreate', run: (host, args) => Promise.resolve(host.platformRuleManagement.prepareCreate(args as Parameters<PlatformRuleManagementCapability['prepareCreate']>[0])) },
  { capabilityId: 'platform-rule-management-create', sdkPath: 'platformRuleManagement.create', run: (host, args) => host.platformRuleManagement.create(args as Parameters<PlatformRuleManagementCapability['create']>[0]) },
  { capabilityId: 'platform-rule-management-prepare-update', sdkPath: 'platformRuleManagement.prepareUpdate', run: (host, args) => Promise.resolve(host.platformRuleManagement.prepareUpdate(args as Parameters<PlatformRuleManagementCapability['prepareUpdate']>[0])) },
  { capabilityId: 'platform-rule-management-update', sdkPath: 'platformRuleManagement.update', run: (host, args) => host.platformRuleManagement.update(args as Parameters<PlatformRuleManagementCapability['update']>[0]) },
  { capabilityId: 'hr-post-setting-list', sdkPath: 'hrPostSetting.list', run: (host, args) => host.hrPostSetting.list(args as Parameters<HrPostSettingCapability['list']>[0]) },
  { capabilityId: 'hr-post-setting-get', sdkPath: 'hrPostSetting.get', run: (host, args) => host.hrPostSetting.get(args as Parameters<HrPostSettingCapability['get']>[0]) },
  { capabilityId: 'hr-post-setting-salary-levels', sdkPath: 'hrPostSetting.salaryLevels', run: host => host.hrPostSetting.salaryLevels() },
  { capabilityId: 'hr-post-setting-prepare-create', sdkPath: 'hrPostSetting.prepareCreate', run: (host, args) => Promise.resolve(host.hrPostSetting.prepareCreate(args as Parameters<HrPostSettingCapability['prepareCreate']>[0])) },
  { capabilityId: 'hr-post-setting-create', sdkPath: 'hrPostSetting.create', run: (host, args) => host.hrPostSetting.create(args as Parameters<HrPostSettingCapability['create']>[0]) },
  { capabilityId: 'hr-post-setting-prepare-update', sdkPath: 'hrPostSetting.prepareUpdate', run: (host, args) => Promise.resolve(host.hrPostSetting.prepareUpdate(args as Parameters<HrPostSettingCapability['prepareUpdate']>[0])) },
  { capabilityId: 'hr-post-setting-update', sdkPath: 'hrPostSetting.update', run: (host, args) => host.hrPostSetting.update(args as Parameters<HrPostSettingCapability['update']>[0]) },
  { capabilityId: 'hr-post-setting-prepare-remove', sdkPath: 'hrPostSetting.prepareRemove', run: (host, args) => host.hrPostSetting.prepareRemove(args as Parameters<HrPostSettingCapability['prepareRemove']>[0]) },
  { capabilityId: 'hr-post-setting-send-delete-code', sdkPath: 'hrPostSetting.sendDeleteCode', run: (host, args) => host.hrPostSetting.sendDeleteCode(args as Parameters<HrPostSettingCapability['sendDeleteCode']>[0]) },
  { capabilityId: 'hr-post-setting-remove', sdkPath: 'hrPostSetting.remove', run: (host, args) => host.hrPostSetting.remove(args as Parameters<HrPostSettingCapability['remove']>[0]) },
  { capabilityId: 'hr-post-setting-download-template', sdkPath: 'hrPostSetting.downloadTemplate', run: host => host.hrPostSetting.downloadTemplate() },
  { capabilityId: 'hr-post-setting-export', sdkPath: 'hrPostSetting.export', run: (host, args) => host.hrPostSetting.export(args as Parameters<HrPostSettingCapability['export']>[0]) },
  { capabilityId: 'hr-post-setting-prepare-import', sdkPath: 'hrPostSetting.prepareImport', run: (host, args) => Promise.resolve(host.hrPostSetting.prepareImport(args as Parameters<HrPostSettingCapability['prepareImport']>[0])) },
  { capabilityId: 'hr-post-setting-import', sdkPath: 'hrPostSetting.importFile', run: (host, args) => host.hrPostSetting.importFile(args as Parameters<HrPostSettingCapability['importFile']>[0]) },
  { capabilityId: 'hr-post-setting-prepare-import-update', sdkPath: 'hrPostSetting.prepareImportUpdate', run: (host, args) => Promise.resolve(host.hrPostSetting.prepareImportUpdate(args as Parameters<HrPostSettingCapability['prepareImportUpdate']>[0])) },
  { capabilityId: 'hr-post-setting-import-update', sdkPath: 'hrPostSetting.importUpdate', run: (host, args) => host.hrPostSetting.importUpdate(args as Parameters<HrPostSettingCapability['importUpdate']>[0]) },
  { capabilityId: 'product-high-production-usage-tree', sdkPath: 'productHighProductionUsage.tree', run: host => host.productHighProductionUsage.tree() },
  { capabilityId: 'product-high-production-usage-list', sdkPath: 'productHighProductionUsage.list', run: (host, args) => host.productHighProductionUsage.list(args as Parameters<ProductHighProductionUsageCapability['list']>[0]) },
  { capabilityId: 'product-stable-production-usage-tree', sdkPath: 'productStableProductionUsage.tree', run: host => host.productStableProductionUsage.tree() },
  { capabilityId: 'product-stable-production-usage-list', sdkPath: 'productStableProductionUsage.list', run: (host, args) => host.productStableProductionUsage.list(args as Parameters<ProductStableProductionUsageCapability['list']>[0]) },
  { capabilityId: 'product-prevention-usage-analysis-tree', sdkPath: 'productPreventionUsageAnalysis.tree', run: host => host.productPreventionUsageAnalysis.tree() },
  { capabilityId: 'product-prevention-usage-analysis-list', sdkPath: 'productPreventionUsageAnalysis.list', run: (host, args) => host.productPreventionUsageAnalysis.list(args as Parameters<ProductPreventionUsageAnalysisCapability['list']>[0]) },
  { capabilityId: 'product-user-analysis-list', sdkPath: 'productUserAnalysis.list', run: (host, args) => host.productUserAnalysis.list(args as Parameters<ProductUserAnalysisCapability['list']>[0]) },
  { capabilityId: 'product-user-analysis-export', sdkPath: 'productUserAnalysis.export', run: (host, args) => host.productUserAnalysis.export(args as Parameters<ProductUserAnalysisCapability['export']>[0]) },
  { capabilityId: 'product-notice-config-list', sdkPath: 'productNoticeConfig.list', run: (host, args) => host.productNoticeConfig.list(args as Parameters<ProductNoticeConfigCapability['list']>[0]) },
  { capabilityId: 'product-notice-config-module-list', sdkPath: 'productNoticeConfig.moduleList', run: host => host.productNoticeConfig.moduleList() },
  { capabilityId: 'product-notice-config-post-list', sdkPath: 'productNoticeConfig.postList', run: host => host.productNoticeConfig.postList() },
  { capabilityId: 'product-notice-config-choose', sdkPath: 'productNoticeConfig.choose', run: host => host.productNoticeConfig.choose() },
  { capabilityId: 'product-notice-config-prepare-save', sdkPath: 'productNoticeConfig.prepareSave', run: (host, args) => Promise.resolve(host.productNoticeConfig.prepareSave(args as Parameters<ProductNoticeConfigCapability['prepareSave']>[0])) },
  { capabilityId: 'product-notice-config-save', sdkPath: 'productNoticeConfig.save', run: (host, args) => host.productNoticeConfig.save(args as Parameters<ProductNoticeConfigCapability['save']>[0]) },
  { capabilityId: 'product-notice-config-remove', sdkPath: 'productNoticeConfig.remove', run: (host, args) => host.productNoticeConfig.remove(args as Parameters<ProductNoticeConfigCapability['remove']>[0]) },
  { capabilityId: 'product-notice-config-toggle-status', sdkPath: 'productNoticeConfig.toggleStatus', run: (host, args) => host.productNoticeConfig.toggleStatus(args as Parameters<ProductNoticeConfigCapability['toggleStatus']>[0]) },
  ...productProgramLibraryBindings('productProgramLibrary', PRODUCT_PROGRAM_LIBRARY_METHODS),
  ...productProgramLibraryBindings('productProgramLibraryNew', PRODUCT_PROGRAM_LIBRARY_NEW_METHODS),
  ...Object.entries(PRODUCT_SETTING_MATERIAL_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingMaterial.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingMaterial as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置物料调用方法不存在：productSettingMaterial.${method}`)
      return Promise.resolve(fn.call(host.productSettingMaterial, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_MEDICINE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingMedicine.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingMedicine as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置药品调用方法不存在：productSettingMedicine.${method}`)
      return Promise.resolve(fn.call(host.productSettingMedicine, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_USER_DICT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingUserDict.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingUserDict as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置鸡群范围调用方法不存在：productSettingUserDict.${method}`)
      return Promise.resolve(fn.call(host.productSettingUserDict, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_VACCINE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingVaccine.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingVaccine as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置疫苗调用方法不存在：productSettingVaccine.${method}`)
      return Promise.resolve(fn.call(host.productSettingVaccine, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_ANTIBODY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingAntibody.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingAntibody as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置抗体监测标准调用方法不存在：productSettingAntibody.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingAntibody, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingChickenProduction.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingChickenProduction as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置种鸡生产指标标准调用方法不存在：productSettingChickenProduction.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingChickenProduction, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingEggStandardAgeStage.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingEggStandardAgeStage as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置孵化日龄段标准调用方法不存在：productSettingEggStandardAgeStage.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingEggStandardAgeStage, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingEpidemicPreventionCost.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingEpidemicPreventionCost as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置只鸡防疫成本标准调用方法不存在：productSettingEpidemicPreventionCost.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingEpidemicPreventionCost, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchAnnualMonthly.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchAnnualMonthly as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置年月指标目标标准调用方法不存在：productSettingHatchAnnualMonthly.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchAnnualMonthly, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_STANDARD_BROILER_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingStandardBroiler.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingStandardBroiler as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置肉鸡标准调用方法不存在：productSettingStandardBroiler.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingStandardBroiler, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingStandardFlockWeek.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingStandardFlockWeek as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置种鸡标准(BI)调用方法不存在：productSettingStandardFlockWeek.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingStandardFlockWeek, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_STANDARD_FLOCK_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingStandardFlock.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingStandardFlock as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置种鸡标准调用方法不存在：productSettingStandardFlock.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingStandardFlock, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_STANDARD_HATCH_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingStandardHatch.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingStandardHatch as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置孵化健母率标准调用方法不存在：productSettingStandardHatch.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingStandardHatch, input))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_BATCH_STATUS_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingBatchStatus.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingBatchStatus as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置鸡群批次状态调用方法不存在：productSettingBatchStatus.${method}`)
      return Promise.resolve(fn.call(host.productSettingBatchStatus, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_CONFIGURE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingConfigure.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingConfigure as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置配置指标调用方法不存在：productSettingConfigure.${method}`)
      return Promise.resolve(fn.call(host.productSettingConfigure, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_DAY_LIQUIDATION_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingDayLiquidation.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingDayLiquidation as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置日清日结调用方法不存在：productSettingDayLiquidation.${method}`)
      return Promise.resolve(fn.call(host.productSettingDayLiquidation, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_FUNCTION_USE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingFunctionUse.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingFunctionUse as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置功能开关调用方法不存在：productSettingFunctionUse.${method}`)
      return Promise.resolve(fn.call(host.productSettingFunctionUse, args))
    },
  })),
  ...Object.entries(PRODUCT_SETTING_MATERIAL_MASTER_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingMaterialMaster.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingMaterialMaster as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置物料主数据调用方法不存在：productSettingMaterialMaster.${method}`)
      return Promise.resolve(fn.call(host.productSettingMaterialMaster, args))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置标准库调用方法不存在：productSettingHatchManageLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageLib, input))
    },
  })),

  ...Object.entries(PRODUCT_BUSINESS_AGE_DIVISION_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productBusinessAgeDivision.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productBusinessAgeDivision as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`生产设置日龄分割调用方法不存在：productBusinessAgeDivision.${method}`)
      const input = method.startsWith('prepareCreate') || method.startsWith('prepareUpdate') ? args.form : args
      return Promise.resolve(fn.call(host.productBusinessAgeDivision, input))
    },
  })),

  ...Object.entries(PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productBusinessDataRetransmit.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productBusinessDataRetransmit as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`生产设置种摊数据重传调用方法不存在：productBusinessDataRetransmit.${method}`)
      const input = method.startsWith('prepare') ? args.form : args
      return Promise.resolve(fn.call(host.productBusinessDataRetransmit, input))
    },
  })),

  ...Object.entries(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productBusinessSetupMaterialCode.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productBusinessSetupMaterialCode as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`生产设置蛋鸡场物料号调用方法不存在：productBusinessSetupMaterialCode.${method}`)
      const input = method.startsWith('prepare') ? args.form : args
      return Promise.resolve(fn.call(host.productBusinessSetupMaterialCode, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案标准库调用方法不存在：productHatcheryLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryLib, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryMethod.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryMethod as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案方法设置调用方法不存在：productHatcheryMethod.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryMethod, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_METHOD_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryMethodLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryMethodLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案方法库调用方法不存在：productHatcheryMethodLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryMethodLib, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryMethodLibIndicator.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryMethodLibIndicator as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案方法库指标调用方法不存在：productHatcheryMethodLibIndicator.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryMethodLibIndicator, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryStandardIndicator.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryStandardIndicator as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案标准库指标调用方法不存在：productHatcheryStandardIndicator.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryStandardIndicator, input))
    },
  })),

  ...Object.entries(PRODUCT_HATCHERY_UNIT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productHatcheryUnit.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productHatcheryUnit as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`孵化预案标准设置调用方法不存在：productHatcheryUnit.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productHatcheryUnit, input))
    },
  })),

  ...Object.entries(PRODUCT_PLAN_PREVIEW_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productPlanPreview.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productPlanPreview as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`预案预览调用方法不存在：productPlanPreview.${method}`)
      return Promise.resolve(fn.call(host.productPlanPreview, args))
    },
  })),

  ...Object.entries(SALE_CUSTOM_QR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleCustomQr.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.saleCustomQr as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`销售设置二维码管理调用方法不存在：saleCustomQr.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.saleCustomQr, input))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_FINANCE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformFinance.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformFinance as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置财务字典调用方法不存在：settingDictPlatformFinance.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformFinance, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_COMMON_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformCommon.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformCommon as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置公共字典调用方法不存在：settingDictPlatformCommon.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformCommon, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_HR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformHr.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformHr as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置人力字典调用方法不存在：settingDictPlatformHr.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformHr, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_MATERIAL_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformMaterial.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformMaterial as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置资产字典调用方法不存在：settingDictPlatformMaterial.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformMaterial, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_PRODUCT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformProduct.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformProduct as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置生产字典调用方法不存在：settingDictPlatformProduct.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformProduct, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_SUPPLY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformSupply.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformSupply as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置采购字典调用方法不存在：settingDictPlatformSupply.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformSupply, args))
    },
  })),

  ...Object.entries(SETTING_DICT_PLATFORM_SALE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `settingDictPlatformSale.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.settingDictPlatformSale as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`系统设置销售字典调用方法不存在：settingDictPlatformSale.${method}`)
      return Promise.resolve(fn.call(host.settingDictPlatformSale, args))
    },
  })),

  ...Object.entries(SALE_VISIT_RECOMMEND_SETTING_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `saleVisitRecommendSetting.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.saleVisitRecommendSetting as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`销售设置推荐设置调用方法不存在：saleVisitRecommendSetting.${method}`)
      const input = method === 'prepareSave' ? args.form : args
      return Promise.resolve(fn.call(host.saleVisitRecommendSetting, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageMethodLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageMethodLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置方法库调用方法不存在：productSettingHatchManageMethodLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageMethodLib, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchMethodLibIndicator.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchMethodLibIndicator as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`生产设置旧版方法库指标调用方法不存在：productSettingHatchMethodLibIndicator.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' || method === 'prepareRemove' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchMethodLibIndicator, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageMethod.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageMethod as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置方法调用方法不存在：productSettingHatchManageMethod.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageMethod, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageSeason.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageSeason as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置温度设置调用方法不存在：productSettingHatchManageSeason.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageSeason, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_INDICATOR_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingIndicatorLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingIndicatorLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置指标库调用方法不存在：productSettingIndicatorLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' || method === 'prepareCopy' || method === 'prepareVersionUpdate' || method === 'prepareCreateVersion' || method === 'prepareDefinitionConfig' || method === 'prepareDataUpdate' || method === 'prepareQuickEntry' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingIndicatorLib, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_METHOD_LIB_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingMethodLib.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingMethodLib as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置方法库-新调用方法不存在：productSettingMethodLib.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingMethodLib, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_SEASON_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingSeason.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingSeason as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置温度配置-新调用方法不存在：productSettingSeason.${method}`)
      const input = method === 'prepareSave' || method === 'prepareRemove' || method === 'prepareRemoveBatch' ? (method === 'prepareSave' ? args.form : args) : args
      return Promise.resolve(fn.call(host.productSettingSeason, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageUnit.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageUnit as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置标准设置调用方法不存在：productSettingHatchManageUnit.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageUnit, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingHatchManageVariety.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingHatchManageVariety as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置预案品种调用方法不存在：productSettingHatchManageVariety.${method}`)
      const input = method === 'prepareCreate' || method === 'prepareUpdate' ? args.form : args
      return Promise.resolve(fn.call(host.productSettingHatchManageVariety, input))
    },
  })),

  ...Object.entries(PRODUCT_SETTING_TENANT_LOG_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `productSettingTenantLog.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.productSettingTenantLog as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`产品设置企业使用情况调用方法不存在：productSettingTenantLog.${method}`)
      return Promise.resolve(fn.call(host.productSettingTenantLog, args))
    },
  })),

  ...Object.entries(CONTRACT_SUPPORT_METHODS).map(([capabilityId, method]) => ({
    capabilityId, sdkPath: 'contractSupport.' + method,
    run: (host: CapabilityHost, args: Record<string, unknown>) => (host.contractSupport[method] as (query: Record<string, unknown>) => Promise<unknown>)(args),
  })),
  ...Object.entries(MEETING_ROOM_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `meetingRoom.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.meetingRoom as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`会议室调用方法不存在：meetingRoom.${method}`)
      return Promise.resolve(fn.call(host.meetingRoom, args))
    },
  })),
  {
    capabilityId: 'meeting-application-definition',
    sdkPath: 'meetingApplication.definition',
    run: (host, args) => host.meetingApplication.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'meeting-room-usage',
    sdkPath: 'meetingApplication.roomUsage',
    run: (host, args) => host.meetingApplication.roomUsage(args.date as string | undefined),
  },
  {
    capabilityId: 'meeting-user-search',
    sdkPath: 'meetingApplication.searchUsers',
    run: (host, args) => host.meetingApplication.searchUsers(args as SimpleUserQuery),
  },
  {
    // prepare 是**只读**的：它只回答"这次提交要人工指定哪些审批人"。
    // 不要在这里顺手提交——那会把两步并成一步，调用方就没有"回执给上层"的机会了。
    capabilityId: 'meeting-application-prepare',
    sdkPath: 'meetingApplication.prepare',
    run: (host, args) => host.meetingApplication.prepare(args as unknown as MeetingApplicationDraft),
  },
  {
    // 写操作绑定到**带防重**的那个方法（不是 submit）：走后端零幂等（H11），
    // 超时重发一次就是一张重复单据（D12）。所以 requestId 在这里是必填，缺了直接报错。
    capabilityId: 'meeting-application-submit',
    sdkPath: 'meetingApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, startUserSelectAssignees, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'meeting-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一张重复单据（D12 / H11）。',
        )
      }
      return host.meetingApplication.submitIdempotent({
        ...(draft as unknown as MeetingApplicationDraft),
        requestId,
        ...(startUserSelectAssignees === undefined
          ? {}
          : { startUserSelectAssignees: startUserSelectAssignees as StartUserSelectAssignees }),
      })
    },
  },
  {
    // cancel 目前没有防重（D12 只包了 submit）。按 id 撤销，重发最多是一次"已取消"的业务报错，
    // 不会产生第二张单据——所以这里如实透传，不假装它被防重保护了。
    capabilityId: 'meeting-application-cancel',
    sdkPath: 'meetingApplication.cancelReservation',
    run: (host, args) => {
      const id = Number(args.id)
      if (!Number.isFinite(id)) {
        throw new CapabilityInvokeError(
          'meeting-application-cancel 需要 id（submit 返回的单据 ID），收到的是 ' +
            `${JSON.stringify(args.id ?? null)}`,
        )
      }
      return host.meetingApplication.cancelReservation(id)
    },
  },
  {
    capabilityId: 'attendance-archive-sheet-list',
    sdkPath: 'attendanceArchive.list',
    run: (host, args) => host.attendanceArchive.list(args as AttendanceArchiveSheetQuery),
  },
  {
    // 只读的候选查询。它只是 `departmentId` / `organizationId` 的 lookup 入口，
    // 不做任何写入——别在这里顺手补一个"按 id 直接改归档状态"的方法，
    // 那个动作（`GET /org/hrAttendanceSheet/unArchiveSheet`）是**写**，见 docs/pages/考勤档案.md。
    capabilityId: 'attendance-org-search',
    sdkPath: 'attendanceArchive.searchOrganizations',
    run: (host, args) => host.attendanceArchive.searchOrganizations(args as unknown as OrganizationSearchQuery),
  },

  { capabilityId: 'attendance-sheet-get', sdkPath: 'attendanceSheet.get', run: (host, args) => host.attendanceSheet.get(args as Parameters<AttendanceSheetCapability['get']>[0]) },
  { capabilityId: 'attendance-sheet-department', sdkPath: 'attendanceSheet.department', run: (host, args) => host.attendanceSheet.department() },
  { capabilityId: 'attendance-sheet-group-search', sdkPath: 'attendanceSheet.searchGroups', run: (host, args) => host.attendanceSheet.searchGroups(args as Parameters<AttendanceSheetCapability['searchGroups']>[0]) },
  { capabilityId: 'attendance-sheet-user-search', sdkPath: 'attendanceSheet.searchUsers', run: (host, args) => host.attendanceSheet.searchUsers(args as Parameters<AttendanceSheetCapability['searchUsers']>[0]) },
  { capabilityId: 'attendance-sheet-save', sdkPath: 'attendanceSheet.saveIdempotent', run: (host, args) => host.attendanceSheet.saveIdempotent(args as Parameters<AttendanceSheetCapability['saveIdempotent']>[0]) },
  { capabilityId: 'attendance-sheet-archive', sdkPath: 'attendanceSheet.archive', run: (host, args) => host.attendanceSheet.archive(args as Parameters<AttendanceSheetCapability['archive']>[0]) },
  { capabilityId: 'attendance-sheet-unarchive', sdkPath: 'attendanceSheet.unarchive', run: (host, args) => host.attendanceSheet.unarchive(args as Parameters<AttendanceSheetCapability['unarchive']>[0]) },
  { capabilityId: 'attendance-sheet-remove', sdkPath: 'attendanceSheet.remove', run: (host, args) => host.attendanceSheet.remove(args as Parameters<AttendanceSheetCapability['remove']>[0]) },
  { capabilityId: 'attendance-sheet-statistics', sdkPath: 'attendanceSheet.statistics', run: (host, args) => host.attendanceSheet.statistics(args as Parameters<AttendanceSheetCapability['statistics']>[0]) },

  {
    // 与 `attendance-archive-sheet-list` 打同一个接口，靠「发不发 isArchived」区分：
    // 这一页不发（拿到全部考勤表），档案页钉死 1。别把两者合成一个能力。
    capabilityId: 'attendance-statistics-list',
    sdkPath: 'attendanceStatistics.list',
    run: (host, args) => host.attendanceStatistics.list(args as AttendanceStatisticsQuery),
  },

  // ---- 作业管理：普通 CRUD，写链路的形态与会议室那条流程线**不一样** ----
  {
    capabilityId: 'assignment-list',
    sdkPath: 'assignment.list',
    run: (host, args) => host.assignment.list(args as AssignmentPageQuery),
  },
  {
    capabilityId: 'assignment-get',
    sdkPath: 'assignment.get',
    run: (host, args) => host.assignment.get(args.id as string | number),
  },
  {
    // 写操作绑定到**带防重**的那个方法（不是 create）：后端零幂等，超时重发一次
    // 就是一条重复作业（D12）。所以 requestId 在这里是必填，缺了直接报错。
    //
    // 只有 create 需要防重，这不是漏了：这个页面的另外三个写操作
    // （update 整单替换、setStatus 写绝对值、remove 按 id 删）重发一次的终态都一样，
    // 造不出第二条记录。理由逐条写在 src/capabilities/assignment.ts 的文件头。
    capabilityId: 'assignment-create',
    sdkPath: 'assignment.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'assignment-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复作业（D12 / H11）。',
        )
      }
      return host.assignment.createIdempotent({
        ...(draft as unknown as AssignmentDraft),
        requestId,
      })
    },
  },
  {
    // 整单替换，重发一次终态相同 → 不做防重，如实透传（不假装它被防重保护了）。
    capabilityId: 'assignment-update',
    sdkPath: 'assignment.update',
    run: (host, args) => host.assignment.update(args as unknown as AssignmentUpdateDraft),
  },
  {
    // 收的是**目标状态**而不是"切换"：做成 toggle 才会变成不幂等的。
    capabilityId: 'assignment-set-status',
    sdkPath: 'assignment.setStatus',
    run: (host, args) => {
      const id = args.id as string | number | undefined
      if (id === undefined || id === null || String(id).trim() === '') {
        throw new CapabilityInvokeError(
          `assignment-set-status 需要 id（作业 ID），收到的是 ${JSON.stringify(args.id ?? null)}`,
        )
      }
      return host.assignment.setStatus(id, args.status as AssignmentStatus)
    },
  },
  {
    capabilityId: 'assignment-remove',
    sdkPath: 'assignment.remove',
    run: (host, args) => host.assignment.remove(args.id as string | number),
  },

  // ---- 班次管理：同一形态的第二个域（HR 考勤），写链路是 get → create/update/remove ----
  {
    capabilityId: 'attendance-shift-list',
    sdkPath: 'attendanceShift.list',
    run: (host, args) => host.attendanceShift.list(args as AttendanceShiftQuery),
  },
  {
    capabilityId: 'attendance-shift-get',
    sdkPath: 'attendanceShift.get',
    run: (host, args) => host.attendanceShift.get(args.id as string | number),
  },
  {
    // 写操作绑定到**带防重**的那个方法（不是 create）：后端零幂等，超时重发一次
    // 就是一条重复班次（D12）。所以 requestId 在这里是必填，缺了直接报错。
    capabilityId: 'attendance-shift-create',
    sdkPath: 'attendanceShift.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'attendance-shift-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复班次（D12 / H11）。',
        )
      }
      return host.attendanceShift.createIdempotent({
        ...(draft as unknown as AttendanceShiftDraft),
        requestId,
      })
    },
  },
  {
    // 整单替换（PUT），重发一次终态相同 → 不做防重，如实透传（不假装它被防重保护了）
    capabilityId: 'attendance-shift-update',
    sdkPath: 'attendanceShift.update',
    run: (host, args) => host.attendanceShift.update(args as unknown as AttendanceShiftUpdateDraft),
  },
  {
    capabilityId: 'attendance-shift-remove',
    sdkPath: 'attendanceShift.remove',
    run: (host, args) => host.attendanceShift.remove(args.id as string | number),
  },

  // ---- 待办事项：列表 + 已办标签下可达的撤销审批动作 ----
  {
    capabilityId: 'backlog-task-examine-list',
    sdkPath: 'backlogTaskExamine.list',
    run: (host, args) => host.backlogTaskExamine.list(args as BacklogTaskExamineQuery),
  },
  {
    capabilityId: 'backlog-task-examine-withdraw',
    sdkPath: 'backlogTaskExamine.withdraw',
    run: (host, args) => host.backlogTaskExamine.withdraw(args as TaskWithdrawParams),
  },

  // ---- 图库管理：同域里唯一含写的页；两个 create 类要防重，其余三个不要 ----
  {
    capabilityId: 'base-image-list',
    sdkPath: 'baseImage.list',
    run: (host, args) => host.baseImage.list(args as BaseImagePageQuery),
  },
  {
    capabilityId: 'base-image-get',
    sdkPath: 'baseImage.get',
    run: (host, args) => host.baseImage.get(args.id as string | number),
  },
  {
    // 与 assignment-create 同理：这一页只有**会产生新记录**的写操作需要防重。
    // create 与 createRelease 都会多出一条记录，所以两个都包了 requestId。
    capabilityId: 'base-image-create',
    sdkPath: 'baseImage.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'base-image-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复图库记录（D12 / H11）。',
        )
      }
      return host.baseImage.createIdempotent({
        ...(draft as unknown as BaseImageDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'base-image-create-release',
    sdkPath: 'baseImage.createReleaseIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'base-image-create-release 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复图库记录（D12 / H11）。',
        )
      }
      return host.baseImage.createReleaseIdempotent({
        ...(draft as unknown as BaseImageDraft),
        requestId,
      })
    },
  },
  {
    // PUT 是**部分更新**（只发点名字段），重发一次终态相同 → 不做防重
    capabilityId: 'base-image-update',
    sdkPath: 'baseImage.update',
    run: (host, args) => host.baseImage.update(args as unknown as BaseImageUpdateDraft),
  },
  {
    // 收的是**目标状态**而不是"切换"：做成 toggle 才会变成不幂等的。
    capabilityId: 'base-image-set-status',
    sdkPath: 'baseImage.setStatus',
    run: (host, args) => {
      const id = args.id as string | number | undefined
      if (id === undefined || id === null || String(id).trim() === '') {
        throw new CapabilityInvokeError(
          `base-image-set-status 需要 id（图库记录 ID），收到的是 ${JSON.stringify(args.id ?? null)}`,
        )
      }
      return host.baseImage.setStatus(id, args.status as 0 | 1)
    },
  },
  {
    capabilityId: 'base-image-remove',
    sdkPath: 'baseImage.remove',
    run: (host, args) => host.baseImage.remove(args.id as string | number),
  },

  // ---- 排班管理：一个页面两条数据线（考勤组本体 + 组的排班），共用同一个页面上下文 ----
  {
    capabilityId: 'attendance-team-list',
    sdkPath: 'attendanceTeam.list',
    run: (host, args) => host.attendanceTeam.list(args as AttendanceTeamQuery),
  },
  {
    capabilityId: 'attendance-team-get',
    sdkPath: 'attendanceTeam.get',
    run: (host, args) => host.attendanceTeam.get(args.id as string | number),
  },
  {
    // 只有 create 需要防重（scheduleSave 是整份覆盖写，重发终态相同），
    // 理由逐条写在 src/capabilities/attendance-team.ts 的文件头
    capabilityId: 'attendance-team-create',
    sdkPath: 'attendanceTeam.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'attendance-team-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复考勤组（D12 / H11）。',
        )
      }
      return host.attendanceTeam.createIdempotent({
        ...(draft as unknown as AttendanceTeamDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'attendance-team-update',
    sdkPath: 'attendanceTeam.update',
    run: (host, args) => host.attendanceTeam.update(args as unknown as AttendanceTeamUpdateDraft),
  },
  {
    capabilityId: 'attendance-team-remove',
    sdkPath: 'attendanceTeam.remove',
    run: (host, args) => host.attendanceTeam.remove(args.id as string | number),
  },
  {
    // 只读：读一个考勤组的排班（含成员）。`groupId` 参数名与能力定义一致
    capabilityId: 'attendance-team-schedule-get',
    sdkPath: 'attendanceTeam.scheduleGet',
    run: (host, args) => host.attendanceTeam.scheduleGet(args.groupId as string | number),
  },
  {
    // 整份覆盖写（不是增量、不是 toggle），重发一次终态相同 → 不包防重，如实透传
    capabilityId: 'attendance-team-schedule-save',
    sdkPath: 'attendanceTeam.scheduleSave',
    run: (host, args) => host.attendanceTeam.scheduleSave(args as unknown as AttendanceTeamScheduleDraft),
  },

  // ---- 组织结构 ----
  {
    capabilityId: 'base-management-center-list',
    sdkPath: 'baseManagementCenter.list',
    run: (host, args) => host.baseManagementCenter.list(args as ManagementCenterQuery),
  },
  {
    capabilityId: 'base-management-center-get',
    sdkPath: 'baseManagementCenter.get',
    run: (host, args) => host.baseManagementCenter.get(args.id as string | number),
  },
  {
    // 名字像写、其实是**只读**：后端 `updateStatus` 一个字段都不写，
    // 只 select 一次拿提示语给页面弹确认框。所以绑到 get 那一侧的口径上，不带 requestId。
    capabilityId: 'base-management-center-check-status',
    sdkPath: 'baseManagementCenter.checkStatus',
    run: (host, args) =>
      host.baseManagementCenter.checkStatus(args.id as string | number, args.status as 0 | 1),
  },
  {
    capabilityId: 'base-management-center-create',
    sdkPath: 'baseManagementCenter.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'base-management-center-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一条重复组织记录（D12 / H11）。',
        )
      }
      return host.baseManagementCenter.createIdempotent({
        ...(draft as unknown as ManagementCenterDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'base-management-center-update',
    sdkPath: 'baseManagementCenter.update',
    run: (host, args) => host.baseManagementCenter.update(args as unknown as ManagementCenterUpdateDraft),
  },
  {
    // 收的是**目标状态**而不是"切换"（与 base-image-set-status 同理）
    capabilityId: 'base-management-center-set-status',
    sdkPath: 'baseManagementCenter.setStatus',
    run: (host, args) => {
      const id = args.id as string | number | undefined
      if (id === undefined || id === null || String(id).trim() === '') {
        throw new CapabilityInvokeError(
          `base-management-center-set-status 需要 id（组织 ID），收到的是 ${JSON.stringify(args.id ?? null)}`,
        )
      }
      return host.baseManagementCenter.setStatus(id, args.status as 0 | 1)
    },
  },
  {
    capabilityId: 'base-management-center-remove',
    sdkPath: 'baseManagementCenter.remove',
    run: (host, args) => host.baseManagementCenter.remove(args.id as string | number),
  },

  // ---- 合同模板 ----
  {
    capabilityId: 'contract-template-list',
    sdkPath: 'contractTemplate.list',
    run: (host, args) => host.contractTemplate.list(args as ContractTemplateQuery),
  },
  {
    capabilityId: 'contract-template-get',
    sdkPath: 'contractTemplate.get',
    run: (host, args) => host.contractTemplate.get(args.id as string | number),
  },
  {
    // 只有 create 需要防重；update 是整单替换、remove 按 id 删，重发终态相同
    capabilityId: 'contract-template-create',
    sdkPath: 'contractTemplate.createIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'contract-template-create 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成一张重复合同模板（D12 / H11）。',
        )
      }
      return host.contractTemplate.createIdempotent({
        ...(draft as unknown as ContractTemplateDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'contract-template-update',
    sdkPath: 'contractTemplate.update',
    run: (host, args) => host.contractTemplate.update(args as unknown as ContractTemplateUpdateDraft),
  },
  {
    capabilityId: 'contract-template-remove',
    sdkPath: 'contractTemplate.remove',
    run: (host, args) => host.contractTemplate.remove(args.id as string | number),
  },

  // ---- 合同库 ----
  {
    capabilityId: 'contract-library-list',
    sdkPath: 'contractLibrary.list',
    run: (host, args) => host.contractLibrary.list(args as ContractQuery),
  },
  {
    capabilityId: 'contract-library-get',
    sdkPath: 'contractLibrary.get',
    run: (host, args) => host.contractLibrary.get(args as { id: string | number }),
  },
  {
    capabilityId: 'contract-library-download',
    sdkPath: 'contractLibrary.download',
    run: (host, args) => host.contractLibrary.download(args as { id: string | number }),
  },
  {
    capabilityId: 'contract-library-records',
    sdkPath: 'contractLibrary.records',
    run: (host, args) => host.contractLibrary.records(args as { contractId: string | number; pageNo?: number; pageSize?: number }),
  },
  {
    capabilityId: 'contract-library-get-replenishment',
    sdkPath: 'contractLibrary.getReplenishment',
    run: (host, args) => host.contractLibrary.getReplenishment(args as { id: string | number }),
  },
  {
    capabilityId: 'contract-library-prepare-replenishment',
    sdkPath: 'contractLibrary.prepareReplenishment',
    run: (host, args) => Promise.resolve(host.contractLibrary.prepareReplenishment(args as Parameters<ContractLibraryCapability['prepareReplenishment']>[0])),
  },
  {
    capabilityId: 'contract-library-save-replenishment',
    sdkPath: 'contractLibrary.saveReplenishment',
    run: (host, args) => host.contractLibrary.saveReplenishment(args as { draft: ContractReplenishmentPreparation['draft'] }),
  },
  {
    capabilityId: 'contract-library-get-sign-certificate',
    sdkPath: 'contractLibrary.getSignCertificate',
    run: (host, args) => host.contractLibrary.getSignCertificate(args as { id: string | number }),
  },
  {
    capabilityId: 'contract-library-prepare-sign-certificate',
    sdkPath: 'contractLibrary.prepareSignCertificate',
    run: (host, args) => Promise.resolve(host.contractLibrary.prepareSignCertificate(args as Parameters<ContractLibraryCapability['prepareSignCertificate']>[0])),
  },
  {
    capabilityId: 'contract-library-save-sign-certificate',
    sdkPath: 'contractLibrary.saveSignCertificate',
    run: (host, args) => host.contractLibrary.saveSignCertificate(args as { draft: ContractSignCertificatePreparation['draft'] }),
  },
  {
    capabilityId: 'contract-library-prepare-update',
    sdkPath: 'contractLibrary.prepareUpdate',
    run: (host, args) => Promise.resolve(host.contractLibrary.prepareUpdate(args as Parameters<ContractLibraryCapability['prepareUpdate']>[0])),
  },
  {
    capabilityId: 'contract-library-update',
    sdkPath: 'contractLibrary.update',
    run: (host, args) => host.contractLibrary.update(args as { draft: ContractUpdatePreparation['draft'] }),
  },
  {
    capabilityId: 'contract-library-prepare-void',
    sdkPath: 'contractLibrary.prepareVoid',
    run: (host, args) => Promise.resolve(host.contractLibrary.prepareVoid(args as { id: string | number; status: number })),
  },
  {
    capabilityId: 'contract-library-void',
    sdkPath: 'contractLibrary.void',
    run: (host, args) => host.contractLibrary.void(args as { draft: ContractVoidDraft }),
  },

  // ---- 合同创建 ----
  {
    capabilityId: 'contract-create-template-options',
    sdkPath: 'contractCreate.templateOptions',
    run: (host, args) => host.contractCreate.templateOptions(args as { typeId: string | number; useSystem?: number | null }),
  },
  {
    capabilityId: 'contract-create-template',
    sdkPath: 'contractCreate.template',
    run: (host, args) => host.contractCreate.template(args as { id: string | number }),
  },
  {
    capabilityId: 'contract-create-variables',
    sdkPath: 'contractCreate.variables',
    run: (host, args) => host.contractCreate.variables(args as { variableApi?: string | null; variableApiData?: string | null }),
  },
  {
    capabilityId: 'contract-create-prepare',
    sdkPath: 'contractCreate.prepare',
    run: (host, args) => Promise.resolve(host.contractCreate.prepare(args as Parameters<ContractCreateCapability['prepare']>[0])),
  },
  {
    capabilityId: 'contract-create',
    sdkPath: 'contractCreate.createIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'contract-create')
      return host.contractCreate.createIdempotent({ draft: args.draft as ContractCreateDraft, requestId })
    },
  },
  {
    capabilityId: 'contract-create-callback',
    sdkPath: 'contractCreate.callback',
    run: (host, args) => host.contractCreate.callback(args as Parameters<ContractCreateCapability['callback']>[0]),
  },

  // ---- 基础数据：部门 / 字典 / 权限清单。九条全是只读，一律不需要 requestId ----
  //
  // 注意这里有**故意的不对称**：`getDepartment` / `getDict` / `hasPermission` 收标量，
  // 其余收对象。绑定层只做参数适配，校验仍然在能力自己那一层（别在这儿重复校验）。
  {
    capabilityId: 'base-dept-search',
    sdkPath: 'baseData.searchDepartments',
    run: (host, args) => host.baseData.searchDepartments(args as { keyword: string; limit?: number }),
  },
  {
    capabilityId: 'base-dept-get',
    sdkPath: 'baseData.getDepartment',
    run: (host, args) => host.baseData.getDepartment(Number(args.id)),
  },
  {
    capabilityId: 'base-dept-children',
    sdkPath: 'baseData.listDepartments',
    run: (host, args) => host.baseData.listDepartments(args as { parentId: number; limit?: number }),
  },
  {
    capabilityId: 'base-dict-get',
    sdkPath: 'baseData.getDict',
    run: (host, args) => host.baseData.getDict(args.dictType as string),
  },
  {
    capabilityId: 'base-dict-search',
    sdkPath: 'baseData.searchDictTypes',
    run: (host, args) => host.baseData.searchDictTypes(args as { keyword: string; limit?: number }),
  },
  {
    capabilityId: 'base-dict-translate',
    sdkPath: 'baseData.translateDict',
    run: (host, args) =>
      host.baseData.translateDict(args as unknown as { dictType: string; value: string | number }),
  },
  {
    capabilityId: 'base-permission-has',
    sdkPath: 'baseData.hasPermission',
    run: (host, args) => host.baseData.hasPermission(args.code as string),
  },
  {
    capabilityId: 'base-permission-check',
    sdkPath: 'baseData.checkPermissions',
    run: (host, args) => host.baseData.checkPermissions(args.codes as string | string[]),
  },
  {
    capabilityId: 'base-permission-search',
    sdkPath: 'baseData.searchPermissions',
    run: (host, args) => host.baseData.searchPermissions(args as { keyword: string; limit?: number }),
  },

  // ---- 上传（OSS 直传）。凭据不在 args 里——它由 `PortalHeadlessConfig.oss` 在建 SDK 时给，
  //      调用方不该、也不必在每次 invoke 里传。注意这三个都是**打 OSS 而不是打 Portal 后端**。
  {
    // 参数名与 `OssUploadRequest` 字段同名同义（fileName 含扩展名、fixedName 不含），
    // 所以直接透传；`content`/`path` 二选一的判别联合没法在运行时收窄，只能 cast。
    capabilityId: 'base-upload-file',
    sdkPath: 'baseUpload.upload',
    run: (host, args) => host.baseUpload.upload(args as unknown as OssUploadRequest),
  },
  {
    // 删除是**必须的收尾能力**：测试产物删不掉就会一直在桶里堆。调休那一单就撞上过
    // （传了个 70 字节 PNG 却没法通过 SDK 删），补上这条之后才清掉。
    capabilityId: 'base-upload-delete',
    sdkPath: 'baseUpload.deleteObject',
    run: (host, args) => host.baseUpload.deleteObject(String(args.objectKey)),
  },
  {
    // 批量删（OSS 的 DeleteMultipleObjects，POST + XML body，一次 ≤1000）。
    // 超限**当场拒、不拆包**——静默拆成多次请求会让"删了多少"变得说不清。
    capabilityId: 'base-upload-delete-multi',
    sdkPath: 'baseUpload.deleteMulti',
    run: (host, args) => host.baseUpload.deleteMulti(args.objectKeys as string[] | string),
  },
  {
    capabilityId: 'base-upload-acl-get',
    sdkPath: 'baseUpload.getAcl',
    run: (host, args) => host.baseUpload.getAcl(String(args.objectKey)),
  },
  {
    // ACL 收的是**目标权限值**而不是"切换"，重发一次终态相同 → 不包防重，如实透传。
    //
    // ⚠️ 实测里 **`putACL` 从来没有在真实上传里成功过一次**（Portal 的 `ossPut` 走的
    //    `x-oss-object-acl` 头就返回了，没再打 putACL 请求），所以这条只在需要补设 ACL 时用；
    //    「它是不是多余」这个问题**没有实测答案**，别把它当成上传的必经一步。
    capabilityId: 'base-upload-acl-set',
    sdkPath: 'baseUpload.putAcl',
    run: (host, args) =>
      host.baseUpload.putAcl(
        String(args.objectKey),
        args.acl as 'public-read' | 'private' | 'public-read-write' | 'default',
      ),
  },

  // ---- 应用外壳：用户信息 / 人员 / 待办 / 菜单 / 工作台卡片。七条全是只读 ----
  //
  // 参数形状直接用 `Parameters<...>[0]` 取，不在这里重抄一遍——抄一遍就多一个会漂的副本，
  // 而绑定层只该做适配、不该重复能力自己的契约。
  {
    capabilityId: 'base-user-info',
    sdkPath: 'baseShell.getUserInfo',
    run: (host) => host.baseShell.getUserInfo(),
  },
  {
    capabilityId: 'base-user-search',
    sdkPath: 'baseShell.searchUsers',
    run: (host, args) =>
      host.baseShell.searchUsers(args as unknown as Parameters<BaseShellCapability['searchUsers']>[0]),
  },
  {
    capabilityId: 'base-todo-list',
    sdkPath: 'baseShell.listTodos',
    run: (host, args) => host.baseShell.listTodos(args as unknown as Parameters<BaseShellCapability['listTodos']>[0]),
  },
  {
    capabilityId: 'base-todo-counts',
    sdkPath: 'baseShell.getTodoCounts',
    run: (host) => host.baseShell.getTodoCounts(),
  },
  {
    capabilityId: 'base-menu-nav',
    sdkPath: 'baseShell.getMenuNav',
    run: (host, args) => host.baseShell.getMenuNav(args as unknown as Parameters<BaseShellCapability['getMenuNav']>[0]),
  },
  {
    capabilityId: 'base-menu-paths',
    sdkPath: 'baseShell.listMenuPaths',
    run: (host, args) =>
      host.baseShell.listMenuPaths(args as unknown as Parameters<BaseShellCapability['listMenuPaths']>[0]),
  },
  {
    capabilityId: 'base-home-widgets',
    sdkPath: 'baseShell.listHomeWidgets',
    run: (host, args) =>
      host.baseShell.listHomeWidgets(args as unknown as Parameters<BaseShellCapability['listHomeWidgets']>[0]),
  },

  // ---- 通用审批：流程表单线的第一条（形态与会议室预定同族：prepare → submit → cancel）----
  {
    capabilityId: 'general-approval-definition',
    sdkPath: 'generalApproval.definition',
    run: (host, args) => host.generalApproval.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'general-approval-user-search',
    sdkPath: 'generalApproval.searchUsers',
    run: (host, args) =>
      host.generalApproval.searchUsers(args as unknown as Parameters<GeneralApprovalCapabilityWithIdempotency['searchUsers']>[0]),
  },
  {
    // prepare 是**只读**的：只回答"这次提交要人工指定哪些审批人"。
    // 别在这里顺手提交——那会把两步并成一步（conventions 第 13 条）。
    capabilityId: 'general-approval-prepare',
    sdkPath: 'generalApproval.prepare',
    run: (host, args) => host.generalApproval.prepare(args as unknown as GeneralApprovalDraft),
  },
  {
    // 写操作绑定到**带防重**的那个方法。这一条比普通 CRUD 更该防重（D12）：
    // 后端零幂等，重发一次就是**第二条流程实例 + 第二串真人待办**。
    capabilityId: 'general-approval-submit',
    sdkPath: 'generalApproval.submitIdempotent',
    run: async (host, args) => {
      const { requestId, startUserSelectAssignees, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'general-approval-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.generalApproval.submitIdempotent({
        ...(draft as unknown as GeneralApprovalDraft),
        requestId,
        ...(startUserSelectAssignees === undefined
          ? {}
          : { startUserSelectAssignees: startUserSelectAssignees as GeneralApprovalAssignees }),
      })
    },
  },
  {
    capabilityId: 'general-approval-detail',
    sdkPath: 'generalApproval.detail',
    run: (host, args) => host.generalApproval.detail(args.id as number | string),
  },
  {
    capabilityId: 'general-approval-my-instances',
    sdkPath: 'generalApproval.myInstances',
    run: (host, args) =>
      host.generalApproval.myInstances(
        args as unknown as Parameters<GeneralApprovalCapabilityWithIdempotency['myInstances']>[0],
      ),
  },
  {
    // 取消（撤回）**没有**防重，与会议室那条线一致：按 id 撤销，重发最多是一次"已取消"的
    // 业务报错，不会产生第二条单据——所以如实透传，不假装它被防重保护了。
    capabilityId: 'general-approval-cancel',
    sdkPath: 'generalApproval.cancel',
    run: (host, args) =>
      host.generalApproval.cancel(
        args as unknown as Parameters<GeneralApprovalCapabilityWithIdempotency['cancel']>[0],
      ),
  },

  // ---- 租户 / 企业上下文（基础能力）----
  {
    capabilityId: 'base-tenant-list',
    sdkPath: 'baseTenant.listTenants',
    run: (host, args) => host.baseTenant.listTenants(args as unknown as Parameters<BaseTenantCapability['listTenants']>[0]),
  },
  {
    capabilityId: 'base-tenant-get',
    sdkPath: 'baseTenant.getTenant',
    run: (host, args) => host.baseTenant.getTenant(args as unknown as Parameters<BaseTenantCapability['getTenant']>[0]),
  },

  // ---- 销售域基础数据（基础能力）。打的是 sale 实例，没配 baseURL 就失败关闭 ----
  {
    capabilityId: 'base-sale-shop-info',
    sdkPath: 'baseSale.getShopInfo',
    run: (host) => host.baseSale.getShopInfo(),
  },
  {
    capabilityId: 'base-sale-area-search',
    sdkPath: 'baseSale.searchAreas',
    run: (host, args) => host.baseSale.searchAreas(args as unknown as Parameters<BaseSaleCapability['searchAreas']>[0]),
  },
  {
    capabilityId: 'base-sale-area-children',
    sdkPath: 'baseSale.listAreaChildren',
    run: (host, args) =>
      host.baseSale.listAreaChildren(args as unknown as Parameters<BaseSaleCapability['listAreaChildren']>[0]),
  },
  {
    capabilityId: 'base-sale-area-describe',
    sdkPath: 'baseSale.describeAreas',
    run: (host, args) =>
      host.baseSale.describeAreas(args as unknown as Parameters<BaseSaleCapability['describeAreas']>[0]),
  },
  {
    capabilityId: 'base-sale-manufacturer-search',
    sdkPath: 'baseSale.searchManufacturers',
    run: (host, args) =>
      host.baseSale.searchManufacturers(args as unknown as Parameters<BaseSaleCapability['searchManufacturers']>[0]),
  },
  {
    capabilityId: 'base-sale-brand-search',
    sdkPath: 'baseSale.searchBrands',
    run: (host, args) => host.baseSale.searchBrands(args as unknown as Parameters<BaseSaleCapability['searchBrands']>[0]),
  },
  {
    capabilityId: 'base-sale-home-tip',
    sdkPath: 'baseSale.getHomeTip',
    run: (host) => host.baseSale.getHomeTip(),
  },

  // ---- 请假申请：流程表单线第二条。形态与通用审批同族（prepare → submit → cancel）----
  {
    capabilityId: 'leave-application-definition',
    sdkPath: 'leaveApplication.definition',
    run: (host, args) => host.leaveApplication.definition(args.key as string | undefined),
  },
  {
    // 只回当前用户**组成载荷的那四项**，刻意不整份返回——
    // `sys/user/info` 里带 password2（bcrypt 散列）与 salt
    capabilityId: 'leave-application-profile',
    sdkPath: 'leaveApplication.profile',
    run: (host) => host.leaveApplication.profile(),
  },
  {
    capabilityId: 'leave-application-types',
    sdkPath: 'leaveApplication.types',
    run: (host, args) => host.leaveApplication.types(args.dictType as string | undefined),
  },
  {
    capabilityId: 'leave-application-year-rest',
    sdkPath: 'leaveApplication.yearRest',
    run: (host, args) => host.leaveApplication.yearRest(args.userId as number | string | undefined),
  },
  {
    capabilityId: 'leave-application-duration',
    sdkPath: 'leaveApplication.duration',
    run: (host, args) =>
      host.leaveApplication.duration(args as unknown as Parameters<LeaveApplicationCapabilityWithIdempotency['duration']>[0]),
  },
  {
    // prepare 是**只读**的：本流程实测 tasks 恒为空（审批人写死在 BPMN 里），
    // 但不要假定为空——流程改版就会变（conventions 第 13 条）
    capabilityId: 'leave-application-prepare',
    sdkPath: 'leaveApplication.prepare',
    run: (host, args) => host.leaveApplication.prepare(args as unknown as LeaveDraft),
  },
  {
    // 写操作绑定到**带防重**的那个方法。本流程有一道天然防线（同一天同一上午/下午
    // 已有 RUNNING 请假会被后端拦），但**只在日期完全撞上时才拦得住**，换组日期照样重发。
    capabilityId: 'leave-application-submit',
    sdkPath: 'leaveApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, startUserSelectAssignees, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'leave-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.leaveApplication.submitIdempotent({
        ...(draft as unknown as LeaveDraft),
        requestId,
        ...(startUserSelectAssignees === undefined
          ? {}
          : { startUserSelectAssignees: startUserSelectAssignees as GeneralApprovalAssignees }),
      })
    },
  },
  {
    capabilityId: 'leave-application-detail',
    sdkPath: 'leaveApplication.detail',
    run: (host, args) => host.leaveApplication.detail(args.id as number | string),
  },
  {
    capabilityId: 'leave-application-my-instances',
    sdkPath: 'leaveApplication.myInstances',
    run: (host, args) =>
      host.leaveApplication.myInstances(
        args as unknown as Parameters<LeaveApplicationCapabilityWithIdempotency['myInstances']>[0],
      ),
  },
  {
    // 取消（撤回）没有防重，与另两条流程线一致：按 id 撤销，重发最多一次业务报错。
    // ⚠️ 请假**记录行不随取消删除**（后端没有监听器），与页面行为一致。
    capabilityId: 'leave-application-cancel',
    sdkPath: 'leaveApplication.cancel',
    run: (host, args) =>
      host.leaveApplication.cancel(
        args as unknown as Parameters<LeaveApplicationCapabilityWithIdempotency['cancel']>[0],
      ),
  },

  // ---- 用车申请：流程表单线第三条。★ 取人走**分页**版（数组版已被后端关掉，见文档）----
  {
    capabilityId: 'vehicle-application-definition',
    sdkPath: 'vehicleApplication.definition',
    run: (host, args) => host.vehicleApplication.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'vehicle-application-applicant-scope',
    sdkPath: 'vehicleApplication.applicantScope',
    run: (host) => host.vehicleApplication.applicantScope(),
  },
  {
    // 申请人选择器：**按组织分页查**。页面上那个数组版入口已实测被后端关掉
    // （超过 1000 人直接 500，提示改用分页选择器），所以只接分页这条
    capabilityId: 'vehicle-application-applicant-picker',
    sdkPath: 'vehicleApplication.applicantPicker',
    run: (host, args) =>
      host.vehicleApplication.applicantPicker(
        args as unknown as Parameters<VehicleApplicationCapabilityWithIdempotency['applicantPicker']>[0],
      ),
  },
  {
    // 审批人候选：**强制关键字**（D6 / H35，长选项不许无条件全量拉）
    capabilityId: 'vehicle-application-approver-search',
    sdkPath: 'vehicleApplication.approverSearch',
    run: (host, args) =>
      host.vehicleApplication.approverSearch(
        args as unknown as Parameters<VehicleApplicationCapabilityWithIdempotency['approverSearch']>[0],
      ),
  },
  {
    capabilityId: 'vehicle-application-prepare',
    sdkPath: 'vehicleApplication.prepare',
    run: (host, args) => host.vehicleApplication.prepare(args as unknown as VehicleApplicationDraft),
  },
  {
    capabilityId: 'vehicle-application-submit',
    sdkPath: 'vehicleApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, startUserSelectAssignees, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'vehicle-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.vehicleApplication.submitIdempotent({
        ...(draft as unknown as VehicleApplicationDraft),
        requestId,
        ...(startUserSelectAssignees === undefined
          ? {}
          : { startUserSelectAssignees: startUserSelectAssignees as GeneralApprovalAssignees }),
      })
    },
  },
  {
    capabilityId: 'vehicle-application-detail',
    sdkPath: 'vehicleApplication.detail',
    run: (host, args) => host.vehicleApplication.detail(args.id as number | string),
  },
  {
    capabilityId: 'vehicle-application-my-instances',
    sdkPath: 'vehicleApplication.myInstances',
    run: (host, args) =>
      host.vehicleApplication.myInstances(
        args as unknown as Parameters<VehicleApplicationCapabilityWithIdempotency['myInstances']>[0],
      ),
  },
  {
    capabilityId: 'vehicle-application-cancel',
    sdkPath: 'vehicleApplication.cancel',
    run: (host, args) =>
      host.vehicleApplication.cancel(
        args as unknown as Parameters<VehicleApplicationCapabilityWithIdempotency['cancel']>[0],
      ),
  },

  // ---- 差旅费支出申请表（用户口语里的「报销」）：流程表单线第四条，13 个能力 ----
  // 形态比前三条复杂：**明细行数组**，且三级地区要按位置展开成省/市/区三个标量；
  // 金额总计由前端算（不接受调用方给）。理由逐条写在 docs/pages/差旅费报销.md。
  {
    capabilityId: 'travel-expense-definition',
    sdkPath: 'travelExpense.definition',
    run: (host, args) => host.travelExpense.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'travel-expense-org-options',
    sdkPath: 'travelExpense.orgOptions',
    run: (host, args) => host.travelExpense.orgOptions(args as unknown as Parameters<TravelExpenseCapabilityWithIdempotency['orgOptions']>[0]),
  },
  {
    capabilityId: 'travel-expense-fee-items',
    sdkPath: 'travelExpense.feeItems',
    run: (host, args) => host.travelExpense.feeItems(args.sourceKey as string),
  },
  {
    capabilityId: 'travel-expense-dict-options',
    sdkPath: 'travelExpense.dictOptions',
    run: (host, args) => host.travelExpense.dictOptions(args.dictType as string),
  },
  {
    capabilityId: 'travel-expense-area-options',
    sdkPath: 'travelExpense.areaOptions',
    run: (host, args) => host.travelExpense.areaOptions(args.parentId as string | undefined),
  },
  {
    capabilityId: 'travel-expense-projects',
    sdkPath: 'travelExpense.projects',
    run: (host, args) => host.travelExpense.projects(args.keyword as string | undefined),
  },
  {
    capabilityId: 'travel-expense-project-principal',
    sdkPath: 'travelExpense.projectPrincipal',
    run: (host, args) => host.travelExpense.projectPrincipal(args.id as number | string),
  },
  {
    // 出差人候选：与用车那条一样，长选项**强制关键字**
    capabilityId: 'travel-expense-travelers',
    sdkPath: 'travelExpense.travelers',
    run: (host, args) => host.travelExpense.travelers(args as unknown as Parameters<TravelExpenseCapabilityWithIdempotency['travelers']>[0]),
  },
  {
    capabilityId: 'travel-expense-payee-options',
    sdkPath: 'travelExpense.payeeOptions',
    run: (host, args) => host.travelExpense.payeeOptions(args as unknown as Parameters<TravelExpenseCapabilityWithIdempotency['payeeOptions']>[0]),
  },
  {
    // prepare 是**只读**的：本地校验 + 拼载荷 + 问审批链 + 自审拦截；
    // 注意它返回的 `previewComplete:false` 表示那一支的预览**不完整**（盲区已在文档写明）
    capabilityId: 'travel-expense-prepare',
    sdkPath: 'travelExpense.prepare',
    run: (host, args) => host.travelExpense.prepare(args as unknown as TravelExpenseDraft),
  },
  {
    capabilityId: 'travel-expense-submit',
    sdkPath: 'travelExpense.submitIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'travel-expense-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.travelExpense.submitIdempotent({
        ...(draft as unknown as TravelExpenseDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'travel-expense-detail',
    sdkPath: 'travelExpense.detail',
    run: (host, args) => host.travelExpense.detail(args.id as number | string),
  },
  {
    // ⚠️ `businessKey` **跨流程会撞车**（实测：差旅费 103 与 welfare_expense 103 同串），
    // 所以按 businessKey 找实例时必须连 `processDefinitionKey` 一起判，别只认 businessKey。
    capabilityId: 'travel-expense-my-instances',
    sdkPath: 'travelExpense.myInstances',
    run: (host, args) => host.travelExpense.myInstances(args as unknown as Parameters<TravelExpenseCapabilityWithIdempotency['myInstances']>[0]),
  },
  {
    capabilityId: 'travel-expense-cancel',
    sdkPath: 'travelExpense.cancel',
    run: (host, args) =>
      host.travelExpense.cancel(args as unknown as Parameters<TravelExpenseCapabilityWithIdempotency['cancel']>[0]),
  },

  // ---- 产品设计文档审核：流程表单线第五条 ----
  // ⚠️ 调查说它属「审核类」（processType=1），**实测不成立**——它在 processType=2（审批）里。
  {
    capabilityId: 'product-design-approval-definition',
    sdkPath: 'productDesignApproval.definition',
    run: (host, args) => host.productDesignApproval.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'product-design-approval-user-search',
    sdkPath: 'productDesignApproval.searchUsers',
    run: (host, args) =>
      host.productDesignApproval.searchUsers(args as unknown as Parameters<ProductDesignApprovalCapabilityWithIdempotency['searchUsers']>[0]),
  },
  {
    capabilityId: 'product-design-approval-prepare',
    sdkPath: 'productDesignApproval.prepare',
    run: (host, args) =>
      host.productDesignApproval.prepare(args as unknown as ProductDesignApprovalDraft),
  },
  {
    // 比通用审批**多做的一条**：页面右下角「查看审批流程」的预览，请求体逐字节照抄抓包。只读。
    capabilityId: 'product-design-approval-preview',
    sdkPath: 'productDesignApproval.preview',
    run: (host, args) =>
      host.productDesignApproval.preview(args as unknown as Parameters<ProductDesignApprovalCapabilityWithIdempotency['preview']>[0]),
  },
  {
    capabilityId: 'product-design-approval-submit',
    sdkPath: 'productDesignApproval.submitIdempotent',
    run: async (host, args) => {
      const { requestId, startUserSelectAssignees, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'product-design-approval-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.productDesignApproval.submitIdempotent({
        ...(draft as unknown as ProductDesignApprovalDraft),
        requestId,
        ...(startUserSelectAssignees === undefined
          ? {}
          : { startUserSelectAssignees: startUserSelectAssignees as GeneralApprovalAssignees }),
      })
    },
  },
  {
    capabilityId: 'product-design-approval-detail',
    sdkPath: 'productDesignApproval.detail',
    run: (host, args) => host.productDesignApproval.detail(args.id as number | string),
  },
  {
    capabilityId: 'product-design-approval-my-instances',
    sdkPath: 'productDesignApproval.myInstances',
    run: (host, args) =>
      host.productDesignApproval.myInstances(args as unknown as Parameters<ProductDesignApprovalCapabilityWithIdempotency['myInstances']>[0]),
  },
  {
    capabilityId: 'product-design-approval-cancel',
    sdkPath: 'productDesignApproval.cancel',
    run: (host, args) =>
      host.productDesignApproval.cancel(args as unknown as Parameters<ProductDesignApprovalCapabilityWithIdempotency['cancel']>[0]),
  },

  // ---- 待办办理：横切能力，让 SDK 能**以审批人身份**办别人提交的单据 ----
  //
  // 这条线补上的是前面五条流程线的另一半：以前只能"发起"，不能"办理"。
  // 读的三个 + 写的七个（七个写都带防重——办理天然不该重放）。
  {
    capabilityId: 'task-action-instance',
    sdkPath: 'taskAction.instance',
    run: (host, args) => host.taskAction.instance(args.processInstanceId as string | number),
  },
  {
    capabilityId: 'task-action-workflow-path',
    sdkPath: 'taskAction.workflowPath',
    run: (host, args) => host.taskAction.workflowPath(args.processInstanceId as string | number),
  },
  {
    // 回退的可选目标节点。**先读它再调 return**：`targetTaskDefinitionKey` 的取值来自这里
    capabilityId: 'task-action-return-options',
    sdkPath: 'taskAction.returnOptions',
    run: (host, args) => host.taskAction.returnOptions(args.taskId as string | number),
  },
  {
    capabilityId: 'task-action-approve',
    sdkPath: 'taskAction.approveIdempotent',
    run: (host, args) => host.taskAction.approveIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['approveIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-reject',
    sdkPath: 'taskAction.rejectIdempotent',
    run: (host, args) => host.taskAction.rejectIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['rejectIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-transfer',
    sdkPath: 'taskAction.transferIdempotent',
    run: (host, args) => host.taskAction.transferIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['transferIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-delegate',
    sdkPath: 'taskAction.delegateIdempotent',
    run: (host, args) => host.taskAction.delegateIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['delegateIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-return',
    sdkPath: 'taskAction.returnIdempotent',
    run: (host, args) => host.taskAction.returnIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['returnIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-batch-approve',
    sdkPath: 'taskAction.batchApproveIdempotent',
    run: (host, args) => host.taskAction.batchApproveIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['batchApproveIdempotent']>[0]),
  },
  {
    capabilityId: 'task-action-batch-reject',
    sdkPath: 'taskAction.batchRejectIdempotent',
    run: (host, args) => host.taskAction.batchRejectIdempotent(args as unknown as Parameters<TaskActionCapabilityWithIdempotency['batchRejectIdempotent']>[0]),
  },

  // ---- 加班审批：流程表单线第六条 ----
  // ★ 本流程**没有**「发起人自选」节点，审批人由后端按 candidateStrategy=23（直属上级）算出来，
  //   所以前几条线「别把审批人选成自己」那条守卫**拦不住**。这个能力的守卫更强：
  //   用 `approvalChain`（真实审批链预览）扫所有 USER_TASK 的候选人，命中发起人本人在 create 之前抛错。
  {
    capabilityId: 'overtime-application-definition',
    sdkPath: 'overtimeApplication.definition',
    run: (host, args) => host.overtimeApplication.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'overtime-application-current-user',
    sdkPath: 'overtimeApplication.currentUser',
    run: (host) => host.overtimeApplication.currentUser(),
  },
  {
    capabilityId: 'overtime-application-approval-chain',
    sdkPath: 'overtimeApplication.approvalChain',
    run: (host, args) =>
      host.overtimeApplication.approvalChain(args as unknown as Parameters<OvertimeApplicationCapabilityWithIdempotency['approvalChain']>[0]),
  },
  {
    capabilityId: 'overtime-application-prepare',
    sdkPath: 'overtimeApplication.prepare',
    run: (host, args) =>
      host.overtimeApplication.prepare(args as unknown as OvertimeApplicationDraft),
  },
  {
    capabilityId: 'overtime-application-submit',
    sdkPath: 'overtimeApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'overtime-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.overtimeApplication.submitIdempotent({
        ...(draft as unknown as OvertimeApplicationDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'overtime-application-detail',
    sdkPath: 'overtimeApplication.detail',
    run: (host, args) => host.overtimeApplication.detail(args.id as number | string),
  },
  {
    capabilityId: 'overtime-application-my-instances',
    sdkPath: 'overtimeApplication.myInstances',
    run: (host, args) =>
      host.overtimeApplication.myInstances(args as unknown as Parameters<OvertimeApplicationCapabilityWithIdempotency['myInstances']>[0]),
  },
  {
    capabilityId: 'overtime-application-cancel',
    sdkPath: 'overtimeApplication.cancel',
    run: (host, args) =>
      host.overtimeApplication.cancel(args as unknown as Parameters<OvertimeApplicationCapabilityWithIdempotency['cancel']>[0]),
  },

  // ---- 调休审批：流程表单线第七条（加班的孪生流程）----
  // 审批链形态与加班完全一样（直属上级、无自选节点），守卫同样走**真实审批链预览**；
  // 但字段形态差很多：**有明细行数组**（加班没有）、**有附件控件**（加班没有）、后端会重算时长。
  {
    capabilityId: 'rest-leave-application-definition',
    sdkPath: 'restLeaveApplication.definition',
    run: (host, args) => host.restLeaveApplication.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'rest-leave-application-current-user',
    sdkPath: 'restLeaveApplication.currentUser',
    run: (host) => host.restLeaveApplication.currentUser(),
  },
  {
    // 本流程独有的只读能力：页面「剩余加班时长」那一格的数据源。
    // ⚠️ 页面显示它用的算法与后端 create 的门槛算法**是两套**（年限/status 口径不同），
    // 所以**不要**拿这个值在本地判「够不够调休」——那个门槛只有后端说了算。
    capabilityId: 'rest-leave-application-remaining-hours',
    sdkPath: 'restLeaveApplication.remainingOvertimeHours',
    run: (host, args) => host.restLeaveApplication.remainingOvertimeHours(args.userId as string | number),
  },
  {
    capabilityId: 'rest-leave-application-approval-chain',
    sdkPath: 'restLeaveApplication.approvalChain',
    run: (host, args) =>
      host.restLeaveApplication.approvalChain(args as unknown as Parameters<RestLeaveApplicationCapabilityWithIdempotency['approvalChain']>[0]),
  },
  {
    capabilityId: 'rest-leave-application-prepare',
    sdkPath: 'restLeaveApplication.prepare',
    run: (host, args) =>
      host.restLeaveApplication.prepare(args as unknown as RestLeaveApplicationDraft),
  },
  {
    capabilityId: 'rest-leave-application-submit',
    sdkPath: 'restLeaveApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'rest-leave-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.restLeaveApplication.submitIdempotent({
        ...(draft as unknown as RestLeaveApplicationDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'rest-leave-application-detail',
    sdkPath: 'restLeaveApplication.detail',
    run: (host, args) => host.restLeaveApplication.detail(args.id as number | string),
  },
  {
    capabilityId: 'rest-leave-application-my-instances',
    sdkPath: 'restLeaveApplication.myInstances',
    run: (host, args) =>
      host.restLeaveApplication.myInstances(args as unknown as Parameters<RestLeaveApplicationCapabilityWithIdempotency['myInstances']>[0]),
  },
  {
    capabilityId: 'rest-leave-application-cancel',
    sdkPath: 'restLeaveApplication.cancel',
    run: (host, args) =>
      host.restLeaveApplication.cancel(args as unknown as Parameters<RestLeaveApplicationCapabilityWithIdempotency['cancel']>[0]),
  },

  // ---- 出差申请：流程表单线第八条 ----
  // 选它不是因为"看着大众化"，而是把人力域候选**逐个拉真实审批链**筛出来的：
  // 用章/离职的审批人是发起人本人（守卫必拦）、转正/信息变更预览算不出候选人、
  // 调动/入职预览里一个 USER_TASK 都没有——**出差是这批里唯一能真提交且能真撤销的**。
  {
    capabilityId: 'business-trip-application-definition',
    sdkPath: 'businessTripApplication.definition',
    run: (host, args) => host.businessTripApplication.definition(args.key as string | undefined),
  },
  {
    capabilityId: 'business-trip-application-current-user',
    sdkPath: 'businessTripApplication.currentUser',
    run: (host) => host.businessTripApplication.currentUser(),
  },
  {
    capabilityId: 'business-trip-application-approval-chain',
    sdkPath: 'businessTripApplication.approvalChain',
    run: (host, args) =>
      host.businessTripApplication.approvalChain(args as unknown as Parameters<BusinessTripApplicationCapabilityWithIdempotency['approvalChain']>[0]),
  },
  {
    capabilityId: 'business-trip-application-prepare',
    sdkPath: 'businessTripApplication.prepare',
    run: (host, args) =>
      host.businessTripApplication.prepare(args as unknown as BusinessTripApplicationDraft),
  },
  {
    // ⚠️ 本流程提交后业务 `status` **仍是 0（待提交）**——判「流程在跑」只能看流程实例，
    //    不要拿业务 status 当判据（实测，见 docs/pages/出差申请.md）。
    capabilityId: 'business-trip-application-submit',
    sdkPath: 'businessTripApplication.submitIdempotent',
    run: async (host, args) => {
      const { requestId, ...draft } = args
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new CapabilityInvokeError(
          'business-trip-application-submit 是写能力：invoke 必须带 requestId（用 createRequestId() 生成，' +
            '超时重试时原样传回上一次那个）。不带会让「超时重发」变成第二条流程实例和一串重复的真人待办（D12 / H11）。',
        )
      }
      return host.businessTripApplication.submitIdempotent({
        ...(draft as unknown as BusinessTripApplicationDraft),
        requestId,
      })
    },
  },
  {
    capabilityId: 'business-trip-application-detail',
    sdkPath: 'businessTripApplication.detail',
    run: (host, args) => host.businessTripApplication.detail(args.id as number | string),
  },
  {
    capabilityId: 'business-trip-application-my-instances',
    sdkPath: 'businessTripApplication.myInstances',
    run: (host, args) =>
      host.businessTripApplication.myInstances(args as unknown as Parameters<BusinessTripApplicationCapabilityWithIdempotency['myInstances']>[0]),
  },
  {
    capabilityId: 'business-trip-application-cancel',
    sdkPath: 'businessTripApplication.cancel',
    run: (host, args) =>
      host.businessTripApplication.cancel(args as unknown as Parameters<BusinessTripApplicationCapabilityWithIdempotency['cancel']>[0]),
  },
  // 课程管理及其由列表实际可达的即时通讯隐藏子页，共用同一个能力组。
  ...Object.entries(STUDY_COURSE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `studyCourse.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.studyCourse as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`课程管理调用方法不存在：studyCourse.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.studyCourse) : fn.call(host.studyCourse, args))
    },
  })),
  {
    capabilityId: 'study-student-list',
    sdkPath: 'studyStudent.list',
    run: (host, args) => host.studyStudent.list(args as StudyStudentQuery),
  },
  {
    capabilityId: 'study-student-check-in-grade',
    sdkPath: 'studyStudent.checkInGrade',
    run: (host, args) => host.studyStudent.checkInGrade(args.studentIds as string | number | Array<string | number>),
  },
  ...Object.entries(STUDY_GRADE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `studyGrade.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.studyGrade as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`班级管理调用方法不存在：studyGrade.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.studyGrade) : fn.call(host.studyGrade, args))
    },
  })),
  ...Object.entries(STUDY_LESSON_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `studyLesson.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.studyLesson as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`课堂管理调用方法不存在：studyLesson.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.studyLesson) : fn.call(host.studyLesson, args))
    },
  })),
  {
    capabilityId: 'study-record-list',
    sdkPath: 'studyRecord.list',
    run: (host, args) => host.studyRecord.list(args as StudyRecordQuery),
  },
  {
    capabilityId: 'study-statistics-student-list',
    sdkPath: 'studyStatistics.listStudents',
    run: (host, args) => host.studyStatistics.listStudents(args as StudyStatisticsStudentQuery),
  },
  {
    capabilityId: 'study-statistics-teacher-list',
    sdkPath: 'studyStatistics.listTeachers',
    run: (host, args) => host.studyStatistics.listTeachers(args as StudyStatisticsTeacherQuery),
  },
  {
    capabilityId: 'study-statistics-lesson-list',
    sdkPath: 'studyStatistics.listLessons',
    run: (host, args) => host.studyStatistics.listLessons(args as StudyStatisticsLessonQuery),
  },
  {
    capabilityId: 'study-statistics-grade-list',
    sdkPath: 'studyStatistics.listGradeLessons',
    run: (host, args) => host.studyStatistics.listGradeLessons(args.kind as GradeLessonKind, args as StudyStatisticsGradeQuery),
  },
  {
    capabilityId: 'study-statistics-learning-summary',
    sdkPath: 'studyStatistics.learningSummary',
    run: (host, args) => host.studyStatistics.learningSummary(args as LearningStaticsPayload),
  },
  ...Object.entries(STUDY_TEACHER_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `studyTeacher.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.studyTeacher as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`讲师管理调用方法不存在：studyTeacher.${method}`)
      return Promise.resolve(args === undefined ? fn.call(host.studyTeacher) : fn.call(host.studyTeacher, args))
    },
  })),
  {
    capabilityId: 'perf-agreement-change-list',
    sdkPath: 'perfAgreement.listAgreementChange',
    run: (host, args) => host.perfAgreement.listAgreementChange(args as unknown as Parameters<PerfAgreementCapability['listAgreementChange']>[0]),
  },
  {
    capabilityId: 'perf-month-agreement-list',
    sdkPath: 'perfAgreement.listMonthAgreements',
    run: (host, args) => host.perfAgreement.listMonthAgreements(args as unknown as Parameters<PerfAgreementCapability['listMonthAgreements']>[0]),
  },
  {
    capabilityId: 'perf-month-agreement-others-list',
    sdkPath: 'perfAgreement.listMonthAgreementsOthers',
    run: (host, args) => host.perfAgreement.listMonthAgreementsOthers(args as unknown as Parameters<PerfAgreementCapability['listMonthAgreementsOthers']>[0]),
  },
  {
    capabilityId: 'perf-year-agreement-list',
    sdkPath: 'perfAgreement.listYearAgreements',
    run: (host, args) => host.perfAgreement.listYearAgreements(args as unknown as Parameters<PerfAgreementCapability['listYearAgreements']>[0]),
  },
  {
    capabilityId: 'perf-year-agreement-others-list',
    sdkPath: 'perfAgreement.listYearAgreementsOthers',
    run: (host, args) => host.perfAgreement.listYearAgreementsOthers(args as unknown as Parameters<PerfAgreementCapability['listYearAgreementsOthers']>[0]),
  },
  {
    capabilityId: 'perf-year-protocol-config-get',
    sdkPath: 'perfAgreement.getYearProtocolConfig',
    run: (host) => host.perfAgreement.getYearProtocolConfig(),
  },
  {
    capabilityId: 'perf-manage-formula-definition-list',
    sdkPath: 'perfManageConfig.listFormulaDefinitions',
    run: (host, args) => host.perfManageConfig.listFormulaDefinitions(args as unknown as Parameters<PerfManageConfigCapability['listFormulaDefinitions']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-list',
    sdkPath: 'perfManageConfig.listIndicators',
    run: (host, args) => host.perfManageConfig.listIndicators(args as unknown as Parameters<PerfManageConfigCapability['listIndicators']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-list',
    sdkPath: 'perfManageConfig.listInsuranceFunds',
    run: (host, args) => host.perfManageConfig.listInsuranceFunds(args as unknown as Parameters<PerfManageConfigCapability['listInsuranceFunds']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-prepare-create',
    sdkPath: 'perfManageConfig.prepareInsuranceFundCreate',
    run: async (host, args) => host.perfManageConfig.prepareInsuranceFundCreate(args as unknown as Parameters<PerfManageConfigCapability['prepareInsuranceFundCreate']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-create',
    sdkPath: 'perfManageConfig.createInsuranceFund',
    run: (host, args) => host.perfManageConfig.createInsuranceFund(args as unknown as Parameters<PerfManageConfigCapability['createInsuranceFund']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-cancel-create',
    sdkPath: 'perfManageConfig.cancelInsuranceFundCreate',
    run: async (host) => host.perfManageConfig.cancelInsuranceFundCreate(),
  },
  {
    capabilityId: 'perf-manage-insurance-prepare-update',
    sdkPath: 'perfManageConfig.prepareInsuranceFundUpdate',
    run: async (host, args) => host.perfManageConfig.prepareInsuranceFundUpdate(args as unknown as Parameters<PerfManageConfigCapability['prepareInsuranceFundUpdate']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-update',
    sdkPath: 'perfManageConfig.updateInsuranceFund',
    run: (host, args) => host.perfManageConfig.updateInsuranceFund(args as unknown as Parameters<PerfManageConfigCapability['updateInsuranceFund']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-cancel-update',
    sdkPath: 'perfManageConfig.cancelInsuranceFundUpdate',
    run: async (host) => host.perfManageConfig.cancelInsuranceFundUpdate(),
  },
  {
    capabilityId: 'perf-manage-standard-list',
    sdkPath: 'perfManageConfig.listStandards',
    run: (host, args) => host.perfManageConfig.listStandards(args as unknown as Parameters<PerfManageConfigCapability['listStandards']>[0]),
  },
  {
    capabilityId: 'perf-manage-protocol-config-read',
    sdkPath: 'perfManageConfig.readProtocolConfig',
    run: (host, args) => host.perfManageConfig.readProtocolConfig(args as unknown as Parameters<PerfManageConfigCapability['readProtocolConfig']>[0]),
  },
  {
    capabilityId: 'perf-manage-protocol-config-update',
    sdkPath: 'perfManageConfig.updateProtocolConfig',
    run: (host, args) => host.perfManageConfig.updateProtocolConfig(args as unknown as Parameters<PerfManageConfigCapability['updateProtocolConfig']>[0]),
  },
  {
    capabilityId: 'perf-manage-protocol-deduct-rule-list',
    sdkPath: 'perfManageConfig.listProtocolDeductRules',
    run: (host) => host.perfManageConfig.listProtocolDeductRules(),
  },
  {
    capabilityId: 'perf-manage-protocol-deduct-rule-update',
    sdkPath: 'perfManageConfig.updateProtocolDeductRule',
    run: (host, args) => host.perfManageConfig.updateProtocolDeductRule(args as unknown as Parameters<PerfManageConfigCapability['updateProtocolDeductRule']>[0]),
  },
  {
    capabilityId: 'perf-manage-formula-definition-prepare-save',
    sdkPath: 'perfManageConfig.prepareFormulaDefinitionSave',
    run: async (host, args) => host.perfManageConfig.prepareFormulaDefinitionSave(args as unknown as Parameters<PerfManageConfigCapability['prepareFormulaDefinitionSave']>[0]),
  },
  {
    capabilityId: 'perf-manage-formula-definition-save-and-publish',
    sdkPath: 'perfManageConfig.saveAndPublishFormulaDefinition',
    run: (host, args) => host.perfManageConfig.saveAndPublishFormulaDefinition(args as unknown as Parameters<PerfManageConfigCapability['saveAndPublishFormulaDefinition']>[0]),
  },
  {
    capabilityId: 'perf-manage-formula-definition-cancel-save',
    sdkPath: 'perfManageConfig.cancelFormulaDefinitionSave',
    run: async (host) => host.perfManageConfig.cancelFormulaDefinitionSave(),
  },
  {
    capabilityId: 'perf-manage-indicator-prepare-save-data',
    sdkPath: 'perfManageConfig.prepareIndicatorDataSave',
    run: (host, args) => Promise.resolve(host.perfManageConfig.prepareIndicatorDataSave(args as unknown as Parameters<PerfManageConfigCapability['prepareIndicatorDataSave']>[0])),
  },
  {
    capabilityId: 'perf-manage-indicator-save-data',
    sdkPath: 'perfManageConfig.submitIndicatorDataSave',
    run: (host, args) => host.perfManageConfig.submitIndicatorDataSave(args as unknown as Parameters<PerfManageConfigCapability['submitIndicatorDataSave']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-cancel-save-data',
    sdkPath: 'perfManageConfig.cancelIndicatorDataSave',
    run: async (host) => host.perfManageConfig.cancelIndicatorDataSave(),
  },
  {
    capabilityId: 'perf-manage-indicator-prepare-import',
    sdkPath: 'perfManageConfig.prepareIndicatorImport',
    run: async (host, args) => host.perfManageConfig.prepareIndicatorImport(args as unknown as Parameters<PerfManageConfigCapability['prepareIndicatorImport']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-import',
    sdkPath: 'perfManageConfig.importIndicators',
    run: (host, args) => host.perfManageConfig.importIndicators(args as unknown as Parameters<PerfManageConfigCapability['importIndicators']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-prepare-status',
    sdkPath: 'perfManageConfig.prepareIndicatorStatus',
    run: async (host, args) => host.perfManageConfig.prepareIndicatorStatus(args as unknown as Parameters<PerfManageConfigCapability['prepareIndicatorStatus']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-update-status',
    sdkPath: 'perfManageConfig.updateIndicatorStatus',
    run: (host, args) => host.perfManageConfig.updateIndicatorStatus(args as unknown as Parameters<PerfManageConfigCapability['updateIndicatorStatus']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-prepare-delete',
    sdkPath: 'perfManageConfig.prepareIndicatorDelete',
    run: async (host, args) => host.perfManageConfig.prepareIndicatorDelete(args as unknown as Parameters<PerfManageConfigCapability['prepareIndicatorDelete']>[0]),
  },
  {
    capabilityId: 'perf-manage-indicator-delete',
    sdkPath: 'perfManageConfig.deleteIndicators',
    run: (host, args) => host.perfManageConfig.deleteIndicators(args as unknown as Parameters<PerfManageConfigCapability['deleteIndicators']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-prepare-import',
    sdkPath: 'perfManageConfig.prepareInsuranceImport',
    run: async (host, args) => host.perfManageConfig.prepareInsuranceImport(args as unknown as Parameters<PerfManageConfigCapability['prepareInsuranceImport']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-import',
    sdkPath: 'perfManageConfig.importInsuranceFunds',
    run: (host, args) => host.perfManageConfig.importInsuranceFunds(args as unknown as Parameters<PerfManageConfigCapability['importInsuranceFunds']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-prepare-delete',
    sdkPath: 'perfManageConfig.prepareInsuranceDelete',
    run: async (host, args) => host.perfManageConfig.prepareInsuranceDelete(args as unknown as Parameters<PerfManageConfigCapability['prepareInsuranceDelete']>[0]),
  },
  {
    capabilityId: 'perf-manage-insurance-delete',
    sdkPath: 'perfManageConfig.deleteInsuranceFunds',
    run: (host, args) => host.perfManageConfig.deleteInsuranceFunds(args as unknown as Parameters<PerfManageConfigCapability['deleteInsuranceFunds']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-prepare-import',
    sdkPath: 'perfManageConfig.prepareStandardImport',
    run: async (host, args) => host.perfManageConfig.prepareStandardImport(args as unknown as Parameters<PerfManageConfigCapability['prepareStandardImport']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-import',
    sdkPath: 'perfManageConfig.importStandards',
    run: (host, args) => host.perfManageConfig.importStandards(args as unknown as Parameters<PerfManageConfigCapability['importStandards']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-prepare-delete',
    sdkPath: 'perfManageConfig.prepareStandardDelete',
    run: async (host, args) => host.perfManageConfig.prepareStandardDelete(args as unknown as Parameters<PerfManageConfigCapability['prepareStandardDelete']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-delete',
    sdkPath: 'perfManageConfig.deleteStandards',
    run: (host, args) => host.perfManageConfig.deleteStandards(args as unknown as Parameters<PerfManageConfigCapability['deleteStandards']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-prepare-save-data',
    sdkPath: 'perfManageConfig.prepareStandardDataSave',
    run: (host, args) => Promise.resolve(host.perfManageConfig.prepareStandardDataSave(args as unknown as Parameters<PerfManageConfigCapability['prepareStandardDataSave']>[0])),
  },
  {
    capabilityId: 'perf-manage-standard-save-data',
    sdkPath: 'perfManageConfig.submitStandardDataSave',
    run: (host, args) => host.perfManageConfig.submitStandardDataSave(args as unknown as Parameters<PerfManageConfigCapability['submitStandardDataSave']>[0]),
  },
  {
    capabilityId: 'perf-manage-standard-cancel-save-data',
    sdkPath: 'perfManageConfig.cancelStandardDataSave',
    run: async (host) => host.perfManageConfig.cancelStandardDataSave(),
  },
  ...Object.entries(PERF_MANAGE_TEMPLATE_METHODS).map(([capabilityId, method]) => ({
    capabilityId,
    sdkPath: `perfManageTemplate.${method}`,
    run: (host: CapabilityHost, args: CapabilityInvokeArgs) => {
      const fn = (host.perfManageTemplate as unknown as Record<string, (input?: unknown) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`绩效模板调用方法不存在：perfManageTemplate.${method}`)
      const input = method.startsWith('prepare') && args.form !== undefined ? args.form : args
      return Promise.resolve(fn.call(host.perfManageTemplate, input))
    },
  })),
  {
    capabilityId: 'perf-salary-main-list',
    sdkPath: 'perfSalary.listSalaryMain',
    run: (host, args) => host.perfSalary.listSalaryMain(args as unknown as Parameters<PerfSalaryCapability['listSalaryMain']>[0]),
  },
  {
    capabilityId: 'perf-salary-main-download-template',
    sdkPath: 'perfSalary.downloadSalaryMainTemplate',
    run: (host) => host.perfSalary.downloadSalaryMainTemplate(),
  },
  {
    capabilityId: 'perf-salary-main-export',
    sdkPath: 'perfSalary.exportSalaryMain',
    run: (host, args) => host.perfSalary.exportSalaryMain(args as unknown as Parameters<PerfSalaryCapability['exportSalaryMain']>[0]),
  },
  {
    capabilityId: 'perf-salary-main-prepare-import',
    sdkPath: 'perfSalary.prepareSalaryMainImport',
    run: async (host, args) => host.perfSalary.prepareSalaryMainImport(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryMainImport']>[0]),
  },
  {
    capabilityId: 'perf-salary-main-import',
    sdkPath: 'perfSalary.importSalaryMainIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-main-import')
      const { requestId: _requestId, ...input } = args
      return host.perfSalary.importSalaryMainIdempotent({
        ...(input as Parameters<PerfSalaryCapabilityWithIdempotency['importSalaryMainIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-adjust-list',
    sdkPath: 'perfSalary.listSalaryAdjust',
    run: (host, args) => host.perfSalary.listSalaryAdjust(args as unknown as Parameters<PerfSalaryCapability['listSalaryAdjust']>[0]),
  },
  {
    capabilityId: 'perf-salary-adjust-prepare-save',
    sdkPath: 'perfSalary.prepareSalaryAdjust',
    run: async (host, args) => host.perfSalary.prepareSalaryAdjust(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryAdjust']>[0]),
  },
  {
    capabilityId: 'perf-salary-adjust-save',
    sdkPath: 'perfSalary.saveSalaryAdjustIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-adjust-save')
      const { requestId: _requestId, ...draft } = args
      return host.perfSalary.saveSalaryAdjustIdempotent({
        ...(draft as Parameters<PerfSalaryCapabilityWithIdempotency['saveSalaryAdjustIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-examine-result-list',
    sdkPath: 'perfSalary.listSalaryExamineResult',
    run: (host, args) => host.perfSalary.listSalaryExamineResult(args as unknown as Parameters<PerfSalaryCapability['listSalaryExamineResult']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-get',
    sdkPath: 'perfSalary.getSalaryExamineResult',
    run: (host, args) => host.perfSalary.getSalaryExamineResult(args as unknown as Parameters<PerfSalaryCapability['getSalaryExamineResult']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-prepare-create',
    sdkPath: 'perfSalary.prepareSalaryExamineResultCreate',
    run: async (host, args) => host.perfSalary.prepareSalaryExamineResultCreate(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryExamineResultCreate']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-create',
    sdkPath: 'perfSalary.createSalaryExamineResultIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-examine-result-create')
      const { requestId: _requestId, ...form } = args
      return host.perfSalary.createSalaryExamineResultIdempotent({
        ...(form as Parameters<PerfSalaryCapabilityWithIdempotency['createSalaryExamineResultIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-examine-result-prepare-update',
    sdkPath: 'perfSalary.prepareSalaryExamineResultUpdate',
    run: async (host, args) => host.perfSalary.prepareSalaryExamineResultUpdate(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryExamineResultUpdate']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-update',
    sdkPath: 'perfSalary.updateSalaryExamineResultIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-examine-result-update')
      const { requestId: _requestId, ...form } = args
      return host.perfSalary.updateSalaryExamineResultIdempotent({
        ...(form as Parameters<PerfSalaryCapabilityWithIdempotency['updateSalaryExamineResultIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-examine-result-prepare-remove',
    sdkPath: 'perfSalary.prepareSalaryExamineResultRemove',
    run: async (host, args) => host.perfSalary.prepareSalaryExamineResultRemove(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryExamineResultRemove']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-remove',
    sdkPath: 'perfSalary.removeSalaryExamineResultIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-examine-result-remove')
      const { requestId: _requestId, ...input } = args
      return host.perfSalary.removeSalaryExamineResultIdempotent({
        ...(input as Parameters<PerfSalaryCapabilityWithIdempotency['removeSalaryExamineResultIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-examine-result-prepare-import',
    sdkPath: 'perfSalary.prepareSalaryExamineResultImport',
    run: async (host, args) => host.perfSalary.prepareSalaryExamineResultImport(args as unknown as Parameters<PerfSalaryCapability['prepareSalaryExamineResultImport']>[0]),
  },
  {
    capabilityId: 'perf-salary-examine-result-import',
    sdkPath: 'perfSalary.importSalaryExamineResultIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-salary-examine-result-import')
      const { requestId: _requestId, ...input } = args
      return host.perfSalary.importSalaryExamineResultIdempotent({
        ...(input as Parameters<PerfSalaryCapabilityWithIdempotency['importSalaryExamineResultIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-salary-examine-result-download-template',
    sdkPath: 'perfSalary.downloadSalaryExamineResultTemplate',
    run: (host) => host.perfSalary.downloadSalaryExamineResultTemplate(),
  },
  {
    capabilityId: 'perf-block-main-list',
    sdkPath: 'perfSalary.listBlockMain',
    run: (host, args) => host.perfSalary.listBlockMain(args as unknown as Parameters<PerfSalaryCapability['listBlockMain']>[0]),
  },
  {
    capabilityId: 'perf-block-main-prepare-status',
    sdkPath: 'perfSalary.prepareBlockStatus',
    run: async (host, args) => host.perfSalary.prepareBlockStatus(args as unknown as Parameters<PerfSalaryCapability['prepareBlockStatus']>[0]),
  },
  {
    capabilityId: 'perf-block-main-set-status',
    sdkPath: 'perfSalary.setBlockStatusIdempotent',
    run: (host, args) => {
      const requestId = requireRequestId(args, 'perf-block-main-set-status')
      const { requestId: _requestId, ...draft } = args
      return host.perfSalary.setBlockStatusIdempotent({
        ...(draft as Parameters<PerfSalaryCapabilityWithIdempotency['setBlockStatusIdempotent']>[0]),
        requestId,
      })
    },
  },
  {
    capabilityId: 'perf-analysis-department-summary',
    sdkPath: 'perfSalary.getAnalysisDepartmentSummary',
    run: (host, args) => host.perfSalary.getAnalysisDepartmentSummary(args as unknown as Parameters<PerfSalaryCapability['getAnalysisDepartmentSummary']>[0]),
  },
  {
    capabilityId: 'perf-analysis-department-self-check',
    sdkPath: 'perfSalary.listAnalysisDepartmentSelfCheck',
    run: (host, args) => host.perfSalary.listAnalysisDepartmentSelfCheck(args as unknown as Parameters<PerfSalaryCapability['listAnalysisDepartmentSelfCheck']>[0]),
  },
  {
    capabilityId: 'perf-analysis-person-summary',
    sdkPath: 'perfSalary.getAnalysisPersonSummary',
    run: (host, args) => host.perfSalary.getAnalysisPersonSummary(args as unknown as Parameters<PerfSalaryCapability['getAnalysisPersonSummary']>[0]),
  },
  {
    capabilityId: 'flow-task-create-definitions',
    sdkPath: 'flowTask.listDefinitions',
    run: (host, args) => host.flowTask.listDefinitions(args as unknown as Parameters<FlowTaskCapability['listDefinitions']>[0]),
  },
  {
    capabilityId: 'flow-task-todo-list',
    sdkPath: 'flowTask.listTodo',
    run: (host) => host.flowTask.listTodo(),
  },
  {
    capabilityId: 'flow-task-done-list',
    sdkPath: 'flowTask.listDone',
    run: (host) => host.flowTask.listDone(),
  },
  {
    capabilityId: 'flow-task-done-withdraw',
    sdkPath: 'flowTask.withdrawDone',
    run: (host, args) => host.flowTask.withdrawDone(args as TaskWithdrawParams),
  },
  {
    capabilityId: 'flow-task-copy-list',
    sdkPath: 'flowTask.listCopy',
    run: (host, args) => host.flowTask.listCopy(args as unknown as Parameters<FlowTaskCapability['listCopy']>[0]),
  },
  {
    capabilityId: 'flow-task-my-list',
    sdkPath: 'flowTask.listMy',
    run: (host, args) => host.flowTask.listMy(args as unknown as Parameters<FlowTaskCapability['listMy']>[0]),
  },
  {
    capabilityId: 'flow-task-my-cancel',
    sdkPath: 'flowTask.cancel',
    run: (host, args) => host.flowTask.cancel(args as unknown as Parameters<FlowTaskCapability['cancel']>[0]),
  },
  {
    capabilityId: 'flow-task-my-cancel-reservation',
    sdkPath: 'flowTask.cancelReservation',
    run: (host, args) => host.flowTask.cancelReservation(args.businessKey as string | number),
  },
  {
    capabilityId: 'flow-task-my-follow-up-capability',
    sdkPath: 'flowTask.getFollowUpCapability',
    run: (host, args) => host.flowTask.getFollowUpCapability(String(args.processInstanceId ?? '')),
  },
  {
    capabilityId: 'flow-task-my-follow-up-list',
    sdkPath: 'flowTask.listFollowUps',
    run: (host, args) => host.flowTask.listFollowUps(String(args.processInstanceId ?? '')),
  },
  {
    capabilityId: 'flow-task-my-follow-up-attachment-register',
    sdkPath: 'flowTask.registerFollowUpAttachment',
    run: (host, args) => host.flowTask.registerFollowUpAttachment(args as unknown as Parameters<FlowTaskCapability['registerFollowUpAttachment']>[0]),
  },
  {
    capabilityId: 'flow-task-my-follow-up-create',
    sdkPath: 'flowTask.createFollowUp',
    run: (host, args) => host.flowTask.createFollowUp(args as unknown as Parameters<FlowTaskCapability['createFollowUp']>[0]),
  },
  {
    capabilityId: 'flow-task-my-sms-remind-detail',
    sdkPath: 'flowTask.getSmsRemindDetail',
    run: (host, args) => host.flowTask.getSmsRemindDetail(String(args.processInstanceId ?? '')),
  },
  {
    capabilityId: 'flow-task-my-sms-remind-history',
    sdkPath: 'flowTask.listSmsRemindHistory',
    run: (host, args) => host.flowTask.listSmsRemindHistory(String(args.processInstanceId ?? '')),
  },
  {
    capabilityId: 'flow-task-my-sms-remind-send',
    sdkPath: 'flowTask.sendSmsRemind',
    run: (host, args) => host.flowTask.sendSmsRemind(args as unknown as Parameters<FlowTaskCapability['sendSmsRemind']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-list',
    sdkPath: 'flowManage.listModels',
    run: (host, args) => host.flowManage.listModels(args as unknown as Parameters<FlowManageCapability['listModels']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-get',
    sdkPath: 'flowManage.getModel',
    run: (host, args) => host.flowManage.getModel(args as unknown as Parameters<FlowManageCapability['getModel']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-prepare-create',
    sdkPath: 'flowManage.prepareModelCreate',
    run: async (host, args) => host.flowManage.prepareModelCreate(args as unknown as Parameters<FlowManageCapability['prepareModelCreate']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-create',
    sdkPath: 'flowManage.createModel',
    run: (host, args) => host.flowManage.createModel(args as unknown as Parameters<FlowManageCapability['createModel']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-cancel-create',
    sdkPath: 'flowManage.cancelModelCreate',
    run: async (host) => host.flowManage.cancelModelCreate(),
  },
  {
    capabilityId: 'flow-manage-model-prepare-update',
    sdkPath: 'flowManage.prepareModelUpdate',
    run: async (host, args) => host.flowManage.prepareModelUpdate(args as unknown as Parameters<FlowManageCapability['prepareModelUpdate']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-update',
    sdkPath: 'flowManage.updateModel',
    run: (host, args) => host.flowManage.updateModel(args as unknown as Parameters<FlowManageCapability['updateModel']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-cancel-update',
    sdkPath: 'flowManage.cancelModelUpdate',
    run: async (host) => host.flowManage.cancelModelUpdate(),
  },
  {
    capabilityId: 'flow-manage-model-deploy',
    sdkPath: 'flowManage.deployModel',
    run: (host, args) => host.flowManage.deployModel(args as unknown as Parameters<FlowManageCapability['deployModel']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-update-state',
    sdkPath: 'flowManage.updateModelState',
    run: (host, args) => host.flowManage.updateModelState(args as unknown as Parameters<FlowManageCapability['updateModelState']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-delete',
    sdkPath: 'flowManage.deleteModel',
    run: (host, args) => host.flowManage.deleteModel(args as unknown as Parameters<FlowManageCapability['deleteModel']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-list',
    sdkPath: 'flowManage.listTaskAssignRules',
    run: (host, args) => host.flowManage.listTaskAssignRules(args as unknown as Parameters<FlowManageCapability['listTaskAssignRules']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-prepare-create',
    sdkPath: 'flowManage.prepareTaskAssignRuleCreate',
    run: async (host, args) => host.flowManage.prepareTaskAssignRuleCreate(args as unknown as Parameters<FlowManageCapability['prepareTaskAssignRuleCreate']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-create',
    sdkPath: 'flowManage.createTaskAssignRule',
    run: (host, args) => host.flowManage.createTaskAssignRule(args as unknown as Parameters<FlowManageCapability['createTaskAssignRule']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-cancel-create',
    sdkPath: 'flowManage.cancelTaskAssignRuleCreate',
    run: async (host) => host.flowManage.cancelTaskAssignRuleCreate(),
  },
  {
    capabilityId: 'flow-manage-model-rule-prepare-update',
    sdkPath: 'flowManage.prepareTaskAssignRuleUpdate',
    run: async (host, args) => host.flowManage.prepareTaskAssignRuleUpdate(args as unknown as Parameters<FlowManageCapability['prepareTaskAssignRuleUpdate']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-update',
    sdkPath: 'flowManage.updateTaskAssignRule',
    run: (host, args) => host.flowManage.updateTaskAssignRule(args as unknown as Parameters<FlowManageCapability['updateTaskAssignRule']>[0]),
  },
  {
    capabilityId: 'flow-manage-model-rule-cancel-update',
    sdkPath: 'flowManage.cancelTaskAssignRule',
    run: async (host) => host.flowManage.cancelTaskAssignRule(),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-list',
    sdkPath: 'flowManage.listAiReviewConfigs',
    run: (host, args) => host.flowManage.listAiReviewConfigs(args as unknown as Parameters<FlowManageCapability['listAiReviewConfigs']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-get',
    sdkPath: 'flowManage.getAiReviewConfig',
    run: (host, args) => host.flowManage.getAiReviewConfig(args as unknown as Parameters<FlowManageCapability['getAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-prepare-create',
    sdkPath: 'flowManage.prepareCreateAiReviewConfig',
    run: async (host, args) => host.flowManage.prepareCreateAiReviewConfig(args as unknown as Parameters<FlowManageCapability['prepareCreateAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-create',
    sdkPath: 'flowManage.createAiReviewConfig',
    run: (host, args) => host.flowManage.createAiReviewConfig(args as unknown as Parameters<FlowManageCapability['createAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-prepare-update',
    sdkPath: 'flowManage.prepareUpdateAiReviewConfig',
    run: async (host, args) => host.flowManage.prepareUpdateAiReviewConfig(args as unknown as Parameters<FlowManageCapability['prepareUpdateAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-update',
    sdkPath: 'flowManage.updateAiReviewConfig',
    run: (host, args) => host.flowManage.updateAiReviewConfig(args as unknown as Parameters<FlowManageCapability['updateAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-delete',
    sdkPath: 'flowManage.deleteAiReviewConfig',
    run: (host, args) => host.flowManage.deleteAiReviewConfig(args as unknown as Parameters<FlowManageCapability['deleteAiReviewConfig']>[0]),
  },
  {
    capabilityId: 'flow-manage-ai-review-config-cancel-save',
    sdkPath: 'flowManage.cancelAiReviewConfig',
    run: async (host) => host.flowManage.cancelAiReviewConfig(),
  },
  {
    capabilityId: 'flow-manage-process-instance-list',
    sdkPath: 'flowManage.listProcessInstances',
    run: (host, args) => host.flowManage.listProcessInstances(args as unknown as Parameters<FlowManageCapability['listProcessInstances']>[0]),
  },
  {
    capabilityId: 'flow-manage-process-instance-prepare-cancel',
    sdkPath: 'flowManage.prepareAdminCancel',
    run: async (host, args) => host.flowManage.prepareAdminCancel(args as unknown as Parameters<FlowManageCapability['prepareAdminCancel']>[0]),
  },
  {
    capabilityId: 'flow-manage-process-instance-cancel-by-admin',
    sdkPath: 'flowManage.submitAdminCancel',
    run: (host, args) => host.flowManage.submitAdminCancel(args as unknown as Parameters<FlowManageCapability['submitAdminCancel']>[0]),
  },
  {
    capabilityId: 'flow-manage-process-instance-cancel-form',
    sdkPath: 'flowManage.cancelAdminCancelForm',
    run: async (host) => host.flowManage.cancelAdminCancelForm(),
  },
  {
    capabilityId: 'flow-manage-task-list',
    sdkPath: 'flowManage.listFlowTasks',
    run: (host, args) => host.flowManage.listFlowTasks(args as unknown as Parameters<FlowManageCapability['listFlowTasks']>[0]),
  },
  // ==========================================================================
  // 人工智能域（16 页 / 5 组，93 个能力）
  // ==========================================================================
  //
  // ⚠️ 这一域**没有** `xxxIdempotent` 变体：`createAi*Capability()` 返回的能力对象上只有
  //    **朴素方法**（与作业管理 / 班次 / 图库那种「门面另挂一个带防重的同名方法」不是一个形态）。
  //    所以写能力直接绑朴素方法，`requestId` 在这里**不是必填** —— 而且现在也没地方能用它：
  //    能力文件里写着"防重要走门面的 `createIdempotent`"，但那个方法**还没挂上**。
  //    哪几条该挂、挂了之后 sdkPath 要不要跟着改，见本节的注释与交付报告，**不要在这里自己造**。
  //
  // ⚠️ 这一域 16 页的 module-type 都匹配不到 ⇒ 与浏览器一致，**不发 `module-type` 头**。
  //    那件事由各页面的 `request` 上下文决定（`createAi*Capability` 的入参），不在绑定层。

  // ---- 知识管理：知识空间 / 知识审核（9）----
  {
    // 展开一层目录。`parentId` 是**这一层**的目录 id，根传 0（页面的初值就是 0）。
    // 这一页**没有分页**：接口一次给全该层，`list` 里也没有 `total`。
    capabilityId: 'ai-knowledge-workspace-list',
    sdkPath: 'aiKnowledge.listChildren',
    run: (host, args) => host.aiKnowledge.listChildren(args as unknown as { parentId: number | string }),
  },
  {
    // 只读。它同时是 `setPermission`（整单替换）的 **prepare**：
    // ⚠️ 整单替换不先读一次就写 = 把没提到的那些权限静默清掉，所以别绕过它。
    capabilityId: 'ai-knowledge-workspace-permission-get',
    sdkPath: 'aiKnowledge.getPermission',
    run: (host, args) => host.aiKnowledge.getPermission(args.id as number | string),
  },
  {
    // ⭐ **一个能力两个实现**：`createFolder` / `createFile` 打的是**同一个接口**
    // （`/manager/knowledgeFile/add`），只有 `type` 不同（1 文件夹 / 2 文档）。
    // 所以这里**按 `type` 分派**，不随便挑一个：
    //   - `type === 1` → `createFolder`（文件夹）
    //   - `type === 2` → `createFile`（文档）
    //   - 别的值 → **失败关闭**（这两个方法都不看 `type`，各写死一个值；认不出来的判别值
    //     意味着"要写哪一种"没答案，静默建出一个文件夹就是一次**写错**，不是一次失败）
    // 两个方法各自带页面自己的校验（`parentId` 必填、`name` 非空），**不在这里重做**。
    // `async` 是刻意的：参数错误走 `Promise.reject`，与其余绑定一致（这里没有同步抛的路径）。
    // `sdkPath` 只能写一个（describe 是单值）：写的是**文件夹**那一支，
    // 文档那一支的路径是 `aiKnowledge.createFile` —— 这条注释就是它的出处。
    capabilityId: 'ai-knowledge-workspace-create',
    sdkPath: 'aiKnowledge.createFolder',
    run: async (host, args) => {
      const draft = args as unknown as { type?: unknown; parentId: number | string; name: string }
      const type = Number(draft.type)
      if (type === KNOWLEDGE_FILE_TYPE_FOLDER) {
        return host.aiKnowledge.createFolder({ parentId: draft.parentId, name: draft.name })
      }
      if (type === KNOWLEDGE_FILE_TYPE_DOCUMENT) {
        return host.aiKnowledge.createFile({ parentId: draft.parentId, name: draft.name })
      }
      throw new CapabilityInvokeError(
        'ai-knowledge-workspace-create 需要 type（1 文件夹 / 2 文档），收到的是 ' +
          `${JSON.stringify(draft.type ?? null)}。` +
          '这两个值分别对应两个方法（createFolder / createFile），没有默认值可猜。',
      )
    },
  },
  {
    // ⚠️ 后端**不会立刻改名**：文件行的 `name` 要等审核通过才变（页面也一样）。
    // 撤销 = 用新名字再调一次（`cancelRename`），或者就是把旧名字再 rename 回来。
    capabilityId: 'ai-knowledge-workspace-rename',
    sdkPath: 'aiKnowledge.rename',
    run: (host, args) => host.aiKnowledge.rename(args as unknown as { id: number | string; name: string }),
  },
  {
    // 撤销 = 移回原父目录（`cancelMove`，要的 `originalParentId` 从被移动那一项自己的行上取）。
    capabilityId: 'ai-knowledge-workspace-move',
    sdkPath: 'aiKnowledge.move',
    run: (host, args) =>
      host.aiKnowledge.move(args as unknown as { id: number | string; targetParentId: number | string }),
  },
  {
    // ⚠️ 这一条**不是即时删除**：它只提一条待审记录（目录非空时后端直接拒），
    // 审核人在 `ai-knowledge-review-audit` 上通过之后才**硬删**。没有撤销。
    capabilityId: 'ai-knowledge-workspace-remove',
    sdkPath: 'aiKnowledge.remove',
    run: (host, args) => host.aiKnowledge.remove(args.id as number | string),
  },
  {
    // 整单替换，且后端会**级联到所有子目录**。撤销用 `cancelSetPermission`，
    // 输入必须是 `getPermission` 读过的那一份 —— 唯一可靠的来源就是上面那条只读能力。
    capabilityId: 'ai-knowledge-workspace-set-permission',
    sdkPath: 'aiKnowledge.setPermission',
    run: (host, args) => host.aiKnowledge.setPermission(args as unknown as KnowledgePermissionDraft),
  },
  {
    // 只读的待办箱入口靠 `auditStatus=2`（`order`/`orderField` 两个空串一定会发）。
    capabilityId: 'ai-knowledge-review-list',
    sdkPath: 'aiKnowledge.listRecords',
    run: (host, args) =>
      host.aiKnowledge.listRecords(args as unknown as Parameters<AiKnowledgeCapability['listRecords']>[0]),
  },
  {
    // ⚠️ **终态、不可撤回**，而且两个方向都有破坏性副作用（通过删除记录 = 硬删文件；
    // 拒绝新建记录 = 把文件改名成时间戳）——`id` 是**变更记录**的 id，不是 fileId。
    capabilityId: 'ai-knowledge-review-audit',
    sdkPath: 'aiKnowledge.audit',
    run: (host, args) =>
      host.aiKnowledge.audit(args as unknown as { id: number | string; auditStatus: number }),
  },

  // ---- 智能交互「问答」四页（14）----
  //
  // sdkPath 的方法名逐条照抄 `src/capabilities/ai-interaction-qa.ts:151-168` 那张表，
  // 但**门面上的字段名不是表里写的 `aiInteraction`** —— 门面暴露的是 `aiInteractionQa`
  // （`PortalHeadless.aiInteractionQa`），所以这里是 `aiInteractionQa.listHotQuestions`。
  // 表里标「⭐ 要防重」的三条（新增热门问题 / 转为热门 / 新增白名单）在这个文件里
  // **只有朴素方法**（`createHotQuestion` / `convertChatToHot` / `createWhitelistWord`），
  // 没有 `xxxIdempotent` 可绑 —— 所以防重**目前不在这里**，如实绑朴素方法、不假装它被保护了。
  {
    // 三种角色（系统/人工/预览）打**三个不同端点**，靠 `role` 分派；参数形状三者一样。
    capabilityId: 'ai-interaction-hot-topics-list',
    sdkPath: 'aiInteractionQa.listHotQuestions',
    run: (host, args) => host.aiInteractionQa.listHotQuestions(args as HotQuestionQuery),
  },
  {
    capabilityId: 'ai-interaction-hot-question-create',
    sdkPath: 'aiInteractionQa.createHotQuestion',
    run: (host, args) => host.aiInteractionQa.createHotQuestion(args as unknown as HotQuestionDraft),
  },
  {
    // 撤销 = 用**原值**再调一次（先 listHotQuestions 拿原值）。
    capabilityId: 'ai-interaction-hot-question-update',
    sdkPath: 'aiInteractionQa.updateHotQuestion',
    run: (host, args) =>
      host.aiInteractionQa.updateHotQuestion(args as unknown as HotQuestionUpdateDraft),
  },
  {
    // 收一个或一组 id。**逻辑删除**（不可复原），但它同时把对应问答行的 `is_hot` 改回 0
    // —— 所以它也是「转为热门」的撤销。
    capabilityId: 'ai-interaction-hot-question-remove',
    sdkPath: 'aiInteractionQa.removeHotQuestions',
    run: (host, args) =>
      host.aiInteractionQa.removeHotQuestions(args.ids as string | number | Array<string | number>),
  },
  {
    capabilityId: 'ai-interaction-chat-list',
    sdkPath: 'aiInteractionQa.listChats',
    run: (host, args) => host.aiInteractionQa.listChats(args as ChatQuery),
  },
  {
    // ⚠️ 页面**从不发**这一次查询（没有详情页），靠后端 mapper 的 `params.id` 分支实现。
    capabilityId: 'ai-interaction-chat-get',
    sdkPath: 'aiInteractionQa.getChatRow',
    run: (host, args) => host.aiInteractionQa.getChatRow(args.id as string | number),
  },
  {
    // `display` 是**目标值**不是 toggle（做成 toggle 就不幂等了）；撤销 = 用原值再调一次，
    // 原值从 `prepareSetChatDisplay` 拿。
    capabilityId: 'ai-interaction-chat-set-display',
    sdkPath: 'aiInteractionQa.setChatDisplay',
    run: (host, args) =>
      host.aiInteractionQa.setChatDisplay(args.id as string | number, args.display),
  },
  {
    // `id` 是**问答行**的 id（不是热门问题行 id）。不回传新 id ⇒ 撤销要按问题文本回查列表。
    capabilityId: 'ai-interaction-chat-convert-hot',
    sdkPath: 'aiInteractionQa.convertChatToHot',
    run: (host, args) =>
      host.aiInteractionQa.convertChatToHot(args as unknown as ConvertChatToHotDraft),
  },
  {
    // `word` 是**等值**匹配（后端 `z.word = #{params.word}`），不是模糊。
    capabilityId: 'ai-interaction-sensitive-word-list',
    sdkPath: 'aiInteractionQa.listWhitelist',
    run: (host, args) => host.aiInteractionQa.listWhitelist(args as WhitelistQuery),
  },
  {
    // **只读**：名字里带 check、方法也是 POST，但后端只做一次查询、不写任何东西。
    // 返回的是**这段文本里命中的敏感词**，空数组 = 一个都没命中。
    capabilityId: 'ai-interaction-sensitive-word-check',
    sdkPath: 'aiInteractionQa.checkSensitiveWords',
    run: (host, args) => host.aiInteractionQa.checkSensitiveWords(args.word as string),
  },
  {
    capabilityId: 'ai-interaction-sensitive-word-create',
    sdkPath: 'aiInteractionQa.createWhitelistWord',
    run: (host, args) =>
      host.aiInteractionQa.createWhitelistWord(args as unknown as WhitelistWordDraft),
  },
  {
    capabilityId: 'ai-interaction-sensitive-word-update',
    sdkPath: 'aiInteractionQa.updateWhitelistWord',
    run: (host, args) =>
      host.aiInteractionQa.updateWhitelistWord(args as unknown as WhitelistWordUpdateDraft),
  },
  {
    // ⚠️ **物理删除**（后端 `delete from … where id in (…)`）：删完查不回来、也没有复原接口。
    capabilityId: 'ai-interaction-sensitive-word-remove',
    sdkPath: 'aiInteractionQa.removeWhitelistWords',
    run: (host, args) =>
      host.aiInteractionQa.removeWhitelistWords(args.ids as string | number | Array<string | number>),
  },
  {
    // 这一页**只有**一个查询接口，没有任何写入口。
    capabilityId: 'ai-interaction-feedback-list',
    sdkPath: 'aiInteractionQa.listFeedback',
    run: (host, args) => host.aiInteractionQa.listFeedback(args as FeedbackQuery),
  },

  // ---- 智能交互「模型与用量」四页（28）----
  //
  // ⚠️ 这一组的写能力里**有几条会影响真人的额度与限流**（额度/流速规则、申请处理），
  //    绑的是朴素方法、没有防重 —— 调用方自己确认路径，见 docs/pages/模型列表.md 的风险等级。
  {
    capabilityId: 'ai-model-list',
    sdkPath: 'aiModel.listModels',
    run: (host, args) => host.aiModel.listModels(args as AiModelPageQuery),
  },
  {
    // `apiKey` 只回 **masked**（`apiKeyMasked`），拿不到明文。
    capabilityId: 'ai-model-detail',
    sdkPath: 'aiModel.getModel',
    run: (host, args) => host.aiModel.getModel(args.id as number | string),
  },
  {
    // ⚠️ 端点**无参数、一次全量**返回（模型选择页挂载时就这么拉）。
    // `keyword` 是**本地过滤**，只帮调用方收窄结果，**不减少请求量** ——
    // 要"按关键字向服务端收窄"请用 `ai-model-list`。
    capabilityId: 'ai-model-available-list',
    sdkPath: 'aiModel.listAvailableModels',
    run: (host, args) => host.aiModel.listAvailableModels(args as unknown as { keyword?: string }),
  },
  {
    // 新建 / 修改是**同一个方法**（有 `id` 走 update、没有走 add）。
    // ⚠️ 后端零幂等，`add` 也**不回传新 id** ⇒ 撤销只能按模型名回查（`cancelCreatedModel`）。
    capabilityId: 'ai-model-save',
    sdkPath: 'aiModel.saveModel',
    run: (host, args) => host.aiModel.saveModel(args as unknown as AiModelSaveDraft),
  },
  {
    // ⚠️ **删了就没了**（没有 cancel）；被"模型选择"引用的模型后端会拒。
    capabilityId: 'ai-model-delete',
    sdkPath: 'aiModel.deleteModel',
    run: (host, args) => host.aiModel.deleteModel(args.id as number | string),
  },
  {
    // **只读**：名字里带"测试"、用的是 POST，但后端只探一次上游、**不落库**。
    // 绑的是**列表页那一支**（body 键序 `{id, modelName, apiUrl, apiKey}`，id 在最前）；
    // 编辑页那一支是 `testModelConnectivityFromForm`（id 追加在最后），键序不同所以是两个方法。
    capabilityId: 'ai-model-test',
    sdkPath: 'aiModel.testModelConnectivity',
    run: (host, args) =>
      host.aiModel.testModelConnectivity(
        args as unknown as { id?: number | string; modelName: string; apiUrl: string; apiKey?: string },
      ),
  },
  {
    // 页面三个分区（通用/租户/个人）各查一次，所以 `ruleScope` 通常要显式给。
    capabilityId: 'ai-model-quota-rule-list',
    sdkPath: 'aiModel.listQuotaRules',
    run: (host, args) =>
      host.aiModel.listQuotaRules(
        args as unknown as { modelId: number | string; ruleScope?: number; pageNo?: number; pageSize?: number },
      ),
  },
  {
    // `create` 返回**新 id** ⇒ 撤销直接 `cancelCreatedQuotaRule(id)`；`update` 是 POST（不是 PUT）。
    capabilityId: 'ai-model-quota-rule-save',
    sdkPath: 'aiModel.saveQuotaRule',
    run: (host, args) => host.aiModel.saveQuotaRule(args as unknown as QuotaRuleSaveDraft),
  },
  {
    // ⚠️ 后端是 `DELETE` + **`?id=`**（`@RequestParam`），不是路径变量。
    capabilityId: 'ai-model-quota-rule-delete',
    sdkPath: 'aiModel.deleteQuotaRule',
    run: (host, args) => host.aiModel.deleteQuotaRule(args.id as number | string),
  },
  {
    capabilityId: 'ai-model-flow-rule-list',
    sdkPath: 'aiModel.listFlowRules',
    run: (host, args) =>
      host.aiModel.listFlowRules(
        args as unknown as {
          modelId: number | string
          ruleScope?: number
          targetTenantId?: number | string
          targetUserId?: number | string
          enabled?: boolean
          pageNo?: number
          pageSize?: number
        },
      ),
  },
  {
    capabilityId: 'ai-model-flow-rule-save',
    sdkPath: 'aiModel.saveFlowRule',
    run: (host, args) => host.aiModel.saveFlowRule(args as unknown as FlowRuleSaveDraft),
  },
  {
    capabilityId: 'ai-model-flow-rule-delete',
    sdkPath: 'aiModel.deleteFlowRule',
    run: (host, args) => host.aiModel.deleteFlowRule(args.id as number | string),
  },
  {
    // 额度与流速**共用同一个端点**，靠必填的 `configType`（1 额度 / 2 流速）区分。
    capabilityId: 'ai-model-rule-history',
    sdkPath: 'aiModel.listRuleHistory',
    run: (host, args) =>
      host.aiModel.listRuleHistory(
        args as unknown as {
          modelId: number | string
          ruleScope?: number
          targetId?: number | string
          configType: number
          pageNo?: number
          pageSize?: number
        },
      ),
  },
  {
    // `statisticsDimension` 由实现**写死平台维度（3）**，与页面上那个「查看申请」按钮一致。
    capabilityId: 'ai-model-apply-record-list',
    sdkPath: 'aiModel.listApplyRecords',
    run: (host, args) =>
      host.aiModel.listApplyRecords(
        args as unknown as {
          status?: number
          userName?: string
          modelId?: number | string
          startDate?: string
          endDate?: string
          pageNo?: number
          pageSize?: number
        },
      ),
  },
  {
    // ⚠️ **参数表与实现不一致（只报告，不代改 ai-model.ts）**：能力定义里暴露了
    // `statisticsDimension`，而 `getPendingApplyCount()` 是**零参**方法、内部写死平台维度 ——
    // 也就是说这个参数**今天传了没用**。要改口径得改 `src/capabilities/ai-model.ts`（别人的文件）。
    capabilityId: 'ai-model-apply-pending-count',
    sdkPath: 'aiModel.getPendingApplyCount',
    run: (host) => host.aiModel.getPendingApplyCount(),
  },
  {
    // ⚠️ **零幂等**：重发一次就是"又处理了一次"；而且它**不会顺手撤销**上一步"一键填写"
    //    新建出来的那条规则（那条要另外删）。撤销要用的 `previousStatus` 从**你手上那一行**取
    //    （`prepareHandleApply` 是纯函数式的预检，不额外打后端）。
    capabilityId: 'ai-model-apply-handle',
    sdkPath: 'aiModel.handleApply',
    run: (host, args) => {
      const { id, status, rejectReason } = args
      return host.aiModel.handleApply(
        { id: id as number | string },
        status as number,
        { rejectReason: rejectReason as string | undefined },
      )
    },
  },
  {
    // **必填关键字**（conventions 第 11 条）：上游是一次跨系统查询，无关键字拉全量会冲掉上下文。
    // 参数名是页面的 `userName`。
    capabilityId: 'ai-model-search-user',
    sdkPath: 'aiModel.searchUsers',
    run: (host, args) =>
      host.aiModel.searchUsers(args as unknown as { keyword: string; pageNo?: number; pageSize?: number }),
  },
  {
    capabilityId: 'ai-model-selection-list',
    sdkPath: 'aiModel.listModelSelections',
    run: (host, args) =>
      host.aiModel.listModelSelections(
        args as unknown as { callTypeList?: Array<number | string>; pageNo?: number; pageSize?: number },
      ),
  },
  {
    capabilityId: 'ai-model-selection-detail',
    sdkPath: 'aiModel.getModelSelection',
    run: (host, args) => host.aiModel.getModelSelection(args.id as number | string),
  },
  {
    // ⚠️ 新建时后端查重：**同一 `callType` 只能有一条**（重复创建 500）；修改时不做这个查重。
    capabilityId: 'ai-model-selection-save',
    sdkPath: 'aiModel.saveModelSelection',
    run: (host, args) =>
      host.aiModel.saveModelSelection(args as unknown as ModelSelectionSaveDraft),
  },
  {
    capabilityId: 'ai-model-selection-delete',
    sdkPath: 'aiModel.deleteModelSelection',
    run: (host, args) => host.aiModel.deleteModelSelection(args.id as number | string),
  },
  {
    // 平台额度 Tab。`statisticsDimension` 由实现写死平台，`quotaCycle` 默认月。
    capabilityId: 'platform-usage-quota-list',
    sdkPath: 'aiModel.listPlatformQuota',
    run: (host, args) => host.aiModel.listPlatformQuota(args as QuotaUsageQuery),
  },
  {
    // 与明细**共用同一份参数构造器**，但**不带分页**（能力定义的参数表已经把 pageNo/pageSize 摘掉）。
    capabilityId: 'platform-usage-quota-summary',
    sdkPath: 'aiModel.getPlatformQuotaSummary',
    run: (host, args) => host.aiModel.getPlatformQuotaSummary(args as QuotaUsageQuery),
  },
  {
    // ⚠️ 明细 Tab 的 `quotaCycle` 初值是**周**（与额度 Tab 的月不同），由实现兜底。
    capabilityId: 'platform-usage-usage-list',
    sdkPath: 'aiModel.listPlatformUsageRecords',
    run: (host, args) => host.aiModel.listPlatformUsageRecords(args as UsageRecordQuery),
  },
  {
    // 用量 Tab 的四张图。实现里**四条各 settle**、失败进 `errors` 而不是整体抛
    // （与学习统计 `learningSummary` 同一套约定）。
    // `includeBreakdowns` **不是能力参数**（能力定义里没有这一项），所以这里只透传查询。
    capabilityId: 'platform-usage-usage-analytics',
    sdkPath: 'aiModel.platformUsageAnalytics',
    run: (host, args) => host.aiModel.platformUsageAnalytics(args as UsageRecordQuery),
  },
  {
    capabilityId: 'platform-usage-usage-detail',
    sdkPath: 'aiModel.getPlatformUsageDetail',
    run: (host, args) => host.aiModel.getPlatformUsageDetail(args.id as number | string),
  },
  {
    // ⚠️ 同 `ai-model-available-list`：端点无参数、一次全量，`keyword` 是**本地过滤**。
    capabilityId: 'platform-usage-function-module-list',
    sdkPath: 'aiModel.listFunctionModules',
    run: (host, args) => host.aiModel.listFunctionModules(args as unknown as { keyword?: string }),
  },
  {
    // 六张图一次并发取回，实现里各自 settle、失败进 `errors`。
    capabilityId: 'data-analysis-overview',
    sdkPath: 'aiModel.dataAnalysisOverview',
    run: (host, args) => host.aiModel.dataAnalysisOverview(args as AiAnalysisQuery),
  },

  // ---- 人工智能「个人用量」一页 -----------------------------------------
  {
    capabilityId: 'personal-usage-quota-list',
    sdkPath: 'modelUsage.listQuota',
    run: (host, args) => host.modelUsage.listQuota(args as PersonalQuotaQuery),
  },
  {
    capabilityId: 'personal-usage-quota-summary',
    sdkPath: 'modelUsage.getQuotaSummary',
    run: (host, args) => host.modelUsage.getQuotaSummary(args as PersonalQuotaQuery),
  },
  {
    capabilityId: 'personal-usage-usage-list',
    sdkPath: 'modelUsage.listUsage',
    run: (host, args) => host.modelUsage.listUsage(args as PersonalUsageQuery),
  },
  {
    capabilityId: 'personal-usage-usage-analytics',
    sdkPath: 'modelUsage.usageAnalytics',
    run: (host, args) => {
      const { includeBreakdowns, ...query } = args
      return host.modelUsage.usageAnalytics(query as PersonalUsageQuery, { includeBreakdowns: includeBreakdowns as boolean | undefined })
    },
  },
  {
    capabilityId: 'personal-usage-usage-detail',
    sdkPath: 'modelUsage.getUsageDetail',
    run: (host, args) => host.modelUsage.getUsageDetail(args.id as number | string),
  },
  {
    capabilityId: 'personal-usage-usage-export',
    sdkPath: 'modelUsage.exportUsage',
    run: (host, args) => host.modelUsage.exportUsage(args as PersonalUsageQuery),
  },
  {
    capabilityId: 'personal-usage-function-module-list',
    sdkPath: 'modelUsage.listFunctionModules',
    run: (host, args) => host.modelUsage.listFunctionModules(args as { keyword?: string }),
  },
  {
    capabilityId: 'personal-usage-model-detail',
    sdkPath: 'modelUsage.getModelDetail',
    run: (host, args) => host.modelUsage.getModelDetail(args.id as number | string),
  },
  {
    capabilityId: 'personal-usage-apply-prepare',
    sdkPath: 'modelUsage.prepareApply',
    run: async (host, args) => host.modelUsage.prepareApply(args.draft as PersonalApplyDraft),
  },
  {
    capabilityId: 'personal-usage-apply-submit',
    sdkPath: 'modelUsage.submitApply',
    run: (host, args) => host.modelUsage.submitApply(args.draft as PersonalApplyDraft),
  },
  {
    capabilityId: 'personal-usage-apply-record-list',
    sdkPath: 'modelUsage.listApplyRecords',
    run: (host, args) => host.modelUsage.listApplyRecords(args as PersonalApplyQuery),
  },
  {
    capabilityId: 'personal-usage-apply-cancel',
    sdkPath: 'modelUsage.cancelApply',
    run: async (host) => host.modelUsage.cancelApply(),
  },

  // ---- 提示工程「基础」三页（21）----
  //
  // ⚠️ 这三页把写链路**按步拆成了三个能力 id**（`…-prepare` / `…-submit` / `…-remove`），
  //    所以每条绑定只落一步，没有要把 prepare 与 submit 合并的地方。
  //    只有技能那一组是例外：它的 `prepare` 就是只读审核（`ai-prompt-skill-prepare`），
  //    `submit` 才是真保存 —— 两者是**两个 id**，不是一条。
  {
    capabilityId: 'ai-prompt-tip-type-list',
    sdkPath: 'aiPrompt.listTipTypes',
    run: (host, args) => host.aiPrompt.listTipTypes(args as TipTypeQuery),
  },
  {
    capabilityId: 'ai-prompt-tip-type-get',
    sdkPath: 'aiPrompt.getTipType',
    run: (host, args) => host.aiPrompt.getTipType(args.id as number),
  },
  {
    // 页面**一个参数都不带**（只发 `_t`）⇒ 实现里空值整项不发；不给就是与页面逐字一致那一档。
    capabilityId: 'ai-prompt-tip-type-options',
    sdkPath: 'aiPrompt.listTipTypeOptions',
    run: (host, args) =>
      host.aiPrompt.listTipTypeOptions(args as unknown as { name?: string; label?: string }),
  },
  {
    capabilityId: 'ai-prompt-tip-type-create',
    sdkPath: 'aiPrompt.createTipType',
    run: (host, args) => host.aiPrompt.createTipType(args as unknown as TipTypeDraft),
  },
  {
    // 两个字段都是**整字段替换**。
    capabilityId: 'ai-prompt-tip-type-update',
    sdkPath: 'aiPrompt.updateTipType',
    run: (host, args) =>
      host.aiPrompt.updateTipType(args as unknown as TipTypeDraft & { id: number }),
  },
  {
    // ⚠️ **被提示词模板引用时删不掉**（后端抛业务错误），要先把引用它的技能改到别的类型。
    capabilityId: 'ai-prompt-tip-type-remove',
    sdkPath: 'aiPrompt.removeTipType',
    run: (host, args) => host.aiPrompt.removeTipType(args.id as number),
  },
  {
    capabilityId: 'ai-prompt-skill-list',
    sdkPath: 'aiPrompt.listSkills',
    run: (host, args) => host.aiPrompt.listSkills(args),
  },
  {
    // 走 `/ai/skill/config/get`（**不是** `/sys/tip-template/{id}`）：只有前者回 `nodes` 节点树。
    capabilityId: 'ai-prompt-skill-get',
    sdkPath: 'aiPrompt.getSkill',
    run: (host, args) => host.aiPrompt.getSkill(args.id as number),
  },
  {
    // **只读**（POST 但没有任何写）：把待保存的载荷渲染成"组装结果"给页面看。
    capabilityId: 'ai-prompt-skill-preview',
    sdkPath: 'aiPrompt.previewSkill',
    run: (host, args) => host.aiPrompt.previewSkill(args as unknown as SkillConfigInput),
  },
  {
    // **只读**：把待保存的载荷交给「技能审核」跑一次（会真的调 AI，但不写业务数据）。
    // ⚠️ 它**不替调用方做决定**（`approved=false` 也不拦保存）；
    // 判断"审核到底跑成功没有"要看返回里的 `executionFailed` / `parseFailed` 两个标志。
    capabilityId: 'ai-prompt-skill-prepare',
    sdkPath: 'aiPrompt.prepareSkillReview',
    run: (host, args) => host.aiPrompt.prepareSkillReview(args as unknown as SkillConfigInput),
  },
  {
    // **写**：`id` 为空 = 新建，有值 = **覆盖**（后端会先删掉全部节点再按 `nodes` 重插，
    // 所以 `nodes` 必须给全）。返回技能 id —— 它就是 `ai-prompt-skill-remove` 要的 id。
    capabilityId: 'ai-prompt-skill-submit',
    sdkPath: 'aiPrompt.submitSkillSave',
    run: (host, args) => host.aiPrompt.submitSkillSave(args as unknown as SkillConfigInput),
  },
  {
    // ⚠️ 实现方法名叫 `cancelSkillSave`（它是 `submit` 的撤销那一半：`DELETE /sys/tip-template/{id}`），
    //    能力 id 叫 `…-remove` —— 同一个动作的两个名字，**不是**两条不同的路径。
    capabilityId: 'ai-prompt-skill-remove',
    sdkPath: 'aiPrompt.cancelSkillSave',
    run: (host, args) => host.aiPrompt.cancelSkillSave(args.id as number),
  },
  {
    // 零参数，与页面一致。
    capabilityId: 'ai-prompt-skill-card-list',
    sdkPath: 'aiPrompt.listSkillCards',
    run: (host) => host.aiPrompt.listSkillCards(),
  },
  {
    // 零参数。`availableStatus !== 1` 的项在页面上是**置灰不可选**的。
    capabilityId: 'ai-prompt-skill-model-options',
    sdkPath: 'aiPrompt.listAvailableModels',
    run: (host) => host.aiPrompt.listAvailableModels(),
  },
  {
    // **必填关键字**（conventions 第 11 条：页面这里是 loopFetch 全量循环拉，无头不照抄）。
    capabilityId: 'ai-prompt-skill-interface-search',
    sdkPath: 'aiPrompt.searchSkillInterfaces',
    run: (host, args) =>
      host.aiPrompt.searchSkillInterfaces(
        args as unknown as {
          name: string
          apiPath?: string
          groupName?: string
          pageNo?: number
          pageSize?: number
        },
      ),
  },
  {
    capabilityId: 'ai-prompt-intent-list',
    sdkPath: 'aiPrompt.listIntents',
    run: (host, args) => host.aiPrompt.listIntents(args as IntentQuery),
  },
  {
    // ⚠️ 绑定为空时返回里**没有** `templateIdList` 这个键（不是空数组）。
    capabilityId: 'ai-prompt-intent-get',
    sdkPath: 'aiPrompt.getIntent',
    run: (host, args) => host.aiPrompt.getIntent(args.id as number),
  },
  {
    // **必填关键字**（同 `ai-prompt-skill-interface-search`）。
    capabilityId: 'ai-prompt-intent-template-search',
    sdkPath: 'aiPrompt.searchIntentTemplates',
    run: (host, args) =>
      host.aiPrompt.searchIntentTemplates(
        args as unknown as {
          name: string
          isIntentRecognition?: number
          pageNo?: number
          pageSize?: number
        },
      ),
  },
  {
    capabilityId: 'ai-prompt-intent-create',
    sdkPath: 'aiPrompt.createIntent',
    run: (host, args) => host.aiPrompt.createIntent(args as unknown as IntentDraft),
  },
  {
    // `templateIdList` 必填（可以是空数组）：整组替换，不传会把已有的绑定全部清掉。
    capabilityId: 'ai-prompt-intent-update',
    sdkPath: 'aiPrompt.updateIntent',
    run: (host, args) =>
      host.aiPrompt.updateIntent(args as unknown as IntentDraft & { id: number }),
  },
  {
    // 逻辑删除；绑定关系不跟着删，但查询都按 `deleted=0` 过滤。
    capabilityId: 'ai-prompt-intent-remove',
    sdkPath: 'aiPrompt.removeIntent',
    run: (host, args) => host.aiPrompt.removeIntent(args.id as number),
  },

  // ---- 提示工程「工具绑定」三页（21）----
  //
  // ⚠️⚠️ **这一组是 `prepare → submit → cancel` 三步式，而一个写动作只有一条能力 id**
  //    （不像 `ai-prompt.ts` 那样拆成 `…-prepare` / `…-submit` 两个 id）。
  //    所以这里的写能力绑的是**各自的 `prepareXxx`** —— 理由：
  //      - 能力定义的参数表就是那个 **draft**（`prepareXxx` 的入参形状），
  //        `submit(plan)` 要的是 `prepareXxx()` 的**返回值**，拿 draft 去调它必然被 `assertPlan` 拒；
  //      - 文件头第 3 条：**不许**把 prepare 与 submit 合并进同一条 binding。
  //    ⇒ `invoke('ai-business-event-create', {...})` 的结果是一个 `WritePlan`
  //    （`{request, undo, note}`），**这一步不发写请求**；真写要再调 `…submit(plan)`。
  //    逐条撤销办法写在能力文件与 `docs/pages/业务事件绑定技能.md` 里。
  //
  //    ⚠️ `create` / `record-retry` 按文件头是"要防重"的两条，而防重**还没挂**
  //    （文件头写的是"门面的 `createIdempotent`，由接线方挂"）。挂上之后这两条
  //    （以及另外两个 create）的 sdkPath 要不要改到那一侧，由接线方定 —— 我不在这里替它决定。
  {
    capabilityId: 'ai-business-event-list',
    sdkPath: 'aiPromptTool.businessEvent.list',
    run: (host, args) => host.aiPromptTool.businessEvent.list(args as BusinessEventQuery),
  },
  {
    capabilityId: 'ai-business-event-get',
    sdkPath: 'aiPromptTool.businessEvent.get',
    run: (host, args) => host.aiPromptTool.businessEvent.get(args.id as number | string),
  },
  {
    // ⚠️ `useSystem` **必填**（页面在它为空时根本不发这个请求）。
    // 但后端当前把它置空（"UseSystem不作为条件"）⇒ 这个条件**今天筛不动**，传了只是与浏览器一致。
    capabilityId: 'ai-business-event-available-skill-list',
    sdkPath: 'aiPromptTool.businessEvent.listAvailableSkills',
    run: (host, args) =>
      host.aiPromptTool.businessEvent.listAvailableSkills(
        args as unknown as BusinessEventAvailableSkillQuery,
      ),
  },
  {
    // ⚠️ `eventCode` **必填**（页面拿不到它时不发请求）—— 它来自事件行上的 `eventCode`。
    capabilityId: 'ai-business-event-record-list',
    sdkPath: 'aiPromptTool.businessEvent.listRecords',
    run: (host, args) =>
      host.aiPromptTool.businessEvent.listRecords(args as unknown as BusinessEventRecordQuery),
  },
  {
    capabilityId: 'ai-business-event-record-get',
    sdkPath: 'aiPromptTool.businessEvent.getRecord',
    run: (host, args) => host.aiPromptTool.businessEvent.getRecord(args.id as number | string),
  },
  {
    // 只读的 prepare（本地校验 + 拼载荷，**一次请求都不发**）；`undo` 恒为 `null`
    // （create 不回传新 id，撤销要先按名字回查）。
    // `async` 是**刻意**的：那三个 `prepareXxx` 里只有它是同步的，包一层让参数错误
    // 与其他能力一样走 `Promise.reject`（否则 `invoke` 会同步抛出去）。
    capabilityId: 'ai-business-event-create',
    sdkPath: 'aiPromptTool.businessEvent.prepareCreate',
    run: async (host, args) =>
      host.aiPromptTool.businessEvent.prepareCreate(args as unknown as BusinessEventDraft),
  },
  {
    // 只读的 prepare：**会 GET 一次当前值**，没给的字段沿用回来再重算（整单替换的底稿+撤销快照）。
    capabilityId: 'ai-business-event-update',
    sdkPath: 'aiPromptTool.businessEvent.prepareUpdate',
    run: (host, args) =>
      host.aiPromptTool.businessEvent.prepareUpdate(args as unknown as BusinessEventDraft),
  },
  {
    // 只读的 prepare：`enabled` 收的是**目标状态**（页面按钮传的是相反值，SDK 不做那一次取反）。
    capabilityId: 'ai-business-event-set-enabled',
    sdkPath: 'aiPromptTool.businessEvent.prepareSetEnabled',
    run: (host, args) =>
      host.aiPromptTool.businessEvent.prepareSetEnabled(
        args.id as number | string,
        args.enabled as boolean,
      ),
  },
  {
    // 只读的 prepare：GET 确认它存在。`undo` 为 `null`（逻辑删除、无恢复接口，`cancel` 会抛）。
    capabilityId: 'ai-business-event-remove',
    sdkPath: 'aiPromptTool.businessEvent.prepareRemove',
    run: (host, args) => host.aiPromptTool.businessEvent.prepareRemove(args.id as number | string),
  },
  {
    // 只读的 prepare：GET 记录并检查状态是否可重试（只有失败/跳过/超时可重试）。
    // ⚠️ `undo` 为 `null`：真跑起来会**把技能再执行一遍**，副作用在技能里，撤不回来。
    capabilityId: 'ai-business-event-record-retry',
    sdkPath: 'aiPromptTool.businessEvent.prepareRecordRetry',
    run: (host, args) =>
      host.aiPromptTool.businessEvent.prepareRecordRetry(args.id as number | string),
  },
  {
    capabilityId: 'ai-open-api-registry-list',
    sdkPath: 'aiPromptTool.openApiRegistry.list',
    run: (host, args) => host.aiPromptTool.openApiRegistry.list(args as OpenApiRegistryQuery),
  },
  {
    capabilityId: 'ai-open-api-registry-get',
    sdkPath: 'aiPromptTool.openApiRegistry.get',
    run: (host, args) => host.aiPromptTool.openApiRegistry.get(args.id as number | string),
  },
  {
    // 按 URL 关键词扫后端已注册的接口。⚠️ `url` 必填（后端 `@RequestParam`），
    // `baseUrl` 顺序在它**之前**（页面就是这么写的）。
    capabilityId: 'ai-open-api-registry-scan',
    sdkPath: 'aiPromptTool.openApiRegistry.scan',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.scan(args as unknown as { baseUrl?: string; url: string }),
  },
  {
    // 只读的 prepare（本地校验 + 拼 body，**不发请求**）。`undo` 为 `null`（create 不回传新 id）。
    capabilityId: 'ai-open-api-registry-create',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareCreate',
    run: async (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareCreate(args as unknown as OpenApiRegistryDraft),
  },
  {
    // 只读的 prepare：**会 GET 当前详情**，没给的字段沿用回来（整单替换的底稿+撤销快照）。
    capabilityId: 'ai-open-api-registry-update',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareUpdate',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareUpdate(args as unknown as OpenApiRegistryDraft),
  },
  {
    // 只读的 prepare。⚠️ 删不动的情况是**前端拦的**（已绑定的接口），后端没有这条校验。
    capabilityId: 'ai-open-api-registry-remove',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareRemove',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareRemove(args.id as number | string),
  },
  {
    // 平台设置 → 开放平台与人工智能 → 开放接口共用 Portal 实现和请求形状。
    capabilityId: 'platform-open-interface-list',
    sdkPath: 'aiPromptTool.openApiRegistry.list',
    run: (host, args) => host.aiPromptTool.openApiRegistry.list(args as OpenApiRegistryQuery),
  },
  {
    capabilityId: 'platform-open-interface-get',
    sdkPath: 'aiPromptTool.openApiRegistry.get',
    run: (host, args) => host.aiPromptTool.openApiRegistry.get(args.id as number | string),
  },
  {
    capabilityId: 'platform-open-interface-scan',
    sdkPath: 'aiPromptTool.openApiRegistry.scan',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.scan(args as unknown as { baseUrl?: string; url: string }),
  },
  {
    capabilityId: 'platform-open-interface-create',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareCreate',
    run: async (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareCreate(args as unknown as OpenApiRegistryDraft),
  },
  {
    capabilityId: 'platform-open-interface-update',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareUpdate',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareUpdate(args as unknown as OpenApiRegistryDraft),
  },
  {
    capabilityId: 'platform-open-interface-remove',
    sdkPath: 'aiPromptTool.openApiRegistry.prepareRemove',
    run: (host, args) =>
      host.aiPromptTool.openApiRegistry.prepareRemove(args.id as number | string),
  },
  {
    capabilityId: 'ai-prompt-template-binding-list',
    sdkPath: 'aiPromptTool.templateBinding.list',
    run: (host, args) =>
      host.aiPromptTool.templateBinding.list(
        args as unknown as { func?: string; pageNo?: number; pageSize?: number },
      ),
  },
  {
    capabilityId: 'ai-prompt-template-binding-get',
    sdkPath: 'aiPromptTool.templateBinding.get',
    run: (host, args) => host.aiPromptTool.templateBinding.get(args.id as number | string),
  },
  {
    // 只读的 prepare（本地校验 + 拼 body）。`templateContent` 在页面上是"所选项的名字"，
    // SDK 侧只能由调用方给。
    capabilityId: 'ai-prompt-template-binding-create',
    sdkPath: 'aiPromptTool.templateBinding.prepareCreate',
    run: async (host, args) =>
      host.aiPromptTool.templateBinding.prepareCreate(
        args as unknown as {
          funcId: string
          templateId: number | string
          useType?: string | null
          templateContent: string
        },
      ),
  },
  {
    // 只读的 prepare：`id` 与草案**是两个位置参数**，所以这里要摊开传。
    // 没给的字段沿用 GET 到的那份（不会被清空）。
    capabilityId: 'ai-prompt-template-binding-update',
    sdkPath: 'aiPromptTool.templateBinding.prepareUpdate',
    run: (host, args) => {
      const { id, ...draft } = args
      return host.aiPromptTool.templateBinding.prepareUpdate(
        id as number | string,
        draft as unknown as {
          funcId?: string
          templateId?: number | string
          useType?: string | null
          templateContent: string
        },
      )
    },
  },
  {
    // 只读的 prepare。⚠️ 删除是 `DELETE …/delete?id=`（**query 传参**，与另两页写法都不同）。
    capabilityId: 'ai-prompt-template-binding-remove',
    sdkPath: 'aiPromptTool.templateBinding.prepareRemove',
    run: (host, args) =>
      host.aiPromptTool.templateBinding.prepareRemove(args.id as number | string),
  },
  ...batchCapabilityBindings(),
]

/** 能力没有 SDK 绑定、参数不对、或缺了写操作必填的 requestId 时抛它 */
export class CapabilityInvokeError extends Error {
  override readonly name = 'CapabilityInvokeError'
  /** 出问题的能力 ID（能确定时） */
  readonly capabilityId: string | null

  constructor (message: string, capabilityId: string | null = null) {
    super(message)
    this.capabilityId = capabilityId
  }
}

/** 去掉 A6 的 `-llm` 后缀：`describe()` 宽容，`invoke()` 一样宽容 */
function normalizeCapabilityId (capabilityId: string): string {
  const raw = capabilityId.trim()
  return raw.endsWith('-llm') ? raw.slice(0, -'-llm'.length) : raw
}

/**
 * 能力 ID → 手写路径（`meetingRoom.list` 这种）。没有登记绑定时返回 null。
 *
 * `describe()` 用它填 `invoke.sdkPath`；`invoke()` 也用它——两者因此不可能分叉。
 */
export function sdkPathOf (capabilityId: string): string | null {
  const id = normalizeCapabilityId(capabilityId)
  const binding = CAPABILITY_BINDINGS.find((candidate) => candidate.capabilityId === id)
  return binding === undefined ? null : binding.sdkPath
}

export type CapabilityInvoker = {
  /** 已登记执行绑定的能力 ID（不是"目录里有哪些能力"，那个问 describe 的失败回执） */
  ids: () => string[]
  /** 等价于 `sdkPathOf`，挂在实例上便于调用方自查 */
  sdkPathOf: (capabilityId: string) => string | null
  /**
   * 按能力 ID 调用。返回类型只有调用方知道（各能力的返回结构不同），
   * 所以默认是 `unknown`，需要时自己给泛型。
   */
  invoke: <T = unknown>(capabilityId: string, args?: CapabilityInvokeArgs) => Promise<T>
}

/** 按 `host`（门面上的能力方法组）建出通用调用入口 */
export function createCapabilityInvoker (host: CapabilityHost): CapabilityInvoker {
  installAiModelCompatibility(host)
  installPortalPageCompatibility(host)
  const invoke = async <T = unknown> (
    capabilityId: string,
    args: CapabilityInvokeArgs = {},
  ): Promise<T> => {
    const id = normalizeCapabilityId(capabilityId)
    if (id.length === 0) {
      throw new CapabilityInvokeError('invoke 需要 capabilityId（能力 ID，来自 describe / recommend）')
    }

    const binding = CAPABILITY_BINDINGS.find((candidate) => candidate.capabilityId === id)
    if (binding === undefined) {
      const known = CAPABILITY_BINDINGS.map((candidate) => candidate.capabilityId)
      throw new CapabilityInvokeError(
        `能力「${capabilityId}」没有接进 SDK 的执行层，调不到。` +
          `已接线的是：${known.length > 0 ? known.join('、') : '（无）'}。` +
          '目录里可能有它（能力定义了但还没接线），那就只能自己拼请求：sdk.call(页面路径, {...})。',
        id,
      )
    }

    return binding.run(host, args) as Promise<T>
  }

  return {
    ids: () => CAPABILITY_BINDINGS.map((binding) => binding.capabilityId),
    sdkPathOf,
    invoke,
  }
}

/**
 * 能力定义数组 + 通用调用入口 = 门面上的 `capabilities`。
 *
 * 为什么是"数组上挂一个方法"而不是另起一个对象：`portal.capabilities` 已经是公开面
 * （`createCatalog({ capabilities: portal.capabilities })`、`tools/generate/next.mjs`
 * 都在当数组用），改成对象会让它们全部失效。挂成**不可枚举**属性，
 * 这样 `Object.keys` / 展开 / `JSON.stringify` 看到的仍然只是能力定义本身。
 */
export type CapabilityRegistry = CapabilityDefinition[] & { invoke: CapabilityInvoker['invoke'] }

export function attachCapabilityInvoker (
  definitions: CapabilityDefinition[],
  invoker: CapabilityInvoker,
): CapabilityRegistry {
  const registry = [...definitions] as CapabilityRegistry
  Object.defineProperty(registry, 'invoke', {
    value: invoker.invoke,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return registry
}
