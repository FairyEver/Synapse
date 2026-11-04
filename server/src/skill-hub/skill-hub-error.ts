import { HttpException } from "@nestjs/common"

export function hubError(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status)
}
