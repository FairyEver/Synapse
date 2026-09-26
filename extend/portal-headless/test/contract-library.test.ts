import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  CONTRACT_LIBRARY_METHODS,
  CONTRACT_LIBRARY_MODULE_TYPE,
  CONTRACT_LIBRARY_PAGE_PATH,
  CONTRACT_LIBRARY_PERMISSION,
  CONTRACT_STATUS,
  createContractLibraryCapability,
  contractLibraryCapabilities,
  type ContractRow,
} from '../src/capabilities/contract-library.js'
import { CONTRACT_LIBRARY_AI_CONTRACTS as contracts, CONTRACT_LIBRARY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-contract-library.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createContractLibraryCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const content = JSON.stringify({ version: '1.1.0', blocks: [] })
const detail: ContractRow = {
  id: 101,
  name: '采购合同',
  templateId: 11,
  typeId: 12,
  typeName: '采购合同',
  code: 'HT20260923001',
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  signDate: '2026-09-02',
  organizationId: 34,
  organizationName: '示例组织',
  updateName: '张三',
  creatorName: '李四',
  createTime: '2026-09-23 10:00:00',
  updateTime: '2026-09-23 10:00:00',
  status: CONTRACT_STATUS.PENDING_SIGN,
  isReplenishment: 0,
  isSignCertificate: 0,
  isVoid: 0,
  useSystem: 1,
  content,
  dataList: [{ contractKey: 'buyer.name', contractValue: '示例公司' }],
  contractVersionId: 201,
  variableApi: null,
  variableApiData: null,
  callbackApi: null,
  callbackApiData: null,
  callbackApiForSignAfterApi: null,
  callbackApiForSignAfterApiData: null,
}

const records = {
  list: [{
    id: 301,
    operateTime: '2026-09-23 10:00:00',
    contractId: 101,
    operateType: 2,
    preUrl: null,
    nextUrl: null,
    preUrlName: null,
    nextUrlName: null,
    preImg: null,
    nextImg: null,
    preImgName: null,
    nextImgName: null,
    operator: 7,
    operatorName: '张三',
  }],
  total: 1,
}

describe('Portal 风险防控 → 合同库页面能力', () => {
  it('逐页锁定菜单、页面动作、状态权限、请求入口和 module-type', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/hr.js')
    const list = read(portal, 'app/portal/views/dashboard/hr/contract/library/list.vue')
    const detailPage = read(portal, 'app/portal/views/dashboard/hr/contract/library/detail/[id].vue')
    const record = read(portal, 'app/portal/views/dashboard/hr/contract/library/components/record-list/index.vue')
    const supplement = read(portal, 'app/portal/library/contract/components/ModalContractSupplyAgree/index.vue')
    const sign = read(portal, 'app/portal/library/contract/components/ModalContractSign/index.vue')
    const form = read(portal, 'app/portal/views/dashboard/hr/contract/[mode]/form/[id].vue')
    const preview = read(portal, 'app/portal/views/dashboard/hr/contract/[mode]/preview/share.js')
    expect(menu).toContain(`path: '${CONTRACT_LIBRARY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${CONTRACT_LIBRARY_PERMISSION}'`)
    for (const fragment of ["'/hr/contract/page'", 'status: null', 'record.status !== 1 && record.status !== 3', 'record.status !== 16', 'actionSupplementAgreement', 'actionContractSign', 'actionOpenRecord', 'actionDownload', 'voidContract', '模拟修改']) expect(list).toContain(fragment)
    for (const fragment of ['[1, 2, 3].includes(status)', 'actionSupplementAgreement', 'actionContractSign']) expect(detailPage).toContain(fragment)
    expect(record).toContain("'/hr/contract/getContractOperate'")
    for (const fragment of ["'/hr/contract/replenishmentInfo'", "'/hr/contract/saveReplenishment'", 'isSignCertificate', 'nextUrl', 'nextUrlName']) expect(supplement).toContain(fragment)
    for (const fragment of ["'/hr/contract/signCertificateInfo'", "'/hr/contract/saveSignCertificate'", 'required: true', 'fileList']) expect(sign).toContain(fragment)
    for (const fragment of ['name:', 'typeId:', 'organizationId:', 'contractTemplateId:', 'required: true']) expect(form).toContain(fragment)
    for (const fragment of ['/hr/contract/updateContractByCommon', 'const onlySave = 0', 'validateTemplateConfig', 'validateResolvedContent']) expect(preview).toContain(fragment)
    expect(contractLibraryCapabilities.map(item => item.id)).toEqual(Object.keys(CONTRACT_LIBRARY_METHODS))
    expect(contractLibraryCapabilities.every(item => item.pagePath === CONTRACT_LIBRARY_PAGE_PATH && item.permission === CONTRACT_LIBRARY_PERMISSION && item.moduleType === CONTRACT_LIBRARY_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java Controller、VO、状态转换、租户对象和内容校验', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr'
    const controller = read(java, `${base}/controller/admin/riskcontrol/contract/ContractController.java`)
    const save = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractSaveReqVO.java`)
    const operateSave = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractOperateSaveReqVO.java`)
    const response = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractRespVO.java`)
    const operateResponse = read(java, `${base}/controller/admin/riskcontrol/contract/vo/ContractOperateRespVO.java`)
    const service = read(java, `${base}/service/contract/ContractServiceImpl.java`)
    const operateService = read(java, `${base}/service/contract/ContractOperateServiceImpl.java`)
    const contentValidator = read(java, `${base}/service/contract/ContractContentValidator.java`)
    const contract = read(java, `${base}/dal/dataobject/contract/ContractDO.java`)
    const operate = read(java, `${base}/dal/dataobject/contract/ContractOperateDO.java`)
    for (const fragment of ['@RequestMapping("/hr/contract")', '@GetMapping("/page")', '@GetMapping("/get")', '@GetMapping("/getContractOperate")', '@GetMapping("/replenishmentInfo")', '@GetMapping("/signCertificateInfo")', '@PostMapping("/saveReplenishment")', '@PostMapping("/saveSignCertificate")', '@PostMapping("updateContractByCommon")', '@PostMapping("voidContract/{id}")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long templateId', 'private Long typeId', 'private LocalDate startDate', 'private LocalDate endDate', 'private Long organizationId', 'private List<ContractDataSaveReqVO> dataList', 'private String content', 'private Integer onlySave']) expect(save).toContain(fragment)
    for (const fragment of ['private Long contractId', 'private String nextUrl', 'private String nextUrlName', 'private String nextImg', 'private String nextImgName', 'private LocalDate signDate']) expect(operateSave).toContain(fragment)
    for (const fragment of ['private Long id', 'private Integer status', 'private Integer isReplenishment', 'private Integer  isSignCertificate', 'private Long contractVersionId']) expect(response).toContain(fragment)
    for (const fragment of ['private Long contractId', 'private Integer operateType', 'private String nextUrl', 'private String nextImg']) expect(operateResponse).toContain(fragment)
    for (const fragment of ['updateContractByCommon', 'getOnlySave()', 'ContractContentValidator', 'contractById.getStatus() == 2']) expect(service).toContain(fragment)
    for (const fragment of ['saveReplenishment', 'MODIFIED_PERFORMANCE', 'saveSignCertificate', 'SIGNED_COMPLETED', 'voidContract', 'setOperateType(3)']) expect(operateService).toContain(fragment)
    for (const fragment of ['validateContractContent', '存在重复 block id', 'blocks', 'version']) expect(contentValidator).toContain(fragment)
    expect(contract).toContain('extends TenantBaseDO')
    expect(operate).toContain('hr_contract_operate')
  })

  it('按 Portal 逐字段覆盖列表、详情、下载、记录、补充协议、签订证明、修改和作废', async () => {
    const replenishment = { url: 'https://oss.example/addendum.pdf', name: '补充协议.pdf' }
    const certificate = { signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31', imgUrl: 'https://oss.example/sign.pdf', imgName: '签订证明.pdf' }
    const receipt = { id: 101, code: 'HT20260923001', contractVersionId: 202, onlySave: 0 }
    const f = fixture([{ list: [detail], total: 1 }, detail, detail, records, replenishment, true, certificate, true, receipt, true])
    await expect(f.api.list({ name: '采购', typeId: 12, signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31', status: CONTRACT_STATUS.PENDING_SIGN, pageNo: 2, pageSize: 10 })).resolves.toEqual({ list: [detail], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(detail)
    await expect(f.api.download({ id: 101 })).resolves.toEqual({ id: 101, name: detail.name, status: detail.status, isSignCertificate: 0, content, dataList: detail.dataList })
    await expect(f.api.records({ contractId: 101, pageNo: 3, pageSize: 4 })).resolves.toEqual(records)
    await expect(f.api.getReplenishment({ id: 101 })).resolves.toEqual(replenishment)
    const replenishmentDraft = f.api.prepareReplenishment({ contractId: 101, current: replenishment, files: [{ url: replenishment.url, name: replenishment.name }] })
    await expect(f.api.saveReplenishment({ draft: replenishmentDraft.draft })).resolves.toBe(true)
    await expect(f.api.getSignCertificate({ id: 101 })).resolves.toEqual(certificate)
    const signDraft = f.api.prepareSignCertificate({ contractId: 101, files: [{ url: certificate.imgUrl, name: certificate.imgName }], signDate: certificate.signDate, startDate: certificate.startDate, endDate: certificate.endDate })
    await expect(f.api.saveSignCertificate({ draft: signDraft.draft })).resolves.toBe(true)
    const update = f.api.prepareUpdate({ current: detail, changes: { name: '更新后的合同' } })
    await expect(f.api.update({ draft: update.draft })).resolves.toEqual(receipt)
    const voidDraft = f.api.prepareVoid({ id: 101, status: CONTRACT_STATUS.PENDING_SIGN })
    await expect(f.api.void(voidDraft)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/contract/page', method: 'get', params: { order: '', orderField: '', name: '采购', typeId: 12, startDate: '2026-09-01', endDate: '2027-08-31', signDate: '2026-09-02', status: 4, pageNo: 2, pageSize: 10 } },
      { url: '/admin-api/hr/contract/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/contract/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/contract/getContractOperate', method: 'get', params: { contractId: 101, pageNo: 3, pageSize: 4 } },
      { url: '/admin-api/hr/contract/replenishmentInfo', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/contract/saveReplenishment', method: 'post', data: { contractId: 101, nextUrl: 'https://oss.example/addendum.pdf', nextUrlName: '补充协议.pdf' } },
      { url: '/admin-api/hr/contract/signCertificateInfo', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/contract/saveSignCertificate', method: 'post', data: { contractId: 101, nextImg: 'https://oss.example/sign.pdf', nextImgName: '签订证明.pdf', signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31' } },
      { url: '/admin-api/hr/contract/updateContractByCommon', method: 'post', data: { id: 101, name: '更新后的合同', templateId: 11, typeId: 12, code: null, startDate: '2026-09-01', endDate: '2027-08-31', organizationId: 34, dataList: [{ contractKey: 'buyer.name', contractValue: '示例公司' }], content, businessId: null, featureId: null, useSystem: 1, onlySave: 0, variableApi: null, variableApiData: null, callbackApi: null, callbackApiData: null, callbackApiForSignAfterApi: null, callbackApiForSignAfterApiData: null } },
      { url: '/admin-api/hr/contract/voidContract/101', method: 'post', data: { params: { id: 101 } } },
    ])
  })

  it('表单规则、状态权限、内容唯一性和坏回执在请求前显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareReplenishment({ contractId: 101, current: { url: 'u1,u2', name: 'a.pdf,b.pdf' }, files: [{ url: 'u2', name: 'b.pdf' }], isSignCertificate: true })).toThrow('不可删除')
    expect(() => f.api.prepareSignCertificate({ contractId: 101, files: [], signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31' })).toThrow('不能为空')
    expect(() => f.api.prepareSignCertificate({ contractId: 101, files: [{ url: 'u', name: 'a.pdf' }], signDate: '2026-02-30', startDate: '2026-09-01', endDate: '2027-08-31' })).toThrow('不是有效日期')
    expect(() => f.api.prepareSignCertificate({ contractId: 101, files: [{ url: 'u', name: 'a.pdf' }], signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31', isSignCertificate: true })).toThrow('只读')
    expect(() => f.api.prepareUpdate({ current: detail, changes: { dataList: [{ contractKey: 'x', contractValue: '1' }, { contractKey: ' x ', contractValue: '2' }] } })).toThrow('重复contractKey')
    expect(() => f.api.prepareUpdate({ current: detail, changes: { content: '{"version":"1.1.0","blocks":[{"id":"x","name":"Common/Text","data":{}},{"id":"x","name":"Common/Text","data":{}}]}' } })).toThrow('重复block id')
    expect(() => f.api.prepareVoid({ id: 101, status: CONTRACT_STATUS.DRAFT })).toThrow('不显示')
    expect(() => f.api.prepareVoid({ id: 101, status: CONTRACT_STATUS.REVIEW_REJECTED })).toThrow('不显示')
    expect(() => f.api.prepareVoid({ id: 101, status: 17 })).toThrow('1至16')
    await expect(f.api.list({ status: 17 as never })).rejects.toThrow()
    await expect(fixture([false]).api.saveSignCertificate({ draft: { contractId: 101, nextImg: 'u', nextImgName: 'a.pdf', signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31' } })).rejects.toThrow('不是true')
    await expect(fixture([{ code: 'missing-id' }]).api.update({ draft: { ...f.api.prepareUpdate({ current: detail }).draft } })).rejects.toThrow('回执.id')
  })
})

describe('合同库 AI 契约', () => {
  it('十四个动作和公开方法契约结构通过，真实环境缺口保持显式', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(contractLibraryCapabilities).toHaveLength(14)
    expect(validateAiContracts(contracts, { definitions: contractLibraryCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(CONTRACT_LIBRARY_METHODS).map(method => `contractLibrary.${method}`))
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: contractLibraryCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(14).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) expect(contract.gaps?.join(' ')).toContain('尚未在真实测试环境')
  })
})
