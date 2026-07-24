import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Request, Response } from "express"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"
import { ProblemFeedbackRateLimiter } from "./problem-feedback-rate-limiter"
import { ProblemFeedbackService } from "./problem-feedback.service"

const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

@Controller("api/problem-feedback")
@SkipThrottle()
export class ProblemFeedbackController {
  constructor(
    private readonly service: ProblemFeedbackService,
    private readonly limiter: ProblemFeedbackRateLimiter,
    private readonly diagnostics: ProblemFeedbackDiagnostics,
  ) {}

  @Post()
  async submit(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.limiter.tryAcquire(request.ip)) {
      this.diagnostics.increment("rate_limited")
      sendPublicResponse(response, 429, { code: "RATE_LIMITED" })
      return
    }

    let result: Awaited<ReturnType<ProblemFeedbackService["submit"]>>
    try {
      result = await this.service.submit(request.body)
    } catch {
      response.destroy()
      return
    }
    if (result.outcome === "success") {
      sendPublicResponse(response, 200, { success: true })
      return
    }
    if (result.outcome === "failed") {
      sendPublicResponse(response, 503, { code: "SUBMISSION_FAILED" })
      return
    }
    if (result.outcome === "unknown") {
      response.destroy()
      return
    }

    if (result.validation.code === "INVALID_INPUT") {
      sendPublicResponse(response, 400, {
        code: "INVALID_INPUT",
        data: result.validation.data,
      })
      return
    }
    sendPublicResponse(response, 422, {
      code: "PRIVACY_RISK",
      data: result.validation.data,
    })
  }
}

@Controller("api/admin/problem-feedback")
@UseGuards(AdminAuthGuard)
export class ProblemFeedbackAdminController {
  constructor(private readonly service: ProblemFeedbackService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @Query() query: Record<string, unknown>,
    @Req() request: AdminRequest,
  ) {
    const page = parseAdminPage(query)
    return this.service.listAdminPage({
      page,
      adminEmail: requireAdminEmail(request),
      ipAddress: request.ip ?? "unknown",
    }).catch(() => {
      throw new ServiceUnavailableException("问题反馈暂时不可用。")
    })
  }

  @Delete(":id")
  @Header("Cache-Control", "no-store")
  async delete(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AdminRequest,
  ): Promise<{ readonly success: true }> {
    if (!canonicalUuidV4Pattern.test(id)) {
      throw new BadRequestException("反馈记录 ID 无效。")
    }
    if (Object.keys(query).length > 0 || requestHasBody(request)) {
      throw new BadRequestException("删除请求不能包含查询参数或请求体。")
    }
    try {
      const result = await this.service.deleteAdminRecord({
        id,
        adminEmail: requireAdminEmail(request),
        ipAddress: request.ip ?? "unknown",
      })
      if (result === "not_found") throw new NotFoundException("反馈记录不存在。")
      return { success: true }
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new ServiceUnavailableException("问题反馈暂时不可用。")
    }
  }
}

function sendPublicResponse(response: Response, status: number, body: unknown): void {
  response
    .status(status)
    .set({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    })
    .send(JSON.stringify(body))
}

function parseAdminPage(query: Record<string, unknown>): number {
  const keys = Object.keys(query)
  if (keys.some((key) => key !== "page")) {
    throw new BadRequestException("查询参数无效。")
  }
  const value = query.page
  if (value === undefined) return 1
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new BadRequestException("页码无效。")
  }
  const page = Number(value)
  if (!Number.isSafeInteger(page)) throw new BadRequestException("页码无效。")
  return page
}

function requireAdminEmail(request: AdminRequest): string {
  if (!request.admin?.email) throw new ServiceUnavailableException("问题反馈暂时不可用。")
  return request.admin.email
}

function requestHasBody(request: Request): boolean {
  const contentLength = request.headers["content-length"]
  return request.headers["transfer-encoding"] !== undefined
    || (typeof contentLength === "string" && contentLength !== "0")
    || (request.body !== undefined
      && request.body !== null
      && (typeof request.body !== "object" || Object.keys(request.body).length > 0))
}
