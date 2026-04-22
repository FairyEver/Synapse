#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// data-store/shared/resolve-user-data.ts
var import_node_os = require("node:os");
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"));
function getUserDataPath() {
  switch (process.platform) {
    case "darwin":
      return import_node_path.default.join((0, import_node_os.homedir)(), "Library", "Application Support", "Synapse");
    case "win32":
      return import_node_path.default.join(process.env.APPDATA ?? import_node_path.default.join((0, import_node_os.homedir)(), "AppData", "Roaming"), "Synapse");
    default:
      return import_node_path.default.join((0, import_node_os.homedir)(), ".config", "Synapse");
  }
}
function readServerInfo() {
  const infoPath = import_node_path.default.join(getUserDataPath(), "data-server.json");
  try {
    const raw = (0, import_node_fs.readFileSync)(infoPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    throw new Error("Synapse is not running or data-server.json not found.\nMake sure Synapse app is open.");
  }
}
function isAppRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function apiCall(info, action, params = {}) {
  const url = `http://127.0.0.1:${info.port}/api`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${info.token}`
    },
    body: JSON.stringify({ action, ...params })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error ?? "Unknown error");
  }
  return data;
}

// data-store/cli/index.ts
var [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(`Error: synd requires Node.js >= 18.0.0 (current: ${process.versions.node})`);
  process.exit(1);
}
function printTable(rows) {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => formatValue(r[k]).length)));
  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "\u2500".repeat(w)).join("\u2500\u2500");
  console.log(header);
  console.log(separator);
  for (const row of rows) {
    console.log(keys.map((k, i) => formatValue(row[k]).padEnd(widths[i])).join("  "));
  }
}
function formatValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function parseColDef(s) {
  const [name, type] = s.split(":");
  if (!name || !type) {
    console.error(`Invalid column definition: "${s}". Expected format: name:type`);
    process.exit(1);
  }
  return { name, type: type.toUpperCase() };
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    console.log(`synd - Synapse Data Store CLI

Usage:
  synd tables                                     List all tables
  synd create <name> <col:type> [col:type...]     Create a table
  synd drop <name>                                Drop a table
  synd describe <name>                            Describe table schema
  synd add-column <table> <col:type>              Add a column
  synd insert <table> --data '{"k":"v"}'          Insert a row
  synd insert <table> --batch '[{...}]'           Batch insert
  synd query <table> [--where k=v] [--limit N]    Query rows
  synd update <table> <id> --data '{"k":"v"}'     Update a row
  synd delete <table> <id>                        Delete a row
  synd sql '<SQL>'                                Execute raw SQL
  synd status                                     Show service status`);
    return;
  }
  let info;
  try {
    info = readServerInfo();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!isAppRunning(info.pid)) {
    console.error("Synapse app is not running. Please start Synapse first.");
    process.exit(1);
  }
  try {
    switch (command) {
      case "tables": {
        const result = await apiCall(info, "listTables");
        printTable(result.data);
        break;
      }
      case "create": {
        const name = args[1];
        const colDefs = args.slice(2).map(parseColDef);
        if (!name || colDefs.length === 0) {
          console.error("Usage: synd create <name> <col:type> [col:type...]");
          process.exit(1);
        }
        await apiCall(info, "createTable", { name, columns: colDefs });
        console.log(`Table "${name}" created.`);
        break;
      }
      case "drop": {
        const name = args[1];
        if (!name) {
          console.error("Usage: synd drop <name>");
          process.exit(1);
        }
        await apiCall(info, "dropTable", { name });
        console.log(`Table "${name}" dropped.`);
        break;
      }
      case "describe": {
        const name = args[1];
        if (!name) {
          console.error("Usage: synd describe <name>");
          process.exit(1);
        }
        const result = await apiCall(info, "describeTable", { name });
        printTable(result.data.columns);
        break;
      }
      case "add-column": {
        const table = args[1];
        const colDef = args[2];
        if (!table || !colDef) {
          console.error("Usage: synd add-column <table> <col:type>");
          process.exit(1);
        }
        const col = parseColDef(colDef);
        await apiCall(info, "addColumn", { name: table, column: col });
        console.log(`Column "${col.name}" added to "${table}".`);
        break;
      }
      case "insert": {
        const table = args[1];
        if (!table) {
          console.error("Usage: synd insert <table> --data '{...}'");
          process.exit(1);
        }
        const batchIdx = args.indexOf("--batch");
        if (batchIdx !== -1) {
          const rows = JSON.parse(args[batchIdx + 1]);
          const result2 = await apiCall(info, "batchInsert", { table, rows });
          console.log(`${result2.affected} rows inserted.`);
          break;
        }
        const dataIdx = args.indexOf("--data");
        if (dataIdx === -1) {
          console.error("Missing --data or --batch flag");
          process.exit(1);
        }
        const data = JSON.parse(args[dataIdx + 1]);
        const result = await apiCall(info, "insert", { table, data });
        console.log(`Row inserted with id=${result.data.id}.`);
        break;
      }
      case "query": {
        const table = args[1];
        if (!table) {
          console.error("Usage: synd query <table>");
          process.exit(1);
        }
        const params = { table };
        const whereIdx = args.indexOf("--where");
        if (whereIdx !== -1) {
          const where = {};
          for (let i = whereIdx + 1; i < args.length; i++) {
            if (args[i].startsWith("--")) break;
            const [k, v] = args[i].split("=");
            if (k && v) where[k] = v;
          }
          params.where = where;
        }
        const limitIdx = args.indexOf("--limit");
        if (limitIdx !== -1) params.limit = parseInt(args[limitIdx + 1]);
        const result = await apiCall(info, "query", params);
        printTable(result.data);
        console.log(`
Total: ${result.total}`);
        break;
      }
      case "update": {
        const table = args[1];
        const id = parseInt(args[2]);
        const dataIdx = args.indexOf("--data");
        if (!table || isNaN(id) || dataIdx === -1) {
          console.error("Usage: synd update <table> <id> --data '{...}'");
          process.exit(1);
        }
        const data = JSON.parse(args[dataIdx + 1]);
        await apiCall(info, "update", { table, id, data });
        console.log(`Row ${id} updated.`);
        break;
      }
      case "delete": {
        const table = args[1];
        const id = parseInt(args[2]);
        if (!table || isNaN(id)) {
          console.error("Usage: synd delete <table> <id>");
          process.exit(1);
        }
        await apiCall(info, "delete", { table, id });
        console.log(`Row ${id} deleted.`);
        break;
      }
      case "sql": {
        const sql = args[1];
        if (!sql) {
          console.error("Usage: synd sql '<SQL>'");
          process.exit(1);
        }
        const result = await apiCall(info, "rawSQL", { sql });
        if (result.data.rows) {
          printTable(result.data.rows);
        } else {
          console.log(`Changes: ${result.data.changes}`);
        }
        break;
      }
      case "status": {
        console.log(`Port: ${info.port}`);
        console.log(`PID: ${info.pid}`);
        console.log(`Started: ${info.startedAt}`);
        console.log(`Running: ${isAppRunning(info.pid) ? "yes" : "no"}`);
        break;
      }
      default:
        console.error(`Unknown command: ${command}
Run "synd help" for usage.`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
void main();
