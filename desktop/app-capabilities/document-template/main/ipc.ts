import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { generateDocxInputSchema, generateDocxResultSchema } from "../shared/schema"
import { createDocumentTemplateService } from "./service"

export const documentTemplateIpcModule: IpcModule = {
  id: "documentTemplate",
  methods: {
    generateDocx: {
      channel: "synapse:document-template:docx:generate",
      kind: "invoke",
      request: generateDocxInputSchema,
      response: generateDocxResultSchema,
      handler: async (_ctx, request: z.infer<typeof generateDocxInputSchema>) =>
        createDocumentTemplateService().generateDocx(request),
    },
  },
  events: {},
}
