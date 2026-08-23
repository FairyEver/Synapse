import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { Response } from "express"
import { PinoLogger } from "nestjs-pino"
import { randomUUID } from "node:crypto"
import { formatAuditError } from "./audit-error"

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request =
      typeof http.getRequest === "function"
        ? http.getRequest<{ readonly id?: string | number | (() => string); readonly originalUrl?: string; readonly url?: string }>()
        : {}
    const { statusCode, error, message, code } = this.resolve(exception)
    const problemFeedbackPath = isProblemFeedbackPath(request.originalUrl ?? request.url ?? "")
    const openApiPath = isOpenApiPath(request.originalUrl ?? request.url ?? "")

    if (problemFeedbackPath || openApiPath) response.setHeader("Cache-Control", "no-store")
    if (statusCode >= 500 && !problemFeedbackPath) {
      this.logger.error(createExceptionLogMetadata(exception), "Unhandled server exception")
    }

    if (openApiPath) {
      const requestId = `req_${randomUUID().replace(/-/gu, "")}`
      const invalidRequest = statusCode === 400 || statusCode === 413 || statusCode === 415
      response.setHeader("X-Request-Id", requestId)
      response.status(invalidRequest ? 400 : statusCode).json({
        requestId,
        error: {
          code: invalidRequest ? "INVALID_REQUEST" : code ?? "INTERNAL_ERROR",
          message: invalidRequest ? "请求参数无效。" : message,
        },
      })
      return
    }

    response.status(statusCode).json({
      error,
      message,
      statusCode,
      ...(code ? { code } : {}),
    })
  }

  private resolve(exception: unknown): {
    statusCode: number
    error: string
    message: string
    code?: string
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      return {
        statusCode: status,
        error: HttpStatus[status] ?? "Error",
        message: typeof body === "string" ? body : readMessage(body),
        code: typeof body === "string" ? undefined : readCode(body),
      }
    }

    const httpLikeError = readHttpLikeError(exception)
    if (httpLikeError) return httpLikeError

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception)
    }

    return {
      statusCode: 500,
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "production"
          ? "服务器内部错误。"
          : exception instanceof Error
            ? exception.message
            : "服务器内部错误。",
    }
  }

  private resolvePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { statusCode: number; error: string; message: string } {
    switch (error.code) {
      case "P2002":
        return { statusCode: 409, error: "Conflict", message: "资源已存在。" }
      case "P2003":
        return { statusCode: 400, error: "Bad Request", message: "请求引用的关联数据不存在。" }
      case "P2025":
        return { statusCode: 404, error: "Not Found", message: "资源不存在。" }
      default:
        return {
          statusCode: 500,
          error: "Internal Server Error",
          message: "数据库操作失败。",
        }
    }
  }
}

function isProblemFeedbackPath(url: string): boolean {
  const pathname = url.split("?")[0] ?? ""
  return pathname === "/api/problem-feedback"
    || pathname === "/api/admin/problem-feedback"
    || pathname.startsWith("/api/admin/problem-feedback/")
}

function isOpenApiPath(url: string): boolean {
  const pathname = url.split("?")[0] ?? ""
  return pathname === "/api/open/v1" || pathname.startsWith("/api/open/v1/")
}

function createExceptionLogMetadata(exception: unknown): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    errorName: exception instanceof Error ? exception.name : typeof exception,
    error: formatAuditError(exception),
  }
  if (exception instanceof Error && exception.stack) {
    metadata.stackLength = exception.stack.length
  }
  return metadata
}

function readMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.join("；")
  }
  return "请求失败。"
}

function readCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("code" in body)) return undefined
  const value = (body as { code: unknown }).code
  return typeof value === "string" ? value : undefined
}

function readHttpLikeError(exception: unknown): {
  statusCode: number
  error: string
  message: string
} | null {
  if (!exception || typeof exception !== "object") return null
  const record = exception as {
    readonly status?: unknown
    readonly statusCode?: unknown
    readonly expose?: unknown
    readonly error?: unknown
    readonly message?: unknown
  }
  const statusCode = typeof record.statusCode === "number"
    ? record.statusCode
    : typeof record.status === "number" ? record.status : undefined
  if (!statusCode || statusCode < 400 || statusCode > 599) return null
  if (statusCode >= 500) {
    return {
      statusCode,
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "production"
        ? "服务器内部错误。"
        : typeof record.message === "string" ? record.message : "服务器内部错误。",
    }
  }
  if (record.expose !== true) return null
  return {
    statusCode,
    error: typeof record.error === "string" ? record.error : HttpStatus[statusCode] ?? "Error",
    message: typeof record.message === "string" ? record.message : "请求失败。",
  }
}
