import type { WecomCliRunOptions } from "./cli-client"
import type { WecomConnectionService } from "./connection-service"
import type {
  WecomCliOutputFormat,
  WecomCliRunInput,
  WecomCliRunResult,
  WecomConnectionView,
} from "../shared/command-schema"

export type WecomInvocationServiceDeps = {
  readonly connection: WecomConnectionService
}

export class WecomInvocationService {
  constructor(private readonly deps: WecomInvocationServiceDeps) {}

  async getConnection(): Promise<WecomConnectionView> {
    const snapshot = await this.deps.connection.snapshot()
    return {
      status: snapshot.status,
      enabled: snapshot.enabled,
      ...(snapshot.connectedAt ? { connectedAt: snapshot.connectedAt } : {}),
      ...(snapshot.lastValidatedAt ? { lastValidatedAt: snapshot.lastValidatedAt } : {}),
    }
  }

  async run(
    input: WecomCliRunInput,
    sessionKey: string,
    options: Pick<WecomCliRunOptions, "abortSignal"> = {},
  ): Promise<WecomCliRunResult> {
    return this.deps.connection.withConnected(async ({ ownerUserId, client, signal }) => {
      const result = await client.runAgent(ownerUserId, sessionKey, input.args, {
        abortSignal: options.abortSignal
          ? AbortSignal.any([signal, options.abortSignal])
          : signal,
        metadata: {
          operation: "wecom.cli.run",
          service: input.args[0],
          argCount: input.args.length,
        },
      })
      const parsed = parseOutput(result.output)
      return {
        ...parsed,
        workingDirectory: result.workingDirectory,
      }
    })
  }
}

function parseOutput(output: string): { readonly output: unknown; readonly format: WecomCliOutputFormat } {
  const trimmed = output.trim()
  if (!trimmed) return { output: "", format: "text" }

  try {
    return { output: JSON.parse(trimmed) as unknown, format: "json" }
  } catch {
    // Fall through to NDJSON and plain text detection.
  }

  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim())
  if (lines.length > 1) {
    try {
      return {
        output: lines.map((line) => JSON.parse(line) as unknown),
        format: "ndjson",
      }
    } catch {
      // The CLI can return ordinary text for help and diagnostics.
    }
  }

  return { output, format: "text" }
}
