import { describe, expect, it } from "vitest"
import {
  CC_RECORD_PAGE_SIZE,
  formatRecordLoadStatus,
  shouldRequestNextRecords,
  shouldShowRecordEmptyState,
  shouldShowRecordLoadMoreSentinel,
} from "../cc/record-loading"

describe("CC record loading helpers", () => {
  it("uses a 50 record page size", () => {
    expect(CC_RECORD_PAGE_SIZE).toBe(50)
  })

  it("formats idle progress while more records remain", () => {
    expect(formatRecordLoadStatus({ shown: 50, total: 128, loading: false })).toBe("已显示 50 / 128")
  })

  it("formats the next loading range while existing records remain visible", () => {
    expect(formatRecordLoadStatus({ shown: 50, total: 128, loading: true })).toBe("正在加载 51-100 / 128")
  })

  it("caps the loading range at total", () => {
    expect(formatRecordLoadStatus({ shown: 100, total: 128, loading: true })).toBe("正在加载 101-128 / 128")
  })

  it("formats the all-loaded state", () => {
    expect(formatRecordLoadStatus({ shown: 128, total: 128, loading: false })).toBe("已显示全部 128 条")
  })

  it("does not return status text for an empty result", () => {
    expect(formatRecordLoadStatus({ shown: 0, total: 0, loading: false })).toBe("")
  })

  it("allows one request per visible row count", () => {
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: false,
      lastRequestedShown: null,
    })).toBe(true)
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: false,
      lastRequestedShown: 50,
    })).toBe(false)
  })

  it("blocks auto loading while loading or when all records are visible", () => {
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: true,
      lastRequestedShown: null,
    })).toBe(false)
    expect(shouldRequestNextRecords({
      shown: 128,
      total: 128,
      loading: false,
      lastRequestedShown: null,
    })).toBe(false)
  })

  it("keeps raw text search out of the terminal empty state while more pages remain", () => {
    expect(shouldShowRecordEmptyState({
      shown: 0,
      rawText: true,
      hasNextCursor: true,
      partial: false,
    })).toBe(false)
    expect(shouldShowRecordLoadMoreSentinel({
      shown: 0,
      rawText: true,
      hasNextCursor: true,
    })).toBe(true)
  })

  it("keeps partial raw text search warnings visible even with no matched rows", () => {
    expect(shouldShowRecordEmptyState({
      shown: 0,
      rawText: true,
      hasNextCursor: false,
      partial: true,
    })).toBe(false)
  })
})
