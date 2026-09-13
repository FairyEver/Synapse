import { expect, it } from "vitest"
import { createExportEvidenceProjection, summarizeSourceEvidence } from "../export-evidence"
import { isSafeTokenMeasurement } from "../redaction"
it("keeps paths comparable inside an export, including nested tool JSON, without reusable path hashes", () => {
  const project = createExportEvidenceProjection()
  const a = project({ file_path: "/private/a.png" }) as Record<string, unknown>
  const b = JSON.parse(project(JSON.stringify({ file_path: "/private/a.png" })) as string)
  const c = project({ file_path: "/private/b.png" }) as Record<string, unknown>
  expect(a.file_pathResourceId).toBe(b.file_pathResourceId)
  expect(a.file_pathResourceId).not.toBe(c.file_pathResourceId)
  expect((createExportEvidenceProjection()({ file_path: "/private/a.png" }) as Record<string, unknown>).file_pathResourceId).not.toBe(a.file_pathResourceId)
})
it("normalizes attachment size without inventing missing measurements or hiding conflicts", () => {
  const project = createExportEvidenceProjection()
  expect(project({ type: "image", byteSize: 339821 })).toMatchObject({ normalizedByteSize: 339821, sizeConflict: false })
  expect(project({ type: "image", size: 20 })).toMatchObject({ normalizedByteSize: 20 })
  expect(project({ type: "image" })).toMatchObject({ normalizedByteSize: null })
  expect(project({ type: "image", size: 20, byteSize: 21 })).toMatchObject({ sizeConflict: true })
})
it("exempts numeric token measurements only, never strings or credential-like keys", () => {
  for (const key of ["usedTokens", "maxTokens", "input_tokens", "cache_read_input_tokens"]) expect(isSafeTokenMeasurement(key, 123)).toBe(true)
  for (const value of ["secret", -1, Infinity, null]) expect(isSafeTokenMeasurement("usedTokens", value)).toBe(false)
  for (const key of ["token", "secretTokens", "authToken"]) expect(isSafeTokenMeasurement(key, 123)).toBe(false)
})
it("does not count a missing ID placeholder as a session, or cancellation and zero usage as failures", () => {
  const history = Array.from({ length: 20 }, (_, n) => ({ metadata: { sdkSessionId: `session-${n}`, attachments: [{ byteSize: 10 }] } }))
  const stats = summarizeSourceEvidence([...history, { metadata: { sdkSessionId: "?", usage: { inputTokens: 0 }, turnOutcome: { status: "cancelled" } } },
    { content: "An older log quoted API Error", metadata: { attachments: [{ size: 3 }, {}] } }])
  expect(stats).toMatchObject({ distinctKnownSdkSessionIds: 20, missingOrUnknownSessionIdRecords: 2,
    knownAttachmentBytes: 203, unknownAttachmentSizes: 1, cancelledOutcomeRecords: 1, failedOutcomeRecords: 0, apiErrorTextMentions: 1 })
})


it("assigns export-local aliases to Windows UNC and extended paths without merging distinct resources", () => {
  const project = createExportEvidenceProjection()
  const file = String.raw`\\server\share\项目 资料\one.png`
  const a = project({ file_path: file }) as Record<string, unknown>
  const b = JSON.parse(project(JSON.stringify({ file_path: file })) as string)
  const c = project({ file_path: String.raw`\\server\share\项目 资料\two.png` }) as Record<string, unknown>
  expect((project({ file_path: "//server/share/file.png" }) as Record<string, unknown>).file_pathResourceId).toMatch(/^resource-/)
  expect(a.file_pathResourceId).toMatch(/^resource-/)
  expect(a.file_pathResourceId).toBe(b.file_pathResourceId)
  expect(c.file_pathResourceId).not.toBe(a.file_pathResourceId)
})
