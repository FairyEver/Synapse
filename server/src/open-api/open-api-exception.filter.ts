import { ArgumentsHost, Catch, ExceptionFilter, Injectable } from "@nestjs/common"
import type { Response } from "express"
import { PinoLogger } from "nestjs-pino"
import { openApiRequestId, toOpenApiError, type OpenApiRequest } from "./open-api.types"

@Injectable()
@Catch()
export class OpenApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<OpenApiRequest>()
    const response = http.getResponse<Response>()
    const requestId = openApiRequestId(request)
    const error = toOpenApiError(exception)
    if (error.statusCode >= 500 && error.code !== "USAGE_LOG_UNAVAILABLE") {
      this.logger.error({
        requestId,
        errorCode: error.code,
        errorName: exception instanceof Error ? exception.name : typeof exception,
      }, "Open API request failed")
    }
    if (response.headersSent) {
      response.destroy(exception instanceof Error ? exception : new Error("Open API stream failed."))
      return
    }
    response.setHeader("X-Request-Id", requestId)
    response.setHeader("Cache-Control", "no-store")
    response.status(error.statusCode).json({
      requestId,
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    })
  }
}
