import { Inject, Injectable, OnApplicationBootstrap, Optional } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import { Client } from "pg"
import { loadEnv } from "../config/env"
import {
  PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE,
  PROBLEM_FEEDBACK_RETENTION_DAYS,
  PROBLEM_FEEDBACK_RETENTION_INTERVAL_MS,
} from "./problem-feedback.constants"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"

const PROBLEM_FEEDBACK_RETENTION_LOCK = 1_903_180
export const problemFeedbackRetentionClientFactoryToken =
  Symbol("problemFeedbackRetentionClientFactory")

export interface ProblemFeedbackRetentionClient {
  connect(): Promise<unknown>
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: T[]; readonly rowCount: number | null }>
  end(): Promise<void>
}

type ClientFactory = () => ProblemFeedbackRetentionClient

@Injectable()
export class ProblemFeedbackRetentionService implements OnApplicationBootstrap {
  private running = false

  private readonly createClient: ClientFactory

  constructor(
    private readonly diagnostics: ProblemFeedbackDiagnostics,
    @Optional()
    @Inject(problemFeedbackRetentionClientFactoryToken)
    createClient?: ClientFactory,
  ) {
    this.createClient = createClient ?? (() => new Client({
      connectionString: loadEnv(process.env).databaseUrl,
    }))
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.runCleanup()
  }

  @Interval(PROBLEM_FEEDBACK_RETENTION_INTERVAL_MS)
  async runCleanup(): Promise<void> {
    if (this.running) return
    this.running = true
    const client = this.createClient()
    let locked = false
    try {
      await client.connect()
      const lockResult = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [PROBLEM_FEEDBACK_RETENTION_LOCK],
      )
      locked = lockResult.rows[0]?.acquired === true
      if (!locked) return

      while (true) {
        let deleted = 0
        try {
          await client.query("BEGIN")
          const result = await client.query(`
            WITH expired AS (
              SELECT "id"
              FROM "ProblemFeedback"
              WHERE "receivedAt" <= CURRENT_TIMESTAMP - make_interval(days => $2)
              ORDER BY "receivedAt" ASC, "id" ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "ProblemFeedback" AS feedback
            USING expired
            WHERE feedback."id" = expired."id"
          `, [
            PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE,
            PROBLEM_FEEDBACK_RETENTION_DAYS,
          ])
          await client.query("COMMIT")
          deleted = result.rowCount ?? 0
          if (deleted > 0) this.diagnostics.increment("retention_deleted", deleted)
        } catch {
          await client.query("ROLLBACK").catch(() => undefined)
          this.diagnostics.increment("retention_failed")
          break
        }
        if (deleted < PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE) break
      }
    } catch {
      this.diagnostics.increment("retention_failed")
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock($1)", [
          PROBLEM_FEEDBACK_RETENTION_LOCK,
        ]).catch(() => undefined)
      }
      await client.end().catch(() => undefined)
      this.running = false
    }
  }
}
