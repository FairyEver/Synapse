import { describe, expect, it, vi } from "vitest"

import { getContentState } from "../components/content-browser-utils"
import { SYNAPSE_DELETED_CATEGORY_ID } from "@/lib/content-categories"

describe("getContentState", () => {
  it("shows the deleted-content empty state instead of the generic content empty state", () => {
    const state = getContentState({
      activeCategoryId: SYNAPSE_DELETED_CATEGORY_ID,
      categoryItems: [],
      contentType: "prompt",
      error: null,
      filteredItems: [],
      isLoading: false,
      items: [],
      itemsInActiveCategory: [],
      normalizedSearchQuery: "",
      onRetry: vi.fn(),
      repositoryStatus: "ready",
    })

    expect(state?.title).toBe("没有已删除的内容")
  })
})
