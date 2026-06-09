import { describe, expect, it } from "vitest"

import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { isWorkflowEntryVisible } from "@/app-shell/workflow-entry-visibility"

describe("workflow entry visibility", () => {
  it("keeps the workflow entry hidden unless the cheat code state is active", () => {
    expect(isWorkflowEntryVisible({})).toBe(false)
    expect(isWorkflowEntryVisible({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: false })).toBe(false)
    expect(isWorkflowEntryVisible({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true })).toBe(true)
  })

  it("shows the workflow entry when the app config enables it by default", () => {
    expect(isWorkflowEntryVisible({}, { visibleByDefault: true })).toBe(true)
    expect(isWorkflowEntryVisible({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: false }, { visibleByDefault: true })).toBe(true)
  })
})
