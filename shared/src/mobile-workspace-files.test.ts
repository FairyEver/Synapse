import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { isMobileIntent, isMobileIntentResultPayload, isMobileSummaryPayload } from "./mobile-live.js"
import { isLiveMobileServerMessage, LIVE_MESSAGE_TYPES, createLiveEnvelope } from "./live.js"
import { MOBILE_WORKSPACE_FILES_LIMITS as L, MOBILE_WORKSPACE_FILES_VERSION, isMobileWorkspaceFilesEnvelopeWithinBudget, isMobileWorkspaceFilesIntent, isMobileWorkspaceFilesResult, mobileWorkspaceFilesUtf8Bytes } from "./mobile-workspace-files.js"

const time = "2026-10-03T08:00:00.000Z"
const intent = { v: 1, kind: "workspaceFiles", filesVersion: 1, intentId: "request-1", sessionId: "session-1" }
const scoped = { ...intent, scopeId: "scope-1", expectedContextVersion: "context-1" }
const scope = { scopeId: "scope-1", rootEntryId: "root-1", scopeMode: "currentDirectory", rootDisplayName: "项目", contextVersion: "context-1", expiresAt: time, gitAvailable: true }
const open = { filesVersion: 1, sessionId: "session-1", scopeId: "scope-1", contextVersion: "context-1", operation: "open", readAt: time, data: scope }
const file = { entryId: "entry-1", name: "README.md", relativePath: "README.md", kind: "file", metadata: { sizeBytes: 10, modifiedAt: time }, canPreview: true, canReference: true }
const directory = { ...open, operation: "directory", data: { directoryVersion: "dir-1", entries: [file], collectionComplete: true, pageIndex: 0, nextCursor: null, completion: "complete" } }

describe("workspace files private wire", () => {
  it("accepts all ten operations through the existing kind envelope", () => {
    const requests = [
      { ...intent, operation: "open", scopeMode: "repository" },
      { ...scoped, operation: "refresh" },
      { ...scoped, operation: "directory", directoryEntryId: "root-1" },
      { ...scoped, operation: "search", query: "代码" },
      { ...scoped, operation: "changes", changeRange: "staged" },
      { ...scoped, operation: "diff", changeSetVersion: "set-1", changeId: "change-1" },
      { ...scoped, operation: "preview", target: { source: "disk", entryId: "entry-1" } },
      { ...scoped, operation: "reference", entryId: "entry-1" },
      { ...intent, operation: "cancel", targetIntentId: "open-1" },
      { ...intent, operation: "close", scopeId: "scope-1" },
    ]
    for (const request of requests) expect(isMobileIntent(request)).toBe(true)
  })
  it("rejects paths, commands, refs, mixed targets and ambiguous field groups", () => {
    for (const extra of [{ rootPath: "/etc" }, { userId: "other" }, { command: "cat /etc/passwd" }, { ref: "HEAD" }, { offset: 1 }, { scopeId: "other" }]) expect(isMobileWorkspaceFilesIntent({ ...intent, operation: "open", scopeMode: "repository", ...extra })).toBe(false)
    expect(isMobileWorkspaceFilesIntent({ ...scoped, operation: "preview", target: { source: "disk", entryId: "x", changeId: "y", side: "before" } })).toBe(false)
    expect(isMobileWorkspaceFilesIntent({ ...scoped, operation: "diff", changeSetVersion: "set", changeId: "c", cursor: "next" })).toBe(false)
    expect(isMobileWorkspaceFilesIntent({ ...scoped, operation: "preview", target: { source: "change", changeId: "c", changeSetVersion: "s", side: "disk" } })).toBe(false)
  })
  it("counts UTF-16 field units and UTF-8 bytes with no target truncation", () => {
    expect(isMobileWorkspaceFilesIntent({ ...intent, operation: "open", sessionId: "😀".repeat(61), scopeMode: "repository" })).toBe(false)
    expect(isMobileWorkspaceFilesIntent({ ...scoped, operation: "search", query: "中".repeat(257) })).toBe(false)
    expect(mobileWorkspaceFilesUtf8Bytes("中😀")).toBe(7)
    expect(isMobileWorkspaceFilesEnvelopeWithinBudget({ text: "\n".repeat(L.maxEnvelopeBytes / 2) })).toBe(false)
    expect(isMobileWorkspaceFilesEnvelopeWithinBudget({ text: "中".repeat(L.maxEnvelopeBytes / 3) })).toBe(false)
  })
  it("pins generated CommonJS budgets to the single TS source", () => {
    const require = createRequire(import.meta.url)
    const cjs = require("./mobile-live-constants.cjs") as { MOBILE_WORKSPACE_FILES_LIMITS: unknown; MOBILE_WORKSPACE_FILES_VERSION: number }
    expect(cjs.MOBILE_WORKSPACE_FILES_LIMITS).toEqual(L)
    expect(cjs.MOBILE_WORKSPACE_FILES_VERSION).toBe(MOBILE_WORKSPACE_FILES_VERSION)
  })
  it("distinguishes unavailable Git from a non-repository without breaking old scope replies", () => {
    expect(isMobileWorkspaceFilesResult({ ...open, data: { ...scope, gitAvailable: false } })).toBe(true)
    for (const gitUnavailableReason of ["not_git_repository", "git_unavailable", "external_filter_required", "permission_denied", "unsafe_path", "limit_exceeded"]) {
      expect(isMobileWorkspaceFilesResult({ ...open, data: { ...scope, gitAvailable: false, gitUnavailableReason } })).toBe(true)
      expect(isMobileWorkspaceFilesResult({ ...open, data: { ...scope, gitUnavailableReason } })).toBe(false)
    }
    expect(isMobileWorkspaceFilesResult({ ...open, data: { ...scope, gitAvailable: false, gitUnavailableReason: "unknown" } })).toBe(false)
  })
  it("requires trusted desktop context for file results while old replies remain valid", () => {
    const result = { intentId: "request-1", outcome: "accepted", workspaceFiles: open }
    expect(isMobileIntentResultPayload({ mobileClientInstanceId: "phone-1", result })).toBe(false)
    expect(isMobileIntentResultPayload({ desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1", result })).toBe(true)
    expect(isMobileIntentResultPayload({ mobileClientInstanceId: "phone-1", result: { intentId: "old", outcome: "accepted" } })).toBe(true)
  })
  it("validates each operation result and specific unavailable content states", () => {
    const page = { pageIndex: 0, nextCursor: null, completion: "complete" }
    const unknownStats = { fileCount: 1, additions: null, deletions: null, collectionComplete: true, statsComplete: false }
    const results = [
      open, { ...open, operation: "refresh" }, directory,
      { ...open, operation: "search", data: { ...page, searchVersion: "search-1", entries: [file], scanComplete: true, scannedEntries: 3, collectionComplete: true } },
      { ...open, operation: "changes", data: { ...page, changeSetVersion: "set-1", changeRange: "unstaged", ranges: { unstaged: unknownStats, staged: unknownStats }, entries: [{ changeId: "change-1", changeRange: "unstaged", relativePath: "README.md", status: "modified", additions: null, deletions: null, statsComplete: false, contentState: "available", canPreviewBefore: true, canPreviewAfter: true }], collectionComplete: true, statsComplete: false } },
      { ...open, operation: "diff", data: { ...page, contentVersion: "content-1", changeId: "change-1", contentState: "available", hunks: [{ hunkId: "hunk-1", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lineOffset: 0, continued: false, lines: [{ kind: "addition", oldLineNumber: null, newLineNumber: 1, text: "新增 中文", truncated: false }] }], additions: null, deletions: null, statsComplete: false, contentComplete: true } },
      { ...open, operation: "preview", data: { ...page, contentVersion: "content-1", source: "change", side: "before", name: file.name, relativePath: file.relativePath, metadata: file.metadata, contentState: "binary", lines: [], contentComplete: true, format: "text" } },
      { ...open, operation: "reference", data: { referenceText: "'/scope/README.md'", contextVersion: "context-1" } },
      { ...open, operation: "cancel", data: { status: "alreadyCompleted", closedScopeId: "scope-1" } },
      { ...open, operation: "close", data: { status: "closed", pendingCancellationCount: 1 } },
    ]
    for (const result of results) expect(isMobileWorkspaceFilesResult(result), result.operation).toBe(true)
    expect(isMobileWorkspaceFilesResult({ ...results[3], data: { ...results[3]!.data, scanComplete: false } })).toBe(false)
  })
  it("validates page completeness, limits and safe display entries", () => {
    expect(isMobileWorkspaceFilesResult(directory)).toBe(true)
    expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, completion: "partial" } })).toBe(false)
    expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, completion: "truncated", truncatedReason: "limit" } })).toBe(true)
    expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, entries: Array(101).fill(file) } })).toBe(false)
    expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, entries: [{ ...file, relativePath: "../outside" }] } })).toBe(false)
    expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, entries: [{ ...file, kind: "symlink" }] } })).toBe(false)
  })
  it("preserves POSIX backslashes in display paths while rejecting parent-directory traversal", () => {
    const name = "a\\..\\b"
    for (const relativePath of [name, `nested/${name}`]) {
      const entry = { ...file, name, relativePath }
      expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, entries: [entry] } })).toBe(true)
      const preview = { ...open, operation: "preview", data: { pageIndex: 0, nextCursor: null, completion: "complete", contentVersion: "content-1", source: "disk", name, relativePath, metadata: file.metadata, contentState: "available", lines: [], contentComplete: true, format: "text" } }
      expect(isMobileWorkspaceFilesResult(preview)).toBe(true)
    }
    for (const relativePath of ["../outside", "nested/../outside", "/outside", "nested/\0outside"]) {
      expect(isMobileWorkspaceFilesResult({ ...directory, data: { ...directory.data, entries: [{ ...file, relativePath }] } })).toBe(false)
    }
    expect(isMobileWorkspaceFilesIntent({ ...scoped, operation: "preview", target: { source: "disk", entryId: "entry-1" }, relativePath: name })).toBe(false)
  })
  it("keeps absent and future capabilities compatible without treating them as version 1", () => {
    const base = { desktopClientInstanceId: "desktop", desktopName: "Mac", revision: 1, groups: [], sessions: [] }
    for (const payload of [base, { ...base, workspaceFilesVersion: 1 }, { ...base, workspaceFilesVersion: 2 }]) expect(isMobileSummaryPayload(payload)).toBe(true)
    const welcome = { connectionId: "connection", serverTime: time, heartbeatIntervalMs: 20000, heartbeatTimeoutMs: 45000 }
    for (const payload of [welcome, { ...welcome, mobileCapabilities: { workspaceFilesVersion: 1 } }, { ...welcome, mobileCapabilities: { workspaceFilesVersion: 2 } }]) expect(isLiveMobileServerMessage(createLiveEnvelope(LIVE_MESSAGE_TYPES.welcome, payload, { id: "hello", sentAt: time }))).toBe(true)
  })
})
