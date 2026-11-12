import {
  SKILL_HUB_LIMITS as limits, SKILL_HUB_WEB_SESSION_HEADER,
  skillHubDetailSchema, skillHubFilePreviewQuerySchema, skillHubFilePreviewResultSchema, skillHubIdSchema,
  skillHubMainResultSchema, skillHubMarkdownResultSchema, skillHubPageSchema, skillHubReceiptSchema, skillHubTeamPageSchema,
  skillHubCreateInputSchema, skillHubDeleteResultSchema, skillHubPublishInputSchema, skillHubRevisionInputSchema,
  skillHubUpdateInputSchema, skillHubUploadInputSchema, skillHubUploadResultSchema, skillHubWriteReplaySchema, skillHubWriteResultSchema,
  type SkillHubCreateInput, type SkillHubPublishInput, type SkillHubRevisionInput, type SkillHubUpdateInput, type SkillHubUploadInput,
  type SkillHubListInput, type SkillHubReceiptInput, type SkillHubTeam, type SkillHubTeamPage,
} from '@synapse/shared/skill-hub-contracts'
import { ApiError, requestJson, requestResponse } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

const base = '/api/skill-hub'
export const hubSegment = (value: string) => encodeURIComponent(skillHubIdSchema.parse(value))
export const hubSkillPath = (id: string) => `/skills/${hubSegment(id)}`
export const hubQuery = (input: object) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value))
  return params.size ? `?${params}` : ''
}

export function assertHubSession(session: string) {
  if (!session || useAuthStore.getState().auth.user?.sessionId !== session) {
    throw new ApiError('登录会话已变化，请刷新页面。', 401, 'HUB_ACCOUNT_CHANGED')
  }
}

export function hubRequestOptions(session: string, options: RequestInit, timeoutMs = 45_000): RequestInit {
  assertHubSession(session)
  return { ...options, headers: { ...options.headers, [SKILL_HUB_WEB_SESSION_HEADER]: session },
    cache: 'no-store', redirect: 'error',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) }
}

export async function hubJson<T>(session: string, path: string, schema: { parse(value: unknown): T }, options: RequestInit = {}) {
  const value = await requestJson<unknown>(base + path, hubRequestOptions(session, options))
  assertHubSession(session)
  return schema.parse(value)
}

async function hubBinary(session: string, path: string, maxBytes: number, type: string, signal?: AbortSignal, expectedVersionId?: string) {
  const response = await requestResponse(base + path, hubRequestOptions(session, { signal }))
  const length = Number(response.headers.get('Content-Length'))
  if (length <= 0 || length > maxBytes || response.headers.get('Content-Type') !== type
    || (expectedVersionId && response.headers.get('X-Skill-Hub-Version-Id') !== expectedVersionId)) {
    await response.body?.cancel()
    throw new ApiError('文件读取失败，请重新读取。', 502, 'HUB_RESPONSE_INVALID')
  }
  const file = await response.blob()
  assertHubSession(session)
  if (file.size !== length) throw new ApiError('文件未完整下载，请重试。', 502, 'HUB_RESPONSE_INVALID')
  return file
}

const writeResult = skillHubWriteResultSchema.or(skillHubWriteReplaySchema)
const deleteResult = skillHubDeleteResultSchema.or(skillHubWriteReplaySchema)
const write = (method: 'POST' | 'PATCH' | 'DELETE', body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const skillHubApi = {
  create: (session: string, input: SkillHubCreateInput) =>
    hubJson(session, '/skills', writeResult, write('POST', skillHubCreateInputSchema.parse(input))),
  publish: (session: string, id: string, input: SkillHubPublishInput) =>
    hubJson(session, `${hubSkillPath(id)}/versions`, writeResult, write('POST', skillHubPublishInputSchema.parse(input))),
  update: (session: string, id: string, input: SkillHubUpdateInput) =>
    hubJson(session, hubSkillPath(id), writeResult, write('PATCH', skillHubUpdateInputSchema.parse(input))),
  delete: (session: string, id: string, input: SkillHubRevisionInput) =>
    hubJson(session, hubSkillPath(id), deleteResult, write('DELETE', skillHubRevisionInputSchema.parse(input))),
  async upload(session: string, input: SkillHubUploadInput, file: Blob) {
    const query = hubQuery(skillHubUploadInputSchema.parse(input))
    const response = await requestResponse(`${base}/uploads${query}`, hubRequestOptions(session, {
      method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
    }, 120_000))
    const value: unknown = await response.json()
    assertHubSession(session)
    return skillHubUploadResultSchema.parse(value)
  },
  teams: (session: string, cursor?: string, signal?: AbortSignal) =>
    hubJson(session, `/teams${hubQuery({ cursor, limit: limits.maxPageSize })}`, skillHubTeamPageSchema, { signal }),
  list: (session: string, input: SkillHubListInput, signal?: AbortSignal) =>
    hubJson(session, `/skills${hubQuery(input)}`, skillHubPageSchema, { signal }),
  get: (session: string, id: string, signal?: AbortSignal) =>
    hubJson(session, hubSkillPath(id), skillHubDetailSchema, { signal }),
  main: (session: string, id: string, expectedVersionId: string, signal?: AbortSignal) =>
    hubJson(session, `${hubSkillPath(id)}/main${hubQuery({ expectedVersionId })}`, skillHubMainResultSchema, { signal }),
  mainMarkdown: (session: string, id: string, expectedVersionId: string, signal?: AbortSignal) =>
    hubJson(session, `${hubSkillPath(id)}/main/rendered${hubQuery({ expectedVersionId })}`, skillHubMarkdownResultSchema, { signal }),
  async preview(session: string, id: string, expectedVersionId: string, path: string, signal?: AbortSignal) {
    const query = hubQuery(skillHubFilePreviewQuerySchema.parse({ expectedVersionId, path }))
    const result = await hubJson(session, `${hubSkillPath(id)}/file${query}`, skillHubFilePreviewResultSchema, { signal })
    if (result.versionId !== expectedVersionId) throw new ApiError('文件版本已变化，请重新读取。', 409, 'HUB_LATEST_CHANGED')
    return result
  },
  async previewMarkdown(session: string, id: string, expectedVersionId: string, path: string, signal?: AbortSignal) {
    const query = hubQuery(skillHubFilePreviewQuerySchema.parse({ expectedVersionId, path }))
    const result = await hubJson(session, `${hubSkillPath(id)}/file/rendered${query}`, skillHubMarkdownResultSchema, { signal })
    if (result.versionId !== expectedVersionId) throw new ApiError('文件版本已变化，请重新读取。', 409, 'HUB_LATEST_CHANGED')
    return result
  },
  download: (session: string, id: string, expectedVersionId: string, signal?: AbortSignal) =>
    hubBinary(session, `${hubSkillPath(id)}/package${hubQuery({ expectedVersionId })}`, limits.uploadBytes, 'application/zip', signal, expectedVersionId),
  icon: (session: string, id: string, signal?: AbortSignal) =>
    hubBinary(session, `${hubSkillPath(id)}/icon`, limits.iconBytes, 'image/png', signal),
  receipt: (session: string, input: SkillHubReceiptInput, signal?: AbortSignal) =>
    hubJson(session, `/receipts/${hubSegment(input.requestId)}${hubQuery({ action: input.action })}`, skillHubReceiptSchema, { signal }),
}

export async function loadHubTeams(session: string, signal?: AbortSignal) {
  const first = await skillHubApi.teams(session, undefined, signal)
  const items = new Map(first.items.map((item) => [item.id, item]))
  const cursors = new Set<string>()
  for (let cursor = first.nextCursor; cursor;) {
    if (cursors.has(cursor)) throw new ApiError('团队范围已变化，请重新读取。', 409, 'HUB_INVALID_CURSOR')
    cursors.add(cursor)
    const next = await skillHubApi.teams(session, cursor, signal)
    if (next.selectionState !== first.selectionState || next.defaultTeamId !== first.defaultTeamId) {
      throw new ApiError('团队范围已变化，请重新读取。', 409, 'HUB_INVALID_CURSOR')
    }
    for (const team of next.items) items.set(team.id, team)
    cursor = next.nextCursor
  }
  return { items: [...items.values()] as SkillHubTeam[], selectionState: first.selectionState, defaultTeamId: first.defaultTeamId }
}

export type HubTeams = Pick<SkillHubTeamPage, 'items' | 'selectionState' | 'defaultTeamId'>
