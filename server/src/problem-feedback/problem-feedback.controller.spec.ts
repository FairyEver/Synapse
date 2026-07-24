import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { registerHttpBodyParsers } from "../common/http-body-parser"
import {
  ProblemFeedbackAdminController,
  ProblemFeedbackController,
} from "./problem-feedback.controller"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"
import { ProblemFeedbackRateLimiter } from "./problem-feedback-rate-limiter"
import { ProblemFeedbackService } from "./problem-feedback.service"

describe("problem feedback Nest routes", () => {
  let app: NestExpressApplication
  const submit = vi.fn().mockResolvedValue({ outcome: "success" })
  const listAdminPage = vi.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 2,
    pageSize: 10,
  })
  const deleteAdminRecord = vi.fn().mockResolvedValue("deleted")

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProblemFeedbackController, ProblemFeedbackAdminController],
      providers: [
        {
          provide: ProblemFeedbackService,
          useValue: { submit, listAdminPage, deleteAdminRecord },
        },
        {
          provide: ProblemFeedbackRateLimiter,
          useValue: { tryAcquire: vi.fn().mockReturnValue(true) },
        },
        ProblemFeedbackDiagnostics,
      ],
    })
      .overrideGuard(AdminAuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): {
            getRequest(): {
              admin?: { id: string; email: string }
            }
          }
        }) {
          context.switchToHttp().getRequest().admin = {
            id: "00112233-4455-4677-8899-aabbccddeeff",
            email: "admin@example.invalid",
          }
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    registerHttpBodyParsers(app)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("mounts only the anonymous POST at the exact public API path", async () => {
    const body = { content: "场景：合成测试。\n实际情况：公开路由正常。" }

    await request(app.getHttpServer())
      .post("/api/problem-feedback")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify(body))
      .expect(200, { success: true })
    await request(app.getHttpServer())
      .post("/problem-feedback")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify(body))
      .expect(404)

    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith(body)
  })

  it("mounts only the administrator GET and DELETE at their exact API paths", async () => {
    const id = "00112233-4455-4677-8899-aabbccddeeff"

    await request(app.getHttpServer())
      .get("/api/admin/problem-feedback?page=2")
      .expect(200, {
        data: [],
        total: 0,
        page: 2,
        pageSize: 10,
      })
    await request(app.getHttpServer())
      .get("/admin/problem-feedback?page=2")
      .expect(404)
    await request(app.getHttpServer())
      .delete(`/api/admin/problem-feedback/${id}`)
      .expect(200, { success: true })
    await request(app.getHttpServer())
      .delete(`/admin/problem-feedback/${id}`)
      .expect(404)

    expect(listAdminPage).toHaveBeenCalledOnce()
    expect(deleteAdminRecord).toHaveBeenCalledOnce()
  })
})

describe("ProblemFeedbackController", () => {
  it("returns the minimal success response after persistence", async () => {
    const response = createResponse()
    const controller = new ProblemFeedbackController(
      { submit: vi.fn().mockResolvedValue({ outcome: "success" }) } as never,
      { tryAcquire: vi.fn().mockReturnValue(true) } as never,
      new ProblemFeedbackDiagnostics(),
    )

    await controller.submit({ ip: "192.0.2.1", body: { content: "synthetic" } } as never, response as never)

    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.send).toHaveBeenCalledWith('{"success":true}')
  })

  it("destroys the response for an ambiguous commit outcome", async () => {
    const response = createResponse()
    const controller = new ProblemFeedbackController(
      { submit: vi.fn().mockResolvedValue({ outcome: "unknown" }) } as never,
      { tryAcquire: vi.fn().mockReturnValue(true) } as never,
      new ProblemFeedbackDiagnostics(),
    )

    await controller.submit({ ip: "192.0.2.1", body: { content: "synthetic" } } as never, response as never)

    expect(response.destroy).toHaveBeenCalledOnce()
    expect(response.send).not.toHaveBeenCalled()
  })

  it("rate limits before shared validation and persistence", async () => {
    const response = createResponse()
    const submit = vi.fn()
    const controller = new ProblemFeedbackController(
      { submit } as never,
      { tryAcquire: vi.fn().mockReturnValue(false) } as never,
      new ProblemFeedbackDiagnostics(),
    )

    await controller.submit({ ip: "192.0.2.1", body: null } as never, response as never)

    expect(submit).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(429)
    expect(response.send).toHaveBeenCalledWith('{"code":"RATE_LIMITED"}')
  })
})

describe("ProblemFeedbackAdminController", () => {
  const adminRequest = {
    admin: { email: "admin@example.invalid" },
    ip: "192.0.2.1",
    headers: { "content-length": "0" },
  }

  it("rejects invalid UUIDs without reading the feedback table", async () => {
    const service = { deleteAdminRecord: vi.fn() }
    const controller = new ProblemFeedbackAdminController(service as never)

    await expect(controller.delete("not-a-uuid", {}, adminRequest as never))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(service.deleteAdminRecord).not.toHaveBeenCalled()
  })

  it("returns not found only after the transactional service audits it", async () => {
    const controller = new ProblemFeedbackAdminController({
      deleteAdminRecord: vi.fn().mockResolvedValue("not_found"),
    } as never)

    await expect(controller.delete(
      "00112233-4455-4677-8899-aabbccddeeff",
      {},
      adminRequest as never,
    )).rejects.toBeInstanceOf(NotFoundException)
  })

  it("maps transaction failures to one unavailable response", async () => {
    const controller = new ProblemFeedbackAdminController({
      deleteAdminRecord: vi.fn().mockRejectedValue(new Error("synthetic")),
    } as never)

    await expect(controller.delete(
      "00112233-4455-4677-8899-aabbccddeeff",
      {},
      adminRequest as never,
    )).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

function createResponse() {
  const response = {
    status: vi.fn(),
    set: vi.fn(),
    send: vi.fn(),
    destroy: vi.fn(),
  }
  response.status.mockReturnValue(response)
  response.set.mockReturnValue(response)
  response.send.mockReturnValue(response)
  return response
}
