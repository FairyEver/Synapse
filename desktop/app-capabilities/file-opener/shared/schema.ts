import path from "node:path"
import { z } from "zod"

export const fileOpenInputSchema = z.object({
  path: z.string().min(1, "文件路径必填").refine(path.isAbsolute, "文件路径必须是绝对路径"),
}).strict()

export const fileOpenResultSchema = z.object({ path: z.string() }).strict()

export type FileOpenInput = z.infer<typeof fileOpenInputSchema>
export type FileOpenResult = z.infer<typeof fileOpenResultSchema>

