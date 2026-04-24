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

function formatTypeLabel(col: DataStoreColumnInfo): string {
  if ((col.type === "ENUM" || col.type === "MULTI_ENUM") && col.enumValues && col.enumValues.length > 0) {
    return `${col.type}: ${col.enumValues.join(" | ")}`
  }
  return col.type
}

function buildSampleRow(cols: DataStoreColumnInfo[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const col of cols) {
    switch (col.type) {
      case "INTEGER":
      case "REAL":
        data[col.name] = 0
        break
      case "BOOLEAN":
        data[col.name] = true
        break
      case "DATE":
        data[col.name] = "YYYY-MM-DD"
        break
      case "DATETIME":
        data[col.name] = "YYYY-MM-DD HH:mm:ss"
        break
      case "JSON":
        data[col.name] = {}
        break
      case "ENUM":
        data[col.name] = col.enumValues && col.enumValues.length > 0 ? col.enumValues[0] : "..."
        break
      case "MULTI_ENUM":
        data[col.name] = col.enumValues && col.enumValues.length > 0 ? [col.enumValues[0]] : []
        break
      case "BLOB":
        data[col.name] = ""
        break
      default:
        data[col.name] = "..."
    }
  }
  return data
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatColumnLines(cols: DataStoreColumnInfo[]): string[] {
  if (cols.length === 0) {
    return ["_（暂无业务列）_"]
  }
  return cols.map((col) => {
    const desc = col.description ? ` — ${col.description}` : ""
    return `- \`${col.name}\` (${formatTypeLabel(col)})${desc}`
  })
}

function generateMCPExample(schema: DataStoreTableSchema): string {
  const editableCols = schema.columns.filter((c) => !c.system)
  const sampleRow = buildSampleRow(editableCols)

  const lines: string[] = [
    `# 数据表 \`${schema.name}\` · MCP 调用速查`,
    ``,
  ]
  if (schema.description) {
    lines.push(schema.description, ``)
  }
  lines.push(
    `**MCP 服务**：\`synapse-data\`（系统列 \`id\` / \`created_at\` / \`updated_at\` 自动维护，插入/更新时不要传）`,
    ``,
    `## 业务列`,
    ...formatColumnLines(editableCols),
    ``,
    `## 取值规则`,
    `- BOOLEAN：\`true\` / \`false\`（不是 0/1）`,
    `- DATE：\`"YYYY-MM-DD"\`；DATETIME：\`"YYYY-MM-DD HH:mm:ss"\``,
    `- ENUM：必须精确匹配允许值之一`,
    `- MULTI_ENUM：字符串数组，每项必须在允许值中`,
    `- JSON：传对象或数组，系统自动序列化`,
    ``,
    `## 常用调用`,
    ``,
    `### \`insert\``,
    "```json",
    stringifyJson({ table: schema.name, data: sampleRow }),
    "```",
    ``,
    `### \`query\`（可选 \`where\` / \`orderBy\` / \`limit\` / \`offset\`，默认上限 100 行）`,
    "```json",
    stringifyJson({ table: schema.name }),
    "```",
    ``,
    `### \`update\`（按 id 部分更新）`,
    "```json",
    stringifyJson({ table: schema.name, id: 1, data: sampleRow }),
    "```",
    ``,
    `### \`delete\`（按 id）`,
    "```json",
    stringifyJson({ table: schema.name, id: 1 }),
    "```",
    ``,
    `## where 用法`,
    `- 等值对象：\`{ "status": "todo" }\``,
    `- 多条件数组：\`[{ "field": "...", "op": "=|!=|>|<|>=|<=|LIKE|CONTAINS", "value": ... }]\``,
    `- **CONTAINS 仅用于 MULTI_ENUM**：\`[{ "field": "tags", "op": "CONTAINS", "value": "紧急" }]\``,
  )

  return lines.join("\n")
}

function generateSkillContext(schema: DataStoreTableSchema): string {
  const editableCols = schema.columns.filter((c) => !c.system)
  const sampleRow = buildSampleRow(editableCols)

  const lines: string[] = [
    `# 操作数据表 \`${schema.name}\``,
    ``,
  ]
  if (schema.description) {
    lines.push(`> ${schema.description}`, ``)
  }

  lines.push(
    `此表通过 MCP 服务 \`synapse-data\` 读写。下文覆盖结构、可用操作、取值规则和调用示例。`,
    ``,
    `## 列结构`,
    ``,
    `### 系统列（自动维护，插入/更新时不要传）`,
    `- \`id\` (INTEGER) — 自增主键`,
    `- \`created_at\` (DATETIME) — 创建时间，插入时自动写入`,
    `- \`updated_at\` (DATETIME) — 更新时间，每次 update 自动刷新`,
    ``,
    `### 业务列`,
    ...formatColumnLines(editableCols),
    ``,
    `## 可用操作（MCP 工具）`,
    ``,
    `**读取**`,
    `- \`query\` — 条件查询 \`{ table, where?, orderBy?, limit?, offset? }\`（默认上限 100 行）`,
    `- \`count\` — 计数 \`{ table, where? }\``,
    `- \`describe_table\` — 查看最新结构 \`{ name }\`（确认 ENUM / MULTI_ENUM 当前允许值）`,
    ``,
    `**写入**`,
    `- \`insert\` — 插入一行 \`{ table, data }\`，返回 \`{ id }\``,
    `- \`batch_insert\` — 事务性批量插入 \`{ table, rows }\`，返回 \`{ ids }\``,
    `- \`update\` — 按 id 部分更新 \`{ table, id, data }\``,
    `- \`update_where\` — 按条件批量更新 \`{ table, where, data }\`（where 不能为空）`,
    `- \`delete\` — 按 id 删除 \`{ table, id }\``,
    `- \`delete_where\` — 按条件批量删除 \`{ table, where }\`（where 不能为空）`,
    ``,
    `## 字段取值规则`,
    ``,
    `- **BOOLEAN**：传 \`true\` / \`false\`（不要传 0/1）`,
    `- **DATE**：\`"YYYY-MM-DD"\``,
    `- **DATETIME**：\`"YYYY-MM-DD HH:mm:ss"\``,
    `- **ENUM**：必须精确匹配声明的允许值之一`,
    `- **MULTI_ENUM**：传字符串数组，每项必须在允许值中；读出时同样是数组`,
    `- **JSON**：传对象或数组，系统自动序列化/反序列化`,
    ``,
    `## where 子句`,
    ``,
    `两种等价写法：`,
    `- 对象等值：\`{ "status": "todo" }\``,
    `- 数组表达式：\`[{ "field": "...", "op": "...", "value": ... }]\``,
    ``,
    `\`op\` 支持 \`=\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`, \`LIKE\`, \`CONTAINS\`。`,
    ``,
    `**CONTAINS 仅适用于 MULTI_ENUM 列**，匹配数组中包含给定值的行，例如 \`[{ "field": "tags", "op": "CONTAINS", "value": "紧急" }]\`。`,
    ``,
    `## 调用示例`,
    ``,
    `### 插入一行 · \`insert\``,
    "```json",
    stringifyJson({ table: schema.name, data: sampleRow }),
    "```",
    ``,
    `### 查询全部 · \`query\``,
    "```json",
    stringifyJson({ table: schema.name }),
    "```",
    ``,
  )

  const enumCol = editableCols.find(
    (c) => c.type === "ENUM" && c.enumValues && c.enumValues.length > 0,
  )
  if (enumCol && enumCol.enumValues) {
    lines.push(
      `### 按 \`${enumCol.name}\` 过滤 · \`query\``,
      "```json",
      stringifyJson({
        table: schema.name,
        where: { [enumCol.name]: enumCol.enumValues[0] },
      }),
      "```",
      ``,
    )
  }

  const multiEnumCol = editableCols.find(
    (c) => c.type === "MULTI_ENUM" && c.enumValues && c.enumValues.length > 0,
  )
  if (multiEnumCol && multiEnumCol.enumValues) {
    lines.push(
      `### 按 \`${multiEnumCol.name}\` 包含过滤 · \`query\``,
      "```json",
      stringifyJson({
        table: schema.name,
        where: [
          { field: multiEnumCol.name, op: "CONTAINS", value: multiEnumCol.enumValues[0] },
        ],
      }),
      "```",
      ``,
    )
  }

  lines.push(
    `### 按 id 更新 · \`update\``,
    "```json",
    stringifyJson({ table: schema.name, id: 1, data: sampleRow }),
    "```",
    ``,
    `### 按 id 删除 · \`delete\``,
    "```json",
    stringifyJson({ table: schema.name, id: 1 }),
    "```",
  )

  return lines.join("\n")
}

function formatYamlSingleLine(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim()
  const needsQuote =
    clean === "" ||
    /^[-?:|>&*%#!@"'[\]{}]/.test(clean) ||
    clean.includes(": ") ||
    /["\n\r]/.test(clean)
  if (!needsQuote) {
    return clean
  }
  const escaped = clean
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
  return `"${escaped}"`
}

function buildSkillName(tableName: string): string {
  const kebab = tableName.toLowerCase().replace(/_/g, "-")
  return `synapse-${kebab}`
}

function buildSkillDescription(schema: DataStoreTableSchema): string {
  const tableRef = `\`${schema.name}\``
  const head = schema.description
    ? `通过 synapse-data MCP 读写 ${tableRef} 表（${schema.description}）。`
    : `通过 synapse-data MCP 读写 ${tableRef} 表。`
  const triggers = `Use when 查询 ${schema.name}、插入 ${schema.name}、更新 ${schema.name}、删除 ${schema.name}、统计 ${schema.name}、操作 ${schema.name} 表、${schema.name} CRUD、按字段筛选 ${schema.name} 数据。`
  return head + triggers
}

function generateSkillFile(schema: DataStoreTableSchema): string {
  const name = buildSkillName(schema.name)
  const description = buildSkillDescription(schema)
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${formatYamlSingleLine(description)}`,
    "---",
    "",
  ].join("\n")
  return `${frontmatter}\n${generateSkillContext(schema)}`
}

const SCHEMA_COPY_FORMATS: SchemaCopyFormat[] = [
  {
    key: "skill-file",
    label: "新建 Skill",
    description: "完整 SKILL.md，含 frontmatter",
    generate: generateSkillFile,
  },
  {
    key: "skill-context",
    label: "嵌入已有 Skill",
    description: "仅正文，粘到现有 SKILL.md",
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
