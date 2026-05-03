type CliApiCall = (action: string, params?: Record<string, unknown>) => Promise<unknown>
type PrintLine = (line: string) => void

export async function handleSchedulerCommand(
  args: string[],
  apiCall: CliApiCall,
  print: PrintLine = console.log,
): Promise<void> {
  const command = `${args[0] ?? ""}.${args[1] ?? ""}`
  switch (command) {
    case "task.list": {
      const params: Record<string, unknown> = {}
      if (args.includes("--enabled")) params.enabled = true
      if (args.includes("--disabled")) params.enabled = false
      const limit = getNumberFlag(args, "--limit")
      if (limit !== undefined) params.limit = limit
      const result = await apiCall("scheduler.task.list", params) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "task.get": {
      const taskId = requireArg(args[2], "Usage: synapse scheduler task get <taskId>")
      const result = await apiCall("scheduler.task.get", { taskId }) as { data?: unknown }
      printJson(result.data ?? null, print)
      break
    }

    case "task.create": {
      const data = parseData(args)
      const result = await apiCall("scheduler.task.create", data as Record<string, unknown>) as { data?: { id?: string } }
      print(`Task created: ${result.data?.id ?? "-"}`)
      break
    }

    case "task.enable": {
      const taskId = requireArg(args[2], "Usage: synapse scheduler task enable <taskId>")
      await apiCall("scheduler.task.enable", { taskId })
      print(`Task enabled: ${taskId}`)
      break
    }

    case "task.disable": {
      const taskId = requireArg(args[2], "Usage: synapse scheduler task disable <taskId>")
      await apiCall("scheduler.task.disable", { taskId })
      print(`Task disabled: ${taskId}`)
      break
    }

    case "run.list": {
      const taskId = requireArg(args[2], "Usage: synapse scheduler run list <taskId> [--limit N]")
      const limit = getNumberFlag(args, "--limit")
      const params: Record<string, unknown> = { taskId }
      if (limit !== undefined) params.limit = limit
      const result = await apiCall("scheduler.run.list", params) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "runtime.inspect": {
      const params: Record<string, unknown> = {}
      if (args[2] && !args[2].startsWith("--")) params.taskId = args[2]
      const result = await apiCall("scheduler.runtime.inspect", params) as { data?: unknown }
      printJson(result.data ?? null, print)
      break
    }

    case "action-type.list": {
      const result = await apiCall("scheduler.action_type.list", {}) as { data?: unknown }
      printJson(result.data ?? [], print)
      break
    }

    case "task.update": {
      const taskId = requireArg(args[2], "Usage: synapse scheduler task update <taskId> --data '{...}'")
      const data = parseData(args, "Usage: synapse scheduler task update <taskId> --data '{...}'")
      if (!isRecord(data)) throw new Error("Invalid JSON for --data: expected object.")
      const result = await apiCall("scheduler.task.update", { taskId, ...data }) as { data?: { id?: string } }
      print(`Task updated: ${result.data?.id ?? taskId}`)
      break
    }

    default:
      throw new Error(`Unknown scheduler command: ${args.join(" ")}\nRun "synapse help" for usage.`)
  }
}

function parseData(args: string[], usage = "Usage: synapse scheduler task create --data '{...}'"): unknown {
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
