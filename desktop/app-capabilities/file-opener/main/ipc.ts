import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { FILE_OPENER_SERVICE_ID } from "../shared/capability"
import { fileOpenInputSchema, fileOpenResultSchema, type FileOpenInput } from "../shared/schema"
import type { FileOpenerService } from "./service"

export const fileOpenerIpcModule: IpcModule = {
  id: "fileOpener",
  methods: {
    openFile: {
      operationId: "app.file_opener.file.open",
      kind: "invoke",
      request: fileOpenInputSchema,
      response: fileOpenResultSchema,
      handler: async (ctx, input: FileOpenInput) => ctx
        .resolve<FileOpenerService>(FILE_OPENER_SERVICE_ID)
        .open(input, {
          source: "app.ui",
          actor: { kind: "user", id: "synapse-renderer", display: "Synapse" },
        }),
    },
  },
  events: {},
}
