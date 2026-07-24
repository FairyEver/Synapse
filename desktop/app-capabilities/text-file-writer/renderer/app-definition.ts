import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { TEXT_FILE_WRITER_APP_ID } from "../shared/capability"

export const textFileWriterAppDefinition = {
  id: TEXT_FILE_WRITER_APP_ID,
  namespace: "text_file_writer",
  type: "system",
  name: "文本写入文件",
  windowTitle: "文本写入文件",
  dock: { pinnedByDefault: false, order: 241 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
