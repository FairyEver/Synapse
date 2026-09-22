import { BadRequestException } from "@nestjs/common"

export interface RequestFieldError { path: string; code: string; message: string }

/** Callers must supply schema-owned paths and fixed messages, never raw input or Zod issues. */
export class RequestValidationException extends BadRequestException {
  constructor(readonly fields: RequestFieldError[]) {
    super({ code: "INVALID_REQUEST", message: "扩展请求参数无效，请按接口契约填写。", fields })
  }
}
