import { describe, expect, it } from "vitest"

import {
  getDiagnosticSnapshot,
  recordDiagnosticBreadcrumb,
  resetDiagnosticContextForTests,
  updateDiagnosticContext,
} from "../diagnostic-context"

describe("diagnostic context", () => {
  it("keeps active context and recent breadcrumbs for crash logs", () => {
    resetDiagnosticContextForTests()

    updateDiagnosticContext({
      activeRepositoryUuid: "repo-1",
      activeAppId: "agent",
      windowType: "main",
    })
    recordDiagnosticBreadcrumb({
      action: "click",
      component: "button",
      name: "agent-send",
    })

    expect(getDiagnosticSnapshot()).toMatchObject({
      context: {
        activeRepositoryUuid: "repo-1",
        activeAppId: "agent",
        windowType: "main",
      },
      breadcrumbs: [
        expect.objectContaining({
          action: "click",
          component: "button",
          name: "agent-send",
        }),
      ],
    })
  })

  it("caps breadcrumbs to the latest 100 entries", () => {
    resetDiagnosticContextForTests()

    for (let index = 0; index < 105; index += 1) {
      recordDiagnosticBreadcrumb({
        action: "click",
        component: "button",
        name: `item-${index}`,
      })
    }

    const snapshot = getDiagnosticSnapshot()
    expect(snapshot.breadcrumbs).toHaveLength(100)
    expect(snapshot.breadcrumbs[0]?.name).toBe("item-5")
    expect(snapshot.breadcrumbs[99]?.name).toBe("item-104")
  })
})
