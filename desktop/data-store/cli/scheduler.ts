type CliApiCall = (action: string, params?: Record<string, unknown>) => Promise<unknown>
type PrintLine = (line: string) => void

export async function handleSchedulerCommand(
  args: string[],
  apiCall: CliApiCall,
  print: PrintLine = console.log,
): Promise<void> {
  const command = args[0]
  switch (command) {
    case "list": {
      const params: Record<string, unknown> = {}
      if (args.includes("--enabled")) params.enabled = true
      if (args.includes("--disabled")) params.enabled = false
      const limit = getNumberFlag(args, "--limit")
      if (limit !== undefined) params.limit = limit
      const result = await apiCall("schedulerTaskList", params) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "get": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler get <taskId>")
      const result = await apiCall("schedulerTaskGet", { taskId }) as { data?: unknown }
      printJson(result.data ?? null, print)
      break
    }

    case "create": {
      const data = parseData(args)
      const result = await apiCall("schedulerTaskCreate", data as Record<string, unknown>) as { data?: { id?: string } }
      print(`Task created: ${result.data?.id ?? "-"}`)
      break
    }

    case "enable": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler enable <taskId>")
      await apiCall("schedulerTaskEnable", { taskId })
      print(`Task enabled: ${taskId}`)
      break
    }

    case "disable": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler disable <taskId>")
      await apiCall("schedulerTaskDisable", { taskId })
      print(`Task disabled: ${taskId}`)
      break
    }

    case "runs": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler runs <taskId> [--limit N]")
      const limit = getNumberFlag(args, "--limit")
      const params: Record<string, unknown> = { taskId }
      if (limit !== undefined) params.limit = limit
      const result = await apiCall("schedulerTaskRunsList", params) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "status": {
      const params: Record<string, unknown> = {}
      if (args[1] && !args[1].startsWith("--")) params.taskId = args[1]
      const result = await apiCall("schedulerTaskRuntimeStatus", params) as { data?: unknown }
      printJson(result.data ?? null, print)
      break
    }

    case "actions": {
      const result = await apiCall("schedulerActionTypesList", {}) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "update": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler update <taskId> --data '{...}'")
      const data = parseData(args, "Usage: synapse scheduler update <taskId> --data '{...}'")
      if (!isRecord(data)) throw new Error("Invalid JSON for --data: expected object.")
      const result = await apiCall("schedulerTaskUpdate", { taskId, ...data }) as { data?: { id?: string } }
      print(`Task updated: ${result.data?.id ?? taskId}`)
      break
    }

    default:
      throw new Error(`Unknown scheduler command: ${command ?? ""}\nRun "synapse help" for usage.`)
  }
}

function parseData(args: string[], usage = "Usage: synapse scheduler create --data '{...}'"): unknown {
  const value = getFlagValue(args, "--data")
  if (value === undefined) throw new Error(usage)
  try {
    return JSON.parse(value)
  } catch {
    throw new Error("Invalid JSON for --data.")
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
  return value
}

function getNumberFlag(args: string[], flag: string): number | undefined {
  const value = getFlagValue(args, flag)
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${flag} value: expected positive integer`)
  return parsed
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) throw new Error(usage)
  return value
}

function printJson(value: unknown, print: PrintLine): void {
  print(JSON.stringify(value, null, 2))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
