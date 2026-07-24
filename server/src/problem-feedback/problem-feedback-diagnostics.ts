import { Injectable } from "@nestjs/common"

export type ProblemFeedbackDiagnosticCounter =
  | "accepted"
  | "invalid_input"
  | "privacy_rejected"
  | "rate_limited"
  | "persistence_failed"
  | "retention_deleted"
  | "retention_failed"

@Injectable()
export class ProblemFeedbackDiagnostics {
  private readonly counters = new Map<ProblemFeedbackDiagnosticCounter, number>()

  increment(counter: ProblemFeedbackDiagnosticCounter, amount = 1): void {
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + amount)
  }

  snapshot(): Readonly<Record<ProblemFeedbackDiagnosticCounter, number>> {
    return {
      accepted: this.counters.get("accepted") ?? 0,
      invalid_input: this.counters.get("invalid_input") ?? 0,
      privacy_rejected: this.counters.get("privacy_rejected") ?? 0,
      rate_limited: this.counters.get("rate_limited") ?? 0,
      persistence_failed: this.counters.get("persistence_failed") ?? 0,
      retention_deleted: this.counters.get("retention_deleted") ?? 0,
      retention_failed: this.counters.get("retention_failed") ?? 0,
    }
  }
}
