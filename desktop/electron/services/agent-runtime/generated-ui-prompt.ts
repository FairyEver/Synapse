import { access, stat } from "node:fs/promises"
import { constants } from "node:fs"
import type { Options } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core"
import library from "../../../src/lib/generated-ui-library.json"
import type { AgentSdkSystemPrompt } from "./project-contributions"

const visualizationGuidance = "DATA PRESENTATION: Even without an explicit chart request, default to an OpenUI line chart for a multi-point time series with reliable, comparable data, including daily code activity; read the OpenUI reference first when using the short bootstrap. Put the chart before the exact values and relevant breakdown, and label units. For meaningful category comparisons or rankings use bars; use a pie chart only for a few non-negative parts of a meaningful whole. Use concise metric cards for related key figures when they aid scanning. Follow the user's requested output format. Prefer concise prose or a simple table for a single fact, small lookup, unsuitable or insufficient data. Never invent values, turn missing data into zero, mix incompatible units, or imply unobserved continuity; distinguish confirmed zero from missing data. Charts complement the exact values, scope and caveats, not replace them."

const chatReference = generateSystemPrompt({
  library: library as unknown as LibrarySpec,
  promptOptions: {
    // Upstream inlineMode hardcodes openui-lang and patch-only updates. SY owns
    // message framing: each block is an independent, complete program.
    inlineMode: false, bindings: true, toolCalls: false, editMode: false,
    preamble: "This reference applies only when you choose to emit an OpenUI chat block. When an in-chat table, chart or form improves an answer, optionally use the components below. It defines no restrictions for project code or file deliverables.",
    additionalRules: [
      "SY MESSAGE FORMAT: ordinary answers are Markdown. Put each interactive UI program in an unindented ```openui fenced block; openui-lang is also recognized. Text before and after a block is normal Markdown. Never use these fences for quoted code examples. On EVERY UI creation or update, emit a COMPLETE standalone program starting with root = Stack(...), including ALL referenced declarations and data. Blocks do not share state or statements with previous replies. Never output only changed statements, patches, ellipses or placeholders. A question about a UI can be answered in prose without a new UI block.",
      "Use existing agent tools to retrieve real data before rendering it. Never invent query results. Follow the data presentation guidance above and respect the user's requested output format and Persona instructions.",
      "Never use Query, Mutation, @Run, Modal, MarkDownRenderer, InlineMarkdownRenderer, image galleries or image cards. Do not load remote images, favicons or other external resources. Images may only use host-provided synapse-agent-artifact://local/ references.",
      "Use @ToAssistant for submissions and follow-ups. Form values will be sent as the next user turn in this same conversation. Use $variables, @Set and @Reset for local filtering. Do not invent custom actions or tool providers.",
      "Use exact positional component signatures. Stack has children, direction, gap, align, justify, wrap in that order: wrap is argument SIX, never argument five. Prefer omitting optional layout arguments; when wrapping, use Stack(items, \"row\", \"m\", \"stretch\", \"start\", true). Do not invent enum values or functions.",
      "Text and BoldText take variant BEFORE value: Text(\"text\", \"Added lines\"), never Text(\"Added lines\", \"text\"). For KPI cards use OverviewCardItem(\"added\", Text(\"text\", \"Added lines\"), MetricIndicatorInline(\"\" + @Sum(visible.amount))).",
      "For forms use Form(name, Buttons([...]), [FormControl(label, field)]). Bind defaults with declared $variables. Use @ToAssistant with a concise button label for server-side refresh; use @Set for immediate local changes. A range selector alone does not change report data: derive the displayed dataset from its binding for local filtering, or submit it and regenerate the full report in the next turn. Keep remarks and all selected fields in the submitted form.",
      "Derive charts, table rows, KPI values and count captions from the SAME displayed dataset. Do not hardcode active/empty-day counts or summary totals in prose if the dataset can change. Do not claim the UI was tested or an action completed before it runs.",
      "Use the official component defaults. Keep layout shallow, avoid nested cards, introductory paragraphs, duplicated labels and decorative text. Keep each UI block under 128 KiB and at most 500 statements.",
    ],
    examples: [
      'Complete KPI overview (fixture data only):\n```openui\nroot = Stack([OverviewCardBlock([added])])\nvisible = [{amount: 120}, {amount: 299}]\nadded = OverviewCardItem("added", Text("text", "Added lines"), MetricIndicatorInline("" + @Sum(visible.amount)))\n```',
      'Complete report with local filtering (fixture data only):\n```openui\nroot = Stack([filters, metrics, chart, table])\n$category = "All"\nfilters = Buttons([Button("All", @Set($category, "All")), Button("Office", @Set($category, "Office"))])\norders = [{category: "Office", name: "Paper", amount: 120}, {category: "Electronics", name: "Keyboard", amount: 299}]\nvisible = $category == "All" ? orders : @Filter(orders, "category", "==", $category)\nmetrics = Stack([TextContent("Count: " + @Count(visible)), TextContent("Total: " + @Sum(visible.amount))], "row")\nchart = BarChart(visible.name, [Series("Amount", visible.amount)])\ntable = Table([Col("Item", visible.name), Col("Amount", visible.amount, "number")])\n```',
      'Complete form for a follow-up in the same conversation (always include the entire program on update):\n```openui\nroot = Stack([report, filter])\nreport = LineChart(["Day 1", "Day 2"], [Series("Sales", [120, 180])])\n$range = "7"\nfilter = Form("filter", Buttons([Button("Update", @ToAssistant("Update"))]), [FormControl("Range", Select("range", [SelectItem("3", "Last 3 days"), SelectItem("7", "All 7 days")], null, null, $range)), FormControl("Remarks", TextArea("remark"))])\n```',
    ],
  },
})

const instructions = [
  "## SY optional chat UI scope",
  "OpenUI is an optional presentation format inside SY chat messages. Continue the normal Claude Code workflow and respect the user's requested output format, Persona and project instructions.",
  visualizationGuidance,
  "DEVELOPMENT TASKS: When the user asks to create, edit, save, build or debug websites, applications, components or code files (including HTML, CSS, JavaScript, TypeScript and React), use the existing tools as appropriate to produce the requested code or files. Never replace those deliverables with an OpenUI chat block. Building a dashboard or a form page in a project is a development task, not a request for an in-chat widget. Do not add OpenUI or its dependencies to a user project unless explicitly requested. Use ordinary language-tagged code fences for code examples.",
  "REFERENCE SCOPE: ALL component signatures, syntax, actions, resource restrictions, layout rules and final-verification requirements in the OpenUI reference below apply ONLY to OpenUI programs embedded in chat. They do not constrain project code, files, code examples, website resources or application architecture. Existing tools, permissions and safety checks remain in force. A chat UI may supplement a development result when requested, but never replaces the requested work.",
  "<openui_chat_reference>",
  chatReference,
  "</openui_chat_reference>",
].join("\n\n")

export function fullGeneratedUiReference(): string { return instructions }

export async function resolveGeneratedUiReferencePath(
  referencePath: string | undefined,
  tools: Options["tools"],
  disallowedTools: readonly string[] = [],
): Promise<string | undefined> {
  if (!referencePath || (Array.isArray(tools) && !tools.includes("Read"))
    || disallowedTools.some(rule => rule === "Read" || rule === "*" || rule.startsWith("Read("))) return undefined
  try {
    if (!(await stat(referencePath)).isFile()) return undefined
    await access(referencePath, constants.R_OK)
    return referencePath
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined
    throw error
  }
}

export function appendGeneratedUiPrompt(prompt: AgentSdkSystemPrompt, referencePath?: string): NonNullable<AgentSdkSystemPrompt> {
  const instructions = referencePath ? [
    "## SY optional chat UI",
    "Use Markdown for ordinary answers. When an in-chat chart, card, table, filter, or form improves the user's answer, use OpenUI; users need not know its name. Never replace requested project code/files with a chat widget.",
    visualizationGuidance,
    `BEFORE generating or updating any OpenUI, use Read to read the COMPLETE reference at ${JSON.stringify(referencePath)}. It contains the exact component signatures, examples and safety rules. Read all of it, without truncation; do not guess syntax. If unavailable, explain that the interactive UI cannot be generated and use prose, without claiming success.`,
    "After reading, put each COMPLETE standalone program in an unindented ```openui fence, starting root = Stack(...). Updates resend all declarations/data. Keep ordinary prose outside the fence. Use @ToAssistant for form submissions to this same conversation; retrieve real data with existing tools. No Query, Mutation, @Run, remote resources or host popups. Follow Persona/project instructions; the reference applies only to in-chat UI.",
  ].join("\n\n") : fullGeneratedUiReference()

  if (!prompt) return { type: "preset", preset: "claude_code", append: instructions }
  if (typeof prompt === "string") return `${prompt}\n\n${instructions}`
  if (Array.isArray(prompt)) return [...prompt, instructions]
  if (prompt.type === "custom") return { ...prompt, prompt: Array.isArray(prompt.prompt) ? [...prompt.prompt, instructions] : `${prompt.prompt}\n\n${instructions}` }
  return { ...prompt, append: [prompt.append, instructions].filter(Boolean).join("\n\n") }
}
