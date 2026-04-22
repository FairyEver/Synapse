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

// data-store/mcp/index.ts
var import_node_readline = require("node:readline");
var [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  process.stderr.write(`Error: Synapse MCP server requires Node.js >= 18.0.0 (current: ${process.versions.node})
`);
  process.exit(1);
}
var TOOLS = [
  {
    name: "list_tables",
    description: "List all user tables in the data store",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_table",
    description: "Create a new table",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Table name" },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"] }
            },
            required: ["name", "type"]
          },
          description: "Column definitions"
        },
        description: { type: "string", description: "Optional table description" }
      },
      required: ["name", "columns"]
    }
  },
  {
    name: "drop_table",
    description: "Drop a table and all its data",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Table name" } },
      required: ["name"]
    }
  },
  {
    name: "describe_table",
    description: "Get table schema and metadata",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Table name" } },
      required: ["name"]
    }
  },
  {
    name: "add_column",
    description: "Add a column to an existing table",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Table name" },
        column: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"] }
          },
          required: ["name", "type"]
        }
      },
      required: ["name", "column"]
    }
  },
  {
    name: "insert",
    description: "Insert a single row",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        data: { type: "object", description: "Row data as key-value pairs" }
      },
      required: ["table", "data"]
    }
  },
  {
    name: "batch_insert",
    description: "Insert multiple rows in a single transaction",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        rows: { type: "array", items: { type: "object" }, description: "Array of row data" }
      },
      required: ["table", "rows"]
    }
  },
  {
    name: "query",
    description: "Query rows from a table with optional filtering, sorting, and pagination",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        where: { description: "Filter conditions (object for equality, array for expressions)" },
        orderBy: { description: "Sort order (string or {field, dir})" },
        limit: { type: "number", description: "Max rows to return (default 100)" },
        offset: { type: "number", description: "Number of rows to skip" }
      },
      required: ["table"]
    }
  },
  {
    name: "update",
    description: "Update a row by id (partial update)",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        id: { type: "number", description: "Row id" },
        data: { type: "object", description: "Fields to update" }
      },
      required: ["table", "id", "data"]
    }
  },
  {
    name: "delete",
    description: "Delete a row by id",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        id: { type: "number", description: "Row id" }
      },
      required: ["table", "id"]
    }
  },
  {
    name: "raw_sql",
    description: "Execute raw SQL (cannot access system tables or use ATTACH/DETACH)",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement" },
        params: { type: "array", description: "Bind parameters" }
      },
      required: ["sql"]
    }
  }
];
var ACTION_MAP = {
  list_tables: "listTables",
  create_table: "createTable",
  drop_table: "dropTable",
  describe_table: "describeTable",
  add_column: "addColumn",
  insert: "insert",
  batch_insert: "batchInsert",
  query: "query",
  update: "update",
  delete: "delete",
  raw_sql: "rawSQL"
};
function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}
function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}
var serverInfo = null;
function getServerInfo() {
  if (!serverInfo) {
    serverInfo = readServerInfo();
    if (!isAppRunning(serverInfo.pid)) {
      throw new Error("Synapse app is not running");
    }
  }
  return serverInfo;
}
async function handleRequest(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "synapse-data", version: "1.0.0" }
    });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "tools/list") {
    sendResponse(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const toolName = params.name;
    const toolArgs = params.arguments ?? {};
    const action = ACTION_MAP[toolName];
    if (!action) {
      sendResponse(id, {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true
      });
      return;
    }
    try {
      const info = getServerInfo();
      const result = await apiCall(info, action, toolArgs);
      sendResponse(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      });
    } catch (error) {
      sendResponse(id, {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      });
    }
    return;
  }
  sendError(id, -32601, `Method not found: ${method}`);
}
var rl = (0, import_node_readline.createInterface)({ input: process.stdin });
rl.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    void handleRequest(request);
  } catch {
    sendError(null, -32700, "Parse error");
  }
});
