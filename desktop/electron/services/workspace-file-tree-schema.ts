import { z } from "zod"

export const workspaceFileTreeScopeIdInputSchema = z.object({
  scopeId: z.string().uuid(),
})

export const workspaceFileTreeListInputSchema = workspaceFileTreeScopeIdInputSchema.extend({
  relativePath: z.string(),
})

export const workspaceFileTreeResolvePathsInputSchema = workspaceFileTreeScopeIdInputSchema.extend({
  relativePaths: z.array(z.string()).min(1),
})

export const workspaceFileTreeResolvePathsResultSchema = z.object({
  scopeId: z.string().uuid(),
  paths: z.array(z.string().min(1)),
})

export const workspaceFileTreeScopeSchema = z.object({
  scopeId: z.string().uuid(),
  rootName: z.string().min(1),
  revision: z.number().int().nonnegative(),
})

export const workspaceFileTreeEntrySchema = z.object({
  relativePath: z.string(),
  name: z.string().min(1),
  kind: z.enum(["directory", "file", "symbolic-link"]),
})

export const workspaceFileTreeDirectoryResultSchema = z.object({
  scopeId: z.string().uuid(),
  relativePath: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(workspaceFileTreeEntrySchema),
})

export const workspaceFileTreeChangedEventSchema = z.object({
  scopeId: z.string().uuid(),
  relativePath: z.string(),
  revision: z.number().int().nonnegative(),
})
