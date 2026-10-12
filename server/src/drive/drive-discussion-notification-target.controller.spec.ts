import "reflect-metadata"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { expect, it, vi } from "vitest"
import { UserAuthService } from "../auth/user-auth.service"
import { DriveDiscussionNotificationTargetController } from "./drive-discussion-notification-target.controller"
import { DriveDiscussionNotificationTargetService } from "./drive-discussion-notification-target.service"

it("requires login and takes the recipient from authentication rather than query parameters", async () => {
  const resolve = vi.fn(async () => ({ status: "unavailable", message: "文档已删除或无法访问" }))
  const module = await Test.createTestingModule({
    controllers: [DriveDiscussionNotificationTargetController],
    providers: [
      { provide: DriveDiscussionNotificationTargetService, useValue: { resolve } },
      { provide: UserAuthService, useValue: { verifyWebSession: vi.fn(async () => null), verifyAccessToken: vi.fn(async () => ({ userId: "actual-reader" })) } },
    ],
  }).compile()
  const app = module.createNestApplication()
  await app.init()
  try {
    await request(app.getHttpServer()).get("/api/notifications/n-1/drive-target").expect(401)
    expect(resolve).not.toHaveBeenCalled()
    await request(app.getHttpServer()).get("/api/notifications/n-1/drive-target?userId=other&shareId=other").set("Authorization", "Bearer test").expect(200)
    expect(resolve).toHaveBeenCalledWith("actual-reader", "n-1")
  } finally { await app.close() }
})
