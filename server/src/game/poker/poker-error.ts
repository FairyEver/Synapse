import { BadRequestException } from "@nestjs/common"
export function reject(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new BadRequestException({ code, message, ...details })
}
