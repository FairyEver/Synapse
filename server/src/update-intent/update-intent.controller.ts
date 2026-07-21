import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import {
  RATE_LIMIT_TTL_MS,
  UPDATE_INTENT_ISSUE_RATE_LIMIT_PER_MINUTE,
  UPDATE_INTENT_VERIFY_RATE_LIMIT_PER_MINUTE,
} from "../common/rate-limits"
import { badRequestFromZodError } from "../common/zod-validation"
import { UpdateIntentService } from "./update-intent.service"

const issueThrottle = {
  default: {
    ttl: RATE_LIMIT_TTL_MS,
    limit: UPDATE_INTENT_ISSUE_RATE_LIMIT_PER_MINUTE,
  },
}
const verifyThrottle = {
  default: {
    ttl: RATE_LIMIT_TTL_MS,
    limit: UPDATE_INTENT_VERIFY_RATE_LIMIT_PER_MINUTE,
  },
}
const verifySchema = z.object({
  token: z.string().min(1).max(4_096),
}).strict()

@Controller("/api/desktop/update-intent")
export class UpdateIntentController {
  constructor(private readonly updateIntents: UpdateIntentService) {}

  @Post()
  @HttpCode(200)
  @Throttle(issueThrottle)
  issue(@Headers("origin") origin?: string) {
    return this.updateIntents.issue(origin)
  }

  @Post("/verify")
  @HttpCode(200)
  @Throttle(verifyThrottle)
  verify(@Body() body: unknown) {
    const parsed = verifySchema.safeParse(body)
    if (!parsed.success) {
      throw badRequestFromZodError(parsed.error, "更新凭证验证请求无效。")
    }
    return this.updateIntents.verify(parsed.data.token)
  }
}
