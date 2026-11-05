/**
 * Phase 0.3 — Shell IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/shell-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { shell } from "electron"
import { lstat } from "node:fs/promises"
import path from "node:path"
import type { IpcModule } from "../../runtime/ipc/types"
import { runGuardedShellOperation } from "./guarded-shell"
import { SKILL_NAME_PATTERN } from "../../../src/lib/skill-name-input"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

export const shellIpcModule: IpcModule = {
  id: "shell",
  methods: {
    openExternal: {
      kind: "invoke",
      operationId: "app.shell.external.open",
      request: z.object({ url: z.string().url() }),
      response: z.void(),
      handler: async (ctx, request: { url: string }) => {
        const url = new URL(request.url)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("Only http and https links can be opened.")
        }
        const externalUrl = url.toString()
        const resource = sanitizeUrl(externalUrl)
        await runGuardedShellOperation({
          ctx,
          resource,
          source: "shell.openExternal",
          run: () => shell.openExternal(externalUrl),
        })
      },
    },
    showItemInFolder: {
      kind: "invoke",
      operationId: "app.shell.item.show_in_folder",
      request: z.object({ fullPath: z.string() }),
      response: z.void(),
      handler: async (ctx, request: { fullPath: string }) => {
        await runGuardedShellOperation({
          ctx,
          resource: request.fullPath,
          source: "shell.showItemInFolder",
          run: () => shell.showItemInFolder(request.fullPath),
        })
      },
    },
    openSkillDirectory: {
      kind: "invoke",
      operationId: "app.shell.skill_directory.open",
      request: z.object({ directoryPath: z.string().refine((value) => path.isAbsolute(value) && !value.includes("\0")) }).strict(),
      response: z.void(),
      handler: async (ctx, request: { directoryPath: string }) => {
        const directoryPath = path.resolve(request.directoryPath)
        await runGuardedShellOperation({
          ctx,
          resource: directoryPath,
          source: "shell.openSkillDirectory",
          run: async () => {
            const entry = await lstat(directoryPath)
            if (!entry.isDirectory() || !SKILL_NAME_PATTERN.test(path.basename(directoryPath))) {
              throw new Error("目标不是可打开的 Skill 文件夹。")
            }
            const mainFile = await lstat(path.join(directoryPath, "SKILL.md"))
            if (!mainFile.isFile()) throw new Error("目标不是可打开的 Skill 文件夹。")
            if (await shell.openPath(directoryPath)) throw new Error("无法打开文件夹。")
          },
        })
      },
    },
  },
  events: {},
}
