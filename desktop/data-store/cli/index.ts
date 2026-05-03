#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  console.error(`Error: synapse requires Node.js >= 18.0.0 (current: ${process.versions.node})`)
  process.exit(1)
}

import { apiCall, isAppRunning, readServerInfo, type ServerInfo } from "../shared/resolve-user-data"
import { handleDatabaseCommand } from "./database"
import { handleSchedulerCommand } from "./scheduler"

function printHelp(): void {
  console.log(`synapse - Synapse Database CLI

Usage:
  synapse database table list
  synapse database table create <tableName> <col:kind> [...] [--description "..."]
  synapse database table delete <tableName>
  synapse database table describe <tableName>
  synapse database table update <tableName> <description>
  synapse database table rename <fromTableName> <toTableName>
  synapse database overview get
  synapse database column create <tableName> <col:kind> [--description "..."]
  synapse database column update <tableName> <columnName> <description>
  synapse database column rename <tableName> <fromColumnName> <toColumnName>
  synapse database column delete <tableName> <columnName>
  synapse database choice update <tableName> <columnName> <choices>
  synapse database choice-usage get <tableName> <columnName>
  synapse database row create <tableName> --data '{"k":"v"}'
  synapse database rows create <tableName> --data '[{...}]'
  synapse database row list <tableName> [--where k=v] [--where-json '{...}'] [--limit N]
  synapse database row count <tableName> [--where k=v] [--where-json '{...}']
  synapse database row update <tableName> <rowId> --data '{"k":"v"}'
  synapse database row delete <tableName> <rowId>
  synapse database rows update <tableName> --where-json '{...}' --data '{"k":"v"}' [--dry-run]
  synapse database rows delete <tableName> --where-json '{...}' [--dry-run]
  synapse database log list [--limit N]
  synapse database sql read '<SQL>' [--params '[...]']
  synapse database sql execute '<SQL>' [--params '[...]']
  synapse scheduler task list [--enabled|--disabled] [--limit N]
  synapse scheduler task get <taskId>
  synapse scheduler task create --data '{...}'
  synapse scheduler task enable <taskId>
  synapse scheduler task disable <taskId>
  synapse scheduler task update <taskId> --data '{...}'
  synapse scheduler run list <taskId> [--limit N]
  synapse scheduler runtime inspect [taskId]
  synapse scheduler action-type list
  synapse status

Column kinds:
  text, integer, decimal, boolean, date, timestamp,
  single_choice, multi_choice, json, binary`)
}

function printStatus(info: ServerInfo | null): void {
  if (!info) {
    console.log("Port: -")
    console.log("PID: -")
    console.log("Started: -")
    console.log("Running: no")
    return
  }

  const running = isAppRunning(info.pid)
  console.log(`Port: ${info.port}`)
  console.log(`PID: ${info.pid}`)
  console.log(`Started: ${info.startedAt}`)
  console.log(`Running: ${running ? "yes" : "no"}`)
}

function readOptionalServerInfo(): ServerInfo | null {
  try {
    return readServerInfo()
  } catch {
    return null
  }
}

function readRequiredServerInfo(): ServerInfo {
  try {
    return readServerInfo()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "help" || command === "--help") {
    printHelp()
    return
  }

  if (command === "status") {
    printStatus(readOptionalServerInfo())
    return
  }

  if (command !== "database" && command !== "scheduler") {
    console.error(`Unknown command: ${command}\nRun "synapse help" for usage.`)
    process.exit(1)
  }

  const info = readRequiredServerInfo()
  if (!isAppRunning(info.pid)) {
    console.error("Synapse app is not running. Please start Synapse first.")
    process.exit(1)
  }

  try {
    if (command === "database") {
      await handleDatabaseCommand(args.slice(1), (action, params = {}) => apiCall(info, action, params))
      return
    }
    await handleSchedulerCommand(args.slice(1), (action, params = {}) => apiCall(info, action, params))
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
    process.exit(1)
  }
}

void main()
