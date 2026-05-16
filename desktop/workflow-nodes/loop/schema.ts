import { z } from "zod"

export const loopNodeConfigSchema = z.object({
  mode: z.enum(["while", "for", "forEach"]),
  count: z.number().int().min(1).optional(),
  arrayInput: z.string().optional(),
  parallel: z.boolean().optional(),
  maxIterations: z.number().int().min(1).max(50).default(10),
  onError: z.enum(["stop", "skip"]).default("stop"),
  loopVariables: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(["text", "number"]),
    initialValue: z.union([z.string(), z.number()]),
    description: z.string().optional(),
  })).default([]),
  subgraph: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    outputMappings: z.array(z.object({
      targetVariable: z.string().min(1),
      sourceNodeId: z.string().min(1),
      sourceField: z.string().min(1),
    })).default([]),
  }).default({ nodes: [], edges: [], outputMappings: [] }),
}).superRefine((config, ctx) => {
  if (config.mode === "for" && (config.count === undefined || config.count < 1)) {
    ctx.addIssue({ code: "custom", path: ["count"], message: "for 模式必须指定执行次数（>= 1）" })
  }
  if (config.mode === "forEach" && !config.arrayInput) {
    ctx.addIssue({ code: "custom", path: ["arrayInput"], message: "forEach 模式必须绑定数组输入" })
  }
  // Validate loop variable names don't conflict with built-ins
  const builtins = new Set(["index", "round", "item"])
  for (const v of config.loopVariables) {
    if (builtins.has(v.name)) {
      ctx.addIssue({ code: "custom", path: ["loopVariables"], message: `变量名 "${v.name}" 与内置变量冲突` })
    }
  }
})
export type LoopNodeConfig = z.infer<typeof loopNodeConfigSchema>
