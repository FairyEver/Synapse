/**
 * Portal 业务失败。对应前端 platform.js 响应拦截器抛出的那个 Error，
 * 字段名与前端保持一致（ret / code / msg / data）。
 */
export class PortalApiError extends Error {
  readonly ret: string | undefined
  readonly code: number | undefined
  readonly bizData: unknown
  /** 原始响应体，供排查 */
  readonly responseData: unknown
  /** 触发该次调用的能力 ID（便于定位） */
  readonly capabilityId: string | undefined

  constructor (init: {
    msg?: string
    ret?: string
    code?: number
    bizData?: unknown
    responseData?: unknown
    capabilityId?: string
  }) {
    super(init.msg || 'Portal 接口调用失败')
    this.name = 'PortalApiError'
    this.ret = init.ret
    this.code = init.code
    this.bizData = init.bizData
    this.responseData = init.responseData
    this.capabilityId = init.capabilityId
  }
}

/**
 * 这些 code 在前端会触发 logout()（platform.js:117）。
 * 无头下没有登录页可跳，一律视为"凭据不可用"（设计 H6 / F8）。
 *
 * 注意：后端只产出 401/403/1002015001 三种（设计 F8），
 * 前端数组里的 6001、10001 在后端并不存在，这里保留是为了与前端行为对齐。
 */
export const AUTH_FAILURE_CODES: readonly number[] = [401, 10001, 1002015001]

export function isCredentialFailureCode (code: number | undefined): boolean {
  return typeof code === 'number' && AUTH_FAILURE_CODES.includes(code)
}

export class PortalCredentialError extends Error {
  readonly code: number | undefined
  constructor (code: number | undefined) {
    super(
      code === 401 || code === undefined
        ? 'Portal 凭据不可用或已失效，需要重新连接'
        : `Portal 凭据不可用（code=${code}）`
    )
    this.name = 'PortalCredentialError'
    this.code = code
  }
}
