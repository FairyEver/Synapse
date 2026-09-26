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
import {
  createCatalog,
  visibleCatalogFrom,
  type Catalog,
  type VisibleCatalog,
  type VisibleCatalogInput,
} from './catalog/index.js'
import {
  SessionStore,
  createPortalBaseDataRegistry,
  createPortalRequestFactory,
  type PortalSession,
  type PortalRequestContext,
  type PortalRequestFactory,
  type SessionStoreOptions,
} from './session/index.js'
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
  createCertificateLicenseCapability,
  CERTIFICATE_LICENSE_PAGE_PATH,
  type CertificateLicenseCapability,
} from './capabilities/certificate-license.js'
import {
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
  createPieceCapability,
  PIECE_PAGE_PATH,
  type PieceCapability,
} from './capabilities/piece.js'
import {
  createBusinessRegistrationCapability,
  BUSINESS_REGISTRATION_PAGE_PATH,
  type BusinessRegistrationCapability,
} from './capabilities/business-registration.js'
import {
  createCompanyPolicyCapability,
  COMPANY_POLICY_PAGE_PATH,
  type CompanyPolicyCapability,
} from './capabilities/company-policy.js'
import {
  createHonorCapability,
  HONOR_PAGE_PATH,
  type HonorCapability,
} from './capabilities/honor.js'
import {
  createLegalDisputeCapability,
  LEGAL_DISPUTE_PAGE_PATH,
  type LegalDisputeCapability,
} from './capabilities/legal-dispute.js'
import {
  createQualificationCapability,
  QUALIFICATION_PAGE_PATH,
  type QualificationCapability,
} from './capabilities/qualification.js'
import {
  createPatentCapability,
  PATENT_PAGE_PATH,
  type PatentCapability,
} from './capabilities/patent.js'
import {
  createSoftwareCapability,
  SOFTWARE_PAGE_PATH,
  type SoftwareCapability,
} from './capabilities/software.js'
import {
  createStandardDocumentCapability,
  STANDARD_DOCUMENT_PAGE_PATH,
  type StandardDocumentCapability,
} from './capabilities/standard-document.js'
import {
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
  type ContractCreateCapabilityWithIdempotency,
  type ContractCreateDraft,
} from './capabilities/contract-create.js'
import {
  baseDeptDictPermissionCapabilities,
  baseDeptPermissionBaseData,
  BASE_DATA_KEYS,
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
import { ALL_CAPABILITY_DEFINITIONS } from './capabilities/index.js'
import type { CapabilityDefinition } from './capabilities/types.js'
import {
  attachCapabilityInvoker,
  createCapabilityInvoker,
  type CapabilityRegistry,
} from './capabilities/invoke.js'
import { createPageCall } from './call.js'
import { applyInvalidation } from './invalidation/index.js'
import type { PortalHeadlessConfig } from './config.js'
import type { PortalRequestConfig } from './http/client.js'
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
  AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
  AI_KNOWLEDGE_REVIEW_PAGE_PATH,
} from './capabilities/ai-knowledge.js'
import {
  createAiInteractionQaCapability,
  AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
  AI_INTERACTION_CHAT_PAGE_PATH,
  AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
  AI_INTERACTION_FEEDBACK_PAGE_PATH,
} from './capabilities/ai-interaction-qa.js'
import {
  createAiModelCapability,
  AI_MODEL_LIST_PAGE_PATH,
  AI_MODEL_SELECT_PAGE_PATH,
  AI_PLATFORM_USAGE_PAGE_PATH,
  AI_DATA_ANALYSIS_PAGE_PATH,
} from './capabilities/ai-model.js'
import {
  createModelUsageCapability,
  PERSONAL_USAGE_PAGE_PATH,
} from './capabilities/model-usage.js'
import {
  createAiPromptCapability,
  AI_PROMPT_TYPE_PAGE_PATH,
  AI_PROMPT_SKILL_PAGE_PATH,
  AI_PROMPT_INTENT_PAGE_PATH,
} from './capabilities/ai-prompt.js'
import {
  createAiPromptToolCapability,
  AI_BUSINESS_EVENT_PAGE_PATH,
  AI_OPEN_API_REGISTRY_PAGE_PATH,
  AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
} from './capabilities/ai-prompt-tool.js'
import { createChatCapability, CHAT_PAGE_PATH, CHAT_AGENT_ORCHESTRATION_DICT_TYPE } from './capabilities/chat.js'
import type { AiKnowledgeCapability } from './capabilities/ai-knowledge.js'
import type { AiInteractionQaCapability } from './capabilities/ai-interaction-qa.js'
import type { AiModelCapability } from './capabilities/ai-model.js'
import type { ModelUsageCapability } from './capabilities/model-usage.js'
import type { AiPromptCapability } from './capabilities/ai-prompt.js'
import type { AiPromptToolCapability } from './capabilities/ai-prompt-tool.js'
import type { ChatCapability } from './capabilities/chat.js'
import { IdempotencyStore, withIdempotency } from './idempotency/index.js'

/**
 * 服务端多用户门面。
 *
 * 与 `createPortalHeadless` 的区别只在**服务几个人**：
 * - `createPortalHeadless(config)` 把凭据绑在实例上，一个进程服务一个 Portal 用户，
 *   适合 CLI、冒烟脚本、单账号任务。
 * - `createPortalServer({ baseUrl })` 按会话取凭据，一个进程服务多个用户 + 多租户，
 *   是 SY 服务端要用的形态（设计 A2：用户带自己的 SY ID 与 Portal 凭据请求）。
 *
 * 为什么要分成两个入口：`createPortalHttp(config)` 的凭据与语言是**创建时绑定**的，
 * 拦截器闭包读的就是那份 config，没法靠给单次请求传参换人。所以多用户形态下
 * **一份会话一个请求函数**（见 `src/session/portal-http.ts` 开头的说明）。
 * 这是有意的取舍：一份凭据一个实例，请求头天然不会串用户。
 */

export type SessionScopedPortal = CompatibleAiModelHost<{
  /** 这份会话本身：基础数据、失效、统计都从这里看 */
  session: PortalSession
  /** 按页面上下文发请求（自动推导并带上该页面的 module-type） */
  call: <T>(pagePath: string, config: PortalRequestConfig) => Promise<T>
  /**
   * 这份会话的能力定义 + 通用调用入口，与单用户门面等价：
   *
   * ```ts
   * await scoped.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
   * ```
   *
   * `invoke` 绑的是**这份会话**的能力方法（凭据、module-type 都是这一份的），
   * 所以多用户场景下不会串人；定义本身是服务级共享的静态数据。
   */
  capabilities: CapabilityRegistry
  /** 批量生成且已通过范围/静态契约门禁的只读列表能力。 */
  batch: BatchCapabilityHost
  /**
   * 取**这份会话的用户**能看到的菜单，据此给出收敛后的目录（设计 D8 / F18 / H36）。
   *
   * ⚠️ 多用户形态下这一条是**按会话**的，所以它挂在这里而不是 `server.catalog` 上：
   * 菜单是 per-(用户, 租户, 项目) 的，服务级那份 `catalog` 是静态共享的，
   * 在它上面过滤会把一个用户的可见面泄漏给另一个用户。
   *
   * 语义与单用户门面的 `PortalHeadless.visibleCatalog()` 完全一致（同一份
   * `visibleCatalogFrom` 实现）：**显式调**、取不到就失败关闭、收敛不等于拦住。
   * 详见那边的注释与 `src/catalog/README.md`。
   */
  visibleCatalog: (input: VisibleCatalogInput) => Promise<VisibleCatalog>
  meetingRoom: MeetingRoomCapability
  /** 写能力带 `submitIdempotent`（短窗口防重，设计 D12） */
  meetingApplication: MeetingApplicationCapabilityWithIdempotency
  /** 只读列表能力：考勤档案（见 docs/pages/考勤档案.md） */
  attendanceArchive: AttendanceArchiveSheetCapability
  /** 只读列表能力：考勤统计（与档案页同接口的另一页，见 docs/pages/考勤统计.md） */
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
  /** 作业管理：写能力里**只有 create** 带 `createIdempotent`（见 docs/pages/作业管理.md） */
  assignment: AssignmentCapabilityWithIdempotency
  /** 班次管理：与作业管理同族，写能力里**只有 create** 带 `createIdempotent` */
  attendanceShift: AttendanceShiftCapabilityWithIdempotency
  /** 待办事项：只读，只有 `list`（会改数据的动作都在别的页面上） */
  backlogTaskExamine: BacklogTaskExamineCapability
  /** 图库管理：**两个**会产生新记录的写能力带 `createIdempotent` / `createReleaseIdempotent` */
  baseImage: BaseImageCapabilityWithIdempotency
  /** 排班管理：一个页面两条数据线（考勤组本体 + 它的排班），只有 create 带防重 */
  attendanceTeam: AttendanceTeamCapabilityWithIdempotency
  /** 组织结构：只有 create 带防重；`checkStatus` 名字像写、其实是只读 */
  baseManagementCenter: BaseManagementCenterCapabilityWithIdempotency
  /** 合同模板：只有 create 带防重；「保存并提交」那一支刻意不实现 */
  contractTemplate: ContractTemplateCapabilityWithIdempotency
  /** 合同库：补充协议、签订证明、模拟修改、作废均按 Portal 页面规则暴露 */
  contractLibrary: ContractLibraryCapability
  /** 合同创建：按 Portal 表单、预览、变量和回调顺序暴露 */
  contractCreate: ContractCreateCapabilityWithIdempotency
  /**
   * 基础数据（部门 / 字典 / 权限清单）。**不是页面能力**，`pagePath` 是合成的 `/base-data/*`。
   *
   * 多用户形态下它多一层好处：会话基础数据里已注册 `dept-list` / `permission-list` 两片，
   * 同一份 1 MB 的字典与几千条权限码在一个会话里只拉一遍。
   */
  baseData: BaseDeptDictPermissionCapability
  /**
   * 上传（OSS 直传）。**不是页面能力**，凭据由服务级 `options.oss` 给。
   *
   * 服务级一份是**忠实**的：Portal 前端那份 OSS 配置就是构建期注入、全站共用一份
   * （页面虽然会往下传自己的 config prop，但组件的调用点上没把它传下去，见 docs/base/上传.md）。
   */
  baseUpload: BaseUploadCapability
  /** 应用外壳：用户信息 / 人员 / 待办 / 菜单 / 工作台卡片（合成路径 /base-data/*） */
  baseShell: BaseShellCapability
  /** 通用审批：流程表单线第一条；写能力里**只有 submit** 带 `submitIdempotent` */
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
  /** **课程管理三页**（页面队列，见 `docs/pages/图文课程.md`）。三个只读列表能力。 */
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
  /** 人工智能·智能交互「模型与用量」四页（模型列表 / 模型选择 / 平台用量 / 数据分析）。**含写** */
  aiModel: AiModelCapability
  /** 人工智能·个人用量页面；固定个人维度，含额度申请提交。 */
  modelUsage: ModelUsageCapability
  /** 人工智能·提示工程「基础」三页（提示词类型 / 技能列表 / 意图列表）。**含写** */
  aiPrompt: AiPromptCapability
  /** 人工智能·提示工程「工具绑定」三页（业务事件绑定技能 / 开放接口 / 工具提示词绑定）。**含写** */
  aiPromptTool: AiPromptToolCapability
  chat: ChatCapability
}>

export type PortalServerOptions = Omit<PortalHeadlessConfig, 'credential' | 'portalDevice'> & {
  /**
   * 覆盖会话层默认（TTL / 容量 / 事件回调等）。
   *
   * `createRequest` 显式给出时**整体替换**会话的请求工厂（缺省是
   * `createPortalRequestFactory(config)`，即 `createPortalHttp` 那一层）。
   * 留这个口子是因为 `createPortalServer` 是**一份会话一个 axios 实例**、
   * 实例本身不对外暴露：不换掉它，多用户门面的请求层就桩不掉，
   * 「同一 requestId 在两个用户上不互相命中」这条保障也就无法断言
   * （钉它的用例见 `test/server-multi-user-identity.test.ts`）。
   *
   * 除非在写测试或自建请求层，否则不要传——传了就等于自己承担
   * 凭据绑定、baseURL、请求头这三件事。
   */
  sessionOptions?: Omit<SessionStoreOptions, 'createRequest' | 'registry'> & {
    createRequest?: PortalRequestFactory
  }
}

export type PortalServer = {
  /**
   * 能力目录与检索；所有会话共用一份（它是静态的）。
   *
   * ⚠️ **全量**目录，不做可见性过滤。可见性是 per-(用户, 租户, 项目) 的，在这里过滤
   * 等于把一个用户的可见面泄漏给另一个用户——要收敛请用 `forSession(...).visibleCatalog()`。
   */
  catalog: Catalog
  /** 会话仓库：多用户多租户都从这里取 */
  sessions: SessionStore
  /**
   * 写操作的短窗口防重（设计 D12），服务级共享一份。
   * **它不是幂等**——进程重启、多实例、TTL 过后都不生效，见 `src/idempotency/README.md`。
   */
  idempotency: IdempotencyStore
  /**
   * 取一份会话作用域的门面；同一 (用户, 租户, 语言, 权限上下文) 会复用同一份会话。
   *
   * `language` 可省略，省略时按 `DEFAULT_LANGUAGE` 落进会话键与 `Accept-Language`——
   * 两边用的是同一个值，不会出现「会话键是 zh-CN、请求头是别的」这种静默错配。
   */
  forSession: (input: PortalSessionInput) => Promise<SessionScopedPortal>
}

export type PortalSessionInput = Omit<PortalRequestContext, 'language'> & {
  /** 当前会话实际PC设备，由调用方提供；不得跨用户共享。 */
  portalDevice?: import('./capabilities/portal-device.js').PortalDeviceOptions
  userId: string
  language?: string
  capabilities?: string[]
}

export function createPortalServer (options: PortalServerOptions): PortalServer {
  const { sessionOptions, ...config } = options
  // 显式解构而不是靠 spread 顺序：`createRequest` 缺省由这里给，给了就以给的为准
  const { createRequest: createRequestOverride, ...restSessionOptions } = sessionOptions ?? {}

  // 唯一来源见 src/capabilities/index.ts（这份清单曾经在三个文件里各拼一遍）
  const capabilities: CapabilityDefinition[] = [...ALL_CAPABILITY_DEFINITIONS]
  const catalog = createCatalog({ capabilities })

  const sessions = new SessionStore({
    createRequest: createRequestOverride ?? createPortalRequestFactory(config),
    // 部门与权限码清单跟着会话基础数据一起加载：一个会话里只拉一遍。
    // 字典**不在这里**——它读的是会话里既有的 dict-hr / dict-platform 两片（再注册一片
    // 会让那份 1 MB 在一次会话里被打第三遍）。
    registry: createPortalBaseDataRegistry().registerAll(baseDeptPermissionBaseData),
    ...restSessionOptions,
  })

  // 服务级一份：防重记录要在同一个用户的多次请求之间共享，否则窗口没有意义
  const idempotency = new IdempotencyStore({})

  async function forSession (
    input: PortalSessionInput,
  ): Promise<SessionScopedPortal> {
    const session = await sessions.acquire({
      userId: input.userId,
      tenantId: input.credential.tenantId,
      credential: input.credential,
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.permissionContext === undefined ? {} : { permissionContext: input.permissionContext }),
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
    })

    // 会话里的 request 是「不带页面上下文」的原始请求函数；
    // 页面能力必须走带 module-type 解析的那一层，否则会丢掉 module-type。
    const rawCall = createPageCall(
      session.request,
      config.moduleTypeFallback,
      config.httpBaseUrls === undefined ? undefined : { baseUrls: config.httpBaseUrls },
    )

    // 公共数据缓存只按已有的写入证据表失效；不能靠 HTTP 动词猜测，Portal 有多条
    // 只读 POST（准备审批人、时长计算、候选分页、连通性试检等），也有 GET 写动作。
    let invalidateBaseData: ((slice?: 'dept' | 'dict' | 'permission') => void) | undefined
    let invalidateBaseShell: ((slice?: 'user-info' | 'menu-nav' | 'home-widgets') => void) | undefined
    let invalidateBaseTenant: ((slice?: 'tenant-list') => void) | undefined
    let invalidateBaseSale: ((slice?: 'sale-shop' | 'sale-area' | 'sale-manufacturer' | 'sale-brand') => void) | undefined

    const invalidatePublicCaches = (requestConfig: PortalRequestConfig): void => {
      const applied = applyInvalidation(session, {
        path: requestConfig.url,
        method: requestConfig.method,
      })
      const keys = new Set(applied.keys)
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

    const meetingApplicationBase = createMeetingApplicationCapability((requestConfig) =>
      call(MEETING_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const meetingRoom = createMeetingRoomCapability((requestConfig) =>
      call(MEETING_ROOM_PAGE_PATH, requestConfig as never),
    )

    const attendanceArchive = createAttendanceArchiveSheetCapability((requestConfig) =>
      call(ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH, requestConfig as never),
    )
    const attendanceAnnualLeave = createAttendanceAnnualLeaveCapability((requestConfig) =>
      call(ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH, requestConfig as never),
    )
    const attendanceException = createAttendanceExceptionCapability((requestConfig) =>
      call(ATTENDANCE_EXCEPTION_PAGE_PATH, requestConfig as never),
    )
    const attendanceSchedualInformation = createAttendanceSchedualInformationCapability((requestConfig) =>
      call(ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH, requestConfig as never),
    )
    const certificateLicense = createCertificateLicenseCapability((requestConfig) =>
      call(CERTIFICATE_LICENSE_PAGE_PATH, requestConfig as never),
    )
    const certificateType = createCertificateTypeCapability((requestConfig) =>
      call(CERTIFICATE_TYPE_PAGE_PATH, requestConfig as never),
    )
    const institutionType = createInstitutionTypeCapability((requestConfig) =>
      call(INSTITUTION_TYPE_PAGE_PATH, requestConfig as never),
    )
    const piece = createPieceCapability((requestConfig) =>
      call(PIECE_PAGE_PATH, requestConfig as never),
    )
    const businessRegistration = createBusinessRegistrationCapability((requestConfig) =>
      call(BUSINESS_REGISTRATION_PAGE_PATH, requestConfig as never),
    )
    const companyPolicy = createCompanyPolicyCapability((requestConfig) =>
      call(COMPANY_POLICY_PAGE_PATH, requestConfig as never),
    )
    const honor = createHonorCapability((requestConfig) =>
      call(HONOR_PAGE_PATH, requestConfig as never),
    )
  const legalDispute = createLegalDisputeCapability((requestConfig) =>
    call(LEGAL_DISPUTE_PAGE_PATH, requestConfig as never),
  )
  const qualification = createQualificationCapability((requestConfig) =>
    call(QUALIFICATION_PAGE_PATH, requestConfig as never),
  )
  const patent = createPatentCapability((requestConfig) =>
      call(PATENT_PAGE_PATH, requestConfig as never),
    )
  const software = createSoftwareCapability((requestConfig) =>
    call(SOFTWARE_PAGE_PATH, requestConfig as never),
  )
  const standardDocument = createStandardDocumentCapability((requestConfig) =>
    call(STANDARD_DOCUMENT_PAGE_PATH, requestConfig as never),
  )
  const trademark = createTrademarkCapability((requestConfig) =>
    call(TRADEMARK_PAGE_PATH, requestConfig as never),
  )
    const attendanceOvertime = createAttendanceOvertimeCapability((requestConfig) =>
      call(ATTENDANCE_OVERTIME_PAGE_PATH, requestConfig as never),
    )

    const hrPostType = createHrPostTypeCapability(requestConfig => call(HR_POST_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig))
    const portalDevice = createPortalDeviceCapability(requestConfig => call(PORTAL_DEVICE_PAGE_PATH, requestConfig as PortalRequestConfig), input.portalDevice)
    const hrOrganizationType = createHrOrganizationTypeCapability(
      requestConfig => call(HR_ORGANIZATION_TYPE_PAGE_PATH, requestConfig as PortalRequestConfig),
      requestConfig => trackRequest(session.request(requestConfig as PortalRequestConfig), requestConfig as PortalRequestConfig),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: params => financeLedgerAccountsBase.prepareCreate(params).draft,
        send: params => financeLedgerAccountsBase.create(params),
      }),
      importIdempotent: withIdempotency<FinanceLedgerAccountFileInput, true>({
        store: idempotency,
        capabilityId: 'finance-ledger-account-import',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
      requestConfig => call(FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH, requestConfig as never),
    )
    const financeSettingOpeningSupplierBase = createFinanceSettingOpeningSupplierCapability(
      requestConfig => call(FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH, requestConfig as never),
    )
    const financeSettingOpeningSupplier: FinanceSettingOpeningSupplierCapabilityWithIdempotency = {
      ...financeSettingOpeningSupplierBase,
      createIdempotent: withIdempotency<{ draft: FinanceSettingOpeningSupplierSaveDraft }, Awaited<ReturnType<typeof financeSettingOpeningSupplierBase.create>>, FinanceSettingOpeningSupplierSaveDraft>({
        store: idempotency,
        capabilityId: 'finance-setting-opening-supplier-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
      identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: buildSheetPayload,
        send: draft => attendanceSheetBase.save(draft),
      }),
    }

    const attendanceStatistics = createAttendanceStatisticsCapability((requestConfig) =>
      call(ATTENDANCE_STATISTICS_PAGE_PATH, requestConfig as never),
    )

    const meetingApplication: MeetingApplicationCapabilityWithIdempotency = {
      ...meetingApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'meeting-application-submit',
        // 身份来自这份会话，不是服务级配置——这正是多用户形态比单用户更该用它的原因
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildMeetingApplicationPayload(params),
        send: (params, { payload }) =>
          meetingApplicationBase.submit(
            payload as unknown as MeetingApplicationDraft,
            params.startUserSelectAssignees ?? {},
          ),
      }),
    }

    const assignmentBase = createAssignmentCapability((requestConfig) =>
      call(ASSIGNMENT_PAGE_PATH, requestConfig as never),
    )

    const assignment: AssignmentCapabilityWithIdempotency = {
      ...assignmentBase,
      // 这个页面只有 create 需要防重（另外三个写操作重发终态相同），
      // 理由逐条写在 src/capabilities/assignment.ts 的文件头
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'assignment-create',
        // 身份来自这份会话：多用户下两个用户的同一个 requestId 不能互相命中
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildAssignmentPayload(params),
        send: (params, { payload }) =>
          assignmentBase.create(payload as unknown as AssignmentDraft),
      }),
    }

    const attendanceShiftBase = createAttendanceShiftCapability((requestConfig) =>
      call(ATTENDANCE_SHIFT_PAGE_PATH, requestConfig as never),
    )

    const attendanceShift: AttendanceShiftCapabilityWithIdempotency = {
      ...attendanceShiftBase,
      // 只有 create 需要防重（另外几个写操作重发终态相同），
      // 理由逐条写在 src/capabilities/attendance-shift.ts 的文件头
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'attendance-shift-create',
        // 身份来自这份会话：多用户下两个用户的同一个 requestId 不能互相命中
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildShiftPayload(params),
        send: (params, { payload }) =>
          attendanceShiftBase.create(payload as unknown as AttendanceShiftDraft),
      }),
    }

    const backlogTaskExamine = createBacklogTaskExamineCapability((requestConfig) =>
      call(BACKLOG_TASK_EXAMINE_PAGE_PATH, requestConfig as never),
    )

    const baseImageBase = createBaseImageCapability((requestConfig) =>
      call(BASE_IMAGE_PAGE_PATH, requestConfig as never),
    )

    // 两个会产生新记录的写能力都要包；update / setStatus / remove 不要包
    // （重发一次终态相同，实测依据见 docs/pages/图库管理.md 的写链路一节）
    const baseImage: BaseImageCapabilityWithIdempotency = {
      ...baseImageBase,
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'base-image-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        send: (params, { payload }) => baseImageBase.create(payload as unknown as BaseImageDraft),
      }),
      createReleaseIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'base-image-create-release',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        send: (params, { payload }) => baseImageBase.createRelease(payload as unknown as BaseImageDraft),
      }),
    }

    const attendanceTeamBase = createAttendanceTeamCapability((requestConfig) =>
      call(ATTENDANCE_TEAM_PAGE_PATH, requestConfig as never),
    )

    const attendanceTeam: AttendanceTeamCapabilityWithIdempotency = {
      ...attendanceTeamBase,
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'attendance-team-create',
        // 身份来自这份会话：多用户下两个用户的同一个 requestId 不能互相命中
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildGroupPayload(params),
        send: (params, { payload }) =>
          attendanceTeamBase.create(payload as unknown as AttendanceTeamDraft),
      }),
    }

    const baseManagementCenterBase = createBaseManagementCenterCapability((requestConfig) =>
      call(BASE_MANAGEMENT_CENTER_PAGE_PATH, requestConfig as never),
    )

    const baseManagementCenter: BaseManagementCenterCapabilityWithIdempotency = {
      ...baseManagementCenterBase,
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'base-management-center-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildManagementCenterPayload(params),
        send: (params, { payload }) =>
          baseManagementCenterBase.create(payload as unknown as ManagementCenterDraft),
      }),
    }

    const contractTemplateBase = createContractTemplateCapability((requestConfig) =>
      call(CONTRACT_TEMPLATE_PAGE_PATH, requestConfig as never),
    )

    const contractTemplate: ContractTemplateCapabilityWithIdempotency = {
      ...contractTemplateBase,
      createIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'contract-template-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildTemplatePayload(params),
        send: (params, { payload }) =>
          contractTemplateBase.create(payload as unknown as ContractTemplateDraft),
      }),
    }

    const contractLibrary = createContractLibraryCapability((requestConfig) =>
      call(CONTRACT_LIBRARY_PAGE_PATH, requestConfig as never),
    )

    const contractCreateBase = createContractCreateCapability((requestConfig) =>
      call(CONTRACT_CREATE_PAGE_PATH, requestConfig as never),
    )
    const contractCreate: ContractCreateCapabilityWithIdempotency = {
      ...contractCreateBase,
      createIdempotent: withIdempotency<{ draft: ContractCreateDraft }, Awaited<ReturnType<typeof contractCreateBase.create>>, ContractCreateDraft>({
        store: idempotency,
        capabilityId: 'contract-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: params => normalizeContractCreateDraft(params.draft),
        send: (_params, { payload }) => contractCreateBase.create({ draft: payload }),
      }),
    }

    // 基础数据：`request` 用**这份会话的** `call`，并把 `session` 传进去，
    // 于是同一会话内的字典/权限码只拉一遍（`PortalSession` 结构上就满足它要求的读写视图）
    const baseData = session.getOrCreateScoped(
      'capability:base-data',
      () => createBaseDeptDictPermission({
        request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
          call<T>(BASE_DEPT_LIST_PATH, requestConfig as PortalRequestConfig),
        session,
      }),
      [BASE_DATA_KEYS.dept, BASE_DATA_KEYS.permission, 'dict-hr', 'dict-platform'],
    )
    invalidateBaseData = baseData.invalidate

    // 上传：服务级一份（OSS 配置与用户无关，见类型注释）。凭据没配也给一份能力，
    // 真要上传时才失败关闭——与单用户门面同一个取舍。
    const baseUpload = createBaseUploadCapability(config.oss ?? {})

    const generalApprovalBase = createGeneralApprovalCapability((requestConfig) =>
      call(GENERAL_APPROVAL_PAGE_PATH, requestConfig as never),
    )

    // 只有 submit 需要防重。**这一条比普通 CRUD 更该防重**：后端零幂等，
    // 重发一次就是第二条流程实例 + 第二串真人待办。
    const generalApproval: GeneralApprovalCapabilityWithIdempotency = {
      ...generalApprovalBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'general-approval-submit',
        // 身份来自这份会话：多用户下两个用户的同一个 requestId 不能互相命中
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildGeneralApprovalPayload(params),
        send: (params, { payload }) =>
          generalApprovalBase.submit(
            payload as unknown as GeneralApprovalDraft,
            params.startUserSelectAssignees ?? {},
          ),
      }),
    }

    const leaveApplicationBase = createLeaveApplicationCapability((requestConfig) =>
      call(LEAVE_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const leaveApplication: LeaveApplicationCapabilityWithIdempotency = {
      ...leaveApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'leave-application-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
      call(VEHICLE_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const vehicleApplication: VehicleApplicationCapabilityWithIdempotency = {
      ...vehicleApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'vehicle-application-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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
      call(TRAVEL_EXPENSE_PAGE_PATH, requestConfig as never),
    )

    const travelExpense: TravelExpenseCapabilityWithIdempotency = {
      ...travelExpenseBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'travel-expense-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildTravelPayload(params),
        send: (params, { payload }) =>
          travelExpenseBase.submit(payload as unknown as TravelExpenseDraft),
      }),
    }

    const productDesignApprovalBase = createProductDesignApprovalCapability((requestConfig) =>
      call(PRODUCT_DESIGN_APPROVAL_PAGE_PATH, requestConfig as never),
    )

    const productDesignApproval: ProductDesignApprovalCapabilityWithIdempotency = {
      ...productDesignApprovalBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'product-design-approval-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => buildProductDesignApprovalPayload(params),
        send: (params, { payload }) =>
          productDesignApprovalBase.submit(
            payload as unknown as ProductDesignApprovalDraft,
            params.startUserSelectAssignees ?? {},
          ),
      }),
    }

    const taskActionBase = createTaskActionCapability(
      (requestConfig) => call(TASK_ACTION_DETAIL_PAGE_PATH, requestConfig as never),
      (requestConfig) => call(TASK_ACTION_BATCH_PAGE_PATH, requestConfig as never),
    )

    const taskActionIdentity = () => ({
      userId: input.userId,
      tenantId: input.credential.tenantId,
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
      call(OVERTIME_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const overtimeApplication: OvertimeApplicationCapabilityWithIdempotency = {
      ...overtimeApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'overtime-application-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        send: (params, { payload }) =>
          overtimeApplicationBase.submit(payload as unknown as OvertimeApplicationDraft),
      }),
    }

    const restLeaveApplicationBase = createRestLeaveApplicationCapability((requestConfig) =>
      call(REST_LEAVE_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const restLeaveApplication: RestLeaveApplicationCapabilityWithIdempotency = {
      ...restLeaveApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'rest-leave-application-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        send: (params, { payload }) =>
          restLeaveApplicationBase.submit(payload as unknown as RestLeaveApplicationDraft),
      }),
    }

    const businessTripApplicationBase = createBusinessTripApplicationCapability((requestConfig) =>
      call(BUSINESS_TRIP_APPLICATION_PAGE_PATH, requestConfig as never),
    )

    const businessTripApplication: BusinessTripApplicationCapabilityWithIdempotency = {
      ...businessTripApplicationBase,
      submitIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'business-trip-application-submit',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        send: (params, { payload }) =>
          businessTripApplicationBase.submit(payload as unknown as BusinessTripApplicationDraft),
      }),
    }

    // 课程管理三页：多个页面共用一个实现，页面上下文取图文课程那一页
    // （三页 module-type 推导结果相同，都是 12 学习管理）
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

    // 讲师管理 / 讲师类型的**列表**走 smart-layer-admin 实例、且用 `isOriginal: true`
    // 拿整个响应体；而它们的删除等接口仍在 platform 上。**实例逐请求指定**，
    // 不挂页面级规则（理由见 http-instance.ts 的 isPageShapedPath 注释）。
    // 评价设置走的是 **platform**，不加 httpInstance、也不 isOriginal。
    const studyTeacher = createStudyTeacherCapability(
      (c) => call(STUDY_TEACHER_PAGE_PATH, { ...(c as object), httpInstance: STUDY_TEACHER_HTTP_INSTANCE, isOriginal: true } as PortalRequestConfig),
      (c) => call(STUDY_TEACHER_LEVEL_PAGE_PATH, { ...(c as object), httpInstance: STUDY_TEACHER_HTTP_INSTANCE, isOriginal: true } as PortalRequestConfig),
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
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => {
          perfSalaryBase.prepareSalaryMainImport(params)
          return params
        },
        send: (params) => perfSalaryBase.importSalaryMain(params),
      }),
      saveSalaryAdjustIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-salary-adjust-save',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => perfSalaryBase.prepareSalaryAdjust(params).draft,
        send: (_params, { payload }) => perfSalaryBase.saveSalaryAdjust(payload),
      }),
      createSalaryExamineResultIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-salary-examine-result-create',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => perfSalaryBase.prepareSalaryExamineResultCreate(params).draft,
        send: (_params, { payload }) => perfSalaryBase.createSalaryExamineResult(payload as Parameters<typeof perfSalaryBase.createSalaryExamineResult>[0]),
      }),
      updateSalaryExamineResultIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-salary-examine-result-update',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => perfSalaryBase.prepareSalaryExamineResultUpdate(params).draft,
        send: (_params, { payload }) => perfSalaryBase.updateSalaryExamineResult(payload as Parameters<typeof perfSalaryBase.updateSalaryExamineResult>[0]),
      }),
      removeSalaryExamineResultIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-salary-examine-result-remove',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => perfSalaryBase.prepareSalaryExamineResultRemove(params),
        send: (_params, { payload }) => perfSalaryBase.removeSalaryExamineResult(payload),
      }),
      importSalaryExamineResultIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-salary-examine-result-import',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
        payload: (params) => {
          perfSalaryBase.prepareSalaryExamineResultImport(params)
          return params
        },
        send: (params) => perfSalaryBase.importSalaryExamineResult(params),
      }),
      setBlockStatusIdempotent: withIdempotency({
        store: idempotency,
        capabilityId: 'perf-block-main-set-status',
        identity: () => ({ userId: input.userId, tenantId: input.credential.tenantId }),
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

    // 人工智能域：**每页一个 request**，各带各的 pagePath（合并会让错误归因指错页）。
    // 16 页在 module-type 规则表里都匹配不到 ⇒ 与浏览器一致，**不发 `module-type` 头**。
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

    const baseTenant = session.getOrCreateScoped(
      'capability:base-tenant',
      () => createBaseTenant({
        request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
          call<T>(BASE_TENANT_DETAIL_PATH, requestConfig as PortalRequestConfig),
      }),
      ['tenant-list', 'tenant-context', 'tenant-system'],
    )
    invalidateBaseTenant = baseTenant.invalidate

    // 销售实例的服务级 baseURL（与用户无关）；没配就给 null，能力自己失败关闭
    const baseSale = session.getOrCreateScoped(
      'capability:base-sale',
      () => createBaseSale({
        saleRequest:
          config.httpBaseUrls?.sale === undefined
            ? null
            : <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
                call<T>(BASE_SALE_SHOP_PATH, {
                  ...requestConfig,
                  httpInstance: 'sale',
                } as PortalRequestConfig),
      }),
      ['sale-shop', 'sale-area', 'sale-manufacturer', 'sale-brand'],
    )
    invalidateBaseSale = baseSale.invalidate

    // 应用外壳：同样把 `session` 传进去（用户信息复用会话里已有的 user-basic，不再打第二遍）
    const baseShell = session.getOrCreateScoped(
      'capability:base-shell',
      () => createBaseShell({
        request: <T>(requestConfig: Parameters<BaseDataRequest>[0]) =>
          call<T>(BASE_SHELL_CONTEXT_ROOT, requestConfig as PortalRequestConfig),
        session,
      }),
      ['user-basic', 'menu-nav', 'home-widgets'],
    )
    invalidateBaseShell = baseShell.invalidate

    // 可见性收敛：**必须用这份会话的 `baseShell`**（菜单是 per-user 的），
    // 而视图建在服务级那份静态 `catalog` 之上——`withVisibility()` 不改它、不缓存，
    // 所以两个用户各拿各的视图，共享的那份一个字段都不变。
    const visibleCatalog = (scopeInput: VisibleCatalogInput): Promise<VisibleCatalog> =>
      visibleCatalogFrom(catalog, (query) => baseShell.getMenuNav(query), scopeInput)

    return withCompatibleAiModelHost({
      session,
      call,
      batch,
      visibleCatalog,
      // 与单用户门面同一份实现（同一张绑定表），只是 host 换成这份会话的能力方法
      capabilities: attachCapabilityInvoker(
        capabilities,
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
      ),
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

  return { catalog, sessions, idempotency, forSession }
}
