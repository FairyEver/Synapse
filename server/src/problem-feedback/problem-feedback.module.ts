import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import {
  ProblemFeedbackAdminController,
  ProblemFeedbackController,
} from "./problem-feedback.controller"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"
import { ProblemFeedbackRateLimiter } from "./problem-feedback-rate-limiter"
import { ProblemFeedbackRetentionService } from "./problem-feedback-retention.service"
import { ProblemFeedbackService } from "./problem-feedback.service"

@Module({
  imports: [AdminAuthModule],
  controllers: [ProblemFeedbackController, ProblemFeedbackAdminController],
  providers: [
    AuditLogService,
    ProblemFeedbackDiagnostics,
    ProblemFeedbackRateLimiter,
    ProblemFeedbackRetentionService,
    ProblemFeedbackService,
  ],
})
export class ProblemFeedbackModule {}
