import { Controller, Header, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import { skillHubUploadInputSchema } from "@synapse/shared/skill-hub-contracts"
import type { Response } from "express"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { hubError } from "./skill-hub-error"
import { assertHubWriteOrigin } from "./skill-hub-origin"
import { hubUploadByteLimit, SkillHubUploadService, validateHubUploadHeaders } from "./skill-hub-upload.service"

@UseGuards(UserAuthGuard)
@Controller("/api/skill-hub/uploads")
export class SkillHubUploadController {
  constructor(private readonly uploads: SkillHubUploadService) {}

  @Post()
  @Header("Cache-Control", "private, no-store")
  async stage(@Req() request: AuthenticatedUserRequest, @Res({ passthrough: true }) response: Response, @Query() query: unknown) {
    assertHubWriteOrigin(request, process.env.APP_PUBLIC_URL)
    const input = skillHubUploadInputSchema.safeParse(query)
    if (!input.success) throw hubError(400, "HUB_INVALID_INPUT", "Skill 上传参数无效。")
    const length = validateHubUploadHeaders(request.headers, hubUploadByteLimit(input.data))
    const abort = new AbortController()
    const cancel = () => abort.abort()
    const deadline = AbortSignal.timeout(120_000)
    let onTimeout: () => void = () => undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      onTimeout = () => {
        cancel()
        reject(hubError(408, "HUB_UPLOAD_INTERRUPTED", "Skill 上传超时，请重新尝试。"))
      }
      deadline.addEventListener("abort", onTimeout, { once: true })
    })
    response.once("close", cancel)
    try {
      return await Promise.race([
        this.uploads.stage(request.user!.id, input.data, request, abort.signal, length),
        timeout,
      ])
    } finally {
      response.off("close", cancel)
      deadline.removeEventListener("abort", onTimeout)
    }
  }
}
