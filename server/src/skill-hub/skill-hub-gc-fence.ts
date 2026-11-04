import { Injectable } from "@nestjs/common"
import { setTimeout as delay } from "node:timers/promises"
import { Client } from "pg"
import { loadEnv } from "../config/env"

type FenceClient = Pick<Client, "connect" | "end" | "on" | "query">
type FenceOptions = { waitMs: number; jobMs?: number }
const scope = "synapse:skill-hub:object-retention:v1"

export async function runUnderHubGcFence<T>(
  client: FenceClient, job: (signal: AbortSignal) => Promise<T>, options: FenceOptions,
): Promise<T | undefined> {
  const disconnected = new AbortController()
  client.on("error", () => disconnected.abort(new Error("Skill Hub retention connection was lost")))
  const deadline = performance.now() + options.waitMs
  try {
    await client.connect()
    for (;;) {
      disconnected.signal.throwIfAborted()
      const { rows } = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [scope],
      )
      if (rows[0]?.acquired) break
      const remaining = deadline - performance.now()
      if (remaining <= 0) return undefined
      await delay(Math.min(250, remaining), undefined, { signal: disconnected.signal })
    }

    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(options.jobMs ?? 20 * 60_000)])
    signal.throwIfAborted()
    const result = await job(signal)
    signal.throwIfAborted()
    return result
  } finally {
    // Dedicated non-pooled session: closing it releases the lock even after a
    // failed query, cancellation or lost connection.
    await client.end()
  }
}

@Injectable()
export class SkillHubGcFence {
  run<T>(job: (signal: AbortSignal) => Promise<T>, options: FenceOptions): Promise<T | undefined> {
    const connectionString = loadEnv(process.env).databaseUrl
    const client = new Client({
      connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 5_000,
      query_timeout: 5_000, keepAlive: true,
    })
    return runUnderHubGcFence(client, job, options)
  }
}
