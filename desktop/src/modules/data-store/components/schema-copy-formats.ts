import type { DataStoreColumnInfo, DataStoreTableSchema } from "@/types/data-store"

type SchemaCopyFormat = {
  key: string
  label: string
  description: string
  generate: (schema: DataStoreTableSchema) => string
}

function sqlType(col: DataStoreColumnInfo): string {
  if (col.primaryKey) return "INTEGER PRIMARY KEY AUTOINCREMENT"
  if (col.type === "DATE" || col.type === "DATETIME") return "TEXT"
  if (col.type === "BOOLEAN") return "INTEGER"
  if (col.type === "ENUM") return "TEXT"
  if (col.type === "MULTI_ENUM") return "TEXT"
  return col.type
}

function tsType(col: DataStoreColumnInfo): string {
  switch (col.type) {
    case "INTEGER":
      return "number"
    case "REAL":
      return "number"
    case "TEXT":
      return "string"
    case "DATE":
      return "string"
    case "DATETIME":
      return "string"
    case "BOOLEAN":
      return "boolean"
    case "BLOB":
      return "Buffer"
    case "JSON":
      return "Record<string, unknown>"
    case "ENUM":
      if (col.enumValues && col.enumValues.length > 0) {
        return col.enumValues.map((v) => `"${v}"`).join(" | ")
      }
      return "string"
    case "MULTI_ENUM":
      if (col.enumValues && col.enumValues.length > 0) {
        return `(${col.enumValues.map((v) => `"${v}"`).join(" | ")})[]`
      }
      return "string[]"
    default:
      return "unknown"
  }
}

function systemColumnDescription(col: DataStoreColumnInfo): string {
  if (col.primaryKey) return "主键，自增"
  if (col.name === "created_at") return "创建时间，自动生成"
  if (col.name === "updated_at") return "更新时间，自动更新"
  return ""
}

function generateSQL(schema: DataStoreTableSchema): string {
  const lines = schema.columns.map((col) => `  ${col.name} ${sqlType(col)}`)
  return `CREATE TABLE ${schema.name} (\n${lines.join(",\n")}\n);`
}

function generateMarkdown(schema: DataStoreTableSchema): string {
  const header = "| 列名 | 类型 | 说明 |"
  const separator = "| --- | --- | --- |"
  const rows = schema.columns.map((col) => {
    const typeDisplay = (col.type === "ENUM" || col.type === "MULTI_ENUM") && col.enumValues && col.enumValues.length > 0
      ? `${col.type} [${col.enumValues.join(", ")}]`
      : col.type
    return `| ${col.name} | ${typeDisplay} | ${col.system ? systemColumnDescription(col) : col.description || ""} |`
  })
  const lines = [`## ${schema.name}`, ""]
  if (schema.description) {
    lines.push(schema.description, "")
  }
  lines.push(header, separator, ...rows)
  return lines.join("\n")
}

function generateTypeScript(schema: DataStoreTableSchema): string {
  const name = schema.name.charAt(0).toUpperCase() + schema.name.slice(1)
  const fields = schema.columns
    .filter((col) => !col.system)
    .map((col) => `  ${col.name}: ${tsType(col)}`)
  const lines = [
    `type ${name}Row = {`,
    `  id: number`,
    `  created_at: string`,
    `  updated_at: string`,
    ...fields,
    `}`,
  ]
  return lines.join("\n")
}

function generateJSONSchema(schema: DataStoreTableSchema): string {
  const properties: Record<string, { type: string; format?: string; description?: string; enum?: string[]; items?: { type: string; enum?: string[] } }> = {}
  for (const col of schema.columns) {
    const prop: { type: string; format?: string; description?: string; enum?: string[]; items?: { type: string; enum?: string[] } } = {
      type: col.type === "INTEGER" || col.type === "REAL" ? "number"
        : col.type === "BOOLEAN" ? "boolean"
        : col.type === "JSON" ? "object"
        : col.type === "MULTI_ENUM" ? "array"
        : "string",
    }
    if (col.type === "DATE") prop.format = "date"
    if (col.type === "DATETIME") prop.format = "date-time"
    if (col.type === "ENUM" && col.enumValues && col.enumValues.length > 0) {
      prop.enum = col.enumValues
    }
    if (col.type === "MULTI_ENUM" && col.enumValues && col.enumValues.length > 0) {
      prop.items = { type: "string", enum: col.enumValues }
    }
    if (col.primaryKey) prop.description = "Auto-increment primary key"
    else if (col.system) prop.description = col.name === "created_at" ? "Auto-generated creation timestamp" : "Auto-updated modification timestamp"
    else if (col.description) prop.description = col.description
    properties[col.name] = prop
  }
  const obj = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: schema.name,
    type: "object" as const,
    properties,
    required: schema.columns.filter((c) => !c.system).map((c) => c.name),
  }
  return JSON.stringify(obj, null, 2)
}

function generateMCPExample(schema: DataStoreTableSchema): string {
  const editableCols = schema.columns.filter((c) => !c.system)
  const sampleData: Record<string, string> = {}
  for (const col of editableCols) {
    switch (col.type) {
      case "INTEGER":
        sampleData[col.name] = "0"
        break
      case "REAL":
        sampleData[col.name] = "0.0"
        break
      case "BOOLEAN":
        sampleData[col.name] = "true"
        break
      case "DATE":
        sampleData[col.name] = `"YYYY-MM-DD"`
        break
      case "DATETIME":
        sampleData[col.name] = `"YYYY-MM-DD HH:mm:ss"`
        break
      case "JSON":
        sampleData[col.name] = "{}"
        break
      case "ENUM":
        sampleData[col.name] = col.enumValues && col.enumValues.length > 0
          ? `"${col.enumValues[0]}"`
          : `"..."`
        break
      case "MULTI_ENUM":
        sampleData[col.name] = col.enumValues && col.enumValues.length > 0
          ? `["${col.enumValues[0]}"]`
          : `[]`
        break
      default:
        sampleData[col.name] = `"..."`
        break
    }
  }
  const dataStr = Object.entries(sampleData)
    .map(([k, v]) => `    "${k}": ${v}`)
    .join(",\n")

  return [
    `# MCP 工具: synapse-data`,
    `# 表名: ${schema.name}`,
    schema.description ? `# 说明: ${schema.description}` : null,
    ``,
    `## 查询`,
    `synapse-data.query({ "table": "${schema.name}" })`,
    ``,
    `## 插入`,
    `synapse-data.insert({`,
    `  "table": "${schema.name}",`,
    `  "data": {`,
    dataStr,
    `  }`,
    `})`,
    ``,
    `## 更新 (按 id)`,
    `synapse-data.update({`,
    `  "table": "${schema.name}",`,
    `  "id": 1,`,
    `  "data": {`,
    dataStr,
    `  }`,
    `})`,
    ``,
    `## 删除 (按 id)`,
    `synapse-data.delete({ "table": "${schema.name}", "id": 1 })`,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

function generateSkillContext(schema: DataStoreTableSchema): string {
  const editableCols = schema.columns.filter((c) => !c.system)

  const colRows = editableCols.map((col) => {
    const desc = col.description ? ` — ${col.description}` : ""
    const enumSuffix = (col.type === "ENUM" || col.type === "MULTI_ENUM") && col.enumValues && col.enumValues.length > 0
      ? `: ${col.enumValues.join("/")}`
      : ""
    return `- ${col.name} (${col.type}${enumSuffix})${desc}`
  })

  const sampleData: Record<string, string> = {}
  for (const col of editableCols) {
    switch (col.type) {
      case "INTEGER":
        sampleData[col.name] = "0"
        break
      case "REAL":
        sampleData[col.name] = "0.0"
        break
      case "BOOLEAN":
        sampleData[col.name] = "true"
        break
      case "DATE":
        sampleData[col.name] = `"YYYY-MM-DD"`
        break
      case "DATETIME":
        sampleData[col.name] = `"YYYY-MM-DD HH:mm:ss"`
        break
      case "JSON":
        sampleData[col.name] = "{}"
        break
      case "ENUM":
        sampleData[col.name] = col.enumValues && col.enumValues.length > 0
          ? `"${col.enumValues[0]}"`
          : `"..."`
        break
      case "MULTI_ENUM":
        sampleData[col.name] = col.enumValues && col.enumValues.length > 0
          ? `["${col.enumValues[0]}"]`
          : `[]`
        break
      default:
        sampleData[col.name] = `"..."`
        break
    }
  }
  const dataStr = Object.entries(sampleData)
    .map(([k, v]) => `    "${k}": ${v}`)
    .join(",\n")

  return [
    `## 数据表: ${schema.name}`,
    schema.description ? `\n${schema.description}` : null,
    ``,
    `### 列`,
    `- id (INTEGER) — 自增主键，插入时不需要提供`,
    `- created_at (TEXT) — 创建时间，自动生成`,
    `- updated_at (TEXT) — 更新时间，自动更新`,
    ...colRows,
    ``,
    `### 操作方式`,
    `使用 MCP 工具 \`synapse-data\``,
    ``,
    `插入:`,
    `\`\`\``,
    `synapse-data.insert({`,
    `  "table": "${schema.name}",`,
    `  "data": {`,
    dataStr,
    `  }`,
    `})`,
    `\`\`\``,
    ``,
    `查询:`,
    `\`\`\``,
    `synapse-data.query({ "table": "${schema.name}" })`,
    `\`\`\``,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

const SCHEMA_COPY_FORMATS: SchemaCopyFormat[] = [
  {
    key: "skill-context",
    label: "Skill 上下文",
    description: "粘贴到 Skill 中让 AI 操作此表",
    generate: generateSkillContext,
  },
  {
    key: "sql",
    label: "SQL CREATE TABLE",
    description: "DDL 建表语句",
    generate: generateSQL,
  },
  {
    key: "markdown",
    label: "Markdown",
    description: "表格形式的结构说明",
    generate: generateMarkdown,
  },
  {
    key: "typescript",
    label: "TypeScript 类型",
    description: "行数据的 TS 类型定义",
    generate: generateTypeScript,
  },
  {
    key: "json-schema",
    label: "JSON Schema",
    description: "JSON Schema 格式",
    generate: generateJSONSchema,
  },
  {
    key: "mcp",
    label: "MCP 调用示例",
    description: "synapse-data 工具的 CRUD 示例",
    generate: generateMCPExample,
  },
]

export { SCHEMA_COPY_FORMATS }
export type { SchemaCopyFormat }
