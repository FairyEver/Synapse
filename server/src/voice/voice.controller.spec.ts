import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UserAuthGuard } from "../auth/user-auth.guard"
import { VoiceController } from "./voice.controller"
import { VoiceService } from "./voice.service"

const service = {
  availability: vi.fn(),
  createSession: vi.fn(),
}

/**
 * 只挂被测 controller，service 用替身。鉴权本身由 `UserAuthGuard` 自己的用例覆盖，
 * 这里关心的是路由、状态码和响应形状。
 */
describe("VoiceController", () => {
  let app: INestApplication | null = null

  beforeEach(async () => {
    service.availability.mockReset()
    service.createSession.mockReset()
    service.availability.mockReturnValue({ available: true })
    service.createSession.mockReturnValue({
      url: "wss://asr.cloud.tencent.com/asr/v2/1252371654?secretid=AKID&signature=abc",
      voiceId: "voice-1",
      expiredAt: 1_700_000_300,
    })

    const moduleRef = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [{ provide: VoiceService, useValue: service }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: (context: never) => {
          const http = (context as unknown as { switchToHttp: () => { getRequest: () => { user?: { id: string } } } }).switchToHttp()
          http.getRequest().user = { id: "user-1" }
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
  })

  it("报告可用性，客户端据此决定显不显示麦克风入口", async () => {
    await request(app!.getHttpServer())
      .get("/api/voice/asr")
      .expect(200)
      .expect({ available: true })

    service.availability.mockReturnValue({ available: false })
    await request(app!.getHttpServer())
      .get("/api/voice/asr")
      .expect(200)
      .expect({ available: false })
  })

  it("POST 返回 200 与签好的会话，而不是默认的 201", async () => {
    const response = await request(app!.getHttpServer())
      .post("/api/voice/asr/session")
      .expect(200)

    expect(response.body).toEqual({
      url: "wss://asr.cloud.tencent.com/asr/v2/1252371654?secretid=AKID&signature=abc",
      voiceId: "voice-1",
      expiredAt: 1_700_000_300,
    })
    // 调用方不参与决定用哪个引擎、用哪个 voiceId——那些是服务端的事。
    expect(service.createSession).toHaveBeenCalledWith()
  })

  it("没配密钥时是 503 而不是 4xx，并且带一个客户端认得出的 code", async () => {
    const { ServiceUnavailableException } = await import("@nestjs/common")
    service.createSession.mockImplementation(() => {
      throw new ServiceUnavailableException({
        code: "VOICE_ASR_NOT_CONFIGURED",
        message: "语音识别暂不可用。",
      })
    })

    const response = await request(app!.getHttpServer())
      .post("/api/voice/asr/session")
      .expect(503)

    // 部署侧的问题不是调用方的错，所以 5xx；code 让客户端能把"平台没配"和
    // "这次请求有问题"分开。
    expect(response.body.code).toBe("VOICE_ASR_NOT_CONFIGURED")
  })
})
