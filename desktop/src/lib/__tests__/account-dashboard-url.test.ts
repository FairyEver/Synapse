import { describe, expect, it } from "vitest"

import { buildAccountDashboardHomeUrl } from "../account-dashboard-url"

describe("account dashboard URL", () => {
  it("builds the console home from the public app root", () => {
    expect(buildAccountDashboardHomeUrl("http://localhost:3000")).toBe("http://localhost:3000/console/")
    expect(buildAccountDashboardHomeUrl("https://synapse.d2.pub/")).toBe("https://synapse.d2.pub/console/")
  })

  it("uses the console path on the public app origin", () => {
    expect(buildAccountDashboardHomeUrl("https://example.com/app/")).toBe("https://example.com/console/")
  })
})
