/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CustomAppDto } from "@synapse/shared"

import { listSystemApps } from "../registry"
import { AppLauncherList } from "../components/app-launcher-list"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
let root: Root | null = null
let container: HTMLDivElement | null = null

describe("AppLauncherList custom apps", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("creates, opens, edits and deletes custom apps from the launcher", async () => {
    const onCreateCustomApp = vi.fn()
    const onOpenCustomApp = vi.fn()
    const onEditCustomApp = vi.fn()
    const onDeleteCustomApp = vi.fn()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(
      <AppLauncherList
        apps={listSystemApps()}
        pinnedAppIds={["agent", "launcher"]}
        onOpenApp={vi.fn()}
        onPinApp={vi.fn()}
        onUnpinApp={vi.fn()}
        onManageDock={vi.fn()}
        customApps={[customApp]}
        canEditCustomApps
        onCreateCustomApp={onCreateCustomApp}
        onOpenCustomApp={onOpenCustomApp}
        onEditCustomApp={onEditCustomApp}
        onDeleteCustomApp={onDeleteCustomApp}
      />,
    ))

    await act(async () => button("新建自定义应用").click())
    expect(onCreateCustomApp).toHaveBeenCalledTimes(1)

    await act(async () => button("阅读").click())
    expect(onOpenCustomApp).toHaveBeenCalledWith(customApp)

    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="编辑阅读"]')!.click())
    expect(onEditCustomApp).toHaveBeenCalledWith(customApp)

    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="删除阅读"]')!.click())
    expect(onDeleteCustomApp).toHaveBeenCalledWith(customApp)
  })
})

const customApp: CustomAppDto = {
  id: appId,
  kind: "web",
  schemaVersion: 1,
  name: "阅读",
  startUrl: "https://example.com/read",
  iconUrl: null,
  iconSource: "favicon",
  version: 1,
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}
