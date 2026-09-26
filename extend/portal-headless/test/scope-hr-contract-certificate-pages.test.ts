import { describe, expect, it } from 'vitest'

import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'
import {
  CONTRACT_LIBRARY_METHODS,
  createContractLibraryCapability,
} from '../src/capabilities/contract-library.js'
import {
  CERTIFICATE_TYPE_METHODS,
} from '../src/capabilities/certificate-type.js'
import {
  PATENT_METHODS,
  PATENT_SHARE_TYPE,
  createPatentCapability,
} from '../src/capabilities/patent.js'
import {
  SOFTWARE_METHODS,
} from '../src/capabilities/software.js'
import {
  PIECE_METHODS,
} from '../src/capabilities/piece.js'
import {
  STANDARD_DOCUMENT_METHODS,
} from '../src/capabilities/standard-document.js'
import {
  QUALIFICATION_METHODS,
} from '../src/capabilities/qualification.js'
import {
  createFlowManageCapability,
  FLOW_MANAGE_AI_REVIEW_LIST_PATH,
  FLOW_MANAGE_AI_REVIEW_PAGE_PATH,
} from '../src/capabilities/flow-manage.js'
import { createCatalog } from '../src/catalog/index.js'
import type { PortalRequest } from '../src/session/types.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

type PageExpectation = {
  pagePath: string
  permission: string
  httpInstance: string
  moduleType: number | null
  capabilityIds: readonly string[]
}

const pages: readonly PageExpectation[] = [
  {
    pagePath: '/dashboard/contract/library/list',
    permission: '/dashboard/contract/library',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'contract-library-list',
      'contract-library-get',
      'contract-library-download',
      'contract-library-records',
      'contract-library-get-replenishment',
      'contract-library-prepare-replenishment',
      'contract-library-save-replenishment',
      'contract-library-get-sign-certificate',
      'contract-library-prepare-sign-certificate',
      'contract-library-save-sign-certificate',
      'contract-library-prepare-update',
      'contract-library-update',
      'contract-library-prepare-void',
      'contract-library-void',
    ],
  },
  {
    pagePath: '/dashboard/certificate/type/list',
    permission: '/dashboard/certificate/type',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'certificate-type-list',
      'certificate-type-get',
      'certificate-type-tip-templates',
      'certificate-type-prepare-create',
      'certificate-type-create',
      'certificate-type-prepare-update',
      'certificate-type-update',
      'certificate-type-remove',
    ],
  },
  {
    pagePath: '/dashboard/certificate/patent/list',
    permission: '/dashboard/certificate/patent',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'patent-list',
      'patent-get',
      'patent-prepare-create',
      'patent-create',
      'patent-prepare-update',
      'patent-update',
      'patent-remove',
      'patent-get-share',
      'patent-save-share',
    ],
  },
  {
    pagePath: '/dashboard/certificate/softwork/list',
    permission: '/dashboard/certificate/softwork',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'software-list',
      'software-get',
      'software-prepare-create',
      'software-create',
      'software-prepare-update',
      'software-update',
      'software-remove',
      'software-get-share',
      'software-save-share',
    ],
  },
  {
    pagePath: '/dashboard/certificate/works/list',
    permission: '/dashboard/certificate/works',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'piece-list',
      'piece-get',
      'piece-prepare-create',
      'piece-create',
      'piece-prepare-update',
      'piece-update',
      'piece-remove',
      'piece-get-share',
      'piece-save-share',
    ],
  },
  {
    pagePath: '/dashboard/certificate/standard-document/list',
    permission: '/dashboard/certificate/standard-document',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'standard-document-list',
      'standard-document-get',
      'standard-document-prepare-create',
      'standard-document-create',
      'standard-document-prepare-update',
      'standard-document-update',
      'standard-document-remove',
      'standard-document-get-share',
      'standard-document-save-share',
    ],
  },
  {
    pagePath: '/dashboard/certificate/qualifications/list',
    permission: '/dashboard/certificate/qualifications',
    httpInstance: 'platform',
    moduleType: 15,
    capabilityIds: [
      'qualification-list',
      'qualification-get',
      'qualification-prepare-create',
      'qualification-create',
      'qualification-prepare-update',
      'qualification-update',
      'qualification-remove',
      'qualification-get-share',
      'qualification-save-share',
    ],
  },
  {
    pagePath: '/dashboard/flow/ai-review-config/list',
    permission: '/dashboard/flow/ai-review-config',
    httpInstance: 'platform',
    moduleType: null,
    capabilityIds: [
      'flow-manage-ai-review-config-list',
      'flow-manage-ai-review-config-get',
      'flow-manage-ai-review-config-prepare-create',
      'flow-manage-ai-review-config-create',
      'flow-manage-ai-review-config-prepare-update',
      'flow-manage-ai-review-config-update',
      'flow-manage-ai-review-config-delete',
      'flow-manage-ai-review-config-cancel-save',
    ],
  },
]

const capabilityById = new Map(ALL_CAPABILITY_DEFINITIONS.map((definition) => [definition.id, definition]))
const catalog = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS })

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    return responses.shift() as T
  }
  return { request, calls }
}

describe('范围审计：合同与证照保留页面（实际 8 页；用户清单写作 9 页）', () => {
  it('每页的能力集合与 pagePath 精确绑定', () => {
    expect(pages).toHaveLength(8)

    for (const page of pages) {
      const definitions = ALL_CAPABILITY_DEFINITIONS.filter((definition) => definition.pagePath === page.pagePath)
      expect(definitions.map((definition) => definition.id).sort(), page.pagePath).toEqual([...page.capabilityIds].sort())
      expect(definitions.every((definition) => definition.pagePath === page.pagePath), page.pagePath).toBe(true)
      const http = resolveHttpInstance({ pagePath: page.pagePath })
      expect(http.kind, page.pagePath).toBe('resolved')
      if (http.kind !== 'resolved') continue
      expect(http.instance.id, page.pagePath).toBe(page.httpInstance)
      expect(resolveModuleType(page.pagePath).moduleType, page.pagePath).toBe(page.moduleType)
      expect(definitions.every((definition) => (
        definition.permission === page.permission &&
        (definition.httpInstance === undefined ? http.instance.id : definition.httpInstance) === page.httpInstance &&
        (definition.moduleType === undefined ? resolveModuleType(page.pagePath).moduleType : definition.moduleType) === page.moduleType
      )), page.pagePath).toBe(true)

      const describedPage = catalog.describePage(page.pagePath)
      expect(describedPage.ok, page.pagePath).toBe(true)
      if (!describedPage.ok) continue
      expect(describedPage.capabilities.map((capability) => capability.capabilityId).sort(), page.pagePath)
        .toEqual([...page.capabilityIds].sort())
    }
  })

  it('逐个能力的 AI 描述、-llm 入口和执行绑定闭合', () => {
    const expectedIds = pages.flatMap((page) => page.capabilityIds)
    expect(new Set(expectedIds).size).toBe(expectedIds.length)

    for (const capabilityId of expectedIds) {
      const definition = capabilityById.get(capabilityId)
      expect(definition, capabilityId).toBeDefined()
      if (definition === undefined) continue

      const described = catalog.describe(capabilityId)
      expect(described.ok, capabilityId).toBe(true)
      if (!described.ok) continue
      expect(described.ai, capabilityId).toMatchObject({
        purpose: expect.any(String),
        whenToUse: expect.any(String),
        effect: expect.any(String),
        inputs: expect.any(Object),
        output: expect.any(Object),
        failures: expect.any(Array),
      })
      expect(described.invoke, capabilityId).toMatchObject({
        capabilityId,
        sdkPath: sdkPathOf(capabilityId),
      })
      expect(catalog.describe(`${capabilityId}-llm`), capabilityId).toMatchObject({
        ok: true,
        ai: described.ai,
        invoke: { capabilityId, sdkPath: sdkPathOf(capabilityId) },
      })
    }
  })

  it('方法表仍与各页面能力集合一一对应，避免相邻证照页面串用能力', () => {
    expect(Object.keys(CONTRACT_LIBRARY_METHODS).sort()).toEqual(pages[0]?.capabilityIds.slice().sort())
    expect(Object.keys(CERTIFICATE_TYPE_METHODS).sort()).toEqual(pages[1]?.capabilityIds.slice().sort())
    expect(Object.keys(PATENT_METHODS).sort()).toEqual(pages[2]?.capabilityIds.slice().sort())
    expect(Object.keys(SOFTWARE_METHODS).sort()).toEqual(pages[3]?.capabilityIds.slice().sort())
    expect(Object.keys(PIECE_METHODS).sort()).toEqual(pages[4]?.capabilityIds.slice().sort())
    expect(Object.keys(STANDARD_DOCUMENT_METHODS).sort()).toEqual(pages[5]?.capabilityIds.slice().sort())
    expect(Object.keys(QUALIFICATION_METHODS).sort()).toEqual(pages[6]?.capabilityIds.slice().sort())
  })
})

describe('合同库关键动作：补充协议、签章证明和作废请求映射', () => {
  it('把 Portal 草稿映射到对应请求，并拒绝删除已签合同的既有补充协议', async () => {
    const f = fixture([true, true, true])
    const api = createContractLibraryCapability(f.request)

    const replenishment = api.prepareReplenishment({
      contractId: 101,
      current: { url: 'old.pdf', name: '旧协议.pdf' },
      files: [{ url: 'old.pdf', name: '旧协议.pdf' }, { url: 'new.pdf', name: '新协议.pdf' }],
      isSignCertificate: true,
    })
    await expect(api.saveReplenishment({ draft: replenishment.draft })).resolves.toBe(true)

    const sign = api.prepareSignCertificate({
      contractId: 101,
      files: [{ url: 'sign.pdf', name: '签章证明.pdf' }],
      signDate: '2026-09-02',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    })
    await expect(api.saveSignCertificate({ draft: sign.draft })).resolves.toBe(true)

    const voidDraft = api.prepareVoid({ id: 101, status: 4 })
    await expect(api.void(voidDraft)).resolves.toBe(true)

    expect(() => api.prepareReplenishment({
      contractId: 101,
      current: { url: 'old.pdf', name: '旧协议.pdf' },
      files: [],
      isSignCertificate: true,
    })).toThrow('不可删除')

    expect(f.calls).toEqual([
      { url: '/admin-api/hr/contract/saveReplenishment', method: 'post', data: { contractId: 101, nextUrl: 'old.pdf,new.pdf', nextUrlName: '旧协议.pdf,新协议.pdf' } },
      { url: '/admin-api/hr/contract/saveSignCertificate', method: 'post', data: { contractId: 101, nextImg: 'sign.pdf', nextImgName: '签章证明.pdf', signDate: '2026-09-02', startDate: '2026-09-01', endDate: '2027-08-31' } },
      { url: '/admin-api/hr/contract/voidContract/101', method: 'post', data: { params: { id: 101 } } },
    ])
  })
})

describe('证照与 AI 审核配置关键请求映射', () => {
  it('专利分享只发送成员 ID，删除使用专利资源 ID', async () => {
    const f = fixture([{ organization: [{ id: 2 }], post: [], duty: [], user: [] }, true, true])
    const api = createPatentCapability(f.request)

    await expect(api.getShare({ resourceId: 101 })).resolves.toEqual({ organization: [{ id: 2 }], post: [], duty: [], user: [] })
    await expect(api.saveShare({ resourceId: 101, organization: [{ id: 2, name: '组织' }], user: [{ id: 9, name: '人员' }] })).resolves.toBe(true)
    await expect(api.remove({ id: 101 })).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: PATENT_SHARE_TYPE, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: PATENT_SHARE_TYPE, resourceId: 101, organizationIds: [{ id: 2 }], postIds: [], dutyIds: [], userIds: [{ id: 9 }] } },
      { url: '/admin-api/hr/patent/delete', method: 'delete', params: { id: 101 } },
    ])
  })

  it('AI审核配置重置后恢复无筛选分页，enabled=false 仍保留为有效筛选', async () => {
    const f = fixture([
      { list: [], total: 0 },
      { list: [], total: 0 },
      { list: [], total: 0 },
    ])
    const api = createFlowManageCapability(f.request, f.request, f.request, f.request)

    await api.listAiReviewConfigs({ processDefinitionKey: 'leave', enabled: false, pageNo: 2, pageSize: 10 })
    await api.listAiReviewConfigs({})

    expect(f.calls).toEqual([
      { url: FLOW_MANAGE_AI_REVIEW_LIST_PATH, method: 'get', params: { processDefinitionKey: 'leave', enabled: false, pageNo: 2, pageSize: 10 } },
      { url: FLOW_MANAGE_AI_REVIEW_LIST_PATH, method: 'get', params: { pageNo: 1, pageSize: 20 } },
    ])
    expect(FLOW_MANAGE_AI_REVIEW_PAGE_PATH).toBe('/dashboard/flow/ai-review-config/list')
  })
})
