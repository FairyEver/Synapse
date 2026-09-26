import { createPortalDeviceCapability, PORTAL_DEVICE_PAGE_PATH, type PortalDeviceCapability } from './capabilities/portal-device.js'
import { createHrPostTypeCapability, HR_POST_TYPE_PAGE_PATH, type HrPostTypeCapability } from './capabilities/hr-post-type.js'
import { createAttendanceSheetCapability, buildSheetPayload, ATTENDANCE_SHEET_PAGE, ATTENDANCE_SHEET_ARCHIVE_PAGE, type AttendanceSheetCapability, type SheetDraft } from './capabilities/attendance-sheet.js'
import { createHrOrganizationTypeCapability, HR_ORGANIZATION_TYPE_PAGE_PATH, type HrOrganizationTypeCapability } from './capabilities/hr-organization-type.js'
import { createHrOrganizationPropertyCapability, HR_ORGANIZATION_PROPERTY_PAGE_PATH, type HrOrganizationPropertyCapability } from './capabilities/hr-organization-property.js'
import { createTechnologyProjectTypeCapability, TECHNOLOGY_PROJECT_TYPE_PAGE_PATH, type TechnologyProjectTypeCapability } from './capabilities/technology-project-type.js'
import { createTechnologyTypeTemplateMappingCapability, TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PAGE_PATH, type TechnologyTypeTemplateMappingCapability } from './capabilities/technology-type-template-mapping.js'
import { createSettingEnterpriseUsageCapability, SETTING_ENTERPRISE_USAGE_PAGE_PATH, type SettingEnterpriseUsageCapability } from './capabilities/setting-enterprise-usage.js'
import { createSettingSensitiveActionCapability, SETTING_SENSITIVE_ACTION_PAGE_PATH, type SettingSensitiveActionCapability } from './capabilities/setting-sensitive-action.js'
import { createSettingTokenAllocationCapability, SETTING_TOKEN_ALLOCATION_PAGE_PATH, type SettingTokenAllocationCapability } from './capabilities/setting-token-allocation.js'
import { createTechnologySettingTemplateBaseCapability, TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH, type TechnologySettingTemplateBaseCapability } from './capabilities/technology-setting-template-base.js'
import { createTechnologySettingTemplateCapability, TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH, type TechnologySettingTemplateCapability } from './capabilities/technology-setting-template.js'
import { createFinanceAccountingPeriodCapability, FINANCE_ACCOUNTING_PERIOD_PAGE_PATH, type FinanceAccountingPeriodCapabilityWithIdempotency } from './capabilities/finance-accounting-period.js'
import { createFinanceAccountingManageCapability, FINANCE_ACCOUNTING_MANAGE_PAGE_PATH, type FinanceAccountingManageCapabilityWithIdempotency, type FinanceAccountingManageDraft } from './capabilities/finance-accounting-manage.js'
import { createFinanceLedgerAccountsCapability, FINANCE_LEDGER_ACCOUNTS_PAGE_PATH, type FinanceLedgerAccountsCapabilityWithIdempotency, type FinanceLedgerAccountDraft, type FinanceLedgerAccountFileInput } from './capabilities/finance-ledger-accounts.js'
import { createFinanceSettingAccuracyCapability, FINANCE_SETTING_ACCURACY_PAGE_PATH, type FinanceSettingAccuracyCapabilityWithIdempotency, type FinanceSettingAccuracyCreateDraft } from './capabilities/finance-setting-accuracy.js'
import { createFinanceAllocationIndicatorCapability, FINANCE_ALLOCATION_INDICATOR_PAGE_PATH, type FinanceAllocationIndicatorCapability } from './capabilities/finance-setting-allocation-indicator.js'
import { createFinanceSettingAnnualCarryforwardCapability, FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH, type FinanceSettingAnnualCarryforwardCapability } from './capabilities/finance-setting-annual-carryforward.js'
import { createFinanceSettingCatConfigCapability, FINANCE_SETTING_CAT_CONFIG_PAGE_PATH, type FinanceSettingCatConfigCapability } from './capabilities/finance-setting-cat-config.js'
import { createFinanceSettingCatMapCapability, FINANCE_SETTING_CAT_MAP_PAGE_PATH, type FinanceSettingCatMapCapability } from './capabilities/finance-setting-cat-map.js'
import { createFinanceSettingDateConfigCapability, FINANCE_SETTING_DATE_CONFIG_PAGE_PATH, type FinanceSettingDateConfigCapability } from './capabilities/finance-setting-date-config.js'
import { createFinanceSettingMonthlyIncomeTimeConfigCapability, FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH, type FinanceSettingMonthlyIncomeTimeConfigCapability } from './capabilities/finance-setting-monthly-income-time-config.js'
import { createFinanceSettingProjectCapability, FINANCE_SETTING_PROJECT_PAGE_PATH, type FinanceSettingProjectCapability } from './capabilities/finance-setting-project.js'
import { createFinanceSettingReceivingAccountCapability, FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH, type FinanceSettingReceivingAccountCapability } from './capabilities/finance-setting-receiving-account.js'
import { createFinanceSettingRelatedPartySettlementAccountCapability, FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH, type FinanceSettingRelatedPartySettlementAccountCapability } from './capabilities/finance-setting-related-party-settlement-account.js'
import { createFinanceSettingSaleAllocationCoefficientCapability, FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH, type FinanceSettingSaleAllocationCoefficientCapability } from './capabilities/finance-setting-sale-allocation-coefficient.js'
import { createFinanceSettingAllocationRulesCapability, FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH, type FinanceSettingAllocationRulesCapability } from './capabilities/finance-setting-allocation-rules.js'
import { createFinanceSettingCostCenterCapability, FINANCE_SETTING_COST_CENTER_PAGE_PATH, type FinanceSettingCostCenterCapability } from './capabilities/finance-setting-cost-center.js'
import { createFinanceSettingEmployeeLoanAmountCapability, FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH, type FinanceSettingEmployeeLoanAmountCapability } from './capabilities/finance-setting-employee-loan-amount.js'
import { createFinanceSettingInitialManageCapability, FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH, type FinanceSettingInitialManageCapability } from './capabilities/finance-setting-initial-manage.js'
import { createFinanceSettingOpeningSupplierCapability, FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH, type FinanceSettingOpeningSupplierCapabilityWithIdempotency, type FinanceSettingOpeningSupplierSaveDraft } from './capabilities/finance-setting-opening-supplier.js'
import { createFinanceSettingFeePurposeCapability, FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH, type FinanceSettingFeePurposeCapability } from './capabilities/finance-setting-fee-purpose.js'
import { createFinanceSettingInventoryAccountCapability, FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH, type FinanceSettingInventoryAccountCapability } from './capabilities/finance-setting-inventory-account.js'
import { createFinanceSettingLivestockAmortizationCapability, FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH, type FinanceSettingLivestockAmortizationCapability } from './capabilities/finance-setting-livestock-amortization.js'
import { createFinanceSettingSettlementSettingCapability, FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH, type FinanceSettingSettlementSettingCapability } from './capabilities/finance-setting-settlement-setting.js'
import { createFinanceSettingVoucherTemplatesCapability, FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH, type FinanceSettingVoucherTemplatesCapability } from './capabilities/finance-setting-voucher-templates.js'
import { createFundSalaryFundCostsCapability, FUND_COST_PAGE_PATH, type FundSalaryFundCostsCapability } from './capabilities/fund-salary-fund-costs.js'
import { createFundSalaryFundProcessCapability, FUND_SALARY_FUND_PROCESS_PAGE_PATH, type FundSalaryFundProcessCapability } from './capabilities/fund-salary-fund-process.js'
import { createInsuranceSalaryInsuranceCostsCapability, INSURANCE_COST_PAGE_PATH, type InsuranceSalaryInsuranceCostsCapability } from './capabilities/insurance-salary-insurance-costs.js'
import { createInsuranceSalaryInsuranceProcessCapability, INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH, type InsuranceSalaryInsuranceProcessCapability } from './capabilities/insurance-salary-insurance-process.js'
import { createManageCostCenterCapability, MANAGE_COST_CENTER_PAGE_PATH, type ManageCostCenterCapability } from './capabilities/manage-cost-center.js'
import { createSalaryItemCapability, SALARY_ITEM_PAGE_PATH, type SalaryItemCapability } from './capabilities/salary-item.js'
import { createMePayRollCapability, ME_PAY_ROLL_PAGE_PATH, type MePayRollCapability } from './capabilities/me-pay-roll.js'
import { createPlatformCategoryDictCapability, PLATFORM_CATEGORY_DICT_PAGE_PATH, type PlatformCategoryDictCapability } from './capabilities/platform-category-dict.js'
import { createSettingCategoryDictCapability, SETTING_CATEGORY_DICT_PAGE_PATH, type SettingCategoryDictCapability } from './capabilities/setting-category-dict.js'
import { createOrgCorporationCapability, ORG_CORPORATION_PAGE_PATH, type OrgCorporationCapability } from './capabilities/org-corporation.js'
import { createHrOrganizationSettingCapability, HR_ORGANIZATION_SETTING_PAGE_PATH, type HrOrganizationSettingCapability } from './capabilities/org-setting.js'
import { createHrOrganizationChartCapability, HR_ORGANIZATION_CHART_PAGE_PATH, type HrOrganizationChartCapability } from './capabilities/org-chart.js'
import { createHrTransferInPlanCapability, HR_TRANSFER_IN_PLAN_PAGE_PATH, type HrTransferInPlanCapability } from './capabilities/hr-transfer-in-plan.js'
import { createPlatformSystemCustomCapability, PLATFORM_SYSTEM_CUSTOM_PAGE_PATH, type PlatformSystemCustomCapability } from './capabilities/platform-system-custom.js'
import { createPlatformSystemSecurityConfigCapability, PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH, type PlatformSystemSecurityConfigCapability } from './capabilities/platform-system-security-config.js'
import { createPlatformSystemQueueStorageCapability, PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH, type PlatformSystemQueueStorageCapability } from './capabilities/platform-system-queue-storage.js'
import { createPlatformSystemEmailCapability, PLATFORM_SYSTEM_EMAIL_PAGE_PATH, type PlatformSystemEmailCapability } from './capabilities/platform-system-email.js'
import { createPlatformSystemQueueExportCapability, PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH, type PlatformSystemQueueExportCapability } from './capabilities/platform-system-queue-export.js'
import { createPlatformSystemQueueFailedCapability, PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH, type PlatformSystemQueueFailedCapability } from './capabilities/platform-system-queue-failed.js'
import { createPlatformSystemQueueMysqlCapability, PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH, type PlatformSystemQueueMysqlCapability } from './capabilities/platform-system-queue-mysql.js'
import { createPlatformSystemScheduleCapability, PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH, type PlatformSystemScheduleCapability } from './capabilities/platform-system-schedule.js'
import { createReportBankPayCapability, REPORT_BANK_PAY_PAGE_PATH, type ReportBankPayCapability } from './capabilities/report-bank-pay.js'
import { createReportBankSummaryCapability, REPORT_BANK_SUMMARY_PAGE_PATH, type ReportBankSummaryCapability } from './capabilities/report-bank-summary.js'
import { createReportCenterInsuranceCapability, REPORT_CENTER_INSURANCE_PAGE_PATH, type ReportCenterInsuranceCapability } from './capabilities/report-center-insurance.js'
import { createReportCostCenterSalaryCapability, REPORT_COST_CENTER_SALARY_PAGE_PATH, type ReportCostCenterSalaryCapability } from './capabilities/report-cost-center-salary.js'
import { createReportDepartmentSalaryDetailCapability, REPORT_DEPARTMENT_SALARY_DETAIL_PAGE_PATH, type ReportDepartmentSalaryDetailCapability } from './capabilities/report-department-salary-detail.js'
import { createReportDepartmentSalaryCapability, REPORT_DEPARTMENT_SALARY_PAGE_PATH, type ReportDepartmentSalaryCapability } from './capabilities/report-department-salary.js'
import { createReportFundPaymentSummaryCapability, REPORT_FUND_PAYMENT_SUMMARY_PAGE_PATH, type ReportFundPaymentSummaryCapability } from './capabilities/report-fund-payment-summary.js'
import { createReportInsurancePaymentSummaryCapability, REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH, type ReportInsurancePaymentSummaryCapability } from './capabilities/report-insurance-payment-summary.js'
import { createReportPersonTaxCapability, REPORT_PERSON_TAX_PAGE_PATH, type ReportPersonTaxCapability } from './capabilities/report-person-tax.js'
import { createReportPostSalaryCapability, REPORT_POST_SALARY_PAGE_PATH, type ReportPostSalaryCapability } from './capabilities/report-post-salary.js'
import { createReportConfigurationCapability, REPORT_CONFIGURATION_PAGE_PATH, type ReportConfigurationCapability } from './capabilities/report-configuration.js'
import { createReportStandardUnitInsuranceCapability, REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH, type ReportStandardUnitInsuranceCapability } from './capabilities/report-standard-unit-insurance.js'
import { createReportRetirementSalarySummaryCapability, REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH, type ReportRetirementSalarySummaryCapability } from './capabilities/report-retirement-salary-summary.js'
import { createReportTemporarySalarySummaryCapability, REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH, type ReportTemporarySalarySummaryCapability } from './capabilities/report-temporary-salary-summary.js'
import { createReportTemporarySalaryCapability, REPORT_TEMPORARY_SALARY_PAGE_PATH, type ReportTemporarySalaryCapability } from './capabilities/report-temporary-salary.js'
import { createReportRetirementSalaryCapability, REPORT_RETIREMENT_SALARY_PAGE_PATH, type ReportRetirementSalaryCapability } from './capabilities/report-retirement-salary.js'
import { createReportSalaryBillCapability, REPORT_SALARY_BILL_PAGE_PATH, type ReportSalaryBillCapability } from './capabilities/report-salary-bill.js'
import { createReportSalaryCostCapability, REPORT_SALARY_COST_PAGE_PATH, type ReportSalaryCostCapability } from './capabilities/report-salary-cost.js'
import { createReportLaborCostAllocationCapability, REPORT_LABOR_COST_ALLOCATION_PAGE_PATH, type ReportLaborCostAllocationCapability } from './capabilities/report-labor-cost-allocation.js'
import { createReportLeadershipProfitSalaryCapability, REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH, type ReportLeadershipProfitSalaryCapability } from './capabilities/report-leadership-profit-salary.js'
import { createReportUnitInterferenceCostAllocationCapability, REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH, type ReportUnitInterferenceCostAllocationCapability } from './capabilities/report-unit-interference-cost-allocation.js'
import { createReportSalaryItemCapability, REPORT_SALARY_ITEM_PAGE_PATH, type ReportSalaryItemCapability } from './capabilities/report-salary-item.js'
import { createSalaryProcessCapability, SALARY_PROCESS_PAGE_PATH, type SalaryProcessCapability } from './capabilities/salary-process.js'
import { createSalaryAccountingCapability, SALARY_ACCOUNTING_PAGE_PATH, type SalaryAccountingCapability } from './capabilities/salary-accounting.js'
import { createSalaryPackageCapability, SALARY_PACKAGE_PAGE_PATH, type SalaryPackageCapability } from './capabilities/salary-package.js'
import { createSalaryAdjustImportCapability, SALARY_ADJUST_IMPORT_PAGE_PATH, type SalaryAdjustImportCapability } from './capabilities/salary-adjust-import.js'
import { createSalaryPersonTaxFileCapability, SALARY_PERSON_TAX_FILE_PAGE_PATH, type SalaryPersonTaxFileCapability } from './capabilities/salary-person-tax-file.js'
import { createSalaryPersonTaxHandleCapability, SALARY_PERSON_TAX_HANDLE_PAGE_PATH, type SalaryPersonTaxHandleCapability } from './capabilities/salary-person-tax-handle.js'
import { createSalaryPersonTaxCapability, SALARY_PERSON_TAX_PAGE_PATH, type SalaryPersonTaxCapability } from './capabilities/salary-person-tax.js'
import { createSalaryLevelCapability, SALARY_LEVEL_PAGE_PATH, type SalaryLevelCapability } from './capabilities/salary-level.js'
import { createSaleCcbAccountCapability, SALE_CCB_ACCOUNT_PAGE_PATH, type SaleCcbAccountCapability } from './capabilities/sale-ccb-account.js'
import { createSalePaymentAccountCapability, SALE_PAYMENT_ACCOUNT_PAGE_PATH, type SalePaymentAccountCapability } from './capabilities/sale-payment-account.js'
import { createSaleSysOfficeCapability, SALE_SYS_OFFICE_PAGE_PATH, type SaleSysOfficeCapability } from './capabilities/sale-sys-office.js'
import { createSaleSysUserCapability, SALE_SYS_USER_PAGE_PATH, type SaleSysUserCapability } from './capabilities/sale-sys-user.js'
import { createSaleClaimSettingCapability, SALE_CLAIM_SETTING_PAGE_PATH, type SaleClaimSettingCapability } from './capabilities/sale-claim-setting.js'
import { createSaleOldChickenSaleCapability, SALE_OLD_CHICKEN_SALE_PAGE_PATH, type SaleOldChickenSaleCapability } from './capabilities/sale-old-chicken-sale.js'
import { createSalePriceControlCapability, SALE_PRICE_CONTROL_PAGE_PATH, type SalePriceControlCapability } from './capabilities/sale-price-control.js'
import { createSaleLowPriceCapability, SALE_LOW_PRICE_PAGE_PATH, type SaleLowPriceCapability } from './capabilities/sale-low-price.js'
import { createSaleTradeStoreroomCapability, SALE_TRADE_STOREROOM_PAGE_PATH, type SaleTradeStoreroomCapability } from './capabilities/sale-trade-storeroom.js'
import { createSaleSettingDictCapability, SALE_SETTING_DICT_PAGE_PATH, type SaleSettingDictCapability } from './capabilities/sale-setting-dict.js'
import { createSaleSysDictCapability, SALE_SYS_DICT_PAGE_PATH, type SaleSysDictCapability } from './capabilities/sale-sys-dict.js'
import { createSaleServiceSubjectCapability, SALE_SERVICE_SUBJECT_PAGE_PATH, type SaleServiceSubjectCapability } from './capabilities/sale-service-subject.js'
import { createSaleScheduleJobCapability, SALE_SCHEDULE_JOB_PAGE_PATH, type SaleScheduleJobCapability } from './capabilities/sale-schedule-job.js'
import { createSaleScheduleJobLogCapability, SALE_SCHEDULE_JOB_LOG_PAGE_PATH, type SaleScheduleJobLogCapability } from './capabilities/sale-schedule-job-log.js'
import { createSaleRegisterCodeCapability, SALE_REGISTER_CODE_PAGE_PATH, type SaleRegisterCodeCapability } from './capabilities/sale-register-code.js'
import { createSettingDictPlatformCapability, SETTING_DICT_PLATFORM_PAGE_PATH, type SettingDictPlatformCapability } from './capabilities/setting-dict-platform.js'
import { createPlatformDictMallCapability, PLATFORM_DICT_MALL_COMMON_PAGE_PATH, PLATFORM_DICT_MALL_COMMON_SYSTEM, PLATFORM_DICT_MALL_FINANCE_PAGE_PATH, PLATFORM_DICT_MALL_FINANCE_SYSTEM, PLATFORM_DICT_MALL_HR_PAGE_PATH, PLATFORM_DICT_MALL_HR_SYSTEM, PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH, PLATFORM_DICT_MALL_MATERIAL_SYSTEM, PLATFORM_DICT_MALL_PAGE_PATH, PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH, PLATFORM_DICT_MALL_PRODUCT_SYSTEM, PLATFORM_DICT_MALL_SALE_PAGE_PATH, PLATFORM_DICT_MALL_SALE_SYSTEM, PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH, PLATFORM_DICT_MALL_SUPPLY_SYSTEM, type PlatformDictMallCapability } from './capabilities/platform-dict-mall.js'
import { createSettingFrontendLogCapability, SETTING_FRONTEND_LOG_PAGE_PATH, type SettingFrontendLogCapability } from './capabilities/setting-frontend-log.js'
import { createSettingMaterialCapability, SETTING_MATERIAL_PAGE_PATH, type SettingMaterialCapability } from './capabilities/setting-material.js'
import { createSettingMenuCapability, SETTING_MENU_PAGE_PATH, type SettingMenuCapability } from './capabilities/setting-menu.js'
import { createSettingSupplierCapability, SETTING_SUPPLIER_PAGE_PATH, type SettingSupplierCapability } from './capabilities/setting-supplier.js'
import { createSettingSystemAccountingParametersCapability, SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH, type SettingSystemAccountingParametersCapability } from './capabilities/setting-system-accounting-parameters.js'
import { createSystemIntegrationCapability, SYSTEM_INTEGRATION_PAGE_PATH, type SystemIntegrationCapability } from './capabilities/system-integration.js'
import { createSettingRolePostCapability, SETTING_ROLE_POST_PAGE_PATH, type SettingRolePostCapability } from './capabilities/setting-role-post.js'
import { createSettingRoleCapability, SETTING_ROLE_PAGE_PATH, type SettingRoleCapabilityWithIdempotency, type SettingRoleDraft } from './capabilities/setting-role.js'
import { createSettingUserCapability, SETTING_USER_PAGE_PATH, type SettingUserCapability } from './capabilities/setting-user.js'
import { createHrExternalStaffCapability, HR_EXTERNAL_STAFF_PAGE_PATH, type HrExternalStaffCapability } from './capabilities/hr-external-staff.js'
import { createHrInternalStaffCapability, HR_INTERNAL_STAFF_PAGE_PATH, type HrInternalStaffCapability } from './capabilities/hr-internal-staff.js'
import { createHistoryArchiveCapability, HISTORY_ARCHIVE_PAGE_PATH, type HistoryArchiveCapability } from './capabilities/history-archive.js'
import { createMeOrganizationCapability, ME_ORGANIZATION_PAGE_PATH, type MeOrganizationCapability } from './capabilities/me-organization.js'
import { createMePersonalCapability, ME_PERSONAL_PAGE_PATH, type MePersonalCapability } from './capabilities/me-personal.js'
import { createRecruitmentPlanCapability, RECRUITMENT_PLAN_PAGE_PATH, type RecruitmentPlanCapability } from './capabilities/recruitment-plan.js'
import { createMyTodoUrgeCapability, MY_TODO_URGE_PAGE_PATH, type MyTodoUrgeCapability } from './capabilities/my-todo-urge.js'
import { createMyUrgeCapability, MY_URGE_PAGE_PATH, type MyUrgeCapability } from './capabilities/my-urge.js'
import { createContractCodeRuleCapability, CONTRACT_CODE_RULE_PAGE_PATH, type ContractCodeRuleCapability } from './capabilities/contract-code-rule.js'
import { createSupplyPersonnelConfigCapability, SUPPLY_PERSONNEL_CONFIG_PAGE_PATH, type SupplyPersonnelConfigCapability } from './capabilities/supply-personnel-config.js'
import { createInventoryOrganizationConfigCapability, INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH, type InventoryOrganizationConfigCapability } from './capabilities/inventory-organization-config.js'
import { createInventoryAssetDepreciationConfigCapability, INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH, type InventoryAssetDepreciationConfigCapability } from './capabilities/inventory-asset-depreciation-config.js'
import { createInventoryStockRuleCapability, INVENTORY_STOCK_RULE_PAGE_PATH, type InventoryStockRuleCapability } from './capabilities/inventory-stock-rule.js'
import { createInventoryStockLocationCapability, INVENTORY_STOCK_LOCATION_PAGE_PATH, type InventoryStockLocationCapability } from './capabilities/inventory-stock-location.js'
import { createInventoryApprovalConfigCapability, INVENTORY_APPROVAL_CONFIG_PAGE_PATH, type InventoryApprovalConfigCapability } from './capabilities/inventory-approval-config.js'
import { createInventoryAssetStocktakingConfigCapability, INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH, type InventoryAssetStocktakingConfigCapability } from './capabilities/inventory-asset-stocktaking-config.js'
import { createInventoryAssetBatchConfigCapability, INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH, type InventoryAssetBatchConfigCapability } from './capabilities/inventory-asset-batch-config.js'
import { createInventoryValuationCapability, INVENTORY_VALUATION_PAGE_PATH, type InventoryValuationCapability } from './capabilities/inventory-valuation.js'
import { createPlatformRuleManagementCapability, PLATFORM_RULE_MANAGEMENT_PAGE_PATH, type PlatformRuleManagementCapability } from './capabilities/platform-rule-management.js'
import { createHrPostSettingCapability, HR_POST_SETTING_PAGE_PATH, type HrPostSettingCapability } from './capabilities/hr-post-setting.js'
import { createProductHighProductionUsageCapability, PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH, type ProductHighProductionUsageCapability } from './capabilities/product-high-production-usage.js'
import { createProductStableProductionUsageCapability, PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH, type ProductStableProductionUsageCapability } from './capabilities/product-stable-production-usage.js'
import { createProductPreventionUsageAnalysisCapability, PRODUCT_PREVENTION_USAGE_ANALYSIS_PAGE_PATH, type ProductPreventionUsageAnalysisCapability } from './capabilities/product-prevention-usage-analysis.js'
import { createProductUserAnalysisCapability, PRODUCT_USER_ANALYSIS_PAGE_PATH, type ProductUserAnalysisCapability } from './capabilities/product-user-analysis.js'
import { createProductNoticeConfigCapability, PRODUCT_NOTICE_CONFIG_PAGE_PATH, type ProductNoticeConfigCapability } from './capabilities/product-notice-config.js'
import { createProductProgramLibraryCapability, PRODUCT_PROGRAM_LIBRARY_PAGE_PATH, PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH, type ProductProgramLibraryCapability } from './capabilities/product-program-library.js'
import { createProductSettingMaterialCapability, PRODUCT_SETTING_MATERIAL_PAGE_PATH, type ProductSettingMaterialCapability } from './capabilities/product-setting-material.js'
import { createProductSettingMedicineCapability, PRODUCT_SETTING_MEDICINE_PAGE_PATH, type ProductSettingMedicineCapability } from './capabilities/product-setting-medicine.js'
import { createProductSettingUserDictCapability, PRODUCT_SETTING_USER_DICT_PAGE_PATH, type ProductSettingUserDictCapability } from './capabilities/product-setting-user-dict.js'
import { createProductSettingVaccineCapability, PRODUCT_SETTING_VACCINE_PAGE_PATH, type ProductSettingVaccineCapability } from './capabilities/product-setting-vaccine.js'
import { createProductSettingAntibodyCapability, PRODUCT_SETTING_ANTIBODY_PAGE_PATH, type ProductSettingAntibodyCapability } from './capabilities/product-setting-antibody.js'
import { createProductSettingChickenProductionCapability, PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH, type ProductSettingChickenProductionCapability } from './capabilities/product-setting-chicken-production.js'
import { createProductSettingEggStandardAgeStageCapability, PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH, type ProductSettingEggStandardAgeStageCapability } from './capabilities/product-setting-egg-standard-age-stage.js'
import { createProductSettingEpidemicPreventionCostCapability, PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH, type ProductSettingEpidemicPreventionCostCapability } from './capabilities/product-setting-epidemic-prevention-cost.js'
import { createProductSettingHatchAnnualMonthlyCapability, PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH, type ProductSettingHatchAnnualMonthlyCapability } from './capabilities/product-setting-hatch-annual-monthly.js'
import { createProductSettingStandardBroilerCapability, PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH, type ProductSettingStandardBroilerCapability } from './capabilities/product-setting-standard-broiler.js'
import { createProductSettingStandardFlockWeekCapability, PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH, type ProductSettingStandardFlockWeekCapability } from './capabilities/product-setting-standard-flock-week.js'
import { createProductSettingStandardFlockCapability, PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH, type ProductSettingStandardFlockCapability } from './capabilities/product-setting-standard-flock.js'
import { createProductSettingStandardHatchCapability, PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH, type ProductSettingStandardHatchCapability } from './capabilities/product-setting-standard-hatch.js'
import { createProductSettingBatchStatusCapability, PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH, type ProductSettingBatchStatusCapability } from './capabilities/product-setting-batch-status.js'
import { createProductSettingConfigureCapability, PRODUCT_SETTING_CONFIGURE_PAGE_PATH, type ProductSettingConfigureCapability } from './capabilities/product-setting-configure.js'
import { createProductSettingDayLiquidationCapability, PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH, type ProductSettingDayLiquidationCapability } from './capabilities/product-setting-day-liquidation.js'
import { createProductSettingFunctionUseCapability, PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH, type ProductSettingFunctionUseCapability } from './capabilities/product-setting-function-use.js'
import { createProductSettingMaterialMasterCapability, PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH, type ProductSettingMaterialMasterCapability } from './capabilities/product-setting-material-master.js'
import { createProductSettingTenantLogCapability, PRODUCT_SETTING_TENANT_LOG_PAGE_PATH, type ProductSettingTenantLogCapability } from './capabilities/product-setting-tenant-log.js'
import { createProductSettingHatchManageLibCapability, PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH, type ProductSettingHatchManageLibCapability } from './capabilities/product-setting-hatch-manage-lib.js'
import { createProductBusinessAgeDivisionCapability, PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, type ProductBusinessAgeDivisionCapability } from './capabilities/product-business-age-division.js'
import { createProductBusinessDataRetransmitCapability, PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH, type ProductBusinessDataRetransmitCapability } from './capabilities/product-business-data-retransmit.js'
import { createProductBusinessSetupMaterialCodeCapability, PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH, type ProductBusinessSetupMaterialCodeCapability } from './capabilities/product-business-setup-material-code.js'
import { createProductHatcheryLibCapability, PRODUCT_HATCHERY_LIB_PAGE_PATH, type ProductHatcheryLibCapability } from './capabilities/product-hatchery-lib.js'
import { createProductHatcheryMethodCapability, PRODUCT_HATCHERY_METHOD_PAGE_PATH, type ProductHatcheryMethodCapability } from './capabilities/product-hatchery-method.js'
import { createProductHatcheryMethodLibCapability, PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH, type ProductHatcheryMethodLibCapability } from './capabilities/product-hatchery-method-lib.js'
import { createProductHatcheryMethodLibIndicatorCapability, PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH, type ProductHatcheryMethodLibIndicatorCapability } from './capabilities/product-hatchery-method-lib-indicator.js'
import { createProductHatcheryStandardIndicatorCapability, PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH, type ProductHatcheryStandardIndicatorCapability } from './capabilities/product-hatchery-standard-indicator.js'
import { createProductHatcheryUnitCapability, PRODUCT_HATCHERY_UNIT_PAGE_PATH, type ProductHatcheryUnitCapability } from './capabilities/product-hatchery-unit.js'
import { createProductPlanPreviewCapability, PRODUCT_PLAN_PREVIEW_PAGE_PATH, type ProductPlanPreviewCapability } from './capabilities/product-plan-preview.js'
import { createSaleCustomQrCapability, SALE_CUSTOM_QR_PAGE_PATH, type SaleCustomQrCapability } from './capabilities/sale-custom-qr.js'
import { createSettingDictPlatformFinanceCapability, SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH, type SettingDictPlatformFinanceCapability } from './capabilities/setting-dict-platform-finance.js'
import { createSettingDictPlatformCommonCapability, SETTING_DICT_PLATFORM_COMMON_PAGE_PATH, type SettingDictPlatformCommonCapability } from './capabilities/setting-dict-platform-common.js'
import { createSettingDictPlatformHrCapability, SETTING_DICT_PLATFORM_HR_PAGE_PATH, type SettingDictPlatformHrCapability } from './capabilities/setting-dict-platform-hr.js'
import { createSettingDictPlatformMaterialCapability, SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH, type SettingDictPlatformMaterialCapability } from './capabilities/setting-dict-platform-material.js'
import { createSettingDictPlatformProductCapability, SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH, type SettingDictPlatformProductCapability } from './capabilities/setting-dict-platform-product.js'
import { createSettingDictPlatformSupplyCapability, SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH, type SettingDictPlatformSupplyCapability } from './capabilities/setting-dict-platform-supply.js'
import { createSettingDictPlatformSaleCapability, SETTING_DICT_PLATFORM_SALE_PAGE_PATH, type SettingDictPlatformSaleCapability } from './capabilities/setting-dict-platform-sale.js'
import { createSaleVisitRecommendSettingCapability, SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH, type SaleVisitRecommendSettingCapability } from './capabilities/sale-visit-recommend-setting.js'
import { createProductSettingHatchManageMethodLibCapability, PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_PAGE_PATH, type ProductSettingHatchManageMethodLibCapability } from './capabilities/product-setting-hatch-manage-method-lib.js'
import { createProductSettingHatchMethodLibIndicatorCapability, PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH, type ProductSettingHatchMethodLibIndicatorCapability } from './capabilities/product-setting-hatch-method-lib-indicator.js'
import { createProductSettingHatchManageMethodCapability, PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH, type ProductSettingHatchManageMethodCapability } from './capabilities/product-setting-hatch-manage-method.js'
import { createProductSettingHatchManageSeasonCapability, PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH, type ProductSettingHatchManageSeasonCapability } from './capabilities/product-setting-hatch-manage-season.js'
import { createProductSettingIndicatorLibCapability, PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH, type ProductSettingIndicatorLibCapability } from './capabilities/product-setting-indicator-lib.js'
import { createProductSettingMethodLibCapability, PRODUCT_SETTING_METHOD_LIB_PAGE_PATH, type ProductSettingMethodLibCapability } from './capabilities/product-setting-method-lib.js'
import { createProductSettingSeasonCapability, PRODUCT_SETTING_SEASON_PAGE_PATH, type ProductSettingSeasonCapability } from './capabilities/product-setting-season.js'
import { createProductSettingHatchManageUnitCapability, PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH, type ProductSettingHatchManageUnitCapability } from './capabilities/product-setting-hatch-manage-unit.js'
import { createProductSettingHatchManageVarietyCapability, PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH, type ProductSettingHatchManageVarietyCapability } from './capabilities/product-setting-hatch-manage-variety.js'
import { withCompatibleAiModelHost, type CompatibleAiModelHost } from './capabilities/ai-model-compat.js'
import { createBatchCapabilityHost, type BatchCapabilityHost } from './capabilities/generated/index.js'
import { createContractSupport, CONTRACT_SUPPORT_CONTEXTS, type ContractSupport } from './capabilities/contract-support.js'
import type { AxiosInstance } from 'axios'

import type { PortalHeadlessConfig } from './config.js'
import { createPortalHttp, type PortalRequestConfig } from './http/client.js'
import { resolveModuleType, type ModuleTypeResolution } from './context/module-type.js'
import {
  createMeetingRoomCapability,
  meetingRoomCapabilities,
  MEETING_ROOM_PAGE_PATH,
  type MeetingRoomCapability,
} from './capabilities/meeting-room.js'
import {
  buildMeetingApplicationPayload,
  createMeetingApplicationCapability,
  meetingApplicationCapabilities,
  MEETING_APPLICATION_PAGE_PATH,
  type MeetingApplicationCapabilityWithIdempotency,
  type MeetingApplicationDraft,
} from './capabilities/meeting-application.js'
import {
  attendanceArchiveSheetCapabilities,
  createAttendanceArchiveSheetCapability,
  ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH,
  type AttendanceArchiveSheetCapability,
} from './capabilities/attendance-archive-sheet.js'
import {
  createAttendanceAnnualLeaveCapability,
  ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH,
  type AttendanceAnnualLeaveCapability,
} from './capabilities/attendance-annual-leave.js'
import {
  createAttendanceExceptionCapability,
  ATTENDANCE_EXCEPTION_PAGE_PATH,
  type AttendanceExceptionCapability,
} from './capabilities/attendance-exception.js'
import {
  createAttendanceSchedualInformationCapability,
  ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH,
  type AttendanceSchedualInformationCapability,
} from './capabilities/attendance-schedual-information.js'
import {
  createAttendanceOvertimeCapability,
  ATTENDANCE_OVERTIME_PAGE_PATH,
  type AttendanceOvertimeCapability,
} from './capabilities/attendance-overtime.js'
import {
  certificateLicenseCapabilities,
  createCertificateLicenseCapability,
  CERTIFICATE_LICENSE_PAGE_PATH,
  type CertificateLicenseCapability,
} from './capabilities/certificate-license.js'
import {
  certificateTypeCapabilities,
  createCertificateTypeCapability,
  CERTIFICATE_TYPE_PAGE_PATH,
  type CertificateTypeCapability,
} from './capabilities/certificate-type.js'
import {
  createInstitutionTypeCapability,
  INSTITUTION_TYPE_PAGE_PATH,
  type InstitutionTypeCapability,
} from './capabilities/institution-type.js'
import {
  pieceCapabilities,
  createPieceCapability,
  PIECE_PAGE_PATH,
  type PieceCapability,
} from './capabilities/piece.js'
import {
  businessRegistrationCapabilities,
  createBusinessRegistrationCapability,
  BUSINESS_REGISTRATION_PAGE_PATH,
  type BusinessRegistrationCapability,
} from './capabilities/business-registration.js'
import {
  companyPolicyCapabilities,
  createCompanyPolicyCapability,
  COMPANY_POLICY_PAGE_PATH,
  type CompanyPolicyCapability,
} from './capabilities/company-policy.js'
import {
  honorCapabilities,
  createHonorCapability,
  HONOR_PAGE_PATH,
  type HonorCapability,
} from './capabilities/honor.js'
import {
  legalDisputeCapabilities,
  createLegalDisputeCapability,
  LEGAL_DISPUTE_PAGE_PATH,
  type LegalDisputeCapability,
} from './capabilities/legal-dispute.js'
import {
  qualificationCapabilities,
  createQualificationCapability,
  QUALIFICATION_PAGE_PATH,
  type QualificationCapability,
} from './capabilities/qualification.js'
import {
  patentCapabilities,
  createPatentCapability,
  PATENT_PAGE_PATH,
  type PatentCapability,
} from './capabilities/patent.js'
import {
  softwareCapabilities,
  createSoftwareCapability,
  SOFTWARE_PAGE_PATH,
  type SoftwareCapability,
} from './capabilities/software.js'
import {
  standardDocumentCapabilities,
  createStandardDocumentCapability,
  STANDARD_DOCUMENT_PAGE_PATH,
  type StandardDocumentCapability,
} from './capabilities/standard-document.js'
import {
  trademarkCapabilities,
  createTrademarkCapability,
  TRADEMARK_PAGE_PATH,
  type TrademarkCapability,
} from './capabilities/trademark.js'
import {
  attendanceStatisticsCapabilities,
  createAttendanceStatisticsCapability,
  ATTENDANCE_STATISTICS_PAGE_PATH,
  type AttendanceStatisticsCapability,
} from './capabilities/attendance-statistics.js'
import {
  assignmentCapabilities,
  buildAssignmentPayload,
  createAssignmentCapability,
  ASSIGNMENT_PAGE_PATH,
  type AssignmentCapabilityWithIdempotency,
  type AssignmentDraft,
} from './capabilities/assignment.js'
import {
  attendanceShiftCapabilities,
  buildShiftPayload,
  createAttendanceShiftCapability,
  ATTENDANCE_SHIFT_PAGE_PATH,
  type AttendanceShiftCapabilityWithIdempotency,
  type AttendanceShiftDraft,
} from './capabilities/attendance-shift.js'
import {
  attendanceTeamCapabilities,
  buildGroupPayload,
  createAttendanceTeamCapability,
  ATTENDANCE_TEAM_PAGE_PATH,
  type AttendanceTeamCapabilityWithIdempotency,
  type AttendanceTeamDraft,
} from './capabilities/attendance-team.js'
import {
  backlogTaskExamineCapabilities,
  createBacklogTaskExamineCapability,
  BACKLOG_TASK_EXAMINE_PAGE_PATH,
  type BacklogTaskExamineCapability,
} from './capabilities/backlog-task-examine.js'
import {
  baseManagementCenterCapabilities,
  buildCreatePayload as buildManagementCenterPayload,
  createBaseManagementCenterCapability,
  BASE_MANAGEMENT_CENTER_PAGE_PATH,
  type BaseManagementCenterCapabilityWithIdempotency,
  type ManagementCenterDraft,
} from './capabilities/base-management-center.js'
import {
  contractTemplateCapabilities,
  buildTemplatePayload,
  createContractTemplateCapability,
  CONTRACT_TEMPLATE_PAGE_PATH,
  type ContractTemplateCapabilityWithIdempotency,
  type ContractTemplateDraft,
} from './capabilities/contract-template.js'
import {
  contractLibraryCapabilities,
  createContractLibraryCapability,
  CONTRACT_LIBRARY_PAGE_PATH,
  type ContractLibraryCapability,
} from './capabilities/contract-library.js'
import {
  contractCreateCapabilities,
  createContractCreateCapability,
  normalizeContractCreateDraft,
  CONTRACT_CREATE_PAGE_PATH,
  type ContractCreateCapability,
  type ContractCreateCapabilityWithIdempotency,
  type ContractCreateDraft,
} from './capabilities/contract-create.js'
import {
  baseDeptDictPermissionCapabilities,
  createBaseDeptDictPermission,
  BASE_DEPT_LIST_PATH,
  type BaseDataRequest,
  type BaseDeptDictPermissionCapability,
} from './capabilities/base-dept-dict-permission.js'
import {
  baseImageCapabilities,
  createBaseImageCapability,
  BASE_IMAGE_PAGE_PATH,
  type BaseImageCapabilityWithIdempotency,
  type BaseImageDraft,
} from './capabilities/base-image.js'
import {
  baseShellCapabilities,
  createBaseShell,
  BASE_SHELL_CONTEXT_ROOT,
  type BaseShellCapability,
} from './capabilities/base-shell.js'
import {
  baseUploadCapabilities,
  createBaseUploadCapability,
  type BaseUploadCapability,
} from './capabilities/base-upload.js'
import {
  buildGeneralApprovalPayload,
  createGeneralApprovalCapability,
  generalApprovalCapabilities,
  GENERAL_APPROVAL_PAGE_PATH,
  type GeneralApprovalCapabilityWithIdempotency,
  type GeneralApprovalDraft,
} from './capabilities/general-approval.js'
import {
  baseTenantCapabilities,
  createBaseTenant,
  BASE_TENANT_DETAIL_PATH,
  type BaseTenantCapability,
} from './capabilities/base-tenant.js'
import {
  baseSaleCapabilities,
  createBaseSale,
  BASE_SALE_SHOP_PATH,
  type BaseSaleCapability,
} from './capabilities/base-sale.js'
import {
  createLeaveApplicationCapability,
  leaveApplicationCapabilities,
  LEAVE_APPLICATION_PAGE_PATH,
  type LeaveApplicationCapabilityWithIdempotency,
  type LeaveDraft,
} from './capabilities/leave-application.js'
import {
  buildVehicleApplicationPayload,
  createVehicleApplicationCapability,
  vehicleApplicationCapabilities,
  VEHICLE_APPLICATION_PAGE_PATH,
  type VehicleApplicationCapabilityWithIdempotency,
  type VehicleApplicationDraft,
} from './capabilities/vehicle-application.js'
import {
  buildTravelPayload,
  createTravelExpenseCapability,
  travelExpenseCapabilities,
  TRAVEL_EXPENSE_PAGE_PATH,
  type TravelExpenseCapabilityWithIdempotency,
  type TravelExpenseDraft,
} from './capabilities/travel-expense-application.js'
import {
  buildProductDesignApprovalPayload,
  createProductDesignApprovalCapability,
  productDesignApprovalCapabilities,
  PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
  type ProductDesignApprovalCapabilityWithIdempotency,
  type ProductDesignApprovalDraft,
} from './capabilities/product-design-approval.js'
import {
  createTaskActionCapability,
  taskActionCapabilities,
  TASK_ACTION_BATCH_PAGE_PATH,
  TASK_ACTION_DETAIL_PAGE_PATH,
  type TaskActionCapabilityWithIdempotency,
} from './capabilities/task-action.js'
import {
  createOvertimeApplicationCapability,
  overtimeApplicationCapabilities,
  OVERTIME_APPLICATION_PAGE_PATH,
  type OvertimeApplicationCapabilityWithIdempotency,
  type OvertimeApplicationDraft,
} from './capabilities/overtime-application.js'
import {
  createRestLeaveApplicationCapability,
  restLeaveApplicationCapabilities,
  REST_LEAVE_APPLICATION_PAGE_PATH,
  type RestLeaveApplicationCapabilityWithIdempotency,
  type RestLeaveApplicationDraft,
} from './capabilities/rest-leave-application.js'
import {
  createBusinessTripApplicationCapability,
  businessTripApplicationCapabilities,
  BUSINESS_TRIP_APPLICATION_PAGE_PATH,
  type BusinessTripApplicationCapabilityWithIdempotency,
  type BusinessTripApplicationDraft,
} from './capabilities/business-trip-application.js'
import {
  createStudyCourseCapability,
  STUDY_COURSE_TEXT_PAGE_PATH,
  type StudyCourseCapability,
  type StudyCourseListQuery,
  type StudyCourseImListQuery,
} from './capabilities/study-course.js'
import {
  createStudyStudentCapability,
  studyStudentCapabilities,
  STUDY_STUDENT_PAGE_PATH,
} from './capabilities/study-student.js'
import {
  createStudyGradeCapability,
  studyGradeCapabilities,
  STUDY_GRADE_PAGE_PATH,
} from './capabilities/study-grade.js'
import {
  createStudyLessonCapability,
  studyLessonCapabilities,
  STUDY_LESSON_DAILY_PAGE_PATH,
  STUDY_LESSON_WEEKLY_PAGE_PATH,
  STUDY_LESSON_MONTHLY_PAGE_PATH,
} from './capabilities/study-lesson.js'
import {
  createStudyRecordCapability,
  studyRecordCapabilities,
  STUDY_RECORD_PAGE_PATH,
} from './capabilities/study-record.js'
import {
  createStudyStatisticsCapability,
  studyStatisticsCapabilities,
  STUDY_STATISTICS_STUDENT_PAGE_PATH,
  STUDY_STATISTICS_TEACHER_PAGE_PATH,
  STUDY_STATISTICS_LESSON_PAGE_PATH,
  STUDY_STATISTICS_GRADE_PAGE_PATH,
  STUDY_STATISTICS_LEARNING_PAGE_PATH,
} from './capabilities/study-statistics.js'
import {
  createStudyTeacherCapability,
  studyTeacherCapabilities,
  STUDY_APPRAISE_SETTING_PAGE_PATH,
  STUDY_TEACHER_PAGE_PATH,
  STUDY_TEACHER_LEVEL_PAGE_PATH,
  STUDY_TEACHER_HTTP_INSTANCE,
} from './capabilities/study-teacher.js'
import type {
  StudyStudentCapability,
} from './capabilities/study-student.js'
import type {
  StudyGradeCapability,
} from './capabilities/study-grade.js'
import type {
  StudyLessonCapability,
} from './capabilities/study-lesson.js'
import type {
  StudyRecordCapability,
} from './capabilities/study-record.js'
import type {
  StudyStatisticsCapability,
} from './capabilities/study-statistics.js'
import type {
  StudyTeacherCapability,
} from './capabilities/study-teacher.js'
import {
  createPerfAgreementCapability,
  perfAgreementCapabilities,
  PERF_AGREEMENT_CHANGE_PAGE_PATH,
  PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH,
  PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH,
  PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
  PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH,
} from './capabilities/perf-agreement.js'
import {
  createPerfManageConfigCapability,
  perfManageConfigCapabilities,
  PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
  PERF_MANAGE_INDICATOR_PAGE_PATH,
  PERF_MANAGE_INSURANCE_PAGE_PATH,
  PERF_MANAGE_STANDARD_PAGE_PATH,
  PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
  PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH,
} from './capabilities/perf-manage-config.js'
import {
  createPerfManageTemplateCapability,
  perfManageTemplateCapabilities,
  PROFIT_PAGE_PATH,
  SALARY_STRUCTURE_PAGE_PATH,
  TEMPLATE_CONTENT_PAGE_PATH,
  TEMPLATE_STRUCTURE_PAGE_PATH,
  STUDY_TASK_CONFIG_PAGE_PATH,
  TASK_TYPE_CONFIG_PAGE_PATH,
} from './capabilities/perf-manage-template.js'
import {
  createPerfSalaryCapability,
  perfSalaryCapabilities,
  PERF_SALARY_MAIN_PAGE_PATH,
  PERF_SALARY_ADJUST_PAGE_PATH,
  PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
  PERF_BLOCK_MAIN_PAGE_PATH,
  PERF_ANALYSIS_DEPARTMENT_PAGE_PATH,
  PERF_ANALYSIS_PERSON_PAGE_PATH,
} from './capabilities/perf-salary.js'
import {
  createFlowTaskCapability,
  flowTaskCapabilities,
  FLOW_TASK_CREATE_PAGE_PATH,
  FLOW_TASK_TODO_PAGE_PATH,
  FLOW_TASK_DONE_PAGE_PATH,
  FLOW_TASK_COPY_PAGE_PATH,
  FLOW_TASK_MY_PAGE_PATH,
} from './capabilities/flow-task.js'
import {
  createFlowManageCapability,
  flowManageCapabilities,
  FLOW_MANAGE_MODEL_PAGE_PATH,
  FLOW_MANAGE_AI_REVIEW_PAGE_PATH,
  FLOW_MANAGE_INSTANCE_PAGE_PATH,
  FLOW_MANAGE_TASK_PAGE_PATH,
} from './capabilities/flow-manage.js'
import type { PerfAgreementCapability } from './capabilities/perf-agreement.js'
import type { PerfManageConfigCapability } from './capabilities/perf-manage-config.js'
import type { PerfManageTemplateCapability } from './capabilities/perf-manage-template.js'
import type { PerfSalaryCapabilityWithIdempotency } from './capabilities/perf-salary.js'
import type { FlowTaskCapability } from './capabilities/flow-task.js'
import type { FlowManageCapability } from './capabilities/flow-manage.js'
import {
  createAiKnowledgeCapability,
  aiKnowledgeCapabilities,
  AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
  AI_KNOWLEDGE_REVIEW_PAGE_PATH,
} from './capabilities/ai-knowledge.js'
import {
  createAiInteractionQaCapability,
  aiInteractionQaCapabilities,
  AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
  AI_INTERACTION_CHAT_PAGE_PATH,
  AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
  AI_INTERACTION_FEEDBACK_PAGE_PATH,
} from './capabilities/ai-interaction-qa.js'
import {
  createAiModelCapability,
  aiModelCapabilities,
  AI_MODEL_LIST_PAGE_PATH,
  AI_MODEL_SELECT_PAGE_PATH,
  AI_PLATFORM_USAGE_PAGE_PATH,
  AI_DATA_ANALYSIS_PAGE_PATH,
} from './capabilities/ai-model.js'
import {
  createModelUsageCapability,
  modelUsageCapabilities,
  PERSONAL_USAGE_PAGE_PATH,
} from './capabilities/model-usage.js'
import {
  createAiPromptCapability,
  aiPromptCapabilities,
  AI_PROMPT_TYPE_PAGE_PATH,
  AI_PROMPT_SKILL_PAGE_PATH,
  AI_PROMPT_INTENT_PAGE_PATH,
} from './capabilities/ai-prompt.js'
import {
  createAiPromptToolCapability,
  aiPromptToolCapabilities,
  AI_BUSINESS_EVENT_PAGE_PATH,
  AI_OPEN_API_REGISTRY_PAGE_PATH,
  AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
} from './capabilities/ai-prompt-tool.js'
import { createChatCapability, CHAT_PAGE_PATH, CHAT_AGENT_ORCHESTRATION_DICT_TYPE, type ChatCapability } from './capabilities/chat.js'
import type { AiKnowledgeCapability } from './capabilities/ai-knowledge.js'
import type { AiInteractionQaCapability } from './capabilities/ai-interaction-qa.js'
import type { AiModelCapability } from './capabilities/ai-model.js'
import type { ModelUsageCapability } from './capabilities/model-usage.js'
import type { AiPromptCapability } from './capabilities/ai-prompt.js'
import type { AiPromptToolCapability } from './capabilities/ai-prompt-tool.js'
import { IdempotencyStore, withIdempotency } from './idempotency/index.js'

import { ALL_CAPABILITY_DEFINITIONS } from './capabilities/index.js'
import type { CapabilityDefinition } from './capabilities/types.js'
import {
  attachCapabilityInvoker,
  createCapabilityInvoker,
  type CapabilityInvoker,
  type CapabilityRegistry,
} from './capabilities/invoke.js'
import {
  createCatalog,
  visibleCatalogFrom,
  type Catalog,
  type VisibleCatalog,
  type VisibleCatalogInput,
} from './catalog/index.js'
import { createPageCall } from './call.js'
import { resolveInvalidation } from './invalidation/index.js'
import { createPortalServer, type PortalServer, type SessionScopedPortal } from './server.js'

export type PortalHeadless = CompatibleAiModelHost<{
  /** 底层 HTTP 客户端。复刻 Portal 前端的请求头、前缀、分页与响应包络 */
  http: AxiosInstance
  /**
   * 按「页面上下文」发请求：自动推导该页面的 module-type。
   * 这是 SDK 的主入口——能力都是围着页面转的（设计 H2 / F3b）。
   */
  call<T>(pagePath: string, config: PortalRequestConfig): Promise<T>
  /** 只解析 module-type，不发请求。便于诊断与逐字段比对 */
  resolveModuleType(pagePath: string): ModuleTypeResolution
  /**
   * 已注册的能力定义，**并且就是调用句柄**：
   *
   * ```ts
   * sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
   * ```
   *
   * `invoke` 是挂在数组上的不可枚举属性（所以 `Object.keys` / 展开 / 序列化看到的
   * 仍然只是能力定义本身），它按能力 ID 分发到 `src/capabilities/invoke.ts` 那张绑定表——
   * 与 `describe().invoke.sdkPath` 是同一份实现，不会分叉（G1）。
   */
  capabilities: CapabilityRegistry
  /** 批量生成且已通过范围/静态契约门禁的只读列表能力。 */
  batch: BatchCapabilityHost
  /**
   * 写操作的短窗口防重（设计 D12）。
   *
   * **它不是幂等**——进程重启、多实例、TTL 过后都不生效。做不到什么逐条列在
   * `src/idempotency/README.md`。真正的幂等只能在服务端做。
   */
  idempotency: IdempotencyStore
  /**
   * 能力目录与检索（设计 D8 / D11 / D14 / D24）。
   *
   * 目录与 `capabilities` 同源：它索引的就是这个实例真正能调的那些能力，
   * 避免"目录里说有、实际调不到"的分叉。
   *
   * ⚠️ 这一份是**全量**目录（1,019 行），不做可见性过滤。要按用户可见菜单收敛下发面，
   * 显式调 `visibleCatalog()`——见下。
   */
  catalog: Catalog
  /**
   * 取「这个用户能看到的菜单」，据此给出**收敛后的目录**（设计 D8 / F18 / H36）。
   *
   * ```ts
   * const { catalog, report } = await portal.visibleCatalog({ project: 2 })
   * catalog.listDomains()   // 只在可见菜单里的页面与能力
   * report?.summary         // 为什么这些可见、哪些被收敛掉了
   * ```
   *
   * 三件事是刻意的：
   *
   * 1. **要显式调**。菜单树不是权限裁决 —— conventions 第 15 条记着实测反例：某账号的
   *    `/dashboard/meeting-room/list` 不在它的菜单里，但该能力是可调的。自动过滤会
   *    **把能用的能力藏起来**，所以 `portal.catalog` 与所有能力方法一个字都不变。
   * 2. **每次调用打一次 `sys/menu/nav`**（`baseShell` 侧 30 分钟实例内缓存、并发单飞）。
   *    菜单是 per-(用户, 项目) 的，不能在构造期拿（`createPortalHeadless` 是同步的，
   *    而且那时候凭据还没用来打过任何请求）。
   * 3. **取不到 / 树被截断 = 失败关闭**（抛 `MenuVisibilityUnavailableError`）。
   *    降级成全量属于静默放大，调用方看不出这份目录没被收窄过；要未过滤的目录，
   *    显式用 `portal.catalog`，或显式传 `onUnavailable: 'unfiltered'`。
   */
  visibleCatalog: (input: VisibleCatalogInput) => Promise<VisibleCatalog>
  meetingRoom: MeetingRoomCapability
  meetingApplication: MeetingApplicationCapabilityWithIdempotency
  /** 考勤档案（普通只读列表页这一类的第一条线，见 docs/pages/考勤档案.md） */
  attendanceArchive: AttendanceArchiveSheetCapability
  /**
   * 考勤统计（与考勤档案打同一个接口的另一页，见 docs/pages/考勤统计.md）。
   *
   * 两页**共用** `GET /org/hrAttendanceSheet/page`，唯一差别是档案页多一个
   * `isArchived=1`；这一页一个字都不发，因此拿到的是全部考勤表（两页的分界即是这个参数）。
   */
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
  settingCategoryDict: SettingCategoryDictCapability
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
  saleCcbAccount: SaleCcbAccountCapability
  salePaymentAccount: SalePaymentAccountCapability
  saleSysOffice: SaleSysOfficeCapability
  saleSysUser: SaleSysUserCapability
  saleClaimSetting: SaleClaimSettingCapability
  saleOldChickenSale: SaleOldChickenSaleCapability
  salePriceControl: SalePriceControlCapability
  saleLowPrice: SaleLowPriceCapability
  saleTradeStoreroom: SaleTradeStoreroomCapability
  saleSettingDict: SaleSettingDictCapability
  saleSysDict: SaleSysDictCapability
  saleServiceSubject: SaleServiceSubjectCapability
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
  /**
   * 作业管理（**第一条换域 + 普通 CRUD** 的线，见 docs/pages/作业管理.md）。
   *
   * 写链路的形态与会议室那条流程线不同：没有 `prepare`，只有
   * `get`（整单替换前的只读前置）→ `create`/`update` → `remove`。
   * 四个写操作里**只有 `create` 带防重**，理由逐条写在能力文件头部。
   */
  assignment: AssignmentCapabilityWithIdempotency
  /**
   * 班次管理（HR 考勤域的第二条线，见 docs/pages/班次管理.md）。
   *
   * 形态与作业管理同族（get → create/update → remove，**没有 prepare**），
   * 但换了一个域、换了一套 ID 与时间字段。
   */
  attendanceShift: AttendanceShiftCapabilityWithIdempotency
  /**
   * 待办事项（只读，见 docs/pages/待办事项.md）。
   *
   * 只有 `list` 一个方法，这是刻意的：页面上所有会改数据的动作
   * （办理 / 跟进 / 撤销审批）都在别的页面上。
   */
  backlogTaskExamine: BacklogTaskExamineCapability
  /**
   * 图库管理（见 docs/pages/图库管理.md）。**同域里唯一含写操作的页**。
   *
   * 两个会**产生新记录**的写操作（`create` 与 `createRelease`）带防重；
   * `update` / `setStatus` / `remove` 重发一次终态相同，如实不包。
   */
  baseImage: BaseImageCapabilityWithIdempotency
  /**
   * 排班管理（见 docs/pages/排班管理.md）。**一个页面两条数据线**：
   * 考勤组本体（`create`/`update`/`remove`…）与这个组的排班（`scheduleGet`/`scheduleSave`）。
   * 只有 `create` 带防重。
   */
  attendanceTeam: AttendanceTeamCapabilityWithIdempotency
  /**
   * 组织结构（见 docs/pages/组织结构.md）。只有 `create` 带防重。
   *
   * 注意 `checkStatus` 名字像写、其实是**只读**：后端 `updateStatus` 一个字段都不写。
   */
  baseManagementCenter: BaseManagementCenterCapabilityWithIdempotency
  /**
   * 合同模板（见 docs/pages/合同模板.md）。只有 `create` 带防重。
   *
   * 「保存并提交」那一支**刻意不实现**：它会真的起审批流推真人待办。
   */
  contractTemplate: ContractTemplateCapabilityWithIdempotency
  /** 合同库（见 docs/pages/合同库.md）。写操作按 Portal 的补充协议、签订证明、模拟修改、作废规则执行。 */
  contractLibrary: ContractLibraryCapability
  /** 合同创建（见 docs/pages/合同创建.md）。按 Portal 表单、预览、变量、回调和回查规则执行。 */
  contractCreate: ContractCreateCapabilityWithIdempotency
  /**
   * **基础数据**：部门 / 字典 / 权限清单（见 `docs/base/` 下三份文档）。
   *
   * 它不是页面能力：`pagePath` 是合成的 `/base-data/*`，只用来给请求一个页面上下文。
   * 设计取向与页面能力不同——这几个接口的响应很大（字段字典约 1 MB、权限码 2159 条），
   * 所以**没有 `listAll`**，每个入口都有硬上限，必须按 `dictType` / 关键字取。
   */
  baseData: BaseDeptDictPermissionCapability
  /**
   * **上传**：把文件直传 OSS 并拿到可访问 url（见 `docs/base/上传.md`）。
   *
   * 它是所有带附件表单的地基——Portal 里上传组件被用了 356 处。
   * 凭据来自 `PortalHeadlessConfig.oss`；**没配也能建 SDK**，真去上传时才失败关闭。
   * 真实链路已实测（测试桶，2026-09-20）：PutObject 200 → 匿名 GET 读回逐字节一致 →
   * 签名 DELETE 204 → 删后匿名 GET 403。仍未验证的一条记在 `docs/base/上传.md` §6.5。
   */
  baseUpload: BaseUploadCapability
  /**
   * **应用外壳**：用户信息 / 人员候选 / 待办与角标 / 可见菜单 / 工作台卡片（见 `docs/base/`）。
   *
   * 这些是 Portal 每次刷新都会打的那一层接口。`user-info` 复用会话里已有的 `user-basic`，
   * 不新增缓存键；人员与待办**不缓存**（它们变得快）。
   *
   * ⚠️ `sys/user/info` 的响应带 `password2` / `salt` 等字段，能力**按白名单裁剪**后才返回，
   * 不要把这个裁剪当成可以绕过的装饰。
   */
  baseShell: BaseShellCapability
  /**
   * **通用审批**（流程表单线的第一条，见 `docs/pages/通用审批.md`）。
   *
   * 形态与会议室预定同族：`definition` 读流程定义 → `prepare`（只读，问要人工指定哪些审批人）
   * → `submit` → `cancel`。只有 `submit` 带防重——重发一次就是**第二条流程实例 + 第二串真人待办**。
   *
   * ⚠️ 提交会**真的推真人待办**。测试时标题带 `SDK-TEST-` 前缀，并**不要**把审批人选成发起人本人：
   * 实测那会触发后端「发起人与审批人相同自动审核通过」，流程 1.22 秒走完，`cancel` 就撤不掉了。
   */
  generalApproval: GeneralApprovalCapabilityWithIdempotency
  /** 租户/企业上下文（基础能力，合成路径 `/base-data/*`） */
  baseTenant: BaseTenantCapability
  /**
   * 销售域基础数据（店铺 / 地区 / 厂商 / 品牌 / 首页提示）。**基础能力**。
   *
   * ⚠️ 它打的是 **`sale` 实例**（与 platform 同 host 不同前缀），所以**必须先配 `httpBaseUrls.sale`**；
   * 没配时每个方法抛 `SaleNotWiredError`（失败关闭，不拿默认 baseURL 去凑——conventions 第 27 条）。
   */
  baseSale: BaseSaleCapability
  /**
   * **请假申请**（流程表单线第二条，见 `docs/pages/请假申请.md`）。
   *
   * 形态与通用审批同族；多出的是**只读联动**：`types`（假别字典）、`yearRest`（年假余额）、
   * `duration`（按法定节假日扣减算出的时长）——这三条在页面上是联动的只读展示，这里也做成了能力。
   *
   * ⚠️ `profile` **刻意不整份返回**：`sys/user/info` 里带 `password2`（bcrypt 散列）与 `salt`。
   */
  leaveApplication: LeaveApplicationCapabilityWithIdempotency
  /**
   * **用车申请**（流程表单线第三条，见 `docs/pages/用车申请.md`）。
   *
   * 两条实测改变设计的点：① 取申请人走**分页**版（页面上那个数组版入口已被后端关掉，
   * 超过 1000 人直接 500）；② 本表单**没有附件控件**，所以载荷里不该有 `attachments`。
   */
  vehicleApplication: VehicleApplicationCapabilityWithIdempotency
  /**
   * **差旅费支出申请表**（用户口语里的「报销」，见 `docs/pages/差旅费报销.md`）。
   *
   * 形态比前三条流程都复杂：**明细行数组**（每行 13 个控件），三级地区按位置展开成
   * 省/市/区三个标量，金额总计由前端算、不接受调用方直接给。
   *
   * ⚠️ 取候选值的那几个方法（org-options / fee-items / dict-options / …）都是只读联动，
   * 页面在填单过程中会打它们；项目费用 prepare 自动补齐负责人变量；变量完整不保证稍后提交必成功。
   */
  travelExpense: TravelExpenseCapabilityWithIdempotency
  /** 已有业务所需的候选与内部法人开户只读查询。 */
  contractSupport: ContractSupport
  /**
   * **产品设计文档审核**（流程表单线第五条，见 `docs/pages/产品设计文档审核.md`）。
   *
   * 比通用审批多一条只读的 `preview`（页面右下角「查看审批流程」）。
   * ⚠️ 调查说它属「审核类」（processType=1），**实测不成立**——它在 processType=2（审批）里。
   */
  productDesignApproval: ProductDesignApprovalCapabilityWithIdempotency
  /**
   * **待办办理（横切能力）**：以**审批人的身份**办理待办——通过 / 驳回 / 转办 / 委派 / 回退 / 批量办理
   * （见 `docs/pages/待办办理.md`）。这条线补上的是前面五条流程线的另一半：
   * 以前只能"发起"，不能"办理"。
   *
   * ⚠️ **一个真实限制**：单测试账号下**办不了**自己的单子——后端 `tryAutoApproveWhenStartUserIsAssignee`
   * 会让「发起人=审批人」的节点秒批（实测 47 个未取消实例里 22 条命中），秒批后 `cancel` 就撤不掉了。
   * 上下文无逃生口。**要用这条线做端到端验证，需要第二个测试账号。**
   */
  taskAction: TaskActionCapabilityWithIdempotency
  /**
   * **加班审批**（流程表单线第六条，见 `docs/pages/加班申请.md`）。只有 `submit` 带防重。
   *
   * 12 个字段全部表达：6 个可填，6 个**只读联动**（申请人 / 申请时间 / 申请部门 / 加班时长）
   * 由 SDK 自动算，不收调用方值。
   *
   * ★ 本流程**没有**「发起人自选」节点，审批人由后端按直属上级算出来，所以前几条线
   * 「别把审批人选成自己」那条守卫拦不住——这个能力把守卫抬到了**真实审批链**上：
   * `approvalChain` 扫所有 USER_TASK 的候选人，命中发起人本人在 `create` 之前就抛错。
   */
  overtimeApplication: OvertimeApplicationCapabilityWithIdempotency
  /**
   * **调休审批**（流程表单线第七条，见 `docs/pages/调休申请.md`）——加班的孪生流程。
   *
   * 审批链形态与加班一样（直属上级、无自选节点），守卫同样走**真实审批链预览**；
   * 字段形态差很多：**有明细行数组**、**有附件控件**，且后端会重算时长。
   *
   * ⚠️ `remainingOvertimeHours` 是页面那一格的**显示值**；后端 `create` 的门槛用的是**另一套算法**，
   * 所以不要拿它在本地判「够不够调休」。
   */
  restLeaveApplication: RestLeaveApplicationCapabilityWithIdempotency
  /**
   * **出差申请**（流程表单线第八条，见 `docs/pages/出差申请.md`）。只有 `submit` 带防重。
   *
   * 14 个字段全部表达：7 个调用方填 + 7 个 disabled 的只读身份字段（由 SDK 自动算）。
   * ⚠️ 本流程**提交后业务 `status` 仍是 0（待提交）**——判「流程在跑」只能看流程实例。
   * ⚠️ 本表单**没有附件**，所以这条线不写 OSS。
   */
  businessTripApplication: BusinessTripApplicationCapabilityWithIdempotency
  /**
   * **课程管理三页**（页面队列，见 `docs/pages/图文课程.md`）。三个只读列表能力。
   *
   * 三页共用 `GET /study/course/studycourse/courseList`，靠 URL 上的 `type=1|2|4` 分片
   * （后端 SQL 第一句就是 `WHERE t1.type = #{dto.type}`），所以 `type` 钉死在各方法里、不接受传。
   *
   * ⚠️ 两条实测的"这一页现在用不了"：
   * - `listText/listVideo/listLive` 的 `keyword` **命中即报错**（后端拉全量用户撞 500 条上限）；
   * - `listIm` **任何查询都报同一个错**（同一根因），即这一页当前完全不可用。
   * 两者都会抛 `PortalApiError`，不会静默返回空列表。
   */
  studyCourse: StudyCourseCapability
  /** **学员管理**（学习管理域·基础数据）。只读；另含删除前那道「是否已在班里」的检查 */
  studyStudent: StudyStudentCapability
  /** **班级管理**（课堂管理）。只读；`searchByKeyword` 是别处班级候选的入口 */
  studyGrade: StudyGradeCapability
  /** **课堂三页**（晨 / 周 / 月）。只读 */
  studyLesson: StudyLessonCapability
  /** **学习管理**（学习记录列表）。只读 */
  studyRecord: StudyRecordCapability
  /** **数据统计五页**（学员 / 讲师 / 班课 / 班级 / 学习）。只读 */
  studyStatistics: StudyStatisticsCapability
  /**
   * **讲师三页**（讲师管理 / 讲师类型 / 评价设置）。只读。
   *
   * ⚠️ 前两页走 **`smart-layer-admin`** 实例（`.lay` 接口，另一个 host）。
   * 调用方必须在 `httpBaseUrls` 里给它的 baseURL，否则那两个方法**失败关闭**
   * （conventions 第 27 条）。
   */
  studyTeacher: StudyTeacherCapability
  /** 绩效·协议类五页（状态变更 / 个人月度 / 所辖月度 / 个人年度 / 所辖年度）；只读 */
  perfAgreement: PerfAgreementCapability
  /** 绩效·配置类六页（公式配置 / 指标管理 / 五险一金 / 标准管理 / 时间节点 / 考核规则）；时间节点与考核规则含写动作 */
  perfManageConfig: PerfManageConfigCapability
  /** 绩效·模板/任务类六页（利润管理 / 薪资结构 / 模板内容 / 模板结构 / 学习任务配置 / 任务类型配置）；学习任务配置含保存动作 */
  perfManageTemplate: PerfManageTemplateCapability
  /** 绩效·薪酬与分析六页（奖励导入 / 工资找齐 / 考核导入 / 组件管理 / 管理分析 / 个人分析）；含写，写入口带 requestId 防重 */
  perfSalary: PerfSalaryCapabilityWithIdempotency
  /** 审批管理·任务四页（发起流程 / 待办任务 / 已办任务 / 抄送我的）；只读 */
  flowTask: FlowTaskCapability
  /** 审批管理·流程管理四页（流程模型 / AI审核配置 / 流程实例 / 流程任务）；只读 */
  flowManage: FlowManageCapability
  /** 人工智能·知识管理两页（知识空间 / 知识审核）。**含写**：建/改名/移动/删除/设权限/审核 */
  aiKnowledge: AiKnowledgeCapability
  /** 人工智能·智能交互「问答」四页（热门问题 / 交互历史 / 敏感词 / 意见反馈）。**含写** */
  aiInteractionQa: AiInteractionQaCapability
  /**
   * 人工智能·智能交互「模型与用量」四页（模型列表 / 模型选择 / 平台用量 / 数据分析）。
   *
   * **含写**：模型增删改、token 配额规则、流速规则、申请处理。
   * ⚠️ 其中**额度/流速规则会影响真人的额度与限流**（`ruleScope=1` 是全局兜底），
   * 申请处理会改真人的申请状态 —— 见 `docs/pages/模型列表.md` 的风险等级。
   */
  aiModel: AiModelCapability
  /** 人工智能·个人用量页面；固定个人维度，含额度申请提交。 */
  modelUsage: ModelUsageCapability
  /** 人工智能·提示工程「基础」三页（提示词类型 / 技能列表 / 意图列表）。**含写** */
  aiPrompt: AiPromptCapability
  /** 人工智能·提示工程「工具绑定」三页（业务事件绑定技能 / 开放接口 / 工具提示词绑定）。**含写** */
  aiPromptTool: AiPromptToolCapability
  /** 智能助手页面：模型/技能、历史、SSE 对话、反馈与技能顺序。 */
  chat: ChatCapability
}>

export function createPortalHeadless (config: PortalHeadlessConfig): PortalHeadless {
  const http = createPortalHttp(config)

  // 与 src/server.ts 共用同一份实现，避免两处各写一遍导致 module-type 处理分叉。
  // 解析不到时的行为见设计 D34：默认不发这个头，与浏览器一致。
  const rawCall = createPageCall(
    <T>(requestConfig: PortalRequestConfig) =>
      http.request(requestConfig as never) as unknown as Promise<T>,
    config.moduleTypeFallback,
    config.httpBaseUrls === undefined ? undefined : { baseUrls: config.httpBaseUrls },
  )

  // 公共数据缓存只按已有的写入证据表失效；不能靠 HTTP 动词猜测，Portal 有多条
  // 只读 POST，也有 GET 写动作。写请求成功后才清理当前单用户门面的相关切片。
  let invalidateBaseData: ((slice?: 'dept' | 'dict' | 'permission') => void) | undefined
  let invalidateBaseShell: ((slice?: 'user-info' | 'menu-nav' | 'home-widgets') => void) | undefined
  let invalidateBaseTenant: ((slice?: 'tenant-list') => void) | undefined
  let invalidateBaseSale: ((slice?: 'sale-shop' | 'sale-area' | 'sale-manufacturer' | 'sale-brand') => void) | undefined

  const invalidatePublicCaches = (requestConfig: PortalRequestConfig): void => {
    const resolution = resolveInvalidation({
      path: requestConfig.url,
      method: requestConfig.method,
    })
    const keys = new Set(resolution.keys)
    if (keys.has('dict-hr') || keys.has('dict-platform')) invalidateBaseData?.('dict')
    if (keys.has('dept-list')) invalidateBaseData?.('dept')
    if (keys.has('permission-list')) invalidateBaseData?.('permission')
    if (keys.has('user-basic')) invalidateBaseShell?.('user-info')
    if (keys.has('tenant-context')) invalidateBaseTenant?.('tenant-list')
  }

  const trackRequest = <T>(request: Promise<T>, requestConfig: PortalRequestConfig): Promise<T> =>
    request.then((result) => {
      invalidatePublicCaches(requestConfig)
      return result
    })

  const call = <T>(pagePath: string, requestConfig: PortalRequestConfig): Promise<T> => {
    try {
      return trackRequest(rawCall<T>(pagePath, requestConfig), requestConfig)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  const batch = createBatchCapabilityHost((pagePath, requestConfig) =>
    call(pagePath, requestConfig),
  )

  // 唯一来源见 src/capabilities/index.ts（这份清单曾经在三个文件里各拼一遍）
  const capabilityDefinitions: CapabilityDefinition[] = [...ALL_CAPABILITY_DEFINITIONS]

  // 进程级一份：短窗口防重的记录跨调用共享，否则窗口毫无意义
  const idempotency = new IdempotencyStore({})

  const meetingApplicationBase = createMeetingApplicationCapability((requestConfig) =>
    call(MEETING_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const meetingApplication: MeetingApplicationCapabilityWithIdempotency = {
    ...meetingApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'meeting-application-submit',
      // 身份每次现取：凭据可能被换掉
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // 本地校验放在 payload 里——校验失败抛在登记之前，不会留下记录，重试天然能过。
      // （send 里 cap.submit 还会再校验一次，重复但无害；换来的是失败分类正确。）
      payload: (params) => buildMeetingApplicationPayload(params),
      send: (params, { payload }) =>
        meetingApplicationBase.submit(
          payload as unknown as MeetingApplicationDraft,
          params.startUserSelectAssignees ?? {},
        ),
    }),
  }

  // 能力内部一律走「页面上下文」，因此必然带上该页面正确的 module-type
  const meetingRoom = createMeetingRoomCapability((requestConfig) =>
    call(MEETING_ROOM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 两个方法的请求都从这一页发出（候选查询也是这一页挂载时打的），所以共用同一个页面上下文
  const attendanceArchive = createAttendanceArchiveSheetCapability((requestConfig) =>
    call(ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const attendanceAnnualLeave = createAttendanceAnnualLeaveCapability((requestConfig) =>
    call(ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const attendanceException = createAttendanceExceptionCapability((requestConfig) =>
    call(ATTENDANCE_EXCEPTION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const attendanceSchedualInformation = createAttendanceSchedualInformationCapability((requestConfig) =>
    call(ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const certificateLicense = createCertificateLicenseCapability((requestConfig) =>
    call(CERTIFICATE_LICENSE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const certificateType = createCertificateTypeCapability((requestConfig) =>
    call(CERTIFICATE_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const institutionType = createInstitutionTypeCapability((requestConfig) =>
    call(INSTITUTION_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const piece = createPieceCapability((requestConfig) =>
    call(PIECE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const businessRegistration = createBusinessRegistrationCapability((requestConfig) =>
    call(BUSINESS_REGISTRATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const companyPolicy = createCompanyPolicyCapability((requestConfig) =>
    call(COMPANY_POLICY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const honor = createHonorCapability((requestConfig) =>
    call(HONOR_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const legalDispute = createLegalDisputeCapability((requestConfig) =>
    call(LEGAL_DISPUTE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const qualification = createQualificationCapability((requestConfig) =>
    call(QUALIFICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const patent = createPatentCapability((requestConfig) =>
    call(PATENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const software = createSoftwareCapability((requestConfig) =>
    call(SOFTWARE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const standardDocument = createStandardDocumentCapability((requestConfig) =>
    call(STANDARD_DOCUMENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const trademark = createTrademarkCapability((requestConfig) =>
    call(TRADEMARK_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const attendanceOvertime = createAttendanceOvertimeCapability((requestConfig) =>
    call(ATTENDANCE_OVERTIME_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 与档案页同一个接口，但页面上下文取的是本页自己的路径：两页的 module-type 同为 11，
  // 仍按各页推导（conventions 第 1 条），不因为"结果一样"就共用一处。
  const hrPostType = createHrPostTypeCapability(requestConfig => call(HR_POST_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig))
  const portalDevice = createPortalDeviceCapability(requestConfig => call(PORTAL_DEVICE_PAGE_PATH, requestConfig as PortalRequestConfig), config.portalDevice)
  const hrOrganizationType = createHrOrganizationTypeCapability(
    requestConfig => call(HR_ORGANIZATION_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig),
    <T>(requestConfig: PortalRequestConfig) => trackRequest(
      http.request(requestConfig as never) as unknown as Promise<T>,
      requestConfig,
    ),
  )
  const hrOrganizationProperty = createHrOrganizationPropertyCapability(
    requestConfig => call(HR_ORGANIZATION_PROPERTY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const technologyProjectType = createTechnologyProjectTypeCapability(
    requestConfig => call(TECHNOLOGY_PROJECT_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const technologyTypeTemplateMapping = createTechnologyTypeTemplateMappingCapability(
    requestConfig => call(TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingEnterpriseUsage = createSettingEnterpriseUsageCapability(
    requestConfig => call(SETTING_ENTERPRISE_USAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingSensitiveAction = createSettingSensitiveActionCapability(
    requestConfig => call(SETTING_SENSITIVE_ACTION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingTokenAllocation = createSettingTokenAllocationCapability(
    requestConfig => call(SETTING_TOKEN_ALLOCATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const technologySettingTemplateBase = createTechnologySettingTemplateBaseCapability(
    requestConfig => call(TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const technologySettingTemplate = createTechnologySettingTemplateCapability(
    requestConfig => call(TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeAccountingPeriodBase = createFinanceAccountingPeriodCapability(
    requestConfig => call(FINANCE_ACCOUNTING_PERIOD_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeAccountingPeriod: FinanceAccountingPeriodCapabilityWithIdempotency = {
    ...financeAccountingPeriodBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'finance-accounting-period-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => financeAccountingPeriodBase.prepareCreate(params).draft,
      send: params => financeAccountingPeriodBase.create(params),
    }),
  }
  const financeAccountingManageBase = createFinanceAccountingManageCapability(
    requestConfig => call(FINANCE_ACCOUNTING_MANAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeAccountingManage: FinanceAccountingManageCapabilityWithIdempotency = {
    ...financeAccountingManageBase,
    createIdempotent: withIdempotency<FinanceAccountingManageDraft, Awaited<ReturnType<typeof financeAccountingManageBase.create>>>({
      store: idempotency,
      capabilityId: 'finance-accounting-manage-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => financeAccountingManageBase.prepareCreate(params).draft,
      send: params => financeAccountingManageBase.create(params),
    }),
  }
  const financeLedgerAccountsBase = createFinanceLedgerAccountsCapability(
    requestConfig => call(FINANCE_LEDGER_ACCOUNTS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeLedgerAccounts: FinanceLedgerAccountsCapabilityWithIdempotency = {
    ...financeLedgerAccountsBase,
    createIdempotent: withIdempotency<FinanceLedgerAccountDraft, Awaited<ReturnType<typeof financeLedgerAccountsBase.create>>>({
      store: idempotency,
      capabilityId: 'finance-ledger-account-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => financeLedgerAccountsBase.prepareCreate(params).draft,
      send: params => financeLedgerAccountsBase.create(params),
    }),
    importIdempotent: withIdempotency<FinanceLedgerAccountFileInput, true>({
      store: idempotency,
      capabilityId: 'finance-ledger-account-import',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => financeLedgerAccountsBase.prepareImport(params),
      send: params => financeLedgerAccountsBase.importFile(params),
    }),
  }
  const financeSettingAccuracyBase = createFinanceSettingAccuracyCapability(
    requestConfig => call(FINANCE_SETTING_ACCURACY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingAccuracy: FinanceSettingAccuracyCapabilityWithIdempotency = {
    ...financeSettingAccuracyBase,
    createIdempotent: withIdempotency<FinanceSettingAccuracyCreateDraft, Awaited<ReturnType<typeof financeSettingAccuracyBase.create>>>({
      store: idempotency,
      capabilityId: 'finance-setting-accuracy-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => financeSettingAccuracyBase.prepareCreate(params).draft,
      send: params => financeSettingAccuracyBase.create(params),
    }),
  }
  const financeAllocationIndicator = createFinanceAllocationIndicatorCapability(
    requestConfig => call(FINANCE_ALLOCATION_INDICATOR_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingAnnualCarryforward = createFinanceSettingAnnualCarryforwardCapability(
    requestConfig => call(FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingCatConfig = createFinanceSettingCatConfigCapability(
    requestConfig => call(FINANCE_SETTING_CAT_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingCatMap = createFinanceSettingCatMapCapability(
    requestConfig => call(FINANCE_SETTING_CAT_MAP_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingDateConfig = createFinanceSettingDateConfigCapability(
    requestConfig => call(FINANCE_SETTING_DATE_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingMonthlyIncomeTimeConfig = createFinanceSettingMonthlyIncomeTimeConfigCapability(
    requestConfig => call(FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingProject = createFinanceSettingProjectCapability(
    requestConfig => call(FINANCE_SETTING_PROJECT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingReceivingAccount = createFinanceSettingReceivingAccountCapability(
    requestConfig => call(FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingRelatedPartySettlementAccount = createFinanceSettingRelatedPartySettlementAccountCapability(
    requestConfig => call(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingSaleAllocationCoefficient = createFinanceSettingSaleAllocationCoefficientCapability(
    requestConfig => call(FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingAllocationRules = createFinanceSettingAllocationRulesCapability(
    requestConfig => call(FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingCostCenter = createFinanceSettingCostCenterCapability(
    requestConfig => call(FINANCE_SETTING_COST_CENTER_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
    const financeSettingEmployeeLoanAmount = createFinanceSettingEmployeeLoanAmountCapability(
      requestConfig => call(FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingInitialManage = createFinanceSettingInitialManageCapability(
      requestConfig => call(FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingOpeningSupplierBase = createFinanceSettingOpeningSupplierCapability(
      requestConfig => call(FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingOpeningSupplier: FinanceSettingOpeningSupplierCapabilityWithIdempotency = {
      ...financeSettingOpeningSupplierBase,
      createIdempotent: withIdempotency<{ draft: FinanceSettingOpeningSupplierSaveDraft }, Awaited<ReturnType<typeof financeSettingOpeningSupplierBase.create>>, FinanceSettingOpeningSupplierSaveDraft>({
        store: idempotency,
        capabilityId: 'finance-setting-opening-supplier-create',
        identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
        payload: params => financeSettingOpeningSupplierBase.prepareCreate(params.draft).draft,
        send: (_params, { payload }) => financeSettingOpeningSupplierBase.create({ draft: payload }),
      }),
    }
    const financeSettingFeePurpose = createFinanceSettingFeePurposeCapability(
      requestConfig => call(FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingInventoryAccount = createFinanceSettingInventoryAccountCapability(
      requestConfig => call(FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingLivestockAmortization = createFinanceSettingLivestockAmortizationCapability(
      requestConfig => call(FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH, requestConfig as PortalRequestConfig),
    )
    const financeSettingSettlementSetting = createFinanceSettingSettlementSettingCapability(
    requestConfig => call(FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const financeSettingVoucherTemplates = createFinanceSettingVoucherTemplatesCapability(
    requestConfig => call(FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const fundSalaryFundCosts = createFundSalaryFundCostsCapability(
    requestConfig => call(FUND_COST_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const fundSalaryFundProcess = createFundSalaryFundProcessCapability(
    requestConfig => call(FUND_SALARY_FUND_PROCESS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const insuranceSalaryInsuranceCosts = createInsuranceSalaryInsuranceCostsCapability(
    requestConfig => call(INSURANCE_COST_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const insuranceSalaryInsuranceProcess = createInsuranceSalaryInsuranceProcessCapability(
    requestConfig => call(INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const manageCostCenter = createManageCostCenterCapability(
    requestConfig => call(MANAGE_COST_CENTER_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const salaryItem = createSalaryItemCapability(
    requestConfig => call(SALARY_ITEM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const mePayRoll = createMePayRollCapability(
    requestConfig => call(ME_PAY_ROLL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformCategoryDict = createPlatformCategoryDictCapability(
    requestConfig => call(PLATFORM_CATEGORY_DICT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingCategoryDict = createSettingCategoryDictCapability(
    requestConfig => call(SETTING_CATEGORY_DICT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const orgCorporation = createOrgCorporationCapability(
    requestConfig => call(ORG_CORPORATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrOrganizationSetting = createHrOrganizationSettingCapability(
    requestConfig => call(HR_ORGANIZATION_SETTING_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrOrganizationChart = createHrOrganizationChartCapability(
    requestConfig => call(HR_ORGANIZATION_CHART_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrTransferInPlan = createHrTransferInPlanCapability(
    requestConfig => call(HR_TRANSFER_IN_PLAN_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemCustom = createPlatformSystemCustomCapability(
    requestConfig => call(PLATFORM_SYSTEM_CUSTOM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemSecurityConfig = createPlatformSystemSecurityConfigCapability(
    requestConfig => call(PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemQueueStorage = createPlatformSystemQueueStorageCapability(
    requestConfig => call(PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemEmail = createPlatformSystemEmailCapability(
    requestConfig => call(PLATFORM_SYSTEM_EMAIL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemQueueExport = createPlatformSystemQueueExportCapability(
    requestConfig => call(PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemQueueFailed = createPlatformSystemQueueFailedCapability(
    requestConfig => call(PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemQueueMysql = createPlatformSystemQueueMysqlCapability(
    requestConfig => call(PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformSystemSchedule = createPlatformSystemScheduleCapability(
    requestConfig => call(PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportBankPay = createReportBankPayCapability(
    requestConfig => call(REPORT_BANK_PAY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportBankSummary = createReportBankSummaryCapability(
    requestConfig => call(REPORT_BANK_SUMMARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportCenterInsurance = createReportCenterInsuranceCapability(
    requestConfig => call(REPORT_CENTER_INSURANCE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportCostCenterSalary = createReportCostCenterSalaryCapability(
    requestConfig => call(REPORT_COST_CENTER_SALARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportDepartmentSalaryDetail = createReportDepartmentSalaryDetailCapability(
    requestConfig => call(REPORT_DEPARTMENT_SALARY_DETAIL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportDepartmentSalary = createReportDepartmentSalaryCapability(
    requestConfig => call(REPORT_DEPARTMENT_SALARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportFundPaymentSummary = createReportFundPaymentSummaryCapability(
    requestConfig => call(REPORT_FUND_PAYMENT_SUMMARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportInsurancePaymentSummary = createReportInsurancePaymentSummaryCapability(
    requestConfig => call(REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportPersonTax = createReportPersonTaxCapability(
    requestConfig => call(REPORT_PERSON_TAX_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportPostSalary = createReportPostSalaryCapability(
    requestConfig => call(REPORT_POST_SALARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportConfiguration = createReportConfigurationCapability(
    requestConfig => call(REPORT_CONFIGURATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportStandardUnitInsurance = createReportStandardUnitInsuranceCapability(
    requestConfig => call(REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportRetirementSalarySummary = createReportRetirementSalarySummaryCapability(
    requestConfig => call(REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportTemporarySalarySummary = createReportTemporarySalarySummaryCapability(
    requestConfig => call(REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportTemporarySalary = createReportTemporarySalaryCapability(
    requestConfig => call(REPORT_TEMPORARY_SALARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportRetirementSalary = createReportRetirementSalaryCapability(
    requestConfig => call(REPORT_RETIREMENT_SALARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportSalaryBill = createReportSalaryBillCapability(
    requestConfig => call(REPORT_SALARY_BILL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportSalaryCost = createReportSalaryCostCapability(
    requestConfig => call(REPORT_SALARY_COST_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const reportLaborCostAllocation = createReportLaborCostAllocationCapability(
    requestConfig => call(REPORT_LABOR_COST_ALLOCATION_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const reportLeadershipProfitSalary = createReportLeadershipProfitSalaryCapability(
    requestConfig => call(REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const reportUnitInterferenceCostAllocation = createReportUnitInterferenceCostAllocationCapability(
    requestConfig => call(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const reportSalaryItem = createReportSalaryItemCapability(
    requestConfig => call(REPORT_SALARY_ITEM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const salaryProcess = createSalaryProcessCapability(
    requestConfig => call(SALARY_PROCESS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const salaryAccounting = createSalaryAccountingCapability(
    requestConfig => call(SALARY_ACCOUNTING_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const salaryPackage = createSalaryPackageCapability(
    requestConfig => call(SALARY_PACKAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const salaryAdjustImport = createSalaryAdjustImportCapability(
    requestConfig => call(SALARY_ADJUST_IMPORT_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const salaryPersonTaxFile = createSalaryPersonTaxFileCapability(
    requestConfig => call(SALARY_PERSON_TAX_FILE_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const salaryPersonTaxHandle = createSalaryPersonTaxHandleCapability(
    requestConfig => call(SALARY_PERSON_TAX_HANDLE_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const salaryPersonTax = createSalaryPersonTaxCapability(
    requestConfig => call(SALARY_PERSON_TAX_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const salaryLevel = createSalaryLevelCapability(
    requestConfig => call(SALARY_LEVEL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const saleSettingDict = createSaleSettingDictCapability(
    requestConfig => call(SALE_SETTING_DICT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const saleSysDict = createSaleSysDictCapability(
    requestConfig => call(SALE_SYS_DICT_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'crm' } as PortalRequestConfig),
  )
  const saleCcbAccount = createSaleCcbAccountCapability(
    requestConfig => call(SALE_CCB_ACCOUNT_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'crm' } as PortalRequestConfig),
  )
  const salePaymentAccount = createSalePaymentAccountCapability(
    requestConfig => call(SALE_PAYMENT_ACCOUNT_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleSysOffice = createSaleSysOfficeCapability(
    requestConfig => call(SALE_SYS_OFFICE_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleSysUser = createSaleSysUserCapability(
    requestConfig => call(SALE_SYS_USER_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleClaimSetting = createSaleClaimSettingCapability(
    requestConfig => call(SALE_CLAIM_SETTING_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleOldChickenSale = createSaleOldChickenSaleCapability(
    requestConfig => call(SALE_OLD_CHICKEN_SALE_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const salePriceControl = createSalePriceControlCapability(
    requestConfig => call(SALE_PRICE_CONTROL_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleLowPrice = createSaleLowPriceCapability(
    requestConfig => call(SALE_LOW_PRICE_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleServiceSubject = createSaleServiceSubjectCapability(
    requestConfig => call(SALE_SERVICE_SUBJECT_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'platform' } as PortalRequestConfig),
  )
  const saleTradeStoreroom = createSaleTradeStoreroomCapability(
    requestConfig => call(SALE_TRADE_STOREROOM_PAGE_PATH, { ...requestConfig, httpInstance: requestConfig.httpInstance ?? 'crm' } as PortalRequestConfig),
  )
  const saleScheduleJob = createSaleScheduleJobCapability(
    requestConfig => call(SALE_SCHEDULE_JOB_PAGE_PATH, { ...requestConfig, httpInstance: 'crm' } as PortalRequestConfig),
  )
  const saleScheduleJobLog = createSaleScheduleJobLogCapability(
    requestConfig => call(SALE_SCHEDULE_JOB_LOG_PAGE_PATH, { ...requestConfig, httpInstance: 'crm' } as PortalRequestConfig),
  )
  const saleRegisterCode = createSaleRegisterCodeCapability(
    requestConfig => call(SALE_REGISTER_CODE_PAGE_PATH, { ...requestConfig, httpInstance: 'crm' } as PortalRequestConfig),
  )
  const settingDictPlatform = createSettingDictPlatformCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformDictMall = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformDictMallCommon = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_COMMON_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_COMMON_SYSTEM },
  )
  const platformDictMallFinance = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_FINANCE_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_FINANCE_SYSTEM },
  )
  const platformDictMallHr = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_HR_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_HR_SYSTEM },
  )
  const platformDictMallMaterial = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_MATERIAL_SYSTEM },
  )
  const platformDictMallProduct = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_PRODUCT_SYSTEM },
  )
  const platformDictMallSale = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_SALE_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_SALE_SYSTEM },
  )
  const platformDictMallSupply = createPlatformDictMallCapability(
    requestConfig => call(PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH, requestConfig as PortalRequestConfig),
    { fixedUseSystem: PLATFORM_DICT_MALL_SUPPLY_SYSTEM },
  )
  const settingFrontendLog = createSettingFrontendLogCapability(
    requestConfig => call(SETTING_FRONTEND_LOG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingMaterial = createSettingMaterialCapability(
    requestConfig => call(SETTING_MATERIAL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingMenu = createSettingMenuCapability(
    requestConfig => call(SETTING_MENU_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingSupplier = createSettingSupplierCapability(
    requestConfig => call(SETTING_SUPPLIER_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingSystemAccountingParameters = createSettingSystemAccountingParametersCapability(
    requestConfig => call(SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const systemIntegration = createSystemIntegrationCapability(
    requestConfig => call(SYSTEM_INTEGRATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingRolePost = createSettingRolePostCapability(
    requestConfig => call(SETTING_ROLE_POST_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingRoleBase = createSettingRoleCapability(
    requestConfig => call(SETTING_ROLE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const settingRole: SettingRoleCapabilityWithIdempotency = {
    ...settingRoleBase,
    createIdempotent: withIdempotency<{ draft: SettingRoleDraft }, Awaited<ReturnType<typeof settingRoleBase.create>>, SettingRoleDraft>({
      store: idempotency,
      capabilityId: 'setting-role-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => settingRoleBase.prepareCreate({ form: params.draft }).draft,
      send: (_params, { payload }) => settingRoleBase.create({ draft: payload }),
    }),
  }
  const settingUser = createSettingUserCapability(
    requestConfig => call(SETTING_USER_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrExternalStaff = createHrExternalStaffCapability(
    requestConfig => call(HR_EXTERNAL_STAFF_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrInternalStaff = createHrInternalStaffCapability(
    requestConfig => call(HR_INTERNAL_STAFF_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const historyArchive = createHistoryArchiveCapability(
    requestConfig => call(HISTORY_ARCHIVE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const meOrganization = createMeOrganizationCapability(
    requestConfig => call(ME_ORGANIZATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const mePersonal = createMePersonalCapability(
    requestConfig => call(ME_PERSONAL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const recruitmentPlan = createRecruitmentPlanCapability(
    requestConfig => call(RECRUITMENT_PLAN_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const myTodoUrge = createMyTodoUrgeCapability(
    requestConfig => call(MY_TODO_URGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const myUrge = createMyUrgeCapability(
    requestConfig => call(MY_URGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const contractCodeRule = createContractCodeRuleCapability(
    requestConfig => call(CONTRACT_CODE_RULE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const supplyPersonnelConfig = createSupplyPersonnelConfigCapability(
    requestConfig => call(SUPPLY_PERSONNEL_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryOrganizationConfig = createInventoryOrganizationConfigCapability(
    requestConfig => call(INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryAssetDepreciationConfig = createInventoryAssetDepreciationConfigCapability(
    requestConfig => call(INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryStockRule = createInventoryStockRuleCapability(
    requestConfig => call(INVENTORY_STOCK_RULE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryStockLocation = createInventoryStockLocationCapability(
    requestConfig => call(INVENTORY_STOCK_LOCATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryApprovalConfig = createInventoryApprovalConfigCapability(
    requestConfig => call(INVENTORY_APPROVAL_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryAssetStocktakingConfig = createInventoryAssetStocktakingConfigCapability(
    requestConfig => call(INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryAssetBatchConfig = createInventoryAssetBatchConfigCapability(
    requestConfig => call(INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const inventoryValuation = createInventoryValuationCapability(
    requestConfig => call(INVENTORY_VALUATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const platformRuleManagement = createPlatformRuleManagementCapability(
    requestConfig => call(PLATFORM_RULE_MANAGEMENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const hrPostSetting = createHrPostSettingCapability(
    requestConfig => call(HR_POST_SETTING_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const productHighProductionUsage = createProductHighProductionUsageCapability(
    requestConfig => call(PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productStableProductionUsage = createProductStableProductionUsageCapability(
    requestConfig => call(PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productPreventionUsageAnalysis = createProductPreventionUsageAnalysisCapability(
    requestConfig => call(PRODUCT_PREVENTION_USAGE_ANALYSIS_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productUserAnalysis = createProductUserAnalysisCapability(
    requestConfig => call(PRODUCT_USER_ANALYSIS_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productNoticeConfig = createProductNoticeConfigCapability(
    requestConfig => call(PRODUCT_NOTICE_CONFIG_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productProgramLibrary = createProductProgramLibraryCapability(
    requestConfig => call(PRODUCT_PROGRAM_LIBRARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const productProgramLibraryNew = createProductProgramLibraryCapability(
    requestConfig => call(PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const productSettingMaterial = createProductSettingMaterialCapability(
    requestConfig => call(PRODUCT_SETTING_MATERIAL_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingMedicine = createProductSettingMedicineCapability(
    requestConfig => call(PRODUCT_SETTING_MEDICINE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingUserDict = createProductSettingUserDictCapability(
    requestConfig => call(PRODUCT_SETTING_USER_DICT_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingVaccine = createProductSettingVaccineCapability(
    requestConfig => call(PRODUCT_SETTING_VACCINE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingAntibody = createProductSettingAntibodyCapability(
    requestConfig => call(PRODUCT_SETTING_ANTIBODY_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingChickenProduction = createProductSettingChickenProductionCapability(
    requestConfig => call(PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingEggStandardAgeStage = createProductSettingEggStandardAgeStageCapability(
    requestConfig => call(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingEpidemicPreventionCost = createProductSettingEpidemicPreventionCostCapability(
    requestConfig => call(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchAnnualMonthly = createProductSettingHatchAnnualMonthlyCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingStandardBroiler = createProductSettingStandardBroilerCapability(
    requestConfig => call(PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingStandardFlockWeek = createProductSettingStandardFlockWeekCapability(
    requestConfig => call(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingStandardFlock = createProductSettingStandardFlockCapability(
    requestConfig => call(PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingStandardHatch = createProductSettingStandardHatchCapability(
    requestConfig => call(PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingBatchStatus = createProductSettingBatchStatusCapability(
    requestConfig => call(PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingConfigure = createProductSettingConfigureCapability(
    requestConfig => call(PRODUCT_SETTING_CONFIGURE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingDayLiquidation = createProductSettingDayLiquidationCapability(
    requestConfig => call(PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingFunctionUse = createProductSettingFunctionUseCapability(
    requestConfig => call(PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingMaterialMaster = createProductSettingMaterialMasterCapability(
    requestConfig => call(PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingTenantLog = createProductSettingTenantLogCapability(
    requestConfig => call(PRODUCT_SETTING_TENANT_LOG_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchManageLib = createProductSettingHatchManageLibCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productBusinessAgeDivision = createProductBusinessAgeDivisionCapability(
    requestConfig => call(PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productBusinessDataRetransmit = createProductBusinessDataRetransmitCapability(
    requestConfig => call(PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productBusinessSetupMaterialCode = createProductBusinessSetupMaterialCodeCapability(
    requestConfig => call(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryLib = createProductHatcheryLibCapability(
    requestConfig => call(PRODUCT_HATCHERY_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryMethod = createProductHatcheryMethodCapability(
    requestConfig => call(PRODUCT_HATCHERY_METHOD_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryMethodLib = createProductHatcheryMethodLibCapability(
    requestConfig => call(PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryMethodLibIndicator = createProductHatcheryMethodLibIndicatorCapability(
    requestConfig => call(PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryStandardIndicator = createProductHatcheryStandardIndicatorCapability(
    requestConfig => call(PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productHatcheryUnit = createProductHatcheryUnitCapability(
    requestConfig => call(PRODUCT_HATCHERY_UNIT_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productPlanPreview = createProductPlanPreviewCapability(
    requestConfig => call(PRODUCT_PLAN_PREVIEW_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const saleCustomQr = createSaleCustomQrCapability(
    requestConfig => call(SALE_CUSTOM_QR_PAGE_PATH, { ...requestConfig, httpInstance: 'crm' } as PortalRequestConfig),
  )
  const settingDictPlatformFinance = createSettingDictPlatformFinanceCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformCommon = createSettingDictPlatformCommonCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_COMMON_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformHr = createSettingDictPlatformHrCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_HR_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformMaterial = createSettingDictPlatformMaterialCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformProduct = createSettingDictPlatformProductCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformSupply = createSettingDictPlatformSupplyCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const settingDictPlatformSale = createSettingDictPlatformSaleCapability(
    requestConfig => call(SETTING_DICT_PLATFORM_SALE_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const saleVisitRecommendSetting = createSaleVisitRecommendSettingCapability(
    requestConfig => call(SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const productSettingHatchManageMethodLib = createProductSettingHatchManageMethodLibCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchMethodLibIndicator = createProductSettingHatchMethodLibIndicatorCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchManageMethod = createProductSettingHatchManageMethodCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchManageSeason = createProductSettingHatchManageSeasonCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingIndicatorLib = createProductSettingIndicatorLibCapability(
    requestConfig => call(PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const productSettingMethodLib = createProductSettingMethodLibCapability(
    requestConfig => call(PRODUCT_SETTING_METHOD_LIB_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const productSettingSeason = createProductSettingSeasonCapability(
    requestConfig => call(PRODUCT_SETTING_SEASON_PAGE_PATH, { ...requestConfig, httpInstance: 'platform' } as PortalRequestConfig),
  )
  const productSettingHatchManageUnit = createProductSettingHatchManageUnitCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const productSettingHatchManageVariety = createProductSettingHatchManageVarietyCapability(
    requestConfig => call(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH, { ...requestConfig, httpInstance: 'product' } as PortalRequestConfig),
  )
  const attendanceSheetBase = createAttendanceSheetCapability(
    requestConfig => call(ATTENDANCE_SHEET_PAGE, requestConfig as PortalRequestConfig),
    requestConfig => call(ATTENDANCE_SHEET_ARCHIVE_PAGE, requestConfig as PortalRequestConfig),
  )
  const attendanceSheet: AttendanceSheetCapability = {
    ...attendanceSheetBase,
    saveIdempotent: withIdempotency<SheetDraft, void>({
      store: idempotency, capabilityId: 'attendance-sheet-save',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: buildSheetPayload,
      send: draft => attendanceSheetBase.save(draft),
    }),
  }

  const attendanceStatistics = createAttendanceStatisticsCapability((requestConfig) =>
    call(ATTENDANCE_STATISTICS_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const assignmentBase = createAssignmentCapability((requestConfig) =>
    call(ASSIGNMENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 这个页面有四个写操作，**只有 create 需要防重**：另外三个（整单替换的 update、
  // 写绝对值的 setStatus、按 id 删的 remove）重发一次的终态都一样，造不出第二条记录。
  // 理由逐条写在 src/capabilities/assignment.ts 的文件头。
  const assignment: AssignmentCapabilityWithIdempotency = {
    ...assignmentBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'assignment-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // 本地校验放在 payload 里：失败抛在登记之前，不会留下记录，重试天然能过
      payload: (params) => buildAssignmentPayload(params),
      send: (params, { payload }) =>
        assignmentBase.create(payload as unknown as AssignmentDraft),
    }),
  }

  const attendanceShiftBase = createAttendanceShiftCapability((requestConfig) =>
    call(ATTENDANCE_SHIFT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 与作业管理同样的分工：五个写操作里**只有 create** 需要防重。另外四个
  // （整单替换的 update、按 id 删的 remove、写绝对值的 setStatus…）重发一次终态相同，
  // 造不出第二条记录。理由逐条写在 src/capabilities/attendance-shift.ts 的文件头。
  const attendanceShift: AttendanceShiftCapabilityWithIdempotency = {
    ...attendanceShiftBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'attendance-shift-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // 本地校验放在 payload 里——校验失败抛在登记之前，不会留下记录，重试天然能过
      payload: (params) => buildShiftPayload(params),
      send: (params, { payload }) =>
        attendanceShiftBase.create(payload as unknown as AttendanceShiftDraft),
    }),
  }

  // 只读一页：没有写操作，所以没有带防重的那一层
  const backlogTaskExamine = createBacklogTaskExamineCapability((requestConfig) =>
    call(BACKLOG_TASK_EXAMINE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const baseImageBase = createBaseImageCapability((requestConfig) =>
    call(BASE_IMAGE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 这一页有五个写操作，**只有那两个会产生新记录的**（create 与 createRelease）需要防重：
  // update 是部分更新、setStatus 写的是绝对值、remove 按 id 删，重发一次终态都一样。
  // 理由逐条写在 src/capabilities/base-image.ts 的文件头。
  //
  // 这里不给 payload：剥离 requestId 之后剩下的就是 { name, url }，正是要发的载荷本身。
  const baseImage: BaseImageCapabilityWithIdempotency = {
    ...baseImageBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'base-image-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      send: (params, { payload }) => baseImageBase.create(payload as unknown as BaseImageDraft),
    }),
    createReleaseIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'base-image-create-release',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      send: (params, { payload }) => baseImageBase.createRelease(payload as unknown as BaseImageDraft),
    }),
  }

  const attendanceTeamBase = createAttendanceTeamCapability((requestConfig) =>
    call(ATTENDANCE_TEAM_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 一个页面两条数据线，但只有 create 需要防重：scheduleSave 是**整份覆盖写**
  // （不是增量、不是 toggle），重发一次终态相同。理由写在能力文件头部。
  const attendanceTeam: AttendanceTeamCapabilityWithIdempotency = {
    ...attendanceTeamBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'attendance-team-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => buildGroupPayload(params),
      send: (params, { payload }) =>
        attendanceTeamBase.create(payload as unknown as AttendanceTeamDraft),
    }),
  }

  const baseManagementCenterBase = createBaseManagementCenterCapability((requestConfig) =>
    call(BASE_MANAGEMENT_CENTER_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 只有 create 需要防重：update 只改名字、setStatus 写绝对值、remove 按 id 删，
  // 重发一次终态都一样。checkStatus 是只读的，本来就不在这条线上。
  const baseManagementCenter: BaseManagementCenterCapabilityWithIdempotency = {
    ...baseManagementCenterBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'base-management-center-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => buildManagementCenterPayload(params),
      send: (params, { payload }) =>
        baseManagementCenterBase.create(payload as unknown as ManagementCenterDraft),
    }),
  }

  const contractTemplateBase = createContractTemplateCapability((requestConfig) =>
    call(CONTRACT_TEMPLATE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const contractTemplate: ContractTemplateCapabilityWithIdempotency = {
    ...contractTemplateBase,
    createIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'contract-template-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => buildTemplatePayload(params),
      send: (params, { payload }) =>
        contractTemplateBase.create(payload as unknown as ContractTemplateDraft),
    }),
  }

  const contractLibrary = createContractLibraryCapability((requestConfig) =>
    call(CONTRACT_LIBRARY_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const contractCreateBase = createContractCreateCapability((requestConfig) =>
    call(CONTRACT_CREATE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )
  const contractCreate: ContractCreateCapabilityWithIdempotency = {
    ...contractCreateBase,
    createIdempotent: withIdempotency<{ draft: ContractCreateDraft }, Awaited<ReturnType<typeof contractCreateBase.create>>, ContractCreateDraft>({
      store: idempotency,
      capabilityId: 'contract-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: params => normalizeContractCreateDraft(params.draft),
      send: (_params, { payload }) => contractCreateBase.create({ draft: payload }),
    }),
  }

  // 基础数据：三个接口的页面上下文推导结果完全相同（module-type 都是 null、实例都是 platform），
  // 所以共用一个合成路径就够；它不指向任何菜单（见 docs/plan.json 的「队列之外」）。
  // `request` 必须是**泛型箭头**：`BaseDataRequest` 是泛型签名，写成非泛型会在 typecheck 报错。
  const baseData = createBaseDeptDictPermission({
    request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
      call<T>(BASE_DEPT_LIST_PATH, requestConfig as PortalRequestConfig),
  })
  invalidateBaseData = baseData.invalidate

  // 上传：凭据没配也给一份能力（**工厂建的时候不校验**，否则没配 OSS 的调用方连 SDK 都建不起来）；
  // 真要上传时在发请求之前以 OssCredentialError 失败关闭。
  const baseUpload = createBaseUploadCapability(config.oss ?? {})

  const generalApprovalBase = createGeneralApprovalCapability((requestConfig) =>
    call(GENERAL_APPROVAL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 只有 submit 需要防重：definition/prepare/detail/my-instances 是只读，cancel 按 id 撤销
  // （重发最多是一次"已取消"的业务报错，造不出第二条单据）。
  const generalApproval: GeneralApprovalCapabilityWithIdempotency = {
    ...generalApprovalBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'general-approval-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => buildGeneralApprovalPayload(params),
      send: (params, { payload }) =>
        generalApprovalBase.submit(
          payload as unknown as GeneralApprovalDraft,
          params.startUserSelectAssignees ?? {},
        ),
    }),
  }

  const leaveApplicationBase = createLeaveApplicationCapability((requestConfig) =>
    call(LEAVE_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 只有 submit 需要防重（其余是只读联动或按 id 撤销）
  const leaveApplication: LeaveApplicationCapabilityWithIdempotency = {
    ...leaveApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'leave-application-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // **刻意不给 payload**：`buildLeavePayload(draft, profile, restDay)` 要三个参数，
      // 后两个得先打两次网络（profile / duration），而 payload 构建器是同步的、在写之前跑。
      // 剥掉 requestId 之后剩下的就是草稿本身，正是要发的载荷；真正的校验在 submit 内部做。
      send: (params, { payload }) =>
        leaveApplicationBase.submit(
          payload as unknown as LeaveDraft,
          params.startUserSelectAssignees ?? {},
        ),
    }),
  }

  const vehicleApplicationBase = createVehicleApplicationCapability((requestConfig) =>
    call(VEHICLE_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const vehicleApplication: VehicleApplicationCapabilityWithIdempotency = {
    ...vehicleApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'vehicle-application-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // 本地校验放在 payload 里：失败抛在登记之前，不会留下记录，重试天然能过
      payload: (params) => buildVehicleApplicationPayload(params),
      send: (params, { payload }) =>
        vehicleApplicationBase.submit(
          payload as unknown as VehicleApplicationDraft,
          params.startUserSelectAssignees ?? {},
        ),
    }),
  }

  const contractSupport = createContractSupport({
    performanceRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.performance, c as PortalRequestConfig),
    hrRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.hr, c as PortalRequestConfig),
    contractRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.contract, c as PortalRequestConfig),
    platformRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.platform, c as PortalRequestConfig),
    learningRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.learning, c as PortalRequestConfig),
    learningCourseRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.learning, { ...(c as object), httpInstance: 'smart-layer-app' } as PortalRequestConfig),
    financeRequest: (c) => call(CONTRACT_SUPPORT_CONTEXTS.finance, c as PortalRequestConfig),
  })

  const travelExpenseBase = createTravelExpenseCapability((requestConfig) =>
    call(TRAVEL_EXPENSE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const travelExpense: TravelExpenseCapabilityWithIdempotency = {
    ...travelExpenseBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'travel-expense-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // 本地校验放在 payload 里：失败抛在登记之前，不会留下记录，重试天然能过
      // （`buildTravelPayload` 的后两个参数可选，这里只给草稿）
      payload: (params) => buildTravelPayload(params),
      send: (params, { payload }) =>
        travelExpenseBase.submit(payload as unknown as TravelExpenseDraft),
    }),
  }

  const productDesignApprovalBase = createProductDesignApprovalCapability((requestConfig) =>
    call(PRODUCT_DESIGN_APPROVAL_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const productDesignApproval: ProductDesignApprovalCapabilityWithIdempotency = {
    ...productDesignApprovalBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'product-design-approval-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => buildProductDesignApprovalPayload(params),
      send: (params, { payload }) =>
        productDesignApprovalBase.submit(
          payload as unknown as ProductDesignApprovalDraft,
          params.startUserSelectAssignees ?? {},
        ),
    }),
  }

  const taskActionBase = createTaskActionCapability(
    (requestConfig) => call(TASK_ACTION_DETAIL_PAGE_PATH, requestConfig as PortalRequestConfig),
    (requestConfig) => call(TASK_ACTION_BATCH_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 七个写能力全部带防重（办理天然不该重放）；target 取 taskId，批量取 ids
  const taskActionIdentity = () => ({
    userId: config.userId,
    tenantId: config.credential.tenantId,
  })
  // 单条办理用 taskId、批量用 ids；`withIdempotency` 的 target 只收标量
  const taskActionTarget = (params: Record<string, unknown>): string | number | undefined =>
    (params.taskId ?? params.ids) as string | number | undefined
  const taskAction: TaskActionCapabilityWithIdempotency = {
    ...taskActionBase,
    approveIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-approve', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.approve(payload as never),
    }),
    rejectIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-reject', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.reject(payload as never),
    }),
    transferIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-transfer', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.transfer(payload as never),
    }),
    delegateIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-delegate', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.delegate(payload as never),
    }),
    returnIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-return', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.returnTask(payload as never),
    }),
    batchApproveIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-batch-approve', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.batchApprove(payload as never),
    }),
    batchRejectIdempotent: withIdempotency({
      store: idempotency, capabilityId: 'task-action-batch-reject', identity: taskActionIdentity,
      target: taskActionTarget,
      send: (params, { payload }) => taskActionBase.batchReject(payload as never),
    }),
  }

  const overtimeApplicationBase = createOvertimeApplicationCapability((requestConfig) =>
    call(OVERTIME_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const overtimeApplication: OvertimeApplicationCapabilityWithIdempotency = {
    ...overtimeApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'overtime-application-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // **刻意不给 payload**：`buildOvertimeApplicationPayload(derived, draft)` 要两个参数，
      // derived 得先打网络（当前用户 + 审批链预览），而 payload 构建器是同步的、在写之前跑。
      // 剥掉 requestId 后剩下的就是草稿，真正的校验与派生在 submit 内部做。
      send: (params, { payload }) =>
        overtimeApplicationBase.submit(payload as unknown as OvertimeApplicationDraft),
    }),
  }

  const restLeaveApplicationBase = createRestLeaveApplicationCapability((requestConfig) =>
    call(REST_LEAVE_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const restLeaveApplication: RestLeaveApplicationCapabilityWithIdempotency = {
    ...restLeaveApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'rest-leave-application-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // **刻意不给 payload**：`buildRestLeaveApplicationPayload(derived, draft)` 要两个参数，
      // derived 得先打网络，而 payload 构建器是同步的、在写之前跑。校验与派生在 submit 内部做。
      send: (params, { payload }) =>
        restLeaveApplicationBase.submit(payload as unknown as RestLeaveApplicationDraft),
    }),
  }

  const businessTripApplicationBase = createBusinessTripApplicationCapability((requestConfig) =>
    call(BUSINESS_TRIP_APPLICATION_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  const businessTripApplication: BusinessTripApplicationCapabilityWithIdempotency = {
    ...businessTripApplicationBase,
    submitIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'business-trip-application-submit',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      // **刻意不给 payload**：`buildBusinessTripPayload(derived, draft)` 要两个参数，
      // derived 得先打网络，而 payload 构建器是同步的、在写之前跑。校验与派生在 submit 内部做。
      send: (params, { payload }) =>
        businessTripApplicationBase.submit(payload as unknown as BusinessTripApplicationDraft),
    }),
  }

  // 课程管理三页：**多个页面共用一个实现**，页面上下文取图文课程那一页
  // （三页的 module-type 推导结果相同，都是 12 学习管理；http 实例也都是 platform）
  const studyCourse = createStudyCourseCapability((requestConfig) =>
    call(STUDY_COURSE_TEXT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 学员管理：与列表同页的还有一个「是否已在班里」的只读前置
  const studyStudent = createStudyStudentCapability((requestConfig) =>
    call(STUDY_STUDENT_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 班级管理
  const studyGrade = createStudyGradeCapability((requestConfig) =>
    call(STUDY_GRADE_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 课堂三页：**每页一个 request**，module-type 才按各自的页面解析
  const studyLesson = createStudyLessonCapability(
    (c) => call(STUDY_LESSON_DAILY_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_LESSON_WEEKLY_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_LESSON_MONTHLY_PAGE_PATH, c as PortalRequestConfig),
  )

  // 学习管理（学习记录列表）
  const studyRecord = createStudyRecordCapability((requestConfig) =>
    call(STUDY_RECORD_PAGE_PATH, requestConfig as PortalRequestConfig),
  )

  // 数据统计五页：同样每页一个 request
  const studyStatistics = createStudyStatisticsCapability(
    (c) => call(STUDY_STATISTICS_STUDENT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_STATISTICS_TEACHER_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_STATISTICS_LESSON_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_STATISTICS_GRADE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_STATISTICS_LEARNING_PAGE_PATH, c as PortalRequestConfig),
  )

  // 讲师三页：前两页走 smart-layer-admin 实例（要调用方配 baseURL），第三页走 platform
  const studyTeacher = createStudyTeacherCapability(
    // 讲师管理 / 讲师类型的**列表**打的是 `.lay` 接口，在 **smart-layer-admin** 实例上，
    // 且页面用 `isOriginal: true` 拿整个响应体；而这两页的删除等接口仍在 platform 上。
    // **实例逐请求指定**，不挂页面级规则 —— `http-instance.ts` 的 `isPageShapedPath`
    // 注释里写着这条道理："同一次页面操作里可能有多个实例，所以实例必须能逐请求指定，
    // 不能只当页面属性"。没配 baseURL 时前两个会**失败关闭**（conventions 27）。
    (c) => call(STUDY_TEACHER_PAGE_PATH, { ...(c as object), httpInstance: STUDY_TEACHER_HTTP_INSTANCE, isOriginal: true } as PortalRequestConfig),
    (c) => call(STUDY_TEACHER_LEVEL_PAGE_PATH, { ...(c as object), httpInstance: STUDY_TEACHER_HTTP_INSTANCE, isOriginal: true } as PortalRequestConfig),
    // 评价设置走的是 **platform**（`/admin-api/study/base/...`），不加 httpInstance、也不 isOriginal
    (c) => call(STUDY_APPRAISE_SETTING_PAGE_PATH, c as PortalRequestConfig),
  )

  // 绩效·协议类五页（状态变更 / 个人月度 / 所辖月度 / 个人年度 / 所辖年度）
  const perfAgreement = createPerfAgreementCapability(
    (c) => call(PERF_AGREEMENT_CHANGE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH, c as PortalRequestConfig),
  )

  // 绩效·配置类六页（公式配置 / 指标管理 / 五险一金 / 标准管理 / 时间节点 / 考核规则）
  const perfManageConfig = createPerfManageConfigCapability(
    (c) => call(PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MANAGE_INDICATOR_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MANAGE_INSURANCE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MANAGE_STANDARD_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH, c as PortalRequestConfig),
  )

  // 绩效·模板/任务类六页（利润管理 / 薪资结构 / 模板内容 / 模板结构 / 学习任务配置 / 任务类型配置）
  const perfManageTemplate = createPerfManageTemplateCapability(
    (c) => call(PROFIT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(SALARY_STRUCTURE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(TEMPLATE_CONTENT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(TEMPLATE_STRUCTURE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(STUDY_TASK_CONFIG_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(TASK_TYPE_CONFIG_PAGE_PATH, c as PortalRequestConfig),
  )

  // 绩效·薪酬与分析六页（奖励导入 / 工资找齐 / 考核导入 / 组件管理 / 管理分析 / 个人分析）
  const perfSalaryBase = createPerfSalaryCapability(
    (c) => call(PERF_SALARY_MAIN_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_SALARY_ADJUST_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_SALARY_EXAMINE_RESULT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_BLOCK_MAIN_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_ANALYSIS_DEPARTMENT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(PERF_ANALYSIS_PERSON_PAGE_PATH, c as PortalRequestConfig),
  )
  const perfSalary: PerfSalaryCapabilityWithIdempotency = {
    ...perfSalaryBase,
    importSalaryMainIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-main-import',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => {
        perfSalaryBase.prepareSalaryMainImport(params)
        return params
      },
      send: (params) => perfSalaryBase.importSalaryMain(params),
    }),
    saveSalaryAdjustIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-adjust-save',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => perfSalaryBase.prepareSalaryAdjust(params).draft,
      send: (_params, { payload }) => perfSalaryBase.saveSalaryAdjust(payload),
    }),
    createSalaryExamineResultIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-examine-result-create',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => perfSalaryBase.prepareSalaryExamineResultCreate(params).draft,
      send: (_params, { payload }) => perfSalaryBase.createSalaryExamineResult(payload as Parameters<typeof perfSalaryBase.createSalaryExamineResult>[0]),
    }),
    updateSalaryExamineResultIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-examine-result-update',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => perfSalaryBase.prepareSalaryExamineResultUpdate(params).draft,
      send: (_params, { payload }) => perfSalaryBase.updateSalaryExamineResult(payload as Parameters<typeof perfSalaryBase.updateSalaryExamineResult>[0]),
    }),
    removeSalaryExamineResultIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-examine-result-remove',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => perfSalaryBase.prepareSalaryExamineResultRemove(params),
      send: (_params, { payload }) => perfSalaryBase.removeSalaryExamineResult(payload),
    }),
    importSalaryExamineResultIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-salary-examine-result-import',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => {
        perfSalaryBase.prepareSalaryExamineResultImport(params)
        return params
      },
      send: (params) => perfSalaryBase.importSalaryExamineResult(params),
    }),
    setBlockStatusIdempotent: withIdempotency({
      store: idempotency,
      capabilityId: 'perf-block-main-set-status',
      identity: () => ({ userId: config.userId, tenantId: config.credential.tenantId }),
      payload: (params) => perfSalaryBase.prepareBlockStatus(params).draft,
      send: (_params, { payload }) => perfSalaryBase.setBlockStatus(payload),
    }),
  }

  // 审批管理·任务四页（发起流程 / 待办任务 / 已办任务 / 抄送我的）
  const flowTask = createFlowTaskCapability(
    (c) => call(FLOW_TASK_CREATE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_TASK_TODO_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_TASK_DONE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_TASK_COPY_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_TASK_MY_PAGE_PATH, c as PortalRequestConfig),
  )

  // 审批管理·流程管理四页（流程模型 / AI审核配置 / 流程实例 / 流程任务）
  const flowManage = createFlowManageCapability(
    (c) => call(FLOW_MANAGE_MODEL_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_MANAGE_INSTANCE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(FLOW_MANAGE_TASK_PAGE_PATH, c as PortalRequestConfig),
  )

  // 人工智能域：**每页一个 request**（各带各的 pagePath，不要合并 —— 合并会让错误归因指错页）。
  // 这 16 页在 module-type 规则表里都匹配不到 ⇒ 与浏览器一致，**不发 `module-type` 头**（conventions 2）。
  const aiKnowledge = createAiKnowledgeCapability(
    (c) => call(AI_KNOWLEDGE_WORKSPACE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_KNOWLEDGE_REVIEW_PAGE_PATH, c as PortalRequestConfig),
  )

  const aiInteractionQa = createAiInteractionQaCapability(
    (c) => call(AI_INTERACTION_HOT_TOPICS_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_INTERACTION_CHAT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_INTERACTION_FEEDBACK_PAGE_PATH, c as PortalRequestConfig),
  )

  const aiModel = createAiModelCapability(
    (c) => call(AI_MODEL_LIST_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_MODEL_SELECT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_PLATFORM_USAGE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_DATA_ANALYSIS_PAGE_PATH, c as PortalRequestConfig),
  )

  const modelUsage = createModelUsageCapability(
    (c) => call(PERSONAL_USAGE_PAGE_PATH, c as PortalRequestConfig),
  )

  const aiPrompt = createAiPromptCapability(
    (c) => call(AI_PROMPT_TYPE_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_PROMPT_SKILL_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_PROMPT_INTENT_PAGE_PATH, c as PortalRequestConfig),
  )

  const aiPromptTool = createAiPromptToolCapability(
    (c) => call(AI_BUSINESS_EVENT_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_OPEN_API_REGISTRY_PAGE_PATH, c as PortalRequestConfig),
    (c) => call(AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH, c as PortalRequestConfig),
  )

  const chat = createChatCapability(
    (c) => call(CHAT_PAGE_PATH, c as PortalRequestConfig),
    async () => baseData.getDict(CHAT_AGENT_ORCHESTRATION_DICT_TYPE),
  )

  // 租户/企业上下文：与基础数据同一套合成上下文
  const baseTenant = createBaseTenant({
    request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
      call<T>(BASE_TENANT_DETAIL_PATH, requestConfig as PortalRequestConfig),
  })
  invalidateBaseTenant = baseTenant.invalidate

  // 销售域基础数据：**显式**绑到 sale 实例（同 host 不同前缀）。没配 baseURL 就给 null，
  // 让能力自己以 SaleNotWiredError 失败关闭——不要拿默认 baseURL 去凑（conventions 第 27 条）。
  const baseSale = createBaseSale({
    saleRequest:
      config.httpBaseUrls?.sale === undefined
        ? null
        : <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
            call<T>(BASE_SALE_SHOP_PATH, {
              ...requestConfig,
              httpInstance: 'sale',
            } as PortalRequestConfig),
  })
  invalidateBaseSale = baseSale.invalidate

  // 应用外壳：与基础数据用同一套合成上下文（都不是菜单路径，见 docs/plan.json 的「队列之外」）
  const baseShell = createBaseShell({
    request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
      call<T>(BASE_SHELL_CONTEXT_ROOT, requestConfig as PortalRequestConfig),
  })
  invalidateBaseShell = baseShell.invalidate

  // 目录索引的就是上面这个数组本身，不是另抄一份。
  // 提成常量而不是写在 return 里：`visibleCatalog()` 也要用它（视图建在它之上，不改它）。
  const catalog = createCatalog({ capabilities: capabilityDefinitions })

  // 通用调用入口与能力方法共用同一份实现（同一个 host、同一张绑定表）
  const capabilities = attachCapabilityInvoker(
    capabilityDefinitions,
    createCapabilityInvoker({
      batch,
      meetingRoom,
      meetingApplication,
      attendanceArchive,
      attendanceAnnualLeave,
      attendanceException,
      attendanceSchedualInformation,
      certificateLicense,
      certificateType,
      institutionType,
      piece,
      businessRegistration,
      companyPolicy,
      honor,
      legalDispute,
      qualification,
      patent,
      software,
      standardDocument,
      trademark,
      attendanceOvertime,
      hrPostType,
      portalDevice,
      attendanceSheet,
      hrOrganizationType,
      hrOrganizationProperty,
      technologyProjectType,
      technologyTypeTemplateMapping,
      settingEnterpriseUsage,
      settingSensitiveAction,
      settingTokenAllocation,
      technologySettingTemplateBase,
      technologySettingTemplate,
      financeAccountingPeriod,
      financeAccountingManage,
      financeLedgerAccounts,
      financeSettingAccuracy,
      financeAllocationIndicator,
      financeSettingAnnualCarryforward,
      financeSettingCatConfig,
      financeSettingCatMap,
      financeSettingDateConfig,
      financeSettingMonthlyIncomeTimeConfig,
      financeSettingProject,
      financeSettingReceivingAccount,
      financeSettingRelatedPartySettlementAccount,
      financeSettingSaleAllocationCoefficient,
      financeSettingAllocationRules,
      financeSettingCostCenter,
          financeSettingEmployeeLoanAmount,
          financeSettingInitialManage,
          financeSettingOpeningSupplier,
          financeSettingFeePurpose,
          financeSettingInventoryAccount,
          financeSettingLivestockAmortization,
          financeSettingSettlementSetting,
      financeSettingVoucherTemplates,
      fundSalaryFundCosts,
      fundSalaryFundProcess,
      insuranceSalaryInsuranceCosts,
      insuranceSalaryInsuranceProcess,
      manageCostCenter,
      salaryItem,
      mePayRoll,
      platformCategoryDict,
      settingCategoryDict,
      orgCorporation,
      hrOrganizationSetting,
      hrOrganizationChart,
      hrTransferInPlan,
      platformSystemCustom,
      platformSystemSecurityConfig,
      platformSystemQueueStorage,
      platformSystemEmail,
      platformSystemQueueExport,
      platformSystemQueueFailed,
      platformSystemQueueMysql,
      platformSystemSchedule,
      reportBankPay,
      reportBankSummary,
      reportCenterInsurance,
      reportCostCenterSalary,
      reportDepartmentSalaryDetail,
      reportDepartmentSalary,
      reportFundPaymentSummary,
      reportInsurancePaymentSummary,
      reportPersonTax,
      reportPostSalary,
      reportConfiguration,
      reportStandardUnitInsurance,
      reportRetirementSalarySummary,
      reportTemporarySalarySummary,
      reportTemporarySalary,
      reportRetirementSalary,
    reportSalaryBill,
    reportSalaryCost,
    reportLaborCostAllocation,
    reportLeadershipProfitSalary,
    reportUnitInterferenceCostAllocation,
    reportSalaryItem,
    salaryProcess,
    salaryAccounting,
    salaryPackage,
    salaryAdjustImport,
    salaryPersonTaxFile,
    salaryPersonTaxHandle,
    salaryPersonTax,
    salaryLevel,
      saleCcbAccount,
      salePaymentAccount,
      saleSysOffice,
      saleSysUser,
          saleClaimSetting,
          saleOldChickenSale,
          salePriceControl,
          saleLowPrice,
          saleSysDict,
          saleServiceSubject,
          saleTradeStoreroom,
      saleSettingDict,
      saleScheduleJob,
      saleScheduleJobLog,
      saleRegisterCode,
      settingDictPlatform,
      platformDictMall,
      platformDictMallCommon,
      platformDictMallFinance,
      platformDictMallHr,
      platformDictMallMaterial,
      platformDictMallProduct,
      platformDictMallSale,
      platformDictMallSupply,
      settingFrontendLog,
      settingMaterial,
      settingMenu,
      settingSupplier,
      settingSystemAccountingParameters,
          systemIntegration,
          settingRolePost,
          settingRole,
          settingUser,
      hrExternalStaff,
      hrInternalStaff,
      historyArchive,
      meOrganization,
      mePersonal,
      recruitmentPlan,
      myTodoUrge,
      myUrge,
      contractCodeRule,
      supplyPersonnelConfig,
      inventoryOrganizationConfig,
      inventoryAssetDepreciationConfig,
      inventoryStockRule,
      inventoryStockLocation,
      inventoryApprovalConfig,
          inventoryAssetStocktakingConfig,
          inventoryAssetBatchConfig,
          inventoryValuation,
          platformRuleManagement,
          hrPostSetting,
          productHighProductionUsage,
          productStableProductionUsage,
          productPreventionUsageAnalysis,
          productUserAnalysis,
          productNoticeConfig,
          productProgramLibrary,
          productProgramLibraryNew,
          productSettingMaterial,
          productSettingMedicine,
          productSettingUserDict,
          productSettingVaccine,
          productSettingAntibody,
          productSettingChickenProduction,
          productSettingEggStandardAgeStage,
          productSettingEpidemicPreventionCost,
          productSettingHatchAnnualMonthly,
          productSettingStandardBroiler,
          productSettingStandardFlockWeek,
          productSettingStandardFlock,
          productSettingStandardHatch,
          productSettingBatchStatus,
          productSettingConfigure,
          productSettingDayLiquidation,
          productSettingFunctionUse,
          productSettingMaterialMaster,
          productSettingHatchManageLib,
          productBusinessAgeDivision,
          productBusinessDataRetransmit,
          productBusinessSetupMaterialCode,
          productHatcheryLib,
          productHatcheryMethod,
          productHatcheryMethodLib,
          productHatcheryMethodLibIndicator,
          productHatcheryStandardIndicator,
          productHatcheryUnit,
          productPlanPreview,
          saleCustomQr,
          settingDictPlatformFinance,
          settingDictPlatformCommon,
          settingDictPlatformHr,
          settingDictPlatformMaterial,
          settingDictPlatformProduct,
          settingDictPlatformSupply,
          settingDictPlatformSale,
          saleVisitRecommendSetting,
          productSettingHatchManageMethodLib,
          productSettingHatchMethodLibIndicator,
          productSettingHatchManageMethod,
          productSettingHatchManageSeason,
          productSettingIndicatorLib,
          productSettingMethodLib,
          productSettingSeason,
          productSettingHatchManageUnit,
          productSettingHatchManageVariety,
          productSettingTenantLog,
      attendanceStatistics,
      assignment,
      attendanceShift,
      attendanceTeam,
      backlogTaskExamine,
      baseImage,
      baseManagementCenter,
      contractTemplate,
      contractLibrary,
      contractCreate,
      baseData,
      baseUpload,
      baseShell,
      generalApproval,
      baseTenant,
      baseSale,
      leaveApplication,
      vehicleApplication,
      contractSupport,
      travelExpense,
      productDesignApproval,
      taskAction,
      overtimeApplication,
      restLeaveApplication,
      businessTripApplication,
      studyCourse,
      studyStudent,
      studyGrade,
      studyLesson,
      studyRecord,
      studyStatistics,
      studyTeacher,
      perfAgreement,
      perfManageConfig,
      perfManageTemplate,
      perfSalary,
      flowTask,
      flowManage,
      aiKnowledge,
      aiInteractionQa,
      aiModel,
      modelUsage,
      aiPrompt,
      aiPromptTool,
      chat,
    }),
  )

  // 可见性收敛：菜单树只能现取（要打网络、且随用户与 project 变），所以是一个 async 入口，
  // 不在构造期做。实现与多用户门面共用同一个 `visibleCatalogFrom`，避免两处各写一遍分叉。
  const visibleCatalog = (input: VisibleCatalogInput): Promise<VisibleCatalog> =>
    visibleCatalogFrom(catalog, (query) => baseShell.getMenuNav(query), input)

  return withCompatibleAiModelHost({
    http,
    call,
    batch,
    resolveModuleType,
    capabilities,
    idempotency,
    catalog,
    visibleCatalog,
    meetingRoom,
    meetingApplication,
    attendanceArchive,
    attendanceAnnualLeave,
    attendanceException,
    attendanceSchedualInformation,
    certificateLicense,
    certificateType,
    institutionType,
    piece,
    businessRegistration,
    companyPolicy,
    honor,
      legalDispute,
    qualification,
    patent,
    software,
    standardDocument,
    trademark,
      attendanceOvertime,
    hrPostType,
    portalDevice,
    attendanceSheet,
    hrOrganizationType,
    hrOrganizationProperty,
    technologyProjectType,
    technologyTypeTemplateMapping,
    settingEnterpriseUsage,
    settingSensitiveAction,
    settingTokenAllocation,
    technologySettingTemplateBase,
    technologySettingTemplate,
    financeAccountingPeriod,
    financeAccountingManage,
    financeLedgerAccounts,
    financeSettingAccuracy,
    financeAllocationIndicator,
    financeSettingAnnualCarryforward,
    financeSettingCatConfig,
    financeSettingCatMap,
    financeSettingDateConfig,
    financeSettingMonthlyIncomeTimeConfig,
    financeSettingProject,
    financeSettingReceivingAccount,
    financeSettingRelatedPartySettlementAccount,
    financeSettingSaleAllocationCoefficient,
      financeSettingAllocationRules,
      financeSettingCostCenter,
      financeSettingEmployeeLoanAmount,
      financeSettingInitialManage,
      financeSettingOpeningSupplier,
      financeSettingFeePurpose,
      financeSettingInventoryAccount,
      financeSettingLivestockAmortization,
      financeSettingSettlementSetting,
    financeSettingVoucherTemplates,
    fundSalaryFundCosts,
    fundSalaryFundProcess,
    insuranceSalaryInsuranceCosts,
    insuranceSalaryInsuranceProcess,
    manageCostCenter,
    salaryItem,
    mePayRoll,
    platformCategoryDict,
    settingCategoryDict,
    orgCorporation,
    hrOrganizationSetting,
    hrOrganizationChart,
    hrTransferInPlan,
    platformSystemCustom,
    platformSystemSecurityConfig,
    platformSystemQueueStorage,
    platformSystemEmail,
    platformSystemQueueExport,
    platformSystemQueueFailed,
    platformSystemQueueMysql,
    platformSystemSchedule,
    reportBankPay,
    reportBankSummary,
    reportCenterInsurance,
    reportCostCenterSalary,
    reportDepartmentSalaryDetail,
    reportDepartmentSalary,
    reportFundPaymentSummary,
    reportInsurancePaymentSummary,
    reportPersonTax,
    reportPostSalary,
    reportConfiguration,
    reportStandardUnitInsurance,
    reportRetirementSalarySummary,
    reportTemporarySalarySummary,
    reportTemporarySalary,
    reportRetirementSalary,
      reportSalaryBill,
      reportSalaryCost,
      reportLaborCostAllocation,
      reportLeadershipProfitSalary,
      reportUnitInterferenceCostAllocation,
      reportSalaryItem,
      salaryProcess,
      salaryAccounting,
      salaryPackage,
      salaryAdjustImport,
      salaryPersonTaxFile,
      salaryPersonTaxHandle,
      salaryPersonTax,
    salaryLevel,
    saleCcbAccount,
    salePaymentAccount,
    saleSysOffice,
    saleSysUser,
      saleClaimSetting,
      saleOldChickenSale,
      salePriceControl,
      saleLowPrice,
      saleSysDict,
      saleServiceSubject,
      saleTradeStoreroom,
    saleSettingDict,
    saleScheduleJob,
    saleScheduleJobLog,
    saleRegisterCode,
    settingDictPlatform,
    platformDictMall,
    platformDictMallCommon,
    platformDictMallFinance,
    platformDictMallHr,
    platformDictMallMaterial,
    platformDictMallProduct,
    platformDictMallSale,
    platformDictMallSupply,
    settingFrontendLog,
    settingMaterial,
    settingMenu,
    settingSupplier,
    settingSystemAccountingParameters,
      systemIntegration,
      settingRolePost,
      settingRole,
      settingUser,
    hrExternalStaff,
    hrInternalStaff,
    historyArchive,
    meOrganization,
    mePersonal,
    recruitmentPlan,
    myTodoUrge,
    myUrge,
    contractCodeRule,
    supplyPersonnelConfig,
    inventoryOrganizationConfig,
    inventoryAssetDepreciationConfig,
    inventoryStockRule,
    inventoryStockLocation,
    inventoryApprovalConfig,
      inventoryAssetStocktakingConfig,
      inventoryAssetBatchConfig,
      inventoryValuation,
      platformRuleManagement,
      hrPostSetting,
      productHighProductionUsage,
      productStableProductionUsage,
      productPreventionUsageAnalysis,
      productUserAnalysis,
      productNoticeConfig,
      productProgramLibrary,
      productProgramLibraryNew,
      productSettingMaterial,
      productSettingMedicine,
      productSettingUserDict,
      productSettingVaccine,
      productSettingAntibody,
      productSettingChickenProduction,
      productSettingEggStandardAgeStage,
      productSettingEpidemicPreventionCost,
      productSettingHatchAnnualMonthly,
      productSettingStandardBroiler,
      productSettingStandardFlockWeek,
      productSettingStandardFlock,
      productSettingStandardHatch,
      productSettingBatchStatus,
      productSettingConfigure,
      productSettingDayLiquidation,
      productSettingFunctionUse,
      productSettingMaterialMaster,
      productSettingHatchManageLib,
      productBusinessAgeDivision,
      productBusinessDataRetransmit,
      productBusinessSetupMaterialCode,
      productHatcheryLib,
      productHatcheryMethod,
      productHatcheryMethodLib,
      productHatcheryMethodLibIndicator,
      productHatcheryStandardIndicator,
      productHatcheryUnit,
      productPlanPreview,
      saleCustomQr,
      settingDictPlatformFinance,
      settingDictPlatformCommon,
      settingDictPlatformHr,
      settingDictPlatformMaterial,
      settingDictPlatformProduct,
      settingDictPlatformSupply,
      settingDictPlatformSale,
      saleVisitRecommendSetting,
      productSettingHatchManageMethodLib,
      productSettingHatchMethodLibIndicator,
      productSettingHatchManageMethod,
      productSettingHatchManageSeason,
      productSettingIndicatorLib,
      productSettingMethodLib,
      productSettingSeason,
      productSettingHatchManageUnit,
      productSettingHatchManageVariety,
      productSettingTenantLog,
    attendanceStatistics,
    assignment,
    attendanceShift,
    attendanceTeam,
    backlogTaskExamine,
    baseImage,
    baseManagementCenter,
    contractTemplate,
    contractLibrary,
    contractCreate,
    baseData,
    baseUpload,
    baseShell,
    generalApproval,
    baseTenant,
    baseSale,
    leaveApplication,
    vehicleApplication,
    contractSupport,
    travelExpense,
    productDesignApproval,
    taskAction,
    overtimeApplication,
    restLeaveApplication,
    businessTripApplication,
    studyCourse,
    studyStudent,
    studyGrade,
    studyLesson,
    studyRecord,
    studyStatistics,
    studyTeacher,
    perfAgreement,
    perfManageConfig,
    perfManageTemplate,
    perfSalary,
    flowTask,
    flowManage,
    aiKnowledge,
    aiInteractionQa,
    aiModel,
    modelUsage,
    aiPrompt,
    aiPromptTool,
    chat,
  })
}

export { PortalApiError, PortalCredentialError } from './http/errors.js'
export { buildHeaders } from './http/headers.js'
export { resolveModuleType, normalizeMenuEntryPath } from './context/module-type.js'
export { createPortalServer } from './server.js'
export type { PortalServer, PortalServerOptions, SessionScopedPortal } from './server.js'

export {
  SessionStore,
  createPortalBaseDataRegistry,
  createPortalRequestFactory,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_MAX_SESSIONS,
} from './session/index.js'
export type {
  PortalSession,
  SessionAcquireInput,
  SessionDescriptor,
  SessionStoreEvent,
  SessionStoreOptions,
  SessionStoreStats,
} from './session/index.js'

export { createCatalog, visibleCatalogFrom, MenuVisibilityUnavailableError } from './catalog/index.js'
// 自己拿菜单树的调用方走这条路：`baseShell.getMenuNav()` → `createUserVisibility()` → `catalog.withVisibility()`
export { createUserVisibility, filterCatalog } from './catalog/index.js'
export type {
  MenuTreeResult,
  MenuTreeSource,
  UserVisibility,
  VisibleCatalog,
  VisibleCatalogInput,
  VisibilityReport,
} from './catalog/index.js'
export type {
  Catalog,
  CapabilityInvokeBinding,
  DescribeResult,
  DomainList,
  DomainListOptions,
  NextStep,
  NextStepRole,
  PageDescription,
  PageList,
  Recommendation,
  RecommendationIntent,
  SearchResult,
} from './catalog/index.js'

// 能力的执行绑定（G1）：`capabilityId` → 门面上的调用方式
export {
  CAPABILITY_BINDINGS,
  CapabilityInvokeError,
  attachCapabilityInvoker,
  createCapabilityInvoker,
  sdkPathOf,
} from './capabilities/invoke.js'
export type {
  CapabilityHost,
  CapabilityInvokeArgs,
  CapabilityInvoker,
  CapabilityRegistry,
} from './capabilities/invoke.js'
export type { PortalHeadlessConfig, PortalCredential, PortalCredentialSnapshot } from './config.js'
export type { CapabilityDefinition, ParamSpec, ParamKind } from './capabilities/types.js'
export type { ModuleTypeResolution } from './context/module-type.js'
export {
  reportLaborCostAllocationCapabilities,
  REPORT_LABOR_COST_ALLOCATION_PAGE_PATH,
  REPORT_LABOR_COST_ALLOCATION_PERMISSION,
  REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE,
  REPORT_LABOR_COST_ALLOCATION_METHODS,
} from './capabilities/report-labor-cost-allocation.js'
export {
  reportLeadershipProfitSalaryCapabilities,
  REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH,
  REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION,
  REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE,
  REPORT_LEADERSHIP_PROFIT_SALARY_METHODS,
} from './capabilities/report-leadership-profit-salary.js'
export {
  reportUnitInterferenceCostAllocationCapabilities,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PROCESS_KEY,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS,
} from './capabilities/report-unit-interference-cost-allocation.js'
export type {
  ReportUnitInterferenceCostAllocationCapability,
  ReportUnitInterferenceCostAllocationId,
  ReportUnitInterferenceCostAllocationStatus,
  ReportUnitInterferenceCostAllocationQuery,
  ReportUnitInterferenceCostAllocationRow,
  ReportUnitInterferenceCostAllocationSummary,
  ReportUnitInterferenceCostAllocationPage,
  ReportUnitInterferenceCostAllocationOrganizationNode,
  ReportUnitInterferenceCostAllocationStaffOption,
  ReportUnitInterferenceCostAllocationStaffSearch,
  ReportUnitInterferenceCostAllocationCreateForm,
  ReportUnitInterferenceCostAllocationCreateDraft,
  ReportUnitInterferenceCostAllocationRecreateInput,
  ReportUnitInterferenceCostAllocationRecreateDraft,
} from './capabilities/report-unit-interference-cost-allocation.js'
export type {
  ReportLeadershipProfitSalaryCapability,
  ReportLeadershipProfitSalaryId,
  ReportLeadershipProfitSalaryStatus,
  ReportLeadershipProfitSalaryQuery,
  ReportLeadershipProfitSalaryRow,
  ReportLeadershipProfitSalaryCreateForm,
  ReportLeadershipProfitSalaryCreateDraft,
  ReportLeadershipProfitSalaryUpdateForm,
  ReportLeadershipProfitSalaryUpdateDraft,
  ReportLeadershipProfitSalaryRemoveInput,
  ReportLeadershipProfitSalaryRemoveDraft,
  ReportLeadershipProfitSalaryFileInput,
  ReportLeadershipProfitSalaryFilePreview,
  ReportLeadershipProfitSalaryFile,
} from './capabilities/report-leadership-profit-salary.js'
export type {
  ReportLaborCostAllocationCapability,
  ReportLaborCostAllocationType,
  ReportLaborCostAllocationId,
  ReportLaborCostAllocationStatus,
  ReportLaborCostAllocationQuery,
  ReportLaborCostAllocationRow,
  ReportLaborCostAllocationSummary,
  ReportLaborCostAllocationPage,
  ReportLaborCostAllocationCreateForm,
  ReportLaborCostAllocationCreateDraft,
  ReportLaborCostAllocationUpdateForm,
  ReportLaborCostAllocationUpdateDraft,
  ReportLaborCostAllocationRemoveInput,
  ReportLaborCostAllocationRemoveDraft,
  ReportLaborCostAllocationDownloadInput,
  ReportLaborCostAllocationFileInput,
  ReportLaborCostAllocationFilePreview,
  ReportLaborCostAllocationFile,
} from './capabilities/report-labor-cost-allocation.js'
export type {
  MeetingRoom,
  MeetingRoomPageQuery,
  MeetingRoomUsage,
  PageResult,
  PortalRequest,
} from './capabilities/meeting-room.js'
export { MEETING_ROOM_PAGE_PATH, MEETING_ROOM_PERMISSION } from './capabilities/meeting-room.js'
export {
  buildMeetingApplicationPayload,
  assertTimeSlot,
  MEETING_APPLICATION_PROCESS_KEY,
} from './capabilities/meeting-application.js'
export type {
  MeetingApplicationCapability,
  MeetingApplicationDraft,
  MeetingRoomUsageResponse,
  ProcessDefinition,
  SimpleUser,
  SimpleUserQuery,
  StartUserSelectAssignees,
  StartUserSelectTask,
} from './capabilities/meeting-application.js'
export {
  assertYearMonth,
  attendanceArchiveSheetCapabilities,
  ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH,
  ATTENDANCE_ARCHIVE_SHEET_PERMISSION,
  ORGANIZATION_TYPE_OPTIONS,
  ORGANIZATION_SEARCH_DEFAULT,
  ORGANIZATION_SEARCH_MAX,
  DEFAULT_PAGE_SIZE,
} from './capabilities/attendance-archive-sheet.js'
export type {
  AttendanceArchiveSheetCapability,
  AttendanceArchiveSheetQuery,
  AttendanceArchiveSheetRow,
  Organization,
  OrganizationSearchQuery,
  OrganizationType,
} from './capabilities/attendance-archive-sheet.js'
export {
  attendanceStatisticsCapabilities,
  ATTENDANCE_STATISTICS_PAGE_PATH,
  ATTENDANCE_STATISTICS_PERMISSION,
} from './capabilities/attendance-statistics.js'
export type {
  AttendanceStatisticsCapability,
  AttendanceStatisticsQuery,
  AttendanceStatisticsRow,
} from './capabilities/attendance-statistics.js'
export {
  attendanceAnnualLeaveCapabilities,
  ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH,
  ATTENDANCE_ANNUAL_LEAVE_PERMISSION,
  ATTENDANCE_ANNUAL_LEAVE_MODULE_TYPE,
  ATTENDANCE_ANNUAL_LEAVE_METHODS,
} from './capabilities/attendance-annual-leave.js'
export {
  attendanceExceptionCapabilities,
  ATTENDANCE_EXCEPTION_PAGE_PATH,
  ATTENDANCE_EXCEPTION_PERMISSION,
  ATTENDANCE_EXCEPTION_MODULE_TYPE,
  ATTENDANCE_EXCEPTION_METHODS,
} from './capabilities/attendance-exception.js'
export type {
  AttendanceExceptionAttachment,
  AttendanceExceptionCapability,
  AttendanceExceptionDetail,
  AttendanceExceptionId,
  AttendanceExceptionQuery,
  AttendanceExceptionRow,
} from './capabilities/attendance-exception.js'
export {
  attendanceSchedualInformationCapabilities,
  ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH,
  ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION,
  ATTENDANCE_SCHEDUAL_INFORMATION_MODULE_TYPE,
  ATTENDANCE_SCHEDUAL_INFORMATION_METHODS,
} from './capabilities/attendance-schedual-information.js'
export {
  certificateLicenseCapabilities,
  CERTIFICATE_LICENSE_PAGE_PATH,
  CERTIFICATE_LICENSE_PERMISSION,
  CERTIFICATE_LICENSE_MODULE_TYPE,
  CERTIFICATE_LICENSE_METHODS,
} from './capabilities/certificate-license.js'
export {
  certificateTypeCapabilities,
  CERTIFICATE_TYPE_PAGE_PATH,
  CERTIFICATE_TYPE_PERMISSION,
  CERTIFICATE_TYPE_MODULE_TYPE,
  CERTIFICATE_TYPE_METHODS,
} from './capabilities/certificate-type.js'
export {
  institutionTypeCapabilities,
  INSTITUTION_TYPE_PAGE_PATH,
  INSTITUTION_TYPE_PERMISSION,
  INSTITUTION_TYPE_MODULE_TYPE,
  INSTITUTION_TYPE_METHODS,
} from './capabilities/institution-type.js'
export {
  pieceCapabilities,
  PIECE_PAGE_PATH,
  PIECE_PERMISSION,
  PIECE_MODULE_TYPE,
  PIECE_SHARE_TYPE,
  PIECE_METHODS,
} from './capabilities/piece.js'
export type {
  PieceId,
  PiecePublishStatus,
  PieceQuery,
  PieceRow,
  PieceForm,
  PiecePreparation,
  PieceShareMember,
  PieceShare,
  PieceShareInput,
  PieceCapability,
} from './capabilities/piece.js'
export type {
  CertificateTypeId,
  CertificateTypeQuery,
  CertificateTypeRow,
  CertificateTypeForm,
  CertificateTypePreparation,
  CertificateTypeTemplate,
  CertificateTypeCapability,
} from './capabilities/certificate-type.js'
export type {
  InstitutionTypeId,
  InstitutionTypeQuery,
  InstitutionTypeRow,
  InstitutionTypePage,
  InstitutionTypeForm,
  InstitutionTypePreparation,
  InstitutionTypeCapability,
} from './capabilities/institution-type.js'
export {
  salaryPackageCapabilities,
  SALARY_PACKAGE_PAGE_PATH,
  SALARY_PACKAGE_PERMISSION,
  SALARY_PACKAGE_MODULE_TYPE,
  SALARY_PACKAGE_METHODS,
} from './capabilities/salary-package.js'
export type {
  SalaryPackageId,
  SalaryPackageFlag,
  SalaryPackageRow,
  SalaryPackageForm,
  SalaryPackagePreparation,
  SalaryPackageCopyForm,
  SalaryPackageItemRow,
  SalaryPackageItemForm,
  SalaryPackageItemPreparation,
  SalaryPackageOrganizationQuery,
  SalaryPackageCapability,
} from './capabilities/salary-package.js'
export {
  salaryAdjustImportCapabilities,
  SALARY_ADJUST_IMPORT_PAGE_PATH,
  SALARY_ADJUST_IMPORT_PERMISSION,
  SALARY_ADJUST_IMPORT_MODULE_TYPE,
  SALARY_ADJUST_IMPORT_METHODS,
  SALARY_ADJUST_IMPORT_AMOUNT_FIELDS,
} from './capabilities/salary-adjust-import.js'
export {
  saleCcbAccountCapabilities,
  SALE_CCB_ACCOUNT_PAGE_PATH,
  SALE_CCB_ACCOUNT_PERMISSION,
  SALE_CCB_ACCOUNT_CREATE_PERMISSION,
  SALE_CCB_ACCOUNT_ROW_ACTION_PERMISSION,
  SALE_CCB_ACCOUNT_MODULE_TYPE,
  SALE_CCB_ACCOUNT_METHODS,
} from './capabilities/sale-ccb-account.js'
export {
  salePaymentAccountCapabilities,
  SALE_PAYMENT_ACCOUNT_PAGE_PATH,
  SALE_PAYMENT_ACCOUNT_PERMISSION,
  SALE_PAYMENT_ACCOUNT_CREATE_PERMISSION,
  SALE_PAYMENT_ACCOUNT_EDIT_PERMISSION,
  SALE_PAYMENT_ACCOUNT_DELETE_PERMISSION,
  SALE_PAYMENT_ACCOUNT_MODULE_TYPE,
  SALE_PAYMENT_ACCOUNT_METHODS,
} from './capabilities/sale-payment-account.js'
export {
  saleSysOfficeCapabilities,
  SALE_SYS_OFFICE_PAGE_PATH,
  SALE_SYS_OFFICE_PERMISSION,
  SALE_SYS_OFFICE_EDIT_PERMISSION,
  SALE_SYS_OFFICE_STOP_PERMISSION,
  SALE_SYS_OFFICE_STOP_BATCH_PERMISSION,
  SALE_SYS_OFFICE_MODULE_TYPE,
  SALE_SYS_OFFICE_METHODS,
} from './capabilities/sale-sys-office.js'
export type { FinanceSettingOpeningSupplierCapabilityWithIdempotency } from './capabilities/finance-setting-opening-supplier.js'
export type {
  SaleSysOfficeCapability,
  SaleSysOfficeId,
  SaleSysOfficeScalar,
  SaleSysOfficeQuery,
  SaleSysOfficeRow,
  SaleSysOfficeTreeNode,
  SaleSysOfficeDictOption,
  SaleSysOfficeBusinessNode,
  SaleSysOfficeForm,
  SaleSysOfficeUpdateDraft,
  SaleSysOfficeUpdatePreparation,
  SaleSysOfficeStopPreparation,
  SaleSysOfficeBatchStopPreparation,
  SaleSysOfficeFile,
} from './capabilities/sale-sys-office.js'
export {
  saleSysUserCapabilities,
  SALE_SYS_USER_PAGE_PATH,
  SALE_SYS_USER_PERMISSION,
  SALE_SYS_USER_EXPORT_PERMISSION,
  SALE_SYS_USER_EDIT_PERMISSION,
  SALE_SYS_USER_EDIT_OFFICE_PERMISSION,
  SALE_SYS_USER_EDIT_BUSINESS_PERMISSION,
  SALE_SYS_USER_STOP_PERMISSION,
  SALE_SYS_USER_OPEN_PERMISSION,
  SALE_SYS_USER_STOP_BATCH_PERMISSION,
  SALE_SYS_USER_OPEN_BATCH_PERMISSION,
  SALE_SYS_USER_TRANSFER_PERMISSION,
  SALE_SYS_USER_MODULE_TYPE,
  SALE_SYS_USER_METHODS,
} from './capabilities/sale-sys-user.js'
export type {
  SaleSysUserCapability,
  SaleSysUserId,
  SaleSysUserScalar,
  SaleSysUserQuery,
  SaleSysUserRow,
  SaleSysUserOption,
  SaleSysUserTreeNode,
  SaleSysUserShop,
  SaleSysUserItemKindOption,
  SaleSysUserMaterial,
  SaleSysUserDomesticMaterialCodes,
  SaleSysUserDomesticQuery,
  SaleSysUserDomesticMaterialRow,
  SaleSysUserTransferCustomer,
  SaleSysUserForm,
  SaleSysUserUpdateDraft,
  SaleSysUserUpdatePreparation,
  SaleSysUserRolePreparation,
  SaleSysUserShopPreparation,
  SaleSysUserOfficePreparation,
  SaleSysUserBusinessPreparation,
  SaleSysUserDomesticPreparation,
  SaleSysUserStatusPreparation,
  SaleSysUserBatchStatusPreparation,
  SaleSysUserTransferQuery,
  SaleSysUserTransferPreparation,
  SaleSysUserFile,
} from './capabilities/sale-sys-user.js'
export {
  saleClaimSettingCapabilities,
  SALE_CLAIM_SETTING_PAGE_PATH,
  SALE_CLAIM_SETTING_PERMISSION,
  SALE_CLAIM_SETTING_CREATE_PERMISSION,
  SALE_CLAIM_SETTING_EDIT_PERMISSION,
  SALE_CLAIM_SETTING_REASON_PERMISSION,
  SALE_CLAIM_SETTING_DELETE_PERMISSION,
  SALE_CLAIM_SETTING_MODULE_TYPE,
  SALE_CLAIM_SETTING_METHODS,
} from './capabilities/sale-claim-setting.js'
export type {
  SaleClaimSettingCapability,
  SaleClaimSettingId,
  SaleClaimType,
  SaleClaimCategoryId,
  SaleClaimSettingQuery,
  SaleClaimSettingRow,
  SaleClaimSettingDetail,
  SaleClaimCategoryNode,
  SaleClaimSettingForm,
  SaleClaimSettingUpdateForm,
  SaleClaimSettingDraft,
  SaleClaimSettingUpdateDraft,
  SaleClaimSettingFormPreparation,
  SaleClaimSettingUpdatePreparation,
  SaleClaimSettingRemovePreparation,
  SaleClaimReason,
  SaleClaimReasonInput,
  SaleClaimReasonDraft,
  SaleClaimReasonPreparation,
} from './capabilities/sale-claim-setting.js'
export {
  saleOldChickenSaleCapabilities,
  SALE_OLD_CHICKEN_SALE_PAGE_PATH,
  SALE_OLD_CHICKEN_SALE_FORM_PATH,
  SALE_OLD_CHICKEN_SALE_PERMISSION,
  SALE_OLD_CHICKEN_SALE_SET_PRICE_RANGE_PERMISSION,
  SALE_OLD_CHICKEN_SALE_CREATE_APPLICATION_PERMISSION,
  SALE_OLD_CHICKEN_SALE_DETAIL_PERMISSION,
  SALE_OLD_CHICKEN_SALE_MODULE_TYPE,
  SALE_OLD_CHICKEN_SALE_METHODS,
} from './capabilities/sale-old-chicken-sale.js'
export {
  salePriceControlCapabilities,
  SALE_PRICE_CONTROL_PAGE_PATH,
  SALE_PRICE_CONTROL_FORM_PATH,
  SALE_PRICE_CONTROL_PERMISSION,
  SALE_PRICE_CONTROL_MODULE_TYPE,
  SALE_PRICE_CONTROL_APPLY_PERMISSION,
  SALE_PRICE_CONTROL_VIEW_PERMISSION,
  SALE_PRICE_CONTROL_STOP_PERMISSION,
  SALE_PRICE_CONTROL_DELETE_PERMISSION,
  SALE_PRICE_CONTROL_APPLY_VIEW_PERMISSION,
  SALE_PRICE_CONTROL_WITHDRAW_PERMISSION,
  SALE_PRICE_CONTROL_RESUBMIT_PERMISSION,
  SALE_PRICE_CONTROL_VOID_PERMISSION,
  SALE_PRICE_CONTROL_METHODS,
} from './capabilities/sale-price-control.js'
export type {
  SalePriceControlCapability,
  SalePriceControlId,
  SalePriceControlDateRange,
  SalePriceControlCategory,
  SalePriceControlStandardRow,
  SalePriceControlApplicationRow,
  SalePriceControlApplicationItem,
  SalePriceControlApplicationRequestItem,
  SalePriceControlAttachment,
  SalePriceControlApplicationDetail,
  SalePriceControlStandardQuery,
  SalePriceControlApplicationQuery,
  SalePriceControlGoodsForm,
  SalePriceControlApplicationForm,
  SalePriceControlApplicationDraft,
  SalePriceControlApplicationPreparation,
  SalePriceControlStandardActionPreparation,
  SalePriceControlRemovePreparation,
  SalePriceControlApplicationActionPreparation,
  SalePriceControlApplicationCategoryNode,
  SalePriceControlItemOption,
  SalePriceControlSkuOption,
} from './capabilities/sale-price-control.js'
export {
  saleLowPriceCapabilities,
  SALE_LOW_PRICE_PAGE_PATH,
  SALE_LOW_PRICE_PERMISSION,
  SALE_LOW_PRICE_CREATE_PERMISSION,
  SALE_LOW_PRICE_EDIT_PERMISSION,
  SALE_LOW_PRICE_DELETE_PERMISSION,
  SALE_LOW_PRICE_MODULE_TYPE,
  SALE_LOW_PRICE_METHODS,
} from './capabilities/sale-low-price.js'
export type {
  SaleLowPriceCapability,
  SaleLowPriceId,
  SaleLowPriceDateRange,
  SaleLowPriceCategoryOption,
  SaleLowPriceCategoryNode,
  SaleLowPriceSkuOption,
  SaleLowPriceSku,
  SaleLowPriceRule,
  SaleLowPriceRuleDraft,
  SaleLowPriceConfig,
  SaleLowPriceListQuery,
  SaleLowPriceSkuInput,
  SaleLowPriceRuleInput,
  SaleLowPriceConfigForm,
  SaleLowPriceConfigDraft,
  SaleLowPriceConfigPreparation,
  SaleLowPriceRemovePreparation,
} from './capabilities/sale-low-price.js'
export {
  saleSysDictCapabilities,
  SALE_SYS_DICT_PAGE_PATH,
  SALE_SYS_DICT_PERMISSION,
  SALE_SYS_DICT_ACTION_PERMISSION,
  SALE_SYS_DICT_MODULE_TYPE,
  SALE_SYS_DICT_METHODS,
} from './capabilities/sale-sys-dict.js'
export type {
  SaleSysDictCapability,
  SaleSysDictId,
  SaleSysDictRow,
  SaleSysDictQuery,
  SaleSysDictForm,
  SaleSysDictDraft,
  SaleSysDictUpdateDraft,
  SaleSysDictCreatePreparation,
  SaleSysDictUpdatePreparation,
  SaleSysDictRemovePreparation,
} from './capabilities/sale-sys-dict.js'
export {
  saleServiceSubjectCapabilities,
  SALE_SERVICE_SUBJECT_PAGE_PATH,
  SALE_SERVICE_SUBJECT_PERMISSION,
  SALE_SERVICE_SUBJECT_CREATE_PERMISSION,
  SALE_SERVICE_SUBJECT_EDIT_PERMISSION,
  SALE_SERVICE_SUBJECT_DELETE_PERMISSION,
  SALE_SERVICE_SUBJECT_MODULE_TYPE,
  SALE_SERVICE_SUBJECT_METHODS,
} from './capabilities/sale-service-subject.js'
export type {
  SaleServiceSubjectCapability,
  SaleServiceSubjectId,
  SaleServiceSubjectScalar,
  SaleServiceSubjectRow,
  SaleServiceSubjectQuery,
  SaleServiceSubjectForm,
  SaleServiceSubjectUpdateForm,
  SaleServiceSubjectCreatePreparation,
  SaleServiceSubjectUpdatePreparation,
  SaleServiceSubjectRemovePreparation,
} from './capabilities/sale-service-subject.js'
export type {
  SaleOldChickenSaleCapability,
  SaleOldChickenSaleId,
  SaleOldChickenSaleQuery,
  SaleOldChickenSaleRow,
  SaleOldChickenCustomer,
  SaleOldChickenCustomerQuery,
  SaleOldChickenControlConfig,
  SaleOldChickenControlConfigDraft,
  SaleOldChickenControlConfigPreparation,
  SaleOldChickenAttachment,
  SaleOldChickenSaleApplicationForm,
  SaleOldChickenSaleApplicationDraft,
  SaleOldChickenSaleApplicationPreparation,
  SaleOldChickenSaleRemovePreparation,
  SaleOldChickenSaleApplicationDetail,
} from './capabilities/sale-old-chicken-sale.js'
export {
  saleTradeStoreroomCapabilities,
  SALE_TRADE_STOREROOM_PAGE_PATH,
  SALE_TRADE_STOREROOM_PERMISSION,
  SALE_TRADE_STOREROOM_ACTION_PERMISSION,
  SALE_TRADE_STOREROOM_MODULE_TYPE,
  SALE_TRADE_STOREROOM_METHODS,
} from './capabilities/sale-trade-storeroom.js'
export type {
  SaleTradeStoreroomCapability,
  SaleTradeStoreroomId,
  SaleTradeStoreroomScalar,
  SaleTradeStoreroomType,
  SaleTradeStoreroomQuery,
  SaleTradeStoreroomRow,
  SaleTradeStoreroomSupplier,
  SaleTradeStoreroomCompany,
  SaleTradeStoreroomCandidate,
  SaleTradeStoreroomOrganizationNode,
  SaleTradeStoreroomSelectedBase,
  SaleTradeStoreroomForm,
  SaleTradeStoreroomUpdateForm,
  SaleTradeStoreroomDraft,
  SaleTradeStoreroomFormPreparation,
  SaleTradeStoreroomRemovePreparation,
  SaleTradeStoreroomSyncDraft,
  SaleTradeStoreroomSyncPreparation,
  SaleTradeStoreroomCandidateQuery,
} from './capabilities/sale-trade-storeroom.js'
export type {
  SalePaymentAccountCapability,
  SalePaymentAccountId,
  SalePaymentAccountScalar,
  SalePaymentAccountQuery,
  SalePaymentAccountRow,
  SalePaymentAccountDetail,
  SalePaymentAccountOrganizationNode,
  SalePaymentAccountCategoryNode,
  SalePaymentAccountBankOption,
  SalePaymentAccountForm,
  SalePaymentAccountUpdateForm,
  SalePaymentAccountCreateDraft,
  SalePaymentAccountUpdateDraft,
  SalePaymentAccountCreatePreparation,
  SalePaymentAccountUpdatePreparation,
  SalePaymentAccountRemovePreparation,
  SalePaymentAccountOrganizationQuery,
  SalePaymentAccountBankQuery,
  SalePaymentAccountBankAccountQuery,
} from './capabilities/sale-payment-account.js'
export type {
  SaleCcbAccountCapability,
  SaleCcbAccountId,
  SaleCcbAccountScalar,
  SaleCcbAccountOffice,
  SaleCcbAccountForm,
  SaleCcbAccountUpdateForm,
  SaleCcbAccountDraft,
  SaleCcbAccountFormPreparation,
  SaleCcbAccountRemovePreparation,
  SaleCcbAccountOrganizationNode,
  SaleCcbAccountRow,
  SaleCcbAccountQuery,
} from './capabilities/sale-ccb-account.js'
export {
  salaryPersonTaxFileCapabilities,
  SALARY_PERSON_TAX_FILE_PAGE_PATH,
  SALARY_PERSON_TAX_FILE_PERMISSION,
  SALARY_PERSON_TAX_FILE_MODULE_TYPE,
  SALARY_PERSON_TAX_FILE_METHODS,
} from './capabilities/salary-person-tax-file.js'
export {
  salaryPersonTaxHandleCapabilities,
  SALARY_PERSON_TAX_HANDLE_PAGE_PATH,
  SALARY_PERSON_TAX_HANDLE_PERMISSION,
  SALARY_PERSON_TAX_HANDLE_MODULE_TYPE,
  SALARY_PERSON_TAX_HANDLE_METHODS,
} from './capabilities/salary-person-tax-handle.js'
export {
  salaryPersonTaxCapabilities,
  SALARY_PERSON_TAX_PAGE_PATH,
  SALARY_PERSON_TAX_PERMISSION,
  SALARY_PERSON_TAX_MODULE_TYPE,
  SALARY_PERSON_TAX_METHODS,
} from './capabilities/salary-person-tax.js'
export type {
  SalaryPersonTaxCapability,
  SalaryPersonTaxId,
  SalaryPersonTaxMonthRange,
  SalaryPersonTaxQuery,
  SalaryPersonTaxExpenseSpecial,
  SalaryPersonTaxRow,
  SalaryPersonTaxSummary,
  SalaryPersonTaxPage,
  SalaryPersonTaxForm,
  SalaryPersonTaxExpenseFileInput,
  SalaryPersonTaxExpenseFilePreview,
  SalaryPersonTaxExpenseFile,
  SalaryPersonTaxExpenseEligibilityResult,
} from './capabilities/salary-person-tax.js'
export type {
  SalaryPersonTaxHandleCapability,
  SalaryPersonTaxHandleId,
  SalaryPersonTaxHandleQuery,
  SalaryPersonTaxHandleRow,
  SalaryPersonTaxHandleSpecial,
  SalaryPersonTaxHandleForm,
  SalaryPersonTaxHandleFileInput,
  SalaryPersonTaxHandleFilePreview,
  SalaryPersonTaxHandleFile,
  SalaryPersonTaxHandleEligibilityResult,
} from './capabilities/salary-person-tax-handle.js'
export type {
  SalaryPersonTaxFileCapability,
  SalaryPersonTaxFileId,
  SalaryPersonTaxFileQuery,
  SalaryPersonTaxFileRow,
  SalaryPersonTaxSpecial,
  SalaryPersonTaxEligibilityResult,
  SalaryPersonTaxEligibilityExcludedStaff,
  SalaryPersonTaxFile,
} from './capabilities/salary-person-tax-file.js'
export type {
  SalaryAdjustImportCapability,
  SalaryAdjustImportId,
  SalaryAdjustImportAmount,
  SalaryAdjustImportFileInput,
  SalaryAdjustImportFilePreview,
  SalaryAdjustImportFile,
  SalaryAdjustImportRow,
  SalaryAdjustImportQuery,
} from './capabilities/salary-adjust-import.js'
export {
  saleScheduleJobCapabilities,
  SALE_SCHEDULE_JOB_PAGE_PATH,
  SALE_SCHEDULE_JOB_PERMISSION,
  SALE_SCHEDULE_JOB_ACTION_PERMISSION,
  SALE_SCHEDULE_JOB_MODULE_TYPE,
  SALE_SCHEDULE_JOB_METHODS,
} from './capabilities/sale-schedule-job.js'
export type {
  SaleScheduleJobCapability,
  SaleScheduleJobId,
  SaleScheduleJobStatus,
  SaleScheduleJobStatusFilter,
  SaleScheduleJobRow,
  SaleScheduleJobQuery,
  SaleScheduleJobForm,
  SaleScheduleJobUpdateForm,
  SaleScheduleJobFormPreparation,
  SaleScheduleJobRemovePreparation,
  SaleScheduleJobRunPreparation,
  SaleScheduleJobStatusPreparation,
} from './capabilities/sale-schedule-job.js'
export {
  saleScheduleJobLogCapabilities,
  SALE_SCHEDULE_JOB_LOG_PAGE_PATH,
  SALE_SCHEDULE_JOB_LOG_PERMISSION,
  SALE_SCHEDULE_JOB_LOG_ACTION_PERMISSION,
  SALE_SCHEDULE_JOB_LOG_MODULE_TYPE,
  SALE_SCHEDULE_JOB_LOG_METHODS,
} from './capabilities/sale-schedule-job-log.js'
export type {
  SaleScheduleJobLogCapability,
  SaleScheduleJobLogId,
  SaleScheduleJobLogRow,
  SaleScheduleJobLogQuery,
  SaleScheduleJobLogForm,
  SaleScheduleJobLogUpdateForm,
  SaleScheduleJobLogFormPreparation,
  SaleScheduleJobLogRemovePreparation,
} from './capabilities/sale-schedule-job-log.js'
export {
  saleRegisterCodeCapabilities,
  SALE_REGISTER_CODE_PAGE_PATH,
  SALE_REGISTER_CODE_PERMISSION,
  SALE_REGISTER_CODE_ACTION_PERMISSION,
  SALE_REGISTER_CODE_MODULE_TYPE,
  SALE_REGISTER_CODE_METHODS,
} from './capabilities/sale-register-code.js'
export type {
  SaleRegisterCodeCapability,
  SaleRegisterCodeId,
  SaleRegisterCodeRow,
  SaleRegisterCodeQuery,
  SaleRegisterCodeFileInput,
  SaleRegisterCodeFilePreview,
  SaleRegisterCodeRemoveInput,
  SaleRegisterCodeRemovePreparation,
} from './capabilities/sale-register-code.js'
export type {
  CertificateLicenseId,
  CertificateLicenseType,
  CertificateLicenseBinaryFlag,
  CertificateLicenseQuery,
  CertificateLicenseStaffRef,
  CertificateLicenseRecord,
  CertificateLicenseTreeNode,
  CertificateLicenseFolderDraft,
  CertificateLicenseFolderPreparation,
  CertificateLicenseForm,
  CertificateLicenseSavePreparation,
  CertificateLicenseShareMember,
  CertificateLicenseShare,
  CertificateLicenseShareInput,
  CertificateLicenseRecognition,
  CertificateLicenseRecognitionResult,
  CertificateLicenseCapability,
} from './capabilities/certificate-license.js'
export {
  businessRegistrationCapabilities,
  BUSINESS_REGISTRATION_PAGE_PATH,
  BUSINESS_REGISTRATION_PERMISSION,
  BUSINESS_REGISTRATION_MODULE_TYPE,
  BUSINESS_REGISTRATION_METHODS,
} from './capabilities/business-registration.js'
export type {
  BusinessRegistrationId,
  BusinessRegistrationType,
  BusinessRegistrationStatus,
  BusinessRegistrationFlag,
  BusinessRegistrationQuery,
  BusinessRegistrationStaffRef,
  BusinessRegistrationRow,
  BusinessRegistrationDetail,
  BusinessRegistrationForm,
  BusinessRegistrationPreparation,
  BusinessRegistrationFile,
  BusinessRegistrationChangeEntry,
  BusinessRegistrationPartialUpdate,
  BusinessRegistrationChangeDraft,
  BusinessRegistrationChangeInput,
  BusinessRegistrationChangeRecord,
  BusinessRegistrationChangeRecordPage,
  BusinessRegistrationShareMember,
  BusinessRegistrationShare,
  BusinessRegistrationShareInput,
  BusinessRegistrationCapability,
} from './capabilities/business-registration.js'
export {
  companyPolicyCapabilities,
  COMPANY_POLICY_PAGE_PATH,
  COMPANY_POLICY_PERMISSION,
  COMPANY_POLICY_MODULE_TYPE,
  COMPANY_POLICY_SHARE_TYPE,
  COMPANY_POLICY_POWER_CONTENT_ID,
  COMPANY_POLICY_METHODS,
} from './capabilities/company-policy.js'
export type {
  CompanyPolicyId,
  CompanyPolicyType,
  CompanyPolicyFlag,
  CompanyPolicyChapter,
  CompanyPolicyDirectory,
  CompanyPolicyRow,
  CompanyPolicyQuery,
  CompanyPolicyFolderDraft,
  CompanyPolicyPreparation,
  CompanyPolicyDirectoryInput,
  CompanyPolicyUploadFile,
  CompanyPolicyDocumentCreateInput,
  CompanyPolicyDocumentDraft,
  CompanyPolicyStudentQuery,
  CompanyPolicyStudentRow,
  CompanyPolicyPowerContent,
  CompanyPolicyShareMember,
  CompanyPolicyShare,
  CompanyPolicyShareInput,
  CompanyPolicyFile,
  CompanyPolicyCapability,
} from './capabilities/company-policy.js'
export {
  honorCapabilities,
  HONOR_PAGE_PATH,
  HONOR_PERMISSION,
  HONOR_MODULE_TYPE,
  HONOR_SHARE_TYPE,
  HONOR_METHODS,
} from './capabilities/honor.js'
export type {
  HonorId,
  HonorFlag,
  HonorQuery,
  HonorRow,
  HonorForm,
  HonorPreparation,
  HonorShareMember,
  HonorShare,
  HonorShareInput,
  HonorCapability,
} from './capabilities/honor.js'
export {
  legalDisputeCapabilities,
  LEGAL_DISPUTE_PAGE_PATH,
  LEGAL_DISPUTE_PERMISSION,
  LEGAL_DISPUTE_MODULE_TYPE,
  LEGAL_DISPUTE_SHARE_TYPE,
  LEGAL_DISPUTE_METHODS,
} from './capabilities/legal-dispute.js'
export {
  patentCapabilities,
  PATENT_PAGE_PATH,
  PATENT_PERMISSION,
  PATENT_MODULE_TYPE,
  PATENT_SHARE_TYPE,
  PATENT_METHODS,
} from './capabilities/patent.js'
export {
  softwareCapabilities,
  SOFTWARE_PAGE_PATH,
  SOFTWARE_PERMISSION,
  SOFTWARE_MODULE_TYPE,
  SOFTWARE_SHARE_TYPE,
  SOFTWARE_METHODS,
} from './capabilities/software.js'
export {
  standardDocumentCapabilities,
  STANDARD_DOCUMENT_PAGE_PATH,
  STANDARD_DOCUMENT_PERMISSION,
  STANDARD_DOCUMENT_MODULE_TYPE,
  STANDARD_DOCUMENT_SHARE_TYPE,
  STANDARD_DOCUMENT_METHODS,
} from './capabilities/standard-document.js'
export {
  trademarkCapabilities,
  TRADEMARK_PAGE_PATH,
  TRADEMARK_PERMISSION,
  TRADEMARK_MODULE_TYPE,
  TRADEMARK_SHARE_TYPE,
  TRADEMARK_METHODS,
} from './capabilities/trademark.js'
export type {
  TrademarkId,
  TrademarkScalar,
  TrademarkQuery,
  TrademarkRow,
  TrademarkForm,
  TrademarkPreparation,
  TrademarkShareMember,
  TrademarkShare,
  TrademarkShareInput,
  TrademarkFile,
  TrademarkRenewalAttachment,
  TrademarkRenewalDraft,
  TrademarkRenewalPreparation,
  TrademarkRenewalRecord,
  TrademarkRenewalRecords,
  TrademarkCapability,
} from './capabilities/trademark.js'
export type {
  StandardDocumentId,
  StandardDocumentFlag,
  StandardDocumentQuery,
  StandardDocumentRow,
  StandardDocumentForm,
  StandardDocumentPreparation,
  StandardDocumentShareMember,
  StandardDocumentShare,
  StandardDocumentShareInput,
  StandardDocumentCapability,
} from './capabilities/standard-document.js'
export type {
  SoftwareId,
  SoftwareWay,
  SoftwareQuery,
  SoftwareRow,
  SoftwareForm,
  SoftwarePreparation,
  SoftwareShareMember,
  SoftwareShare,
  SoftwareShareInput,
  SoftwareCapability,
} from './capabilities/software.js'
export type {
  PatentId,
  PatentQuery,
  PatentRow,
  PatentForm,
  PatentPreparation,
  PatentShareMember,
  PatentShare,
  PatentShareInput,
  PatentCapability,
} from './capabilities/patent.js'
export type {
  LegalDisputeId,
  LegalDisputeSolution,
  LegalDisputeQuery,
  LegalDisputeRow,
  LegalDisputeForm,
  LegalDisputePreparation,
  LegalDisputeShareMember,
  LegalDisputeShare,
  LegalDisputeShareInput,
  LegalDisputeFile,
  LegalDisputeCapability,
} from './capabilities/legal-dispute.js'
export {
  qualificationCapabilities,
  QUALIFICATION_PAGE_PATH,
  QUALIFICATION_PERMISSION,
  QUALIFICATION_MODULE_TYPE,
  QUALIFICATION_SHARE_TYPE,
  QUALIFICATION_METHODS,
} from './capabilities/qualification.js'
export type {
  QualificationId,
  QualificationFlag,
  QualificationQuery,
  QualificationRow,
  QualificationForm,
  QualificationPreparation,
  QualificationShareMember,
  QualificationShare,
  QualificationShareInput,
  QualificationCapability,
} from './capabilities/qualification.js'
export type {
  AttendanceSchedualInformationAbsentPeriod,
  AttendanceSchedualInformationAbsentUser,
  AttendanceSchedualInformationAbsenceInput,
  AttendanceSchedualInformationAttachment,
  AttendanceSchedualInformationAttendanceItem,
  AttendanceSchedualInformationCalendar,
  AttendanceSchedualInformationCalendarQuery,
  AttendanceSchedualInformationCapability,
  AttendanceSchedualInformationId,
  AttendanceSchedualInformationListQuery,
  AttendanceSchedualInformationRow,
  AttendanceSchedualInformationTimePeriod,
} from './capabilities/attendance-schedual-information.js'
export {
  attendanceOvertimeCapabilities,
  ATTENDANCE_OVERTIME_PAGE_PATH,
  ATTENDANCE_OVERTIME_PERMISSION,
  ATTENDANCE_OVERTIME_MODULE_TYPE,
  ATTENDANCE_OVERTIME_METHODS,
} from './capabilities/attendance-overtime.js'
export type {
  AttendanceOvertimeCapability,
  AttendanceOvertimeDetail,
  AttendanceOvertimeDetailInput,
  AttendanceOvertimeId,
  AttendanceOvertimeQuery,
  AttendanceOvertimeRow,
} from './capabilities/attendance-overtime.js'
export type {
  AttendanceAnnualLeaveAbsent,
  AttendanceAnnualLeaveCapability,
  AttendanceAnnualLeaveFile,
  AttendanceAnnualLeaveId,
  AttendanceAnnualLeaveQuery,
  AttendanceAnnualLeaveRow,
} from './capabilities/attendance-annual-leave.js'

export {
  assignmentCapabilities,
  ASSIGNMENT_MODULE_TYPE,
  ASSIGNMENT_PAGE_PATH,
  ASSIGNMENT_PERMISSION,
  ASSIGNMENT_TYPE_OPTIONS,
  buildAssignmentPayload,
  buildCreateTimeRange,
} from './capabilities/assignment.js'
export type {
  Assignment,
  AssignmentCapability,
  AssignmentCapabilityWithIdempotency,
  AssignmentDraft,
  AssignmentPageQuery,
  AssignmentStatus,
  AssignmentUpdateDraft,
} from './capabilities/assignment.js'

// 注意：`DEFAULT_PAGE_SIZE` 这里**不重复导出**——考勤档案那一行已经导出过它了，
// 同一个模块里导出两次同名符号是编译错误。要用这个常量的调用方从
// `./capabilities/attendance-archive-sheet.js` 取。
export {
  attendanceShiftCapabilities,
  assertClockTime,
  assertNoStatusParam,
  ATTENDANCE_SHIFT_PAGE_PATH,
  ATTENDANCE_SHIFT_PERMISSION,
  ATTENDANCE_SHIFT_MODULE_TYPE,
  buildShiftPayload,
} from './capabilities/attendance-shift.js'
export type {
  AttendanceShiftCapability,
  AttendanceShiftCapabilityWithIdempotency,
  AttendanceShiftDraft,
  AttendanceShiftQuery,
  AttendanceShiftRow,
  AttendanceShiftUpdateDraft,
} from './capabilities/attendance-shift.js'

export {
  backlogTaskExamineCapabilities,
  BACKLOG_TASK_EXAMINE_PAGE_PATH,
  BACKLOG_TASK_EXAMINE_PERMISSION,
  FINISHED_OPTIONS,
  SELECT_TYPE_OPTIONS,
} from './capabilities/backlog-task-examine.js'
export type {
  BacklogTaskExamineCapability,
  BacklogTaskExamineQuery,
  BacklogTaskRow,
  Finished,
  SelectType,
} from './capabilities/backlog-task-examine.js'

export {
  baseImageCapabilities,
  BASE_IMAGE_PAGE_PATH,
  BASE_IMAGE_PERMISSION,
  BASE_IMAGE_MODULE_TYPE,
  BASE_IMAGE_STATUS_OPTIONS,
  buildListParams,
} from './capabilities/base-image.js'
export type {
  BaseImage,
  BaseImageCapability,
  BaseImageCapabilityWithIdempotency,
  BaseImageDraft,
  BaseImagePageQuery,
  BaseImageUpdateDraft,
} from './capabilities/base-image.js'

// 同样不重复导出 `DEFAULT_PAGE_SIZE`（档案页那一行已经导出过）
export {
  assertIsoDate,
  attendanceTeamCapabilities,
  ATTENDANCE_TEAM_MODULE_TYPE,
  ATTENDANCE_TEAM_PAGE_PATH,
  ATTENDANCE_TEAM_PERMISSION,
  buildGroupPayload,
  buildSchedulePayload,
  GROUP_NAME_MAX_LENGTH,
  SCHEDULE_TYPES,
  STANDARD_WORKING_HOURS,
} from './capabilities/attendance-team.js'
export type {
  AttendanceTeamCapability,
  AttendanceTeamCapabilityWithIdempotency,
  AttendanceTeamDraft,
  AttendanceTeamQuery,
  AttendanceTeamRow,
  AttendanceTeamSchedule,
  AttendanceTeamScheduleDraft,
  AttendanceTeamScheduleMember,
  AttendanceTeamUpdateDraft,
} from './capabilities/attendance-team.js'

// `buildListParams` 不从这里出（base-image 那一行已经导出过同名符号）；
// `buildCreatePayload` 改名导出，避免以后再来一个同名的分不清是谁的。
export {
  BASE_MANAGEMENT_CENTER_MODULE_TYPE,
  BASE_MANAGEMENT_CENTER_PAGE_PATH,
  BASE_MANAGEMENT_CENTER_PERMISSION,
  baseManagementCenterCapabilities,
  buildCreatePayload as buildManagementCenterPayload,
  MANAGEMENT_CENTER_NAME_MAX_LENGTH,
  MANAGEMENT_CENTER_STATUS_OPTIONS,
} from './capabilities/base-management-center.js'
export type {
  BaseManagementCenterCapability,
  BaseManagementCenterCapabilityWithIdempotency,
  ManagementCenterDraft,
  ManagementCenterQuery,
  ManagementCenterRow,
  ManagementCenterUpdateDraft,
} from './capabilities/base-management-center.js'

// `assertNoStatusParam` 不从这里出（attendance-shift 那一行已经导出过）
export {
  assertNoOnlySubmit,
  assertTemplateContent,
  buildTemplatePayload,
  buildTemplateUpdatePayload,
  CONTRACT_TEMPLATE_MODULE_TYPE,
  CONTRACT_TEMPLATE_PAGE_PATH,
  CONTRACT_TEMPLATE_PERMISSION,
  CONTRACT_TEMPLATE_STATUS,
  contractTemplateCapabilities,
  EMPTY_TEMPLATE_CONTENT,
  SYSTEM_OPTIONS,
} from './capabilities/contract-template.js'
export {
  CONTRACT_LIBRARY_MODULE_TYPE,
  CONTRACT_LIBRARY_PAGE_PATH,
  CONTRACT_LIBRARY_PERMISSION,
  CONTRACT_STATUS,
  contractLibraryCapabilities,
  CONTRACT_LIBRARY_METHODS,
  assertContractContent,
} from './capabilities/contract-library.js'
export type {
  ContractData,
  ContractFile,
  ContractId,
  ContractLibraryCapability,
  ContractQuery,
  ContractRecord,
  ContractReplenishment,
  ContractReplenishmentDraft,
  ContractReplenishmentPreparation,
  ContractRow,
  ContractSignCertificate,
  ContractSignCertificateDraft,
  ContractSignCertificatePreparation,
  ContractStatus,
  ContractUpdateDraft,
  ContractUpdatePreparation,
  ContractUpdateReceipt,
  ContractVoidDraft,
} from './capabilities/contract-library.js'
export {
  CONTRACT_CREATE_MODULE_TYPE,
  CONTRACT_CREATE_PAGE_PATH,
  CONTRACT_CREATE_PERMISSION,
  CONTRACT_CREATE_METHODS,
  contractCreateCapabilities,
} from './capabilities/contract-create.js'
export type {
  ContractCreateCapability,
  ContractCreateCapabilityWithIdempotency,
  ContractCreateDraft,
  ContractCreateInput,
  ContractCreateReceipt,
  ContractCreateTemplate,
  ContractCreateVariable,
} from './capabilities/contract-create.js'
export type {
  ContractTemplateCapability,
  ContractTemplateCapabilityWithIdempotency,
  ContractTemplateDraft,
  ContractTemplateQuery,
  ContractTemplateRow,
  ContractTemplateUpdateDraft,
} from './capabilities/contract-template.js'

// 基础数据（不是页面能力，见 docs/base/）
export {
  BASE_DATA_KEYS,
  BASE_DEPT_LIST_PATH,
  BASE_DICT_LIST_PATH,
  BASE_PERMISSION_LIST_PATH,
  baseDeptDictPermissionCapabilities,
  baseDeptPermissionBaseData,
  DEPT_SEARCH_MAX,
  DICT_TYPE_SEARCH_MAX,
  PERMISSION_SEARCH_MAX,
} from './capabilities/base-dept-dict-permission.js'
export type {
  BaseDeptDictPermissionCapability,
  DeptNode,
  DictEntry,
} from './capabilities/base-dept-dict-permission.js'

// 上传（基础能力，不是页面）。三个错误类也转出来——调用方要按类型判「是缺凭据还是请求失败」，
// 只靠 `error.name` 字符串判太脆（用法文档 §10.4 原本只能那样教）。
export {
  baseUploadCapabilities,
  OSS_FOLDERS,
  OssCredentialError,
  OssRequestError,
  OssUploadParamError,
  redactOssConfig,
} from './capabilities/base-upload.js'
export type {
  BaseUploadCapability,
  OssUploadConfig,
  OssUploadRequest,
  OssUploadResult,
  OssPreparedRequest,
} from './capabilities/base-upload.js'

// 应用外壳（基础能力，不是页面）
export {
  BASE_HOME_WIDGETS_PATH,
  BASE_MENU_NAV_PATH,
  BASE_SHELL_CONTEXT_ROOT,
  baseShellCapabilities,
  BASE_TODO_PATH,
  BASE_USER_INFO_PATH,
  BASE_USER_SEARCH_PATH,
} from './capabilities/base-shell.js'
export type { BaseShellCapability, BaseShellOptions } from './capabilities/base-shell.js'

// 通用审批（流程表单线第一条，是**页面能力**：见 docs/pages/通用审批.md）
export {
  buildGeneralApprovalCreatePayload,
  buildGeneralApprovalPayload,
  generalApprovalCapabilities,
  GENERAL_APPROVAL_PAGE_PATH,
  GENERAL_APPROVAL_PROCESS_KEY,
} from './capabilities/general-approval.js'
export type {
  GeneralApprovalCapability,
  GeneralApprovalCapabilityWithIdempotency,
  GeneralApprovalDraft,
} from './capabilities/general-approval.js'

// 基础能力第三批：租户/企业上下文 + 销售域基础数据
export {
  baseTenantCapabilities,
  BASE_TENANT_DETAIL_PATH,
  BASE_TENANT_LIST_PATH,
} from './capabilities/base-tenant.js'
export type { BaseTenantCapability } from './capabilities/base-tenant.js'
export {
  baseSaleCapabilities,
  BASE_SALE_AREA_PATH,
  BASE_SALE_BRAND_PATH,
  BASE_SALE_HOME_TIP_PATH,
  BASE_SALE_MANUFACTURER_PATH,
  BASE_SALE_SHOP_PATH,
} from './capabilities/base-sale.js'
export type { BaseSaleCapability } from './capabilities/base-sale.js'

// 请假申请（流程表单线第二条，是**页面能力**：见 docs/pages/请假申请.md）
export {
  buildLeavePayload,
  leaveApplicationCapabilities,
  LEAVE_APPLICATION_PAGE_PATH,
  LEAVE_APPLICATION_PROCESS_KEY,
} from './capabilities/leave-application.js'
export type {
  LeaveApplicationCapability,
  LeaveApplicationCapabilityWithIdempotency,
  LeaveDraft,
} from './capabilities/leave-application.js'

// 用车申请（流程表单线第三条，是**页面能力**）
export {
  buildVehicleApplicationPayload,
  vehicleApplicationCapabilities,
  VEHICLE_APPLICATION_PAGE_PATH,
  VEHICLE_APPLICATION_PROCESS_KEY,
} from './capabilities/vehicle-application.js'
export type {
  VehicleApplicationCapability,
  VehicleApplicationCapabilityWithIdempotency,
  VehicleApplicationDraft,
} from './capabilities/vehicle-application.js'

// 差旅费支出申请表（流程表单线第四条，是**页面能力**）
export {
  buildTravelPayload,
  travelExpenseCapabilities,
  TRAVEL_EXPENSE_PAGE_PATH,
  TRAVEL_EXPENSE_PROCESS_KEY,
} from './capabilities/travel-expense-application.js'
export type {
  TravelExpenseCapability,
  TravelExpenseCapabilityWithIdempotency,
  TravelExpenseDraft,
} from './capabilities/travel-expense-application.js'

// 产品设计文档审核（流程表单线第五条，是**页面能力**）
export {
  buildProductDesignApprovalPayload,
  productDesignApprovalCapabilities,
  PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
  PRODUCT_DESIGN_APPROVAL_PROCESS_KEY,
} from './capabilities/product-design-approval.js'
export type {
  ProductDesignApprovalCapability,
  ProductDesignApprovalCapabilityWithIdempotency,
  ProductDesignApprovalDraft,
} from './capabilities/product-design-approval.js'

// 待办办理（横切能力）
export {
  taskActionCapabilities,
  TASK_ACTION_BATCH_PAGE_PATH,
  TASK_ACTION_DETAIL_PAGE_PATH,
} from './capabilities/task-action.js'
export type { TaskActionCapability, TaskActionCapabilityWithIdempotency } from './capabilities/task-action.js'

// 加班审批（流程表单线第六条，是**页面能力**）
export {
  overtimeApplicationCapabilities,
  OVERTIME_APPLICATION_PAGE_PATH,
  OVERTIME_APPLICATION_PROCESS_KEY,
} from './capabilities/overtime-application.js'
export type {
  OvertimeApplicationCapability,
  OvertimeApplicationCapabilityWithIdempotency,
  OvertimeApplicationDraft,
} from './capabilities/overtime-application.js'

// 调休审批（流程表单线第七条，是**页面能力**）
export {
  restLeaveApplicationCapabilities,
  REST_LEAVE_APPLICATION_PAGE_PATH,
  REST_LEAVE_APPLICATION_PROCESS_KEY,
} from './capabilities/rest-leave-application.js'
export type {
  RestLeaveApplicationCapability,
  RestLeaveApplicationCapabilityWithIdempotency,
  RestLeaveApplicationDraft,
} from './capabilities/rest-leave-application.js'

// 出差申请（流程表单线第八条，是**页面能力**）
export {
  businessTripApplicationCapabilities,
  BUSINESS_TRIP_APPLICATION_PAGE_PATH,
  BUSINESS_TRIP_APPLICATION_PROCESS_KEY,
} from './capabilities/business-trip-application.js'
export type {
  BusinessTripApplicationCapability,
  BusinessTripApplicationCapabilityWithIdempotency,
  BusinessTripApplicationDraft,
} from './capabilities/business-trip-application.js'

// 课程管理三页（页面队列，是**页面能力**）
export {
  studyCourseCapabilities,
  studyCourseListUrl,
  STUDY_COURSE_LIST_PATH,
  STUDY_COURSE_TEXT_PAGE_PATH,
  STUDY_COURSE_VIDEO_PAGE_PATH,

  STUDY_COURSE_IM_PAGE_PATH,
  STUDY_COURSE_ROUTE_FILES,
  buildStudyCourseTimeRange,
  buildStudyCourseCreateTimeRange,
  buildStudyCourseDeleteTimeRange,
  IM_COURSE_STATUS_OPTIONS,
} from './capabilities/study-course.js'
export {
  studyStudentCapabilities,
  STUDY_STUDENT_PAGE_PATH,
  STUDY_STUDENT_LIST_PATH,
  STUDY_STUDENT_IN_GRADE_PATH,
  buildStudyStudentTimeRange,
} from './capabilities/study-student.js'
export {
  studyGradeCapabilities,
  STUDY_GRADE_PAGE_PATH,
  STUDY_GRADE_LIST_PATH,
} from './capabilities/study-grade.js'
export {
  studyLessonCapabilities,
  STUDY_LESSON_LIST_PATH,
  STUDY_LESSON_DAILY_PAGE_PATH,
  STUDY_LESSON_WEEKLY_PAGE_PATH,
  STUDY_LESSON_MONTHLY_PAGE_PATH,
  STUDY_LESSON_WEEKLY_EXPORT_PATH,
  buildStudyLessonTimeRange,
} from './capabilities/study-lesson.js'
export {
  studyRecordCapabilities,
  STUDY_RECORD_PAGE_PATH,
  STUDY_RECORD_LIST_PATH,
  buildStudyRecordTimeRange,
} from './capabilities/study-record.js'
export {
  studyStatisticsCapabilities,
  STUDY_STATISTICS_STUDENT_PAGE_PATH,
  STUDY_STATISTICS_TEACHER_PAGE_PATH,
  STUDY_STATISTICS_LESSON_PAGE_PATH,
  STUDY_STATISTICS_GRADE_PAGE_PATH,
  STUDY_STATISTICS_LEARNING_PAGE_PATH,
  dropEmptyParams,
  buildStudyStatisticsTeacherTimeRange,
  buildStudyStatisticsLessonTimeRange,
  buildStudyStatisticsGradeRange,
} from './capabilities/study-statistics.js'
export {
  studyTeacherCapabilities,
  STUDY_TEACHER_PAGE_PATH,
  STUDY_TEACHER_LEVEL_PAGE_PATH,
  STUDY_TEACHER_HTTP_INSTANCE,
  STUDY_APPRAISE_SETTING_PAGE_PATH,
} from './capabilities/study-teacher.js'
export type {
  StudyStudentCapability,
  StudyStudentQuery,
  StudyStudentRow,
} from './capabilities/study-student.js'
export type {
  StudyGradeCapability,
  StudyGradeQuery,
  StudyGradeRow,
} from './capabilities/study-grade.js'
export type {
  StudyLessonCapability,
  StudyLessonDailyQuery,
  StudyLessonWeeklyQuery,
  StudyLessonMonthlyQuery,
  StudyLessonRow,
  StudyLessonFile,
  StudyLessonWeeklyExportInput,
} from './capabilities/study-lesson.js'
export type {
  StudyRecordCapability,
  StudyRecordQuery,
  StudyRecordRow,
} from './capabilities/study-record.js'
export type {
  StudyStatisticsCapability,
  StudyStatisticsStudentQuery,
  StudyStatisticsTeacherQuery,
  StudyStatisticsLessonQuery,
  StudyStatisticsGradeQuery,
  GradeLessonKind,
  LearningStaticsPayload,
} from './capabilities/study-statistics.js'
export type {
  StudyTeacherCapability,
  StudyTeacherQuery,
  StudyTeacherLevelQuery,
  StudyTeacherRow,
  StudyTeacherLevelRow,
  StudyAppraiseSettingRow,
} from './capabilities/study-teacher.js'

// 人工智能域（16 页 / 5 组）。**含写**：这一域 94 个能力里 42 个是写操作。
// 16 页在 module-type 规则表里都匹配不到 ⇒ 与浏览器一致，**不发 `module-type` 头**。
export {
  aiKnowledgeCapabilities,
  AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
  AI_KNOWLEDGE_REVIEW_PAGE_PATH,
} from './capabilities/ai-knowledge.js'
export type {
  AiKnowledgeCapability,
} from './capabilities/ai-knowledge.js'
export {
  aiInteractionQaCapabilities,
  AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
  AI_INTERACTION_CHAT_PAGE_PATH,
  AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
  AI_INTERACTION_FEEDBACK_PAGE_PATH,
} from './capabilities/ai-interaction-qa.js'
export type {
  AiInteractionQaCapability,
} from './capabilities/ai-interaction-qa.js'
export {
  aiModelCapabilities,
  AI_MODEL_LIST_PAGE_PATH,
  AI_MODEL_SELECT_PAGE_PATH,
  AI_PLATFORM_USAGE_PAGE_PATH,
  AI_DATA_ANALYSIS_PAGE_PATH,
} from './capabilities/ai-model.js'
export type {
  AiModelCapability,
} from './capabilities/ai-model.js'
export {
  modelUsageCapabilities,
  PERSONAL_USAGE_PAGE_PATH,
  PERSONAL_USAGE_PERMISSION,
  PERSONAL_USAGE_MODULE_TYPE,
  PERSONAL_USAGE_BUTTON_PERMISSIONS,
  PERSONAL_USAGE_PATHS,
  buildPersonalApplyPayload,
  preparePersonalApply,
} from './capabilities/model-usage.js'
export type {
  ModelUsageCapability,
  PersonalQuotaQuery,
  PersonalUsageQuery,
  PersonalApplyDraft,
  PersonalApplyPreparation,
  PersonalApplyQuery,
  PersonalUsageFile,
} from './capabilities/model-usage.js'
export {
  aiPromptCapabilities,
  AI_PROMPT_TYPE_PAGE_PATH,
  AI_PROMPT_SKILL_PAGE_PATH,
  AI_PROMPT_INTENT_PAGE_PATH,
} from './capabilities/ai-prompt.js'
export type {
  AiPromptCapability,
} from './capabilities/ai-prompt.js'
export {
  aiPromptToolCapabilities,
  AI_BUSINESS_EVENT_PAGE_PATH,
  AI_OPEN_API_REGISTRY_PAGE_PATH,
  AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
} from './capabilities/ai-prompt-tool.js'
export type {
  AiPromptToolCapability,
} from './capabilities/ai-prompt-tool.js'
export {
  chatCapabilities,
  CHAT_PAGE_PATH,
  CHAT_PERMISSION,
  CHAT_AGENT_ORCHESTRATION_DICT_TYPE,
  CHAT_AGENT_ORCHESTRATION_OPEN_LABEL,
  CHAT_DEFAULT_CALL_TYPE,
  CHAT_DEFAULT_HISTORY_PAGE_SIZE,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MAX_IMAGES,
  CHAT_MAX_CHECKED_SKILLS,
  CHAT_METHODS,
} from './capabilities/chat.js'
export type {
  ChatCapability,
  ChatRequest,
  ChatSkill,
  ChatAvailable,
  ChatHistoryItem,
  ChatSkillOrder,
  ChatAttachment,
  ChatStreamInput,
  ChatStreamData,
  ChatStreamEvent,
  ChatStreamResponse,
  ChatSkillOrderDraft,
} from './capabilities/chat.js'
export type {
  StudyCourseCapability,
  StudyCourseRow,
  StudyCourseListQuery,
  StudyCourseImListQuery,
} from './capabilities/study-course.js'

export {
  inventoryApprovalConfigCapabilities,
  INVENTORY_APPROVAL_CONFIG_PAGE_PATH,
  INVENTORY_APPROVAL_CONFIG_PERMISSION,
  INVENTORY_APPROVAL_CONFIG_MODULE_TYPE,
  INVENTORY_APPROVAL_CONFIG_METHODS,
} from './capabilities/inventory-approval-config.js'

export {
  inventoryAssetStocktakingConfigCapabilities,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS,
} from './capabilities/inventory-asset-stocktaking-config.js'
export {
  inventoryAssetBatchConfigCapabilities,
  INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH,
  INVENTORY_ASSET_BATCH_CONFIG_PERMISSION,
  INVENTORY_ASSET_BATCH_CONFIG_MODULE_TYPE,
  INVENTORY_ASSET_BATCH_CONFIG_METHODS,
} from './capabilities/inventory-asset-batch-config.js'
export {
  inventoryValuationCapabilities,
  INVENTORY_VALUATION_PAGE_PATH,
  INVENTORY_VALUATION_PERMISSION,
  INVENTORY_VALUATION_MODULE_TYPE,
  INVENTORY_VALUATION_METHODS,
} from './capabilities/inventory-valuation.js'
export type {
  InventoryValuationCapability,
  InventoryValuationId,
  InventoryValuationPricingMethod,
  InventoryValuationQuery,
  InventoryValuationRow,
  InventoryValuationCreateRow,
  InventoryValuationCreatePayload,
  InventoryValuationUpdateDraft,
  InventoryValuationUpdatePayload,
  InventoryValuationTypeOption,
  InventoryValuationChangeLog,
  InventoryValuationPriceHistoryRow,
} from './capabilities/inventory-valuation.js'
export {
  platformRuleManagementCapabilities,
  PLATFORM_RULE_MANAGEMENT_PAGE_PATH,
  PLATFORM_RULE_MANAGEMENT_PERMISSION,
  PLATFORM_RULE_MANAGEMENT_MODULE_TYPE,
  PLATFORM_RULE_MANAGEMENT_METHODS,
  PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS,
} from './capabilities/platform-rule-management.js'
export type {
  PlatformRuleManagementCapability,
  PlatformRuleManagementId,
  PlatformRuleManagementSystemType,
  PlatformRuleManagementQuery,
  PlatformRuleManagementRecord,
  PlatformRuleManagementForm,
  PlatformRuleManagementCreatePayload,
  PlatformRuleManagementUpdatePayload,
  PlatformRuleValidationResult,
} from './capabilities/platform-rule-management.js'
export {
  systemIntegrationCapabilities,
  SYSTEM_INTEGRATION_PAGE_PATH,
  SYSTEM_INTEGRATION_PERMISSION,
  SYSTEM_INTEGRATION_MODULE_TYPE,
  SYSTEM_INTEGRATION_METHODS,
} from './capabilities/system-integration.js'
export type {
  SystemIntegrationCapability,
  SystemIntegrationId,
  SystemIntegrationFlag,
  SystemIntegrationQuery,
  SystemIntegrationRow,
  SystemIntegrationForm,
  SystemIntegrationDraft,
  SystemIntegrationPreparation,
} from './capabilities/system-integration.js'
export {
  settingRolePostCapabilities,
  SETTING_ROLE_POST_PAGE_PATH,
  SETTING_ROLE_POST_PERMISSION,
  SETTING_ROLE_POST_MODULE_TYPE,
  SETTING_ROLE_POST_METHODS,
} from './capabilities/setting-role-post.js'
export {
  settingRoleCapabilities,
  SETTING_ROLE_PAGE_PATH,
  SETTING_ROLE_PERMISSION,
  SETTING_ROLE_MODULE_TYPE,
  SETTING_ROLE_METHODS,
} from './capabilities/setting-role.js'
export type {
  SettingRoleCapability,
  SettingRoleCapabilityWithIdempotency,
  SettingRoleId,
  SettingRoleQuery,
  SettingRoleRow,
  SettingRoleModuleScope,
  SettingRoleForm,
  SettingRoleDetail,
  SettingRoleDraft,
  SettingRolePreparation,
  SettingRoleDeleteDraft,
  SettingRoleDeletePreparation,
  SettingRoleTreeNode,
  SettingRoleStandardTreeNode,
  SettingRoleOption,
} from './capabilities/setting-role.js'
export type {
  SettingRolePostCapability,
  SettingRolePostId,
  SettingRolePostQuery,
  SettingRolePostRow,
  SettingRolePostRole,
  SettingRolePostRoleTreeNode,
  SettingRolePostUser,
  SettingRolePostUserQuery,
  SettingRolePostReplaceInput,
  SettingRolePostDraft,
  SettingRolePostPreparation,
} from './capabilities/setting-role-post.js'
export {
  meOrganizationCapabilities,
  ME_ORGANIZATION_PAGE_PATH,
  ME_ORGANIZATION_PERMISSION,
  ME_ORGANIZATION_MODULE_TYPE,
  ME_ORGANIZATION_METHODS,
} from './capabilities/me-organization.js'
export {
  hrOrganizationChartCapabilities,
  HR_ORGANIZATION_CHART_PAGE_PATH,
  HR_ORGANIZATION_CHART_PERMISSION,
  HR_ORGANIZATION_CHART_MODULE_TYPE,
  HR_ORGANIZATION_CHART_METHODS,
} from './capabilities/org-chart.js'
export {
  hrTransferInPlanCapabilities,
  HR_TRANSFER_IN_PLAN_PAGE_PATH,
  HR_TRANSFER_IN_PLAN_PERMISSION,
  HR_TRANSFER_IN_PLAN_MODULE_TYPE,
  HR_TRANSFER_IN_PLAN_METHODS,
} from './capabilities/hr-transfer-in-plan.js'
export type {
  HrTransferInPlanCapability,
  HrTransferInPlanId,
  HrTransferInPlanYear,
  HrTransferInPlanOrganizationNode,
  HrTransferInPlanRow,
  HrTransferInPlanPostRequirement,
  HrTransferInPlanRoute,
} from './capabilities/hr-transfer-in-plan.js'
export type {
  HrOrganizationChartCapability,
  HrOrganizationChartId,
  HrOrganizationChartDirection,
  HrOrganizationChartNode,
  HrOrganizationChartFile,
  HrOrganizationChartEditRoute,
} from './capabilities/org-chart.js'
export {
  mePersonalCapabilities,
  ME_PERSONAL_PAGE_PATH,
  ME_PERSONAL_PERMISSION,
  ME_PERSONAL_MODULE_TYPE,
  ME_PERSONAL_FORM_PATH,
  ME_PERSONAL_PROCESS_KEY,
  ME_PERSONAL_METHODS,
  EDUCATIONAL_ITEM_FIELDS,
} from './capabilities/me-personal.js'
export type {
  MePersonalCapability,
  MePersonalId,
  MePersonalJsonObject,
  MePersonalDetail,
  MePersonalChangeDraft,
  MePersonalStartUserSelectTask,
  MePersonalStartUserSelectAssignees,
  MePersonalPreparation,
  MePersonalPrepareInput,
  MePersonalSubmitInput,
  MePersonalEditLaunch,
} from './capabilities/me-personal.js'
export type {
  MeOrganizationCapability,
  MeOrganizationId,
  MeOrganizationBaseInfoItem,
  MeOrganizationStaffBaseInfo,
  MeOrganizationNode,
  MeOrganizationDuty,
  MeOrganizationChartPoint,
  MeOrganizationChartLine,
  MeOrganizationChart,
  MeOrganizationStatisticsQuery,
  MeOrganizationEmployeeStatisticsQuery,
} from './capabilities/me-organization.js'
export {
  hrPostSettingCapabilities,
  HR_POST_SETTING_PAGE_PATH,
  HR_POST_SETTING_PERMISSION,
  HR_POST_SETTING_MODULE_TYPE,
  HR_POST_SETTING_METHODS,
} from './capabilities/hr-post-setting.js'
export {
  recruitmentPlanCapabilities,
  RECRUITMENT_PLAN_PAGE_PATH,
  RECRUITMENT_PLAN_PERMISSION,
  RECRUITMENT_PLAN_MODULE_TYPE,
  RECRUITMENT_PLAN_FORM_PATH,
  RECRUITMENT_PLAN_ONBOARDING_FORM_PATH,
  RECRUITMENT_PLAN_PROCESS_KEY,
  RECRUITMENT_PLAN_ONBOARDING_PROCESS_KEY,
  RECRUITMENT_PLAN_METHODS,
} from './capabilities/recruitment-plan.js'
export type {
  RecruitmentPlanCapability,
  RecruitmentPlanId,
  RecruitmentPlanQuery,
  RecruitmentPlanRow,
  RecruitmentPlanDraft,
  RecruitmentPlanPreparation,
  RecruitmentPlanCreateInput,
  RecruitmentPlanUpdateInput,
  RecruitmentPlanFileInput,
  RecruitmentPlanFile,
  RecruitmentPlanOrganizationNode,
  RecruitmentPlanPostOption,
  RecruitmentPlanSalaryLevelOption,
  RecruitmentResumeRow,
  RecruitmentResumeQuery,
  RecruitmentResumeAttachment,
  RecruitmentResumeDraft,
  RecruitmentResumeWriteInput,
  RecruitmentInterviewRow,
  RecruitmentInterviewDraft,
  RecruitmentInterviewWriteInput,
  RecruitmentOnboardingLaunch,
} from './capabilities/recruitment-plan.js'
export {
  myTodoUrgeCapabilities,
  MY_TODO_URGE_PAGE_PATH,
  MY_TODO_URGE_PERMISSION,
  MY_TODO_URGE_DETAIL_PATH,
  MY_TODO_URGE_CREATE_PATH,
  MY_TODO_URGE_DEGREE_TYPE_OPTIONS,
  MY_TODO_URGE_COMPLETION_OPTIONS,
  MY_TODO_URGE_METHODS,
  buildMyTodoUrgeCompletionPayload,
} from './capabilities/my-todo-urge.js'
export {
  myUrgeCapabilities,
  MY_URGE_PAGE_PATH,
  MY_URGE_PERMISSION,
  MY_URGE_DETAIL_PATH,
  MY_URGE_CREATE_PATH,
  MY_URGE_DEGREE_TYPE_OPTIONS,
  MY_URGE_COMPLETION_OPTIONS,
  MY_URGE_METHODS,
} from './capabilities/my-urge.js'
export type {
  MyUrgeCapability,
  MyUrgeId,
  MyUrgeSupervisor,
  MyUrgeSupervisorOption,
  MyUrgeRow,
  MyUrgeDetail,
  MyUrgeQuery,
  MyUrgeSupervisorSearchQuery,
  MyUrgeCreateInput,
  MyUrgeCreateDraft,
  MyUrgeDeleteDraft,
  MyUrgeReminderDraft,
  MyUrgePersonalReminderDraft,
  MyUrgeDetailRoute,
  MyUrgeCreateRoute,
} from './capabilities/my-urge.js'
export type {
  MyTodoUrgeCapability,
  MyTodoUrgeId,
  MyTodoUrgeAssignee,
  MyTodoUrgeRow,
  MyTodoUrgeDetail,
  MyTodoUrgeQuery,
  MyTodoUrgeCompletionInput,
  MyTodoUrgeCompletionDraft,
  MyTodoUrgeDetailRoute,
  MyTodoUrgeCreateRoute,
} from './capabilities/my-todo-urge.js'
export {
  contractCodeRuleCapabilities,
  CONTRACT_CODE_RULE_PAGE_PATH,
  CONTRACT_CODE_RULE_PERMISSION,
  CONTRACT_CODE_RULE_MODULE_TYPE,
  CONTRACT_CODE_RULE_METHODS,
} from './capabilities/contract-code-rule.js'
export type {
  ContractCodeRuleCapability,
  ContractCodeRuleId,
  ContractCodeRuleDateStyle,
  ContractCodeRuleSerialLength,
  ContractCodeRule,
  ContractCodeRuleDraft,
  ContractCodeRulePreviewInput,
} from './capabilities/contract-code-rule.js'
export {
  productHighProductionUsageCapabilities,
  PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH,
  PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION,
  PRODUCT_HIGH_PRODUCTION_USAGE_METHODS,
} from './capabilities/product-high-production-usage.js'
export {
  productStableProductionUsageCapabilities,
  PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH,
  PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION,
  PRODUCT_STABLE_PRODUCTION_USAGE_METHODS,
} from './capabilities/product-stable-production-usage.js'
export {
  productPreventionUsageAnalysisCapabilities,
  PRODUCT_PREVENTION_USAGE_ANALYSIS_PAGE_PATH,
  PRODUCT_PREVENTION_USAGE_ANALYSIS_PERMISSION,
  PRODUCT_PREVENTION_USAGE_ANALYSIS_MODULE_TYPE,
  PRODUCT_PREVENTION_USAGE_ANALYSIS_METHODS,
} from './capabilities/product-prevention-usage-analysis.js'
export type {
  ProductPreventionUsageAnalysisCapability,
  ProductPreventionUsageAnalysisId,
  ProductPreventionUsageAnalysisGroup,
  ProductPreventionUsageAnalysisQuery,
  ProductPreventionUsageAnalysisTreeNode,
  ProductPreventionUsageAnalysisRow,
} from './capabilities/product-prevention-usage-analysis.js'
export {
  productUserAnalysisCapabilities,
  PRODUCT_USER_ANALYSIS_PAGE_PATH,
  PRODUCT_USER_ANALYSIS_PERMISSION,
  PRODUCT_USER_ANALYSIS_METHODS,
} from './capabilities/product-user-analysis.js'
export type {
  ProductUserAnalysisCapability,
  ProductUserAnalysisPermission,
  ProductUserAnalysisUsage,
  ProductUserAnalysisQuery,
  ProductUserAnalysisRow,
} from './capabilities/product-user-analysis.js'
export {
  productNoticeConfigCapabilities,
  PRODUCT_NOTICE_CONFIG_PAGE_PATH,
  PRODUCT_NOTICE_CONFIG_PERMISSION,
  PRODUCT_NOTICE_CONFIG_MODULE_TYPE,
  PRODUCT_NOTICE_CONFIG_METHODS,
} from './capabilities/product-notice-config.js'
export type {
  ProductNoticeConfigCapability,
  ProductNoticeConfigId,
  ProductNoticeConfigModule,
  ProductNoticeConfigStatus,
  ProductNoticeConfigQuery,
  ProductNoticeConfigRow,
  ProductNoticeConfigForm,
  ProductNoticeConfigOption,
  ProductNoticeConfigPostOption,
  ProductNoticeConfigChooseNode,
  ProductNoticeConfigPage,
} from './capabilities/product-notice-config.js'
export {
  productSettingMaterialCapabilities,
  PRODUCT_SETTING_MATERIAL_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_PERMISSION,
  PRODUCT_SETTING_MATERIAL_MODULE_TYPE,
  PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION,
  PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION,
  PRODUCT_SETTING_MATERIAL_BACK_PERMISSION,
  PRODUCT_SETTING_MATERIAL_METHODS,
} from './capabilities/product-setting-material.js'
export type {
  ProductSettingMaterialCapability,
  ProductSettingMaterialId,
  ProductSettingMaterialType,
  ProductSettingMaterialQuery,
  ProductSettingMaterialRow,
  ProductSettingMaterialSaveDraft,
  ProductSettingMaterialPage,
} from './capabilities/product-setting-material.js'
export {
  productSettingMedicineCapabilities,
  PRODUCT_SETTING_MEDICINE_PAGE_PATH,
  PRODUCT_SETTING_MEDICINE_PERMISSION,
  PRODUCT_SETTING_MEDICINE_MODULE_TYPE,
  PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION,
  PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION,
  PRODUCT_SETTING_MEDICINE_METHODS,
} from './capabilities/product-setting-medicine.js'
export type {
  ProductSettingMedicineCapability,
  ProductSettingMedicineId,
  ProductSettingMedicineType,
  ProductSettingMedicineQuery,
  ProductSettingMedicineRow,
  ProductSettingMedicineSaveDraft,
  ProductSettingMedicinePage,
} from './capabilities/product-setting-medicine.js'
export {
  productSettingUserDictCapabilities,
  PRODUCT_SETTING_USER_DICT_PAGE_PATH,
  PRODUCT_SETTING_USER_DICT_PERMISSION,
  PRODUCT_SETTING_USER_DICT_MODULE_TYPE,
  PRODUCT_SETTING_USER_DICT_QUERY_PERMISSION,
  PRODUCT_SETTING_USER_DICT_SUBMIT_PERMISSION,
  PRODUCT_SETTING_USER_DICT_METHODS,
} from './capabilities/product-setting-user-dict.js'
export type {
  ProductSettingUserDictCapability,
  ProductSettingUserDictId,
  ProductSettingUserDictQuery,
  ProductSettingUserDictTypeOption,
  ProductSettingUserDictRow,
  ProductSettingUserDictPage,
} from './capabilities/product-setting-user-dict.js'
export {
  productSettingVaccineCapabilities,
  PRODUCT_SETTING_VACCINE_PAGE_PATH,
  PRODUCT_SETTING_VACCINE_PERMISSION,
  PRODUCT_SETTING_VACCINE_MODULE_TYPE,
  PRODUCT_SETTING_VACCINE_QUERY_PERMISSION,
  PRODUCT_SETTING_VACCINE_SUBMIT_PERMISSION,
  PRODUCT_SETTING_VACCINE_METHODS,
} from './capabilities/product-setting-vaccine.js'
export type {
  ProductSettingVaccineCapability,
  ProductSettingVaccineId,
  ProductSettingVaccineImported,
  ProductSettingVaccineQuery,
  ProductSettingVaccineRow,
  ProductSettingVaccineSaveDraft,
  ProductSettingVaccinePage,
} from './capabilities/product-setting-vaccine.js'
export {
  productSettingAntibodyCapabilities,
  PRODUCT_SETTING_ANTIBODY_PAGE_PATH,
  PRODUCT_SETTING_ANTIBODY_PERMISSION,
  PRODUCT_SETTING_ANTIBODY_MODULE_TYPE,
  PRODUCT_SETTING_ANTIBODY_METHODS,
} from './capabilities/product-setting-antibody.js'
export type {
  ProductSettingAntibodyCapability,
  ProductSettingAntibodyId,
  ProductSettingAntibodyType,
  ProductSettingAntibodyEvaluation,
  ProductSettingAntibodyQuery,
  ProductSettingAntibodyRow,
  ProductSettingAntibodyPage,
  ProductSettingAntibodyCreateForm,
  ProductSettingAntibodyCreateDraft,
  ProductSettingAntibodyUpdateForm,
  ProductSettingAntibodyUpdateDraft,
  ProductSettingAntibodyRemoveInput,
  ProductSettingAntibodyRemoveDraft,
} from './capabilities/product-setting-antibody.js'
export {
  productSettingChickenProductionCapabilities,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_MODULE_TYPE,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS,
} from './capabilities/product-setting-chicken-production.js'
export {
  productSettingEggStandardAgeStageCapabilities,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_MODULE_TYPE,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS,
} from './capabilities/product-setting-egg-standard-age-stage.js'
export {
  productSettingEpidemicPreventionCostCapabilities,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_MODULE_TYPE,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS,
} from './capabilities/product-setting-epidemic-prevention-cost.js'
export {
  productSettingHatchAnnualMonthlyCapabilities,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS,
} from './capabilities/product-setting-hatch-annual-monthly.js'
export {
  productSettingStandardBroilerCapabilities,
  PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_BROILER_PERMISSION,
  PRODUCT_SETTING_STANDARD_BROILER_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_BROILER_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_BROILER_SUBMIT_PERMISSION,
  PRODUCT_SETTING_STANDARD_BROILER_METHODS,
} from './capabilities/product-setting-standard-broiler.js'
export {
  productSettingStandardFlockWeekCapabilities,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS,
} from './capabilities/product-setting-standard-flock-week.js'
export {
  productSettingStandardFlockCapabilities,
  PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_FLOCK_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_FLOCK_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_SUBMIT_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_METHODS,
} from './capabilities/product-setting-standard-flock.js'
export {
  productSettingStandardHatchCapabilities,
  PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_HATCH_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_MODULE_TYPE,
  PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_METHODS,
} from './capabilities/product-setting-standard-hatch.js'
export type {
  ProductSettingStandardFlockCapability,
  ProductSettingStandardFlockId,
  ProductSettingStandardFlockQuery,
  ProductSettingStandardFlockRow,
  ProductSettingStandardFlockPage,
  ProductSettingStandardFlockCreateForm,
  ProductSettingStandardFlockCreateDraft,
  ProductSettingStandardFlockUpdateForm,
  ProductSettingStandardFlockUpdateDraft,
  ProductSettingStandardFlockRemoveInput,
  ProductSettingStandardFlockRemoveDraft,
} from './capabilities/product-setting-standard-flock.js'
export type {
  ProductSettingStandardFlockWeekCapability,
  ProductSettingStandardFlockWeekId,
  ProductSettingStandardFlockWeekQuery,
  ProductSettingStandardFlockWeekRow,
  ProductSettingStandardFlockWeekPage,
  ProductSettingStandardFlockWeekCreateForm,
  ProductSettingStandardFlockWeekCreateDraft,
  ProductSettingStandardFlockWeekUpdateForm,
  ProductSettingStandardFlockWeekUpdateDraft,
  ProductSettingStandardFlockWeekRemoveInput,
  ProductSettingStandardFlockWeekRemoveDraft,
} from './capabilities/product-setting-standard-flock-week.js'
export type {
  ProductSettingStandardHatchCapability,
  ProductSettingStandardHatchId,
  ProductSettingStandardHatchGenDown,
  ProductSettingStandardHatchQuery,
  ProductSettingStandardHatchAgeStageOption,
  ProductSettingStandardHatchRow,
  ProductSettingStandardHatchPage,
  ProductSettingStandardHatchCreateForm,
  ProductSettingStandardHatchCreateDraft,
  ProductSettingStandardHatchUpdateForm,
  ProductSettingStandardHatchUpdateDraft,
  ProductSettingStandardHatchRemoveInput,
  ProductSettingStandardHatchRemoveDraft,
} from './capabilities/product-setting-standard-hatch.js'
export type {
  ProductSettingStandardBroilerCapability,
  ProductSettingStandardBroilerId,
  ProductSettingStandardBroilerType,
  ProductSettingStandardBroilerQuery,
  ProductSettingStandardBroilerRow,
  ProductSettingStandardBroilerPage,
  ProductSettingStandardBroilerCreateForm,
  ProductSettingStandardBroilerCreateDraft,
  ProductSettingStandardBroilerUpdateForm,
  ProductSettingStandardBroilerUpdateDraft,
  ProductSettingStandardBroilerRemoveInput,
  ProductSettingStandardBroilerRemoveDraft,
} from './capabilities/product-setting-standard-broiler.js'
export type {
  ProductSettingHatchAnnualMonthlyCapability,
  ProductSettingHatchAnnualMonthlyId,
  ProductSettingHatchAnnualMonthlyType,
  ProductSettingHatchAnnualMonthlyQuery,
  ProductSettingHatchAnnualMonthlyRow,
  ProductSettingHatchAnnualMonthlyPage,
  ProductSettingHatchAnnualMonthlyCreateForm,
  ProductSettingHatchAnnualMonthlyCreateDraft,
  ProductSettingHatchAnnualMonthlyUpdateForm,
  ProductSettingHatchAnnualMonthlyUpdateDraft,
  ProductSettingHatchAnnualMonthlyRemoveInput,
  ProductSettingHatchAnnualMonthlyRemoveDraft,
} from './capabilities/product-setting-hatch-annual-monthly.js'
export type {
  ProductSettingEpidemicPreventionCostCapability,
  ProductSettingEpidemicPreventionCostId,
  ProductSettingEpidemicPreventionCostMoulting,
  ProductSettingEpidemicPreventionCostQuery,
  ProductSettingEpidemicPreventionCostRow,
  ProductSettingEpidemicPreventionCostPage,
  ProductSettingEpidemicPreventionCostCreateForm,
  ProductSettingEpidemicPreventionCostCreateDraft,
  ProductSettingEpidemicPreventionCostUpdateForm,
  ProductSettingEpidemicPreventionCostUpdateDraft,
  ProductSettingEpidemicPreventionCostRemoveInput,
  ProductSettingEpidemicPreventionCostRemoveDraft,
} from './capabilities/product-setting-epidemic-prevention-cost.js'
export type {
  ProductSettingEggStandardAgeStageCapability,
  ProductSettingEggStandardAgeStageId,
  ProductSettingEggStandardAgeStageMoulting,
  ProductSettingEggStandardAgeStageQuery,
  ProductSettingEggStandardAgeStageRow,
  ProductSettingEggStandardAgeStagePage,
  ProductSettingEggStandardAgeStageCreateForm,
  ProductSettingEggStandardAgeStageCreateDraft,
  ProductSettingEggStandardAgeStageUpdateForm,
  ProductSettingEggStandardAgeStageUpdateDraft,
  ProductSettingEggStandardAgeStageRemoveInput,
  ProductSettingEggStandardAgeStageRemoveDraft,
} from './capabilities/product-setting-egg-standard-age-stage.js'
export type {
  ProductSettingChickenProductionCapability,
  ProductSettingChickenProductionId,
  ProductSettingChickenProductionMoulting,
  ProductSettingChickenProductionQuery,
  ProductSettingChickenProductionRow,
  ProductSettingChickenProductionPage,
  ProductSettingChickenProductionCreateForm,
  ProductSettingChickenProductionCreateDraft,
  ProductSettingChickenProductionUpdateForm,
  ProductSettingChickenProductionUpdateDraft,
  ProductSettingChickenProductionRemoveInput,
  ProductSettingChickenProductionRemoveDraft,
} from './capabilities/product-setting-chicken-production.js'
export {
  productSettingBatchStatusCapabilities,
  PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH,
  PRODUCT_SETTING_BATCH_STATUS_PERMISSION,
  PRODUCT_SETTING_BATCH_STATUS_MODULE_TYPE,
  PRODUCT_SETTING_BATCH_STATUS_QUERY_PERMISSION,
  PRODUCT_SETTING_BATCH_STATUS_SUBMIT_PERMISSION,
  PRODUCT_SETTING_BATCH_STATUS_METHODS,
} from './capabilities/product-setting-batch-status.js'
export type {
  ProductSettingBatchStatusCapability,
  ProductSettingBatchStatusId,
  ProductSettingBatchStatusFlag,
  ProductSettingBatchStatusQuery,
  ProductSettingBatchStatusRow,
  ProductSettingBatchStatusPage,
  ProductSettingBatchStatusBuildingOption,
  ProductSettingBatchStatusTerminationDraft,
  ProductSettingBatchStatusTerminationResult,
} from './capabilities/product-setting-batch-status.js'
export {
  productSettingConfigureCapabilities,
  PRODUCT_SETTING_CONFIGURE_PAGE_PATH,
  PRODUCT_SETTING_CONFIGURE_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_MODULE_TYPE,
  PRODUCT_SETTING_CONFIGURE_QUERY_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_EDIT_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_DELETE_PERMISSION,
  PRODUCT_SETTING_CONFIGURE_METHODS,
} from './capabilities/product-setting-configure.js'
export type {
  ProductSettingConfigureCapability,
  ProductSettingConfigureId,
  ProductSettingConfigureScalar,
  ProductSettingConfigureRow,
  ProductSettingConfigureListQuery,
  ProductSettingConfigureUpdateDraft,
} from './capabilities/product-setting-configure.js'
export {
  productSettingDayLiquidationCapabilities,
  PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH,
  PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION,
  PRODUCT_SETTING_DAY_LIQUIDATION_MODULE_TYPE,
  PRODUCT_SETTING_DAY_LIQUIDATION_METHODS,
} from './capabilities/product-setting-day-liquidation.js'
export {
  productSettingFunctionUseCapabilities,
  PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH,
  PRODUCT_SETTING_FUNCTION_USE_PERMISSION,
  PRODUCT_SETTING_FUNCTION_USE_MODULE_TYPE,
  PRODUCT_SETTING_FUNCTION_USE_QUERY_PERMISSION,
  PRODUCT_SETTING_FUNCTION_USE_SUBMIT_PERMISSION,
  PRODUCT_SETTING_FUNCTION_USE_METHODS,
} from './capabilities/product-setting-function-use.js'
export {
  productSettingMaterialMasterCapabilities,
  PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION,
  PRODUCT_SETTING_MATERIAL_MASTER_MODULE_TYPE,
  PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION,
  PRODUCT_SETTING_MATERIAL_MASTER_METHODS,
} from './capabilities/product-setting-material-master.js'
export type {
  ProductSettingMaterialMasterCapability,
  ProductSettingMaterialMasterId,
  ProductSettingMaterialMasterQuery,
  ProductSettingMaterialMasterRow,
  ProductSettingMaterialMasterSaveForm,
  ProductSettingMaterialMasterSaveDraft,
  ProductSettingMaterialMasterPage,
} from './capabilities/product-setting-material-master.js'
export {
  productSettingHatchManageLibCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS,
} from './capabilities/product-setting-hatch-manage-lib.js'
export type {
  ProductSettingHatchManageLibCapability,
  ProductSettingHatchManageLibId,
  ProductSettingHatchManageLibFlag,
  ProductSettingHatchManageLibQuery,
  ProductSettingHatchManageLibRow,
  ProductSettingHatchManageLibPage,
  ProductSettingHatchManageLibTemperatureOption,
  ProductSettingHatchManageLibFileInput,
  ProductSettingHatchManageLibCreateForm,
  ProductSettingHatchManageLibCreateDraft,
  ProductSettingHatchManageLibCreateInput,
  ProductSettingHatchManageLibCreateResult,
  ProductSettingHatchManageLibUpdateForm,
  ProductSettingHatchManageLibUpdateDraft,
  ProductSettingHatchManageLibFile,
} from './capabilities/product-setting-hatch-manage-lib.js'
export {
  productSettingHatchManageMethodLibCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_LIB_METHODS,
} from './capabilities/product-setting-hatch-manage-method-lib.js'
export type {
  ProductSettingHatchManageMethodLibCapability,
  ProductSettingHatchManageMethodLibId,
  ProductSettingHatchManageMethodLibFlag,
  ProductSettingHatchManageMethodLibQuery,
  ProductSettingHatchManageMethodLibRow,
  ProductSettingHatchManageMethodLibPage,
  ProductSettingHatchManageMethodLibTemperatureOption,
  ProductSettingHatchManageMethodLibFileInput,
  ProductSettingHatchManageMethodLibCreateForm,
  ProductSettingHatchManageMethodLibCreateDraft,
  ProductSettingHatchManageMethodLibCreateInput,
  ProductSettingHatchManageMethodLibCreateResult,
  ProductSettingHatchManageMethodLibUpdateForm,
  ProductSettingHatchManageMethodLibUpdateDraft,
  ProductSettingHatchManageMethodLibFile,
} from './capabilities/product-setting-hatch-manage-method-lib.js'
export {
  productSettingHatchMethodLibIndicatorCapabilities,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS,
} from './capabilities/product-setting-hatch-method-lib-indicator.js'
export type {
  ProductSettingHatchMethodLibIndicatorCapability,
  ProductSettingHatchMethodLibIndicatorId,
  ProductSettingHatchMethodLibIndicatorTraitType,
  ProductSettingHatchMethodLibIndicatorListQuery,
  ProductSettingHatchMethodLibIndicatorRow,
  ProductSettingHatchMethodLibIndicatorPage,
  ProductSettingHatchMethodLibIndicatorTraitOption,
  ProductSettingHatchMethodLibIndicatorTraitOptionsInput,
  ProductSettingHatchMethodLibIndicatorCreateForm,
  ProductSettingHatchMethodLibIndicatorCreateDraft,
  ProductSettingHatchMethodLibIndicatorCreateInput,
  ProductSettingHatchMethodLibIndicatorCreateResult,
  ProductSettingHatchMethodLibIndicatorUpdateForm,
  ProductSettingHatchMethodLibIndicatorUpdateDraft,
  ProductSettingHatchMethodLibIndicatorRemoveForm,
  ProductSettingHatchMethodLibIndicatorRemoveDraft,
  ProductSettingHatchMethodLibIndicatorFile,
} from './capabilities/product-setting-hatch-method-lib-indicator.js'
export {
  productSettingHatchManageMethodCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS,
} from './capabilities/product-setting-hatch-manage-method.js'
export {
  productSettingHatchManageSeasonCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS,
} from './capabilities/product-setting-hatch-manage-season.js'
export {
  productSettingIndicatorLibCapabilities,
  PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH,
  PRODUCT_SETTING_INDICATOR_LIB_PERMISSION,
  PRODUCT_SETTING_INDICATOR_LIB_MODULE_TYPE,
  PRODUCT_SETTING_INDICATOR_LIB_METHODS,
} from './capabilities/product-setting-indicator-lib.js'
export {
  productSettingMethodLibCapabilities,
  PRODUCT_SETTING_METHOD_LIB_PAGE_PATH,
  PRODUCT_SETTING_METHOD_LIB_PERMISSION,
  PRODUCT_SETTING_METHOD_LIB_MODULE_TYPE,
  PRODUCT_SETTING_METHOD_LIB_METHODS,
} from './capabilities/product-setting-method-lib.js'
export {
  productSettingSeasonCapabilities,
  PRODUCT_SETTING_SEASON_PAGE_PATH,
  PRODUCT_SETTING_SEASON_PERMISSION,
  PRODUCT_SETTING_SEASON_MODULE_TYPE,
  PRODUCT_SETTING_SEASON_METHODS,
} from './capabilities/product-setting-season.js'
export type {
  ProductSettingMethodLibCapability,
  ProductSettingMethodLibId,
  ProductSettingMethodLibMethodType,
  ProductSettingMethodLibListQuery,
  ProductSettingMethodLibRule,
  ProductSettingMethodLibRow,
  ProductSettingMethodLibPage,
  ProductSettingMethodLibForm,
  ProductSettingMethodLibDraft,
  ProductSettingMethodLibRemoveInput,
  ProductSettingMethodLibRemoveDraft,
  ProductSettingMethodLibFileInput,
  ProductSettingMethodLibFile,
  ProductSettingMethodLibImportForm,
} from './capabilities/product-setting-method-lib.js'
export type {
  ProductSettingSeasonCapability,
  ProductSettingSeasonAreaId,
  ProductSettingSeasonAreaNode,
  ProductSettingSeasonDateRange,
  ProductSettingSeasonTempBand,
  ProductSettingSeasonAreaConfig,
  ProductSettingSeasonListPage,
  ProductSettingSeasonListQuery,
  ProductSettingSeasonDateRangeForm,
  ProductSettingSeasonTempBandForm,
  ProductSettingSeasonSaveForm,
  ProductSettingSeasonDateRangeDraft,
  ProductSettingSeasonTempBandDraft,
  ProductSettingSeasonSaveDraft,
  ProductSettingSeasonRemoveInput,
  ProductSettingSeasonRemoveDraft,
  ProductSettingSeasonRemoveBatchInput,
  ProductSettingSeasonRemoveBatchDraft,
} from './capabilities/product-setting-season.js'
export type {
  ProductSettingIndicatorLibCapability,
  ProductSettingIndicatorLibId,
  ProductSettingIndicatorLibVersionScope,
  ProductSettingIndicatorLibListQuery,
  ProductSettingIndicatorLibVersion,
  ProductSettingIndicatorLibListPage,
  ProductSettingIndicatorLibDimensionForm,
  ProductSettingIndicatorLibCreateForm,
  ProductSettingIndicatorLibCreateDraft,
  ProductSettingIndicatorLibUpdateForm,
  ProductSettingIndicatorLibUpdateDraft,
  ProductSettingIndicatorLibCopyForm,
  ProductSettingIndicatorLibCopyDraft,
  ProductSettingIndicatorLibRemoveInput,
  ProductSettingIndicatorLibRemoveDraft,
  ProductSettingIndicatorLibVersionUpdateForm,
  ProductSettingIndicatorLibVersionUpdateDraft,
  ProductSettingIndicatorLibCreateVersionForm,
  ProductSettingIndicatorLibCreateVersionDraft,
  ProductSettingIndicatorLibDefinition,
  ProductSettingIndicatorLibDefinitionConfigForm,
  ProductSettingIndicatorLibDefinitionConfigDraft,
  ProductSettingIndicatorLibValueType,
  ProductSettingIndicatorLibValue,
  ProductSettingIndicatorLibDataRow,
  ProductSettingIndicatorLibDetail,
  ProductSettingIndicatorLibDataUpdateForm,
  ProductSettingIndicatorLibDataUpdateDraft,
  ProductSettingIndicatorLibQuickEntryForm,
  ProductSettingIndicatorLibQuickEntryDraft,
  ProductSettingIndicatorLibFileInput,
  ProductSettingIndicatorLibFile,
  ProductSettingIndicatorLibImportForm,
} from './capabilities/product-setting-indicator-lib.js'
export {
  productSettingHatchManageUnitCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS,
} from './capabilities/product-setting-hatch-manage-unit.js'
export type {
  ProductSettingHatchManageUnitCapability,
  ProductSettingHatchManageUnitId,
  ProductSettingHatchManageUnitContentType,
  ProductSettingHatchManageUnitQuery,
  ProductSettingHatchManageUnitRow,
  ProductSettingHatchManageUnitPage,
  ProductSettingHatchManageUnitCreateForm,
  ProductSettingHatchManageUnitCreateDraft,
  ProductSettingHatchManageUnitUpdateForm,
  ProductSettingHatchManageUnitUpdateDraft,
} from './capabilities/product-setting-hatch-manage-unit.js'
export {
  productSettingHatchManageVarietyCapabilities,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_MODULE_TYPE,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS,
} from './capabilities/product-setting-hatch-manage-variety.js'
export type {
  ProductSettingHatchManageVarietyCapability,
  ProductSettingHatchManageVarietyId,
  ProductSettingHatchManageVarietyQuery,
  ProductSettingHatchManageVarietyRow,
  ProductSettingHatchManageVarietyPage,
  ProductSettingHatchManageVarietyCreateForm,
  ProductSettingHatchManageVarietyCreateDraft,
  ProductSettingHatchManageVarietyUpdateForm,
  ProductSettingHatchManageVarietyUpdateDraft,
  ProductSettingHatchManageVarietySaveInput,
} from './capabilities/product-setting-hatch-manage-variety.js'
export type {
  ProductSettingHatchManageSeasonCapability,
  ProductSettingHatchManageSeasonId,
  ProductSettingHatchManageSeasonQuery,
  ProductSettingHatchManageSeasonRow,
  ProductSettingHatchManageSeasonPage,
  ProductSettingHatchManageSeasonCreateForm,
  ProductSettingHatchManageSeasonCreateDraft,
  ProductSettingHatchManageSeasonUpdateForm,
  ProductSettingHatchManageSeasonUpdateDraft,
} from './capabilities/product-setting-hatch-manage-season.js'
export type {
  ProductSettingHatchManageMethodCapability,
  ProductSettingHatchManageMethodId,
  ProductSettingHatchManageMethodQuery,
  ProductSettingHatchManageMethodRow,
  ProductSettingHatchManageMethodPage,
  ProductSettingHatchManageMethodCreateForm,
  ProductSettingHatchManageMethodCreateDraft,
  ProductSettingHatchManageMethodUpdateForm,
  ProductSettingHatchManageMethodUpdateDraft,
} from './capabilities/product-setting-hatch-manage-method.js'
export {
  productSettingTenantLogCapabilities,
  PRODUCT_SETTING_TENANT_LOG_PAGE_PATH,
  PRODUCT_SETTING_TENANT_LOG_PERMISSION,
  PRODUCT_SETTING_TENANT_LOG_MODULE_TYPE,
  PRODUCT_SETTING_TENANT_LOG_METHODS,
} from './capabilities/product-setting-tenant-log.js'
export type {
  ProductSettingTenantLogCapability,
  ProductSettingTenantLogId,
  ProductSettingTenantLogPageType,
  ProductSettingTenantLogDeviceType,
  ProductSettingTenantLogFunction,
  ProductSettingTenantLogQuery,
  ProductSettingTenantLogDetailQuery,
  ProductSettingTenantLogModuleDetailQuery,
  ProductSettingTenantLogFunctionDetailQuery,
  ProductSettingTenantLogUserDetailQuery,
  ProductSettingTenantLogCompany,
  ProductSettingTenantLogFunctionNode,
  ProductSettingTenantLogUser,
  ProductSettingTenantLogRow,
} from './capabilities/product-setting-tenant-log.js'
export type {
  ProductSettingFunctionUseCapability,
  ProductSettingFunctionUseId,
  ProductSettingFunctionUseStatus,
  ProductSettingFunctionUseRow,
  ProductSettingFunctionUseSwitchDraft,
  ProductSettingFunctionUsePreparedSwitch,
} from './capabilities/product-setting-function-use.js'
export type {
  ProductSettingDayLiquidationCapability,
  ProductSettingDayLiquidationId,
  ProductSettingDayLiquidationType,
  ProductSettingDayLiquidationQuery,
  ProductSettingDayLiquidationRow,
  ProductSettingDayLiquidationPage,
  ProductSettingDayLiquidationBuildingOption,
  ProductSettingDayLiquidationBatchOption,
} from './capabilities/product-setting-day-liquidation.js'
export {
  productProgramLibraryCapabilities,
  productProgramLibraryNewCapabilities,
  PRODUCT_PROGRAM_LIBRARY_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_PERMISSION,
  PRODUCT_PROGRAM_LIBRARY_MODULE_TYPE,
  PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_NEW_PERMISSION,
  PRODUCT_PROGRAM_LIBRARY_NEW_MODULE_TYPE,
  PRODUCT_PROGRAM_PAGE_KEYS,
  PRODUCT_PROGRAM_LIBRARY_METHODS,
  PRODUCT_PROGRAM_LIBRARY_NEW_METHODS,
} from './capabilities/product-program-library.js'
export type {
  ProductProgramLibraryCapability,
  ProductProgramPageKey,
  ProductProgramId,
  ProductProgramDraft,
  ProductProgramFileInput,
  ProductProgramFile,
  ProductProgramSupplyItem,
  ProductProgramRow,
  ProductProgramPage,
  ProductProgramTab,
  ProductProgramQuery,
  ProductProgramPrepareInput,
  ProductProgramRemoveInput,
  ProductProgramBatchRemoveInput,
  ProductProgramVentilationRow,
  ProductProgramVentilationInput,
  ProductProgramTemplateInput,
} from './capabilities/product-program-library.js'
export type {
  ProductStableProductionUsageCapability,
  ProductStableProductionUsageId,
  ProductStableProductionUsageGroup,
  ProductStableProductionUsageQuery,
  ProductStableProductionUsageTreeNode,
  ProductStableProductionUsageRow,
} from './capabilities/product-stable-production-usage.js'
export type {
  ProductHighProductionUsageCapability,
  ProductHighProductionUsageId,
  ProductHighProductionUsageGroup,
  ProductHighProductionUsageQuery,
  ProductHighProductionUsageTreeNode,
  ProductHighProductionUsageRow,
} from './capabilities/product-high-production-usage.js'
export type {
  HrPostSettingCapability,
  HrPostSettingId,
  HrPostSettingParent,
  HrPostSettingQuery,
  HrPostSettingAncestor,
  HrPostSettingRow,
  HrPostSettingSalaryLevel,
  HrPostSettingForm,
  HrPostSettingSavePayload,
  HrPostSettingCreatePayload,
  HrPostSettingUpdatePayload,
  HrPostSettingFileInput,
  HrPostSettingFilePreview,
  HrPostSettingFile,
  HrPostSettingDeletePreparation,
} from './capabilities/hr-post-setting.js'
export type {
  InventoryAssetBatchConfigCapability,
  InventoryAssetBatchConfigId,
  InventoryAssetBatchConfigQuery,
  InventoryAssetBatchConfigRow,
  InventoryAssetBatchMaterialOption,
  InventoryAssetBatchCategoryNode,
  InventoryAssetBatchUnitNode,
  InventoryAssetBatchMaterialCreateRow,
  InventoryAssetBatchCategoryCreateRow,
  InventoryAssetBatchIdDraft,
  InventoryAssetBatchIdPreparation,
  InventoryAssetBatchToggleInput,
  InventoryAssetBatchRemoveInput,
} from './capabilities/inventory-asset-batch-config.js'
export type {
  InventoryAssetStocktakingConfigCapability,
  InventoryAssetStocktakingConfigId,
  InventoryAssetStocktakingType,
  InventoryAssetStocktakingConfigQuery,
  InventoryAssetStocktakingConfigRow,
  InventoryAssetStocktakingConfigUserOption,
  InventoryAssetStocktakingConfigCreateDraft,
  InventoryAssetStocktakingConfigUpdateDraft,
} from './capabilities/inventory-asset-stocktaking-config.js'
export type {
  InventoryApprovalConfigCapability,
  InventoryApprovalConfigId,
  InventoryApprovalConfigQuery,
  InventoryApprovalConfigLeaf,
  InventoryApprovalConfigTreeNode,
  InventoryApprovalConfigTypeOption,
  InventoryApprovalConfigCreateRow,
  InventoryApprovalConfigCreateInputRow,
  InventoryApprovalConfigCreatePreparation,
  InventoryApprovalConfigSetApprovalDraft,
  InventoryApprovalConfigSetApprovalPreparation,
} from './capabilities/inventory-approval-config.js'

export {
  platformSystemQueueStorageCapabilities,
  PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH,
  PLATFORM_SYSTEM_QUEUE_STORAGE_PERMISSION,
  PLATFORM_SYSTEM_QUEUE_STORAGE_MODULE_TYPE,
  PLATFORM_SYSTEM_QUEUE_STORAGE_METHODS,
} from './capabilities/platform-system-queue-storage.js'
export type {
  PlatformSystemQueueStorageCapability,
  PlatformSystemQueueStorageField,
  PlatformSystemQueueStorageForm,
} from './capabilities/platform-system-queue-storage.js'
export {
  productBusinessAgeDivisionCapabilities,
  PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH,
  PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_MODULE_TYPE,
  PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_METHODS,
} from './capabilities/product-business-age-division.js'
export type {
  ProductBusinessAgeDivisionCapability,
  ProductBusinessAgeDivisionId,
  ProductBusinessAgeDivisionMoult,
  ProductBusinessAgeDivisionBulkQuery,
  ProductBusinessAgeDivisionBatchQuery,
  ProductBusinessAgeDivisionBulkRow,
  ProductBusinessAgeDivisionBatchRow,
  ProductBusinessAgeDivisionPage,
  ProductBusinessAgeDivisionBulkForm,
  ProductBusinessAgeDivisionBulkDraft,
  ProductBusinessAgeDivisionBatchForm,
  ProductBusinessAgeDivisionBatchDraft,
} from './capabilities/product-business-age-division.js'
export {
  productBusinessDataRetransmitCapabilities,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_MODULE_TYPE,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS,
} from './capabilities/product-business-data-retransmit.js'
export type {
  ProductBusinessDataRetransmitCapability,
  ProductBusinessDataRetransmitSapUploadType,
  ProductBusinessDataRetransmitFinanceType,
  ProductBusinessDataRetransmitId,
  ProductBusinessDataRetransmitSapUploadForm,
  ProductBusinessDataRetransmitSapQuery,
  ProductBusinessDataRetransmitDetail,
  ProductBusinessDataRetransmitRow,
  ProductBusinessDataRetransmitPage,
  ProductBusinessDataRetransmitFinanceForm,
  ProductBusinessDataRetransmitFinanceDraft,
} from './capabilities/product-business-data-retransmit.js'
export {
  productBusinessSetupMaterialCodeCapabilities,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MODULE_TYPE,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_QUERY_PERMISSION,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_QUERY_PERMISSION,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS,
} from './capabilities/product-business-setup-material-code.js'
export type {
  ProductBusinessSetupMaterialCodeCapability,
  ProductBusinessSetupMaterialCodeId,
  ProductBusinessSetupMaterialCodeScalar,
  ProductBusinessSetupMaterialCodeMaterialProp,
  ProductBusinessSetupMaterialCodeQuery,
  ProductBusinessSetupMaterialCodeBatchListInput,
  ProductBusinessSetupMaterialCodeBatchOptionsInput,
  ProductBusinessSetupMaterialCodeFarmLookupInput,
  ProductBusinessSetupMaterialCodeBatchLookupInput,
  ProductBusinessSetupMaterialCodeMaterialOptionsInput,
  ProductBusinessSetupMaterialCodeRow,
  ProductBusinessSetupMaterialCodePage,
  ProductBusinessSetupMaterialCodeBatchRow,
  ProductBusinessSetupMaterialCodeBuildingOption,
  ProductBusinessSetupMaterialCodeBatchOption,
  ProductBusinessSetupMaterialCodeMaterialOption,
  ProductBusinessSetupMaterialCodeForm,
  ProductBusinessSetupMaterialCodeDraft,
} from './capabilities/product-business-setup-material-code.js'
export {
  productHatcheryLibCapabilities,
  PRODUCT_HATCHERY_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_LIB_PERMISSION,
  PRODUCT_HATCHERY_LIB_MODULE_TYPE,
  PRODUCT_HATCHERY_LIB_QUERY_PERMISSION,
  PRODUCT_HATCHERY_LIB_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_LIB_DELETE_PERMISSION,
  PRODUCT_HATCHERY_LIB_METHODS,
} from './capabilities/product-hatchery-lib.js'
export type {
  ProductHatcheryLibCapability,
  ProductHatcheryLibId,
  ProductHatcheryLibFlag,
  ProductHatcheryLibQuery,
  ProductHatcheryLibRow,
  ProductHatcheryLibPage,
  ProductHatcheryLibTemperatureOption,
  ProductHatcheryLibFile,
  ProductHatcheryLibCreateForm,
  ProductHatcheryLibCreateInput,
  ProductHatcheryLibCreateResult,
  ProductHatcheryLibUpdateForm,
} from './capabilities/product-hatchery-lib.js'
export {
  productHatcheryMethodCapabilities,
  PRODUCT_HATCHERY_METHOD_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_PERMISSION,
  PRODUCT_HATCHERY_METHOD_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_METHOD_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHODS,
} from './capabilities/product-hatchery-method.js'
export type {
  ProductHatcheryMethodCapability,
  ProductHatcheryMethodId,
  ProductHatcheryMethodQuery,
  ProductHatcheryMethodRow,
  ProductHatcheryMethodPage,
  ProductHatcheryMethodCreateForm,
  ProductHatcheryMethodCreateDraft,
  ProductHatcheryMethodUpdateForm,
  ProductHatcheryMethodUpdateDraft,
} from './capabilities/product-hatchery-method.js'
export {
  productHatcheryMethodLibCapabilities,
  PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_LIB_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_METHODS,
} from './capabilities/product-hatchery-method-lib.js'
export type {
  ProductHatcheryMethodLibCapability,
  ProductHatcheryMethodLibId,
  ProductHatcheryMethodLibFlag,
  ProductHatcheryMethodLibQuery,
  ProductHatcheryMethodLibRow,
  ProductHatcheryMethodLibPage,
  ProductHatcheryMethodLibTemperatureOption,
  ProductHatcheryMethodLibFile,
  ProductHatcheryMethodLibCreateForm,
  ProductHatcheryMethodLibCreateInput,
  ProductHatcheryMethodLibCreateResult,
  ProductHatcheryMethodLibUpdateForm,
} from './capabilities/product-hatchery-method-lib.js'
export {
  productHatcheryMethodLibIndicatorCapabilities,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_MODULE_TYPE,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_INDICATOR_METHODS,
} from './capabilities/product-hatchery-method-lib-indicator.js'
export {
  productHatcheryStandardIndicatorCapabilities,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_MODULE_TYPE,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_QUERY_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_DELETE_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS,
} from './capabilities/product-hatchery-standard-indicator.js'
export type {
  ProductHatcheryStandardIndicatorCapability,
  ProductHatcheryStandardIndicatorId,
  ProductHatcheryStandardIndicatorContentType,
  ProductHatcheryStandardIndicatorFlag,
  ProductHatcheryStandardIndicatorQuery,
  ProductHatcheryStandardIndicatorTraitOption,
  ProductHatcheryStandardIndicatorRow,
  ProductHatcheryStandardIndicatorPage,
  ProductHatcheryStandardIndicatorForm,
  ProductHatcheryStandardIndicatorCreateDraft,
  ProductHatcheryStandardIndicatorUpdateDraft,
  ProductHatcheryStandardIndicatorCreateResult,
  ProductHatcheryStandardIndicatorFile,
} from './capabilities/product-hatchery-standard-indicator.js'
export type {
  ProductHatcheryMethodLibIndicatorCapability,
  ProductHatcheryMethodLibIndicatorId,
  ProductHatcheryMethodLibIndicatorTraitType,
  ProductHatcheryMethodLibIndicatorListQuery,
  ProductHatcheryMethodLibIndicatorRow,
  ProductHatcheryMethodLibIndicatorPage,
  ProductHatcheryMethodLibIndicatorTraitOption,
  ProductHatcheryMethodLibIndicatorTraitOptionsInput,
  ProductHatcheryMethodLibIndicatorCreateForm,
  ProductHatcheryMethodLibIndicatorCreateDraft,
  ProductHatcheryMethodLibIndicatorCreateInput,
  ProductHatcheryMethodLibIndicatorCreateResult,
  ProductHatcheryMethodLibIndicatorUpdateForm,
  ProductHatcheryMethodLibIndicatorUpdateDraft,
  ProductHatcheryMethodLibIndicatorRemoveForm,
  ProductHatcheryMethodLibIndicatorRemoveDraft,
  ProductHatcheryMethodLibIndicatorFile,
} from './capabilities/product-hatchery-method-lib-indicator.js'
export {
  productHatcheryUnitCapabilities,
  PRODUCT_HATCHERY_UNIT_PAGE_PATH,
  PRODUCT_HATCHERY_UNIT_PERMISSION,
  PRODUCT_HATCHERY_UNIT_MODULE_TYPE,
  PRODUCT_HATCHERY_UNIT_QUERY_PERMISSION,
  PRODUCT_HATCHERY_UNIT_SUBMIT_PERMISSION,
  PRODUCT_HATCHERY_UNIT_DELETE_PERMISSION,
  PRODUCT_HATCHERY_UNIT_METHODS,
} from './capabilities/product-hatchery-unit.js'
export type {
  ProductHatcheryUnitCapability,
  ProductHatcheryUnitId,
  ProductHatcheryUnitContentType,
  ProductHatcheryUnitQuery,
  ProductHatcheryUnitRow,
  ProductHatcheryUnitPage,
  ProductHatcheryUnitCreateForm,
  ProductHatcheryUnitCreateDraft,
  ProductHatcheryUnitUpdateForm,
  ProductHatcheryUnitUpdateDraft,
} from './capabilities/product-hatchery-unit.js'
export {
  productPlanPreviewCapabilities,
  PRODUCT_PLAN_PREVIEW_PAGE_PATH,
  PRODUCT_PLAN_PREVIEW_PERMISSION,
  PRODUCT_PLAN_PREVIEW_MODULE_TYPE,
  PRODUCT_PLAN_PREVIEW_URL,
  PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID,
  PRODUCT_PLAN_PREVIEW_METHODS,
  buildProductPlanPreviewParams,
  normalizeProductPlanPreview,
} from './capabilities/product-plan-preview.js'
export type {
  ProductPlanPreviewCapability,
  ProductPlanPreviewQuery,
  ProductPlanPreviewVideo,
  ProductPlanPreviewItem,
  ProductPlanPreviewSection,
  ProductPlanPreviewDay,
  ProductPlanPreviewResult,
} from './capabilities/product-plan-preview.js'
export {
  saleCustomQrCapabilities,
  SALE_CUSTOM_QR_PAGE_PATH,
  SALE_CUSTOM_QR_PERMISSION,
  SALE_CUSTOM_QR_MODULE_TYPE,
  SALE_CUSTOM_QR_METHODS,
} from './capabilities/sale-custom-qr.js'
export type {
  SaleCustomQrCapability,
  SaleCustomQrId,
  SaleCustomQrShopId,
  SaleCustomQrSupplierRow,
  SaleCustomQrSupplierQuery,
  SaleCustomQrItemKindRow,
  SaleCustomQrFieldRow,
  SaleCustomQrOrderFieldOption,
  SaleCustomQrForm,
  SaleCustomQrCreateForm,
  SaleCustomQrUpdateForm,
  SaleCustomQrDraft,
  SaleCustomQrUpdateDraft,
  SaleCustomQrFormPreparation,
  SaleCustomQrUpdatePreparation,
  SaleCustomQrRemovePreparation,
} from './capabilities/sale-custom-qr.js'
export {
  settingDictPlatformFinanceCapabilities,
  SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH,
  SETTING_DICT_PLATFORM_FINANCE_PERMISSION,
  SETTING_DICT_PLATFORM_FINANCE_MODULE_TYPE,
  SETTING_DICT_PLATFORM_FINANCE_SYSTEM,
  SETTING_DICT_PLATFORM_FINANCE_METHODS,
} from './capabilities/setting-dict-platform-finance.js'
export type {
  SettingDictPlatformFinanceCapability,
  SettingDictPlatformFinanceTypeQuery,
  SettingDictPlatformFinanceTypeRow,
  SettingDictPlatformFinanceDataQuery,
  SettingDictPlatformFinanceDataRow,
  SettingDictPlatformFinanceDataCreateInput,
  SettingDictPlatformFinanceDataGetInput,
  SettingDictPlatformFinanceDataRemoveInput,
  SettingDictPlatformFinanceId,
} from './capabilities/setting-dict-platform-finance.js'
export {
  settingDictPlatformCommonCapabilities,
  SETTING_DICT_PLATFORM_COMMON_PAGE_PATH,
  SETTING_DICT_PLATFORM_COMMON_PERMISSION,
  SETTING_DICT_PLATFORM_COMMON_MODULE_TYPE,
  SETTING_DICT_PLATFORM_COMMON_SYSTEM,
  SETTING_DICT_PLATFORM_COMMON_METHODS,
} from './capabilities/setting-dict-platform-common.js'
export type {
  SettingDictPlatformCommonCapability,
  SettingDictPlatformCommonId,
  SettingDictPlatformCommonStatus,
  SettingDictPlatformCommonTypeRow,
  SettingDictPlatformCommonTypeQuery,
  SettingDictPlatformCommonDataRow,
  SettingDictPlatformCommonDataQuery,
  SettingDictPlatformCommonDataCreateInput,
  SettingDictPlatformCommonDataUpdateInput,
  SettingDictPlatformCommonDataGetInput,
  SettingDictPlatformCommonDataRemoveInput,
} from './capabilities/setting-dict-platform-common.js'
export {
  settingDictPlatformHrCapabilities,
  SETTING_DICT_PLATFORM_HR_PAGE_PATH,
  SETTING_DICT_PLATFORM_HR_PERMISSION,
  SETTING_DICT_PLATFORM_HR_MODULE_TYPE,
  SETTING_DICT_PLATFORM_HR_SYSTEM,
  SETTING_DICT_PLATFORM_HR_METHODS,
} from './capabilities/setting-dict-platform-hr.js'
export type {
  SettingDictPlatformHrCapability,
  SettingDictPlatformHrId,
  SettingDictPlatformHrStatus,
  SettingDictPlatformHrTypeRow,
  SettingDictPlatformHrTypeQuery,
  SettingDictPlatformHrDataRow,
  SettingDictPlatformHrDataQuery,
  SettingDictPlatformHrDataCreateInput,
  SettingDictPlatformHrDataUpdateInput,
  SettingDictPlatformHrDataGetInput,
  SettingDictPlatformHrDataRemoveInput,
} from './capabilities/setting-dict-platform-hr.js'
export {
  settingDictPlatformMaterialCapabilities,
  SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH,
  SETTING_DICT_PLATFORM_MATERIAL_PERMISSION,
  SETTING_DICT_PLATFORM_MATERIAL_MODULE_TYPE,
  SETTING_DICT_PLATFORM_MATERIAL_SYSTEM,
  SETTING_DICT_PLATFORM_MATERIAL_METHODS,
} from './capabilities/setting-dict-platform-material.js'
export type {
  SettingDictPlatformMaterialCapability,
  SettingDictPlatformMaterialId,
  SettingDictPlatformMaterialTypeRow,
  SettingDictPlatformMaterialTypeQuery,
  SettingDictPlatformMaterialDataRow,
  SettingDictPlatformMaterialDataQuery,
  SettingDictPlatformMaterialDataCreateInput,
  SettingDictPlatformMaterialDataUpdateInput,
  SettingDictPlatformMaterialDataGetInput,
  SettingDictPlatformMaterialDataRemoveInput,
} from './capabilities/setting-dict-platform-material.js'
export {
  settingDictPlatformProductCapabilities,
  SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH,
  SETTING_DICT_PLATFORM_PRODUCT_PERMISSION,
  SETTING_DICT_PLATFORM_PRODUCT_MODULE_TYPE,
  SETTING_DICT_PLATFORM_PRODUCT_SYSTEM,
  SETTING_DICT_PLATFORM_PRODUCT_METHODS,
} from './capabilities/setting-dict-platform-product.js'
export type {
  SettingDictPlatformProductCapability,
  SettingDictPlatformProductId,
  SettingDictPlatformProductTypeRow,
  SettingDictPlatformProductTypeQuery,
  SettingDictPlatformProductDataRow,
  SettingDictPlatformProductDataQuery,
  SettingDictPlatformProductDataCreateInput,
  SettingDictPlatformProductDataUpdateInput,
  SettingDictPlatformProductDataGetInput,
  SettingDictPlatformProductDataRemoveInput,
} from './capabilities/setting-dict-platform-product.js'
export {
  settingDictPlatformSupplyCapabilities,
  SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH,
  SETTING_DICT_PLATFORM_SUPPLY_PERMISSION,
  SETTING_DICT_PLATFORM_SUPPLY_MODULE_TYPE,
  SETTING_DICT_PLATFORM_SUPPLY_SYSTEM,
  SETTING_DICT_PLATFORM_SUPPLY_METHODS,
} from './capabilities/setting-dict-platform-supply.js'
export type {
  SettingDictPlatformSupplyCapability,
  SettingDictPlatformSupplyId,
  SettingDictPlatformSupplyTypeRow,
  SettingDictPlatformSupplyTypeQuery,
  SettingDictPlatformSupplyDataRow,
  SettingDictPlatformSupplyDataQuery,
  SettingDictPlatformSupplyDataCreateInput,
  SettingDictPlatformSupplyDataGetInput,
  SettingDictPlatformSupplyDataRemoveInput,
} from './capabilities/setting-dict-platform-supply.js'
export {
  settingDictPlatformSaleCapabilities,
  SETTING_DICT_PLATFORM_SALE_PAGE_PATH,
  SETTING_DICT_PLATFORM_SALE_PERMISSION,
  SETTING_DICT_PLATFORM_SALE_MODULE_TYPE,
  SETTING_DICT_PLATFORM_SALE_SYSTEM,
  SETTING_DICT_PLATFORM_SALE_METHODS,
} from './capabilities/setting-dict-platform-sale.js'
export type {
  SettingDictPlatformSaleCapability,
  SettingDictPlatformSaleId,
  SettingDictPlatformSaleTypeRow,
  SettingDictPlatformSaleTypeQuery,
  SettingDictPlatformSaleDataRow,
  SettingDictPlatformSaleDataQuery,
  SettingDictPlatformSaleDataCreateInput,
  SettingDictPlatformSaleDataUpdateInput,
  SettingDictPlatformSaleDataGetInput,
  SettingDictPlatformSaleDataRemoveInput,
} from './capabilities/setting-dict-platform-sale.js'
export {
  saleVisitRecommendSettingCapabilities,
  SALE_VISIT_RECOMMEND_SETTING_PAGE_PATH,
  SALE_VISIT_RECOMMEND_SETTING_PERMISSION,
  SALE_VISIT_RECOMMEND_SETTING_MODULE_TYPE,
  SALE_VISIT_RECOMMEND_SETTING_METHODS,
} from './capabilities/sale-visit-recommend-setting.js'
export type {
  SaleVisitRecommendSettingCapability,
  SaleVisitRecommendSettingRatio,
  SaleVisitRecommendSettingDetail,
  SaleVisitRecommendSettingKeyAge,
  SaleVisitRecommendSettingForm,
  SaleVisitRecommendSettingSaveDraft,
} from './capabilities/sale-visit-recommend-setting.js'

export {
  IdempotencyStore,
  createRequestId,
  withIdempotency,
  IdempotencyKeyReuseError,
  IdempotencyRequestIdError,
  NotDispatchedError,
} from './idempotency/index.js'
export type {
  IdempotencyIdentity,
  IdempotencyStats,
  IdempotencyStoreOptions,
} from './idempotency/index.js'

export { withAiModelCompatibility, AiModelApplyPartialWriteError, type AiModelFillApplyInput, type AiModelFillReceipt, type CompatibleAiModel } from './capabilities/ai-model-compat.js'
