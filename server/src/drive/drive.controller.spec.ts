import { type INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"

type SupertestResponse = { readonly text: string }
type SupertestChain = {
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => { readonly get: (path: string) => SupertestChain }

describe("DriveController", () => {
  let app: INestApplication | null = null
  const drive = {
    listItems: vi.fn(),
    resolvePublicShare: vi.fn(),
  }

  beforeEach(async () => {
    drive.listItems.mockReset()
    drive.resolvePublicShare.mockReset()
    drive.resolvePublicShare.mockRejectedValue(new NotFoundException("文件未找到"))
    const moduleRef = await Test.createTestingModule({
      controllers: [DriveUserController, DrivePublicController],
      providers: [{ provide: DriveService, useValue: drive }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn(() => { throw new UnauthorizedException("未登录或登录已过期。") }) })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
  })

  it("requires user auth for /api/drive/items", async () => {
    await request(app!.getHttpServer()).get("/api/drive/items").expect(401)
  })

  it("returns public not found for missing share ids", async () => {
    const response = await request(app!.getHttpServer()).get("/files/shr_missing").expect(404)
    expect(response.text).toContain("文件未找到")
  })
})
