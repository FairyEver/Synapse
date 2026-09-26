import { DEFAULT_LANGUAGE, type PortalCredential } from '../config.js'

/**
 * 复刻 Portal 前端的 generateHttpHeaders()（app/portal/utils/system.js:813-836）。
 *
 * 前端产出四个头，顺序固定：tenant-id、token、module-type、Accept-Language。
 * 这里保持同样的顺序与「值为空则不写」的规则，便于与浏览器请求逐字段比对（设计 D20）。
 *
 * 注意 moduleType 的语义（设计 F19）：它只影响后端的「数据范围（数据权限）」，
 * 不影响权限码校验。不传它，后端会取该用户全部模块数据权限的并集。
 */
export type ModuleTypeInput = number | undefined

/**
 * 请求头集合的三种形态（来源见 `src/context/http-instance.ts` 的 `HttpHeaderMode`）。
 *
 * - `generate-http-headers`：四个头，顺序固定。**默认，也是改造前唯一的一种**
 * - `minimal`：只有 `Accept-Language` + `token`。**没有 `tenant-id`，也没有 `module-type`**
 *   ——`smart-layer-*` / `zhdj-*` 就是这样。少了 `tenant-id` 时后端会**静默选错租户**（F26），
 *   所以这些实例不能拿默认集合去凑
 * - `custom`：zhdj-* 自己的写法，目前按 `minimal` 处理，差异记在 `src/context/README.md`
 */
export type HeaderMode = 'generate-http-headers' | 'minimal' | 'custom'

export function buildHeaders (init: {
  credential: PortalCredential
  moduleType: ModuleTypeInput
  language?: string
  /** 缺省 `generate-http-headers`——与改造前逐字段一致 */
  headerMode?: HeaderMode
  /** 固定追加的头（如 product.js 的 `devicetype: 'PC'`） */
  extraHeaders?: Readonly<Record<string, string>>
}): Record<string, string> {
  const header: Record<string, string> = {}
  const { credential } = init
  const mode = init.headerMode ?? 'generate-http-headers'

  if (mode !== 'generate-http-headers') {
    // 手写形态（smart-layer-admin.js:16-20）：只有 Accept-Language 与 token
    if (credential.token) header['token'] = credential.token
    header['Accept-Language'] = init.language || DEFAULT_LANGUAGE
    return { ...header, ...init.extraHeaders }
  }

  const tenantId = credential.tenantId
  if (tenantId !== undefined && tenantId !== null && `${tenantId}` !== '') {
    header['tenant-id'] = String(tenantId)
  }

  if (credential.token) {
    header['token'] = credential.token
  }

  if (init.moduleType !== undefined && init.moduleType !== null) {
    header['module-type'] = String(init.moduleType)
  }

  header['Accept-Language'] = init.language || DEFAULT_LANGUAGE
  return { ...header, ...init.extraHeaders }
}
