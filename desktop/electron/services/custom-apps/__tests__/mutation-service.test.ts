import { describe, expect, it, vi } from "vitest"

import {
  CustomAppsHttpApi,
  type CustomAppsAccountPort,
} from "../mutation-service"

describe("CustomAppsHttpApi", () => {
  it("uses the API origin path without duplicating the base /api prefix", async () => {
    const fetchAuthenticated = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      initialized: true,
      dockCatalogVersion: 1,
      apps: [],
      dockAppIds: [],
      dockMigrationIds: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    const account: CustomAppsAccountPort = {
      getState: () => ({ status: "unauthenticated" }),
      onStateChanged: () => () => {},
      captureAccountRequestScope: () => ({ accountId: "user-1", authRevision: 1 }),
      getApiBaseUrlForLive: () => "http://localhost:19700/api",
      fetchAuthenticated,
    }

    await expect(new CustomAppsHttpApi(account).fetchSnapshot()).resolves.toMatchObject({
      revision: 0,
    })

    expect(fetchAuthenticated).toHaveBeenCalledWith(
      "http://localhost:19700/api/custom-apps/snapshot",
      { method: "GET" },
      "自定义应用加载失败。",
      { accountId: "user-1", authRevision: 1 },
    )
  })
})
