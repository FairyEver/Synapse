import { describe, expect, it, vi } from "vitest"
import { MobileLiveController } from "./mobile-live.controller"
import type { MobileDeviceService } from "./mobile-device.service"
import type { MobileLiveRelayService } from "./mobile-live-relay.service"

function controllerWith(onlineDesktops: MobileLiveRelayService["onlineDesktops"]) {
  return new MobileLiveController(
    {} as unknown as MobileDeviceService,
    { onlineDesktops } as unknown as MobileLiveRelayService,
  )
}

const request = { user: { id: "user-1" } } as never

describe("MobileLiveController", () => {
  /*
   * Two shapes in one answer, and both have to stay.
   *
   * `clientInstanceIds` is what every shipped build decodes — `DesktopList` on the
   * iOS side has it as a non-optional field. Removing it in favour of the richer
   * list would make those phones read "no computer online" while one is running in
   * front of their user, which is a failure with no error attached to it.
   */
  it("lists reachable computers as both ids and named entries", async () => {
    const onlineDesktops = vi.fn(() => [
      { clientInstanceId: "desktop-a", deviceName: "MacBook Pro" },
      { clientInstanceId: "desktop-b", deviceName: "iMac" },
    ])
    const controller = controllerWith(onlineDesktops)

    const response = await controller.listDesktops(request)

    expect(response.clientInstanceIds).toEqual(["desktop-a", "desktop-b"])
    expect(response.desktops).toEqual([
      { clientInstanceId: "desktop-a", deviceName: "MacBook Pro" },
      { clientInstanceId: "desktop-b", deviceName: "iMac" },
    ])
  })

  it("asks for the calling user's computers only", async () => {
    const onlineDesktops = vi.fn(() => [])
    const controller = controllerWith(onlineDesktops)

    await controller.listDesktops(request)

    expect(onlineDesktops).toHaveBeenCalledWith("user-1")
  })

  it("answers with both keys empty when nothing is online", async () => {
    const controller = controllerWith(() => [])

    await expect(controller.listDesktops(request)).resolves.toEqual({
      clientInstanceIds: [],
      desktops: [],
    })
  })
})
