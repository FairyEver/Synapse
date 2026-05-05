import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, type Device } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { DevicesPage } from "./devices-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listDevices: vi.fn(),
    updateDevice: vi.fn(),
  },
}))

describe("DevicesPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("renders activation code information for each device row", async () => {
    const device = createDevice({
      id: "device_1",
      name: "MacBook",
      accountEmail: "user@example.com",
      platform: "darwin",
      appVersion: "0.2.55",
      status: "active",
    })
    vi.mocked(adminApi.listDevices).mockResolvedValue([device])

    const result = await render(<DevicesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("激活码")
      expect(result.container.textContent).toContain("SYN-****-0001")
      expect(result.container.textContent).toContain("user@example.com")
      const operationHead = Array.from(result.container.querySelectorAll("th"))
        .find((head) => head.textContent === "操作")
      const operationCell = result.container.querySelector("tbody tr td:last-child")
      expect(operationHead?.className).toContain("sticky")
      expect(operationHead?.className).toContain("right-0")
      expect(operationCell?.className).toContain("sticky")
      expect(operationCell?.className).toContain("right-0")
      const actionButton = operationCell?.querySelector("button")
      expect(actionButton?.getAttribute("data-variant")).toBe("ghost")
      expect(actionButton?.getAttribute("data-size")).toBe("sm")
      expect(actionButton?.textContent).toBe("撤销")
    })

    const revokeButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "撤销") as HTMLButtonElement

    await act(async () => {
      revokeButton.click()
    })

    expect(adminApi.updateDevice).toHaveBeenCalledWith("device_1", "revoked")
  })

  it("filters devices by name, account, platform and version", async () => {
    vi.mocked(adminApi.listDevices).mockResolvedValue([
      createDevice({
        id: "device_1",
        name: "MacBook",
        accountEmail: "alpha@example.com",
        platform: "darwin",
        appVersion: "0.2.55",
        status: "active",
      }),
      createDevice({
        id: "device_2",
        name: "Surface",
        accountEmail: "beta@example.com",
        platform: "win32",
        appVersion: "0.3.10",
        status: "revoked",
      }),
    ])

    const result = await render(<DevicesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("MacBook")
      expect(result.container.textContent).toContain("Surface")
    })

    const nameSearch = result.container.querySelector("#device-name-search") as HTMLInputElement
    const accountSearch = result.container.querySelector("#device-account-search") as HTMLInputElement
    const platformSearch = result.container.querySelector("#device-platform-search") as HTMLInputElement
    const versionSearch = result.container.querySelector("#device-version-search") as HTMLInputElement

    await act(async () => {
      changeInput(nameSearch, "surface")
      changeInput(accountSearch, "beta")
      changeInput(platformSearch, "win")
      changeInput(versionSearch, "0.3")
    })

    await waitFor(() => {
      expect(result.container.textContent).not.toContain("MacBook")
      expect(result.container.textContent).toContain("Surface")
      expect(result.container.textContent).toContain("beta@example.com")
      expect(result.container.textContent).toContain("win32")
      expect(result.container.textContent).toContain("0.3.10")
    })
  })
})

function createDevice(input: {
  readonly id: string
  readonly name: string
  readonly accountEmail: string
  readonly platform: string
  readonly appVersion: string
  readonly status: Device["status"]
}): Device {
  return {
    id: input.id,
    name: input.name,
    platform: input.platform,
    appVersion: input.appVersion,
    status: input.status,
    firstSeenAt: "2026-04-29T00:00:00.000Z",
    lastSeenAt: "2026-04-29T01:00:00.000Z",
    license: {
      id: `license_${input.id}`,
      status: "active",
      maxDevices: 1,
      expiresAt: null,
      createdAt: "2026-04-29T00:00:00.000Z",
      devices: [],
      activationCode: {
        id: `code_${input.id}`,
        codeHint: "SYN-****-0001",
      },
      account: {
        id: `account_${input.id}`,
        email: input.accountEmail,
        status: "active",
        note: null,
      },
    },
  }
}
