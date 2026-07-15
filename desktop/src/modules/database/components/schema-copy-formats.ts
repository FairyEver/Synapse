import type { Column, DatabaseTableSchema } from "@/types/database"

type SchemaCopyFormat = {
  key: string
  label: string
  description: string
  generate: (schema: DatabaseTableSchema) => string
}

type SchemaCopyGroup = {
  key: string
  label: string
  formats: SchemaCopyFormat[]
}

function sqlType(col: Column): string {
  if (col.primaryKey) return "INTEGER PRIMARY KEY AUTOINCREMENT"
  switch (col.kind) {
    case "integer":
    case "boolean":
      return "INTEGER"
    case "decimal":
      return "REAL"
    case "binary":
      return "BLOB"
    default:
      return "TEXT"
  }
}

function tsType(col: Column): string {
  switch (col.kind) {
    case "integer":
    case "decimal":
      return "number"
    case "text":
    case "date":
    case "timestamp":
      return "string"
    case "boolean":
      return "boolean"
    case "binary":
      return "Buffer"
    case "json":
      return "Record<string, unknown>"
    case "single_choice":
      if (col.choices && col.choices.length > 0) {
        return col.choices.map((v) => `"${v}"`).join(" | ")
      }
      return "string"
    case "multi_choice":
      if (col.choices && col.choices.length > 0) {
        return `(${col.choices.map((v) => `"${v}"`).join(" | ")})[]`
      }
      return "string[]"
    default:
      return "unknown"
  }
}

function systemColumnDescription(col: Column): string {
  if (col.primaryKey) return "主键，自增"
  if (col.name === "created_at") return "创建时间，自动生成"
  if (col.name === "updated_at") return "更新时间，自动更新"
  return ""
}

function generateSQL(schema: DatabaseTableSchema): string {
  const lines = schema.columns.map((col) => `  ${col.name} ${sqlType(col)}`)
  return `CREATE TABLE ${schema.name} (\n${lines.join(",\n")}\n);`
}

function generateMarkdown(schema: DatabaseTableSchema): string {
  const header = "| 列名 | 类型 | 说明 |"
  const separator = "| --- | --- | --- |"
  const rows = schema.columns.map((col) => {
    const typeDisplay = (col.kind === "single_choice" || col.kind === "multi_choice") && col.choices && col.choices.length > 0
      ? `${col.kind} [${col.choices.join(", ")}]`
      : col.kind
    return `| ${col.name} | ${typeDisplay} | ${col.system ? systemColumnDescription(col) : col.description || ""} |`
  })
  const lines = [`## ${schema.name}`, ""]
  if (schema.description) {
    lines.push(schema.description, "")
  }
  lines.push(header, separator, ...rows)
  return lines.join("\n")
}

function generateTypeScript(schema: DatabaseTableSchema): string {
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

function generateJSONSchema(schema: DatabaseTableSchema): string {
  const properties: Record<string, { type: string; format?: string; description?: string; enum?: string[]; items?: { type: string; enum?: string[] } }> = {}
  for (const col of schema.columns) {
    const prop: { type: string; format?: string; description?: string; enum?: string[]; items?: { type: string; enum?: string[] } } = {
      type: col.kind === "integer" || col.kind === "decimal" ? "number"
        : col.kind === "boolean" ? "boolean"
        : col.kind === "json" ? "object"
        : col.kind === "multi_choice" ? "array"
        : "string",
    }
    if (col.kind === "date") prop.format = "date"
    if (col.kind === "timestamp") prop.format = "date-time"
    if (col.kind === "single_choice" && col.choices && col.choices.length > 0) {
      prop.enum = col.choices
    }
    if (col.kind === "multi_choice" && col.choices && col.choices.length > 0) {
      prop.items = { type: "string", enum: col.choices }
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

function formatTypeLabel(col: Column): string {
  if ((col.kind === "single_choice" || col.kind === "multi_choice") && col.choices && col.choices.length > 0) {
    return `${col.kind}: ${col.choices.join(" | ")}`
  }
  return col.kind
}

function buildSampleRow(cols: Column[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const col of cols) {
    switch (col.kind) {
      case "integer":
      case "decimal":
        data[col.name] = 0
        break
      case "boolean":
        data[col.name] = true
        break
      case "date":
        data[col.name] = "YYYY-MM-DD"
        break
      case "timestamp":
        data[col.name] = "2026-04-24T15:30:00"
        break
      case "json":
        data[col.name] = {}
        break
      case "single_choice":
        data[col.name] = col.choices && col.choices.length > 0 ? col.choices[0] : "..."
        break
      case "multi_choice":
        data[col.name] = col.choices && col.choices.length > 0 ? [col.choices[0]] : []
        break
      case "binary":
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

function formatColumnLines(cols: Column[]): string[] {
  if (cols.length === 0) {
    return ["_（暂无业务列）_"]
  }
  return cols.map((col) => {
    const desc = col.description ? ` — ${col.description}` : ""
    return `- \`${col.name}\` (${formatTypeLabel(col)})${desc}`
  })
}

function bulkMutationSafetyLines(tableName: string, sampleRow: Record<string, unknown>): string[] {
  return [
    `## 批量更新/删除安全步骤`,
    `1. 使用窄且非空的同一 \`where\`，先以 \`dryRun: true\` 调用批量工具。`,
    `2. 检查返回的 \`ids\` 和 \`affected\`，确认目标行无误。`,
    `3. 再用完全相同的参数移除 \`dryRun\`（或设为 \`false\`）执行真实写入。`,
    ``,
    `### 批量更新预览 · \`app_database_rows_update\``,
    "```json",
    stringifyJson({ tableName, where: { id: 1 }, data: sampleRow, dryRun: true }),
    "```",
    ``,
    `### 批量删除预览 · \`app_database_rows_delete\``,
    "```json",
    stringifyJson({ tableName, where: { id: 1 }, dryRun: true }),
    "```",
    ``,
  ]
}

function generateMCPExample(schema: DatabaseTableSchema): string {
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
    `**MCP 服务**：\`synapse-mcp\`（系统列 \`id\` / \`created_at\` / \`updated_at\` 自动维护，插入/更新时不要传）`,
    ``,
    `## 业务列`,
    ...formatColumnLines(editableCols),
    ``,
    `## 取值规则`,
    `- boolean：\`true\` / \`false\``,
    `- date：\`"YYYY-MM-DD"\``,
    `- timestamp：ISO 8601，例如 \`"2026-04-24T15:30:00"\``,
    `- single_choice：必须精确匹配选项之一`,
    `- multi_choice：字符串数组，每项必须在选项中`,
    `- json：传对象或数组`,
    ``,
    `## 常用调用`,
    ``,
    `### \`app_database_row_create\``,
    "```json",
    stringifyJson({ tableName: schema.name, data: sampleRow }),
    "```",
    ``,
    `### \`app_database_row_list\`（可选 \`where\` / \`orderBy\` / \`limit\` / \`offset\`，默认上限 100 行）`,
    "```json",
    stringifyJson({ tableName: schema.name }),
    "```",
    ``,
    `### \`app_database_row_update\`（按 id 部分更新）`,
    "```json",
    stringifyJson({ tableName: schema.name, rowId: 1, data: sampleRow }),
    "```",
    ``,
    `### \`app_database_row_delete\`（按 id）`,
    "```json",
    stringifyJson({ tableName: schema.name, rowId: 1 }),
    "```",
    ``,
    ...bulkMutationSafetyLines(schema.name, sampleRow),
    `## where 用法`,
    `- 等值对象：\`{ "status": "todo" }\``,
    `- 多条件数组：\`[{ "field": "...", "op": "=|!=|>|<|>=|<=|LIKE|CONTAINS", "value": ... }]\``,
    `- **CONTAINS 仅用于 multi_choice**：\`[{ "field": "tags", "op": "CONTAINS", "value": "紧急" }]\``,
  )

  return lines.join("\n")
}

function generateSkillContext(schema: DatabaseTableSchema): string {
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
    `此表通过 MCP 服务 \`synapse-mcp\` 读写。下文覆盖结构、可用操作、取值规则和调用示例。`,
    ``,
    `## 列结构`,
    ``,
    `### 系统列（自动维护，插入/更新时不要传）`,
    `- \`id\` (integer) — 自增主键`,
    `- \`created_at\` (timestamp) — 创建时间，插入时自动写入`,
    `- \`updated_at\` (timestamp) — 更新时间，每次 app_database_row_update 自动刷新`,
    ``,
    `### 业务列`,
    ...formatColumnLines(editableCols),
    ``,
    `## 可用操作（MCP 工具）`,
    ``,
    `**读取**`,
    `- \`app_database_row_list\` — 条件查询 \`{ tableName, where?, orderBy?, limit?, offset? }\`（默认上限 100 行）`,
    `- \`app_database_row_count\` — 计数 \`{ tableName, where? }\``,
    `- \`app_database_table_describe\` — 查看最新结构 \`{ tableName }\`（确认 choices 当前值）`,
    ``,
    `**写入**`,
    `- \`app_database_row_create\` — 插入一行 \`{ tableName, data }\`，返回 \`{ id }\``,
    `- \`app_database_rows_create\` — 事务性批量插入 \`{ tableName, rows }\`，返回 \`{ ids }\``,
    `- \`app_database_row_update\` — 按 id 部分更新 \`{ tableName, rowId, data }\``,
    `- \`app_database_rows_update\` — 按条件批量更新 \`{ tableName, where, data, dryRun? }\`（where 不能为空）`,
    `- \`app_database_row_delete\` — 按 id 删除 \`{ tableName, rowId }\``,
    `- \`app_database_rows_delete\` — 按条件批量删除 \`{ tableName, where, dryRun? }\`（where 不能为空）`,
    ``,
    `## 字段取值规则`,
    ``,
    `- **boolean**：传 \`true\` / \`false\``,
    `- **date**：\`"YYYY-MM-DD"\``,
    `- **timestamp**：ISO 8601，例如 \`"2026-04-24T15:30:00"\``,
    `- **single_choice**：必须精确匹配选项之一`,
    `- **multi_choice**：传字符串数组，每项必须在选项中；读出时同样是数组`,
    `- **json**：传对象或数组`,
    ``,
    `## where 子句`,
    ``,
    `两种等价写法：`,
    `- 对象等值：\`{ "status": "todo" }\``,
    `- 数组表达式：\`[{ "field": "...", "op": "...", "value": ... }]\``,
    ``,
    `\`op\` 支持 \`=\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`, \`LIKE\`, \`CONTAINS\`。`,
    ``,
    `**CONTAINS 仅适用于 multi_choice 列**，匹配数组中包含给定值的行，例如 \`[{ "field": "tags", "op": "CONTAINS", "value": "紧急" }]\`。`,
    ``,
    `## 调用示例`,
    ``,
    `### 插入一行 · \`app_database_row_create\``,
    "```json",
    stringifyJson({ tableName: schema.name, data: sampleRow }),
    "```",
    ``,
    `### 查询全部 · \`app_database_row_list\``,
    "```json",
    stringifyJson({ tableName: schema.name }),
    "```",
    ``,
  )

  const singleChoiceCol = editableCols.find(
    (c) => c.kind === "single_choice" && c.choices && c.choices.length > 0,
  )
  if (singleChoiceCol && singleChoiceCol.choices) {
    lines.push(
      `### 按 \`${singleChoiceCol.name}\` 过滤 · \`app_database_row_list\``,
      "```json",
      stringifyJson({
        tableName: schema.name,
        where: { [singleChoiceCol.name]: singleChoiceCol.choices[0] },
      }),
      "```",
      ``,
    )
  }

  const multiChoiceCol = editableCols.find(
    (c) => c.kind === "multi_choice" && c.choices && c.choices.length > 0,
  )
  if (multiChoiceCol && multiChoiceCol.choices) {
    lines.push(
      `### 按 \`${multiChoiceCol.name}\` 包含过滤 · \`app_database_row_list\``,
      "```json",
      stringifyJson({
        tableName: schema.name,
        where: [
          { field: multiChoiceCol.name, op: "CONTAINS", value: multiChoiceCol.choices[0] },
        ],
      }),
      "```",
      ``,
    )
  }

  lines.push(
    `### 按 id 更新 · \`app_database_row_update\``,
    "```json",
    stringifyJson({ tableName: schema.name, rowId: 1, data: sampleRow }),
    "```",
    ``,
    `### 按 id 删除 · \`app_database_row_delete\``,
    "```json",
    stringifyJson({ tableName: schema.name, rowId: 1 }),
    "```",
    ``,
    ...bulkMutationSafetyLines(schema.name, sampleRow),
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

function buildSkillDescription(schema: DatabaseTableSchema): string {
  const tableRef = `\`${schema.name}\``
  const head = schema.description
    ? `通过 synapse-mcp 读写 ${tableRef} 表（${schema.description}）。`
    : `通过 synapse-mcp 读写 ${tableRef} 表。`
  const triggers = `Use when 查询 ${schema.name}、插入 ${schema.name}、更新 ${schema.name}、删除 ${schema.name}、统计 ${schema.name}、操作 ${schema.name} 表、${schema.name} CRUD、按字段筛选 ${schema.name} 数据。`
  return head + triggers
}

function generateSkillFile(schema: DatabaseTableSchema): string {
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

const SCHEMA_COPY_GROUPS: SchemaCopyGroup[] = [
  {
    key: "skill",
    label: "Skill 文件",
    formats: [
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
    ],
  },
  {
    key: "reference",
    label: "结构说明",
    formats: [
      {
        key: "mcp",
        label: "MCP 调用速查",
        description: "synapse-mcp 的 CRUD 示例",
        generate: generateMCPExample,
      },
      {
        key: "markdown",
        label: "Markdown 表格",
        description: "字段列表，适合写入文档",
        generate: generateMarkdown,
      },
      {
        key: "sql",
        label: "SQL CREATE TABLE",
        description: "DDL 建表语句",
        generate: generateSQL,
      },
    ],
  },
  {
    key: "typing",
    label: "类型定义",
    formats: [
      {
        key: "typescript",
        label: "TypeScript 类型",
        description: "行数据的 TS 类型",
        generate: generateTypeScript,
      },
      {
        key: "json-schema",
        label: "JSON Schema",
        description: "用于字段校验",
        generate: generateJSONSchema,
      },
    ],
  },
]

const SCHEMA_COPY_FORMATS: SchemaCopyFormat[] = SCHEMA_COPY_GROUPS.flatMap(
  (group) => group.formats,
)

export { SCHEMA_COPY_FORMATS, SCHEMA_COPY_GROUPS }
export type { SchemaCopyFormat, SchemaCopyGroup }
