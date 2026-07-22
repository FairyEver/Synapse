import { nodeTypeRegistry } from "./registry"
import { textNodeManifest, textNodeExecutor } from "./text"
import { promptNodeManifest, promptNodeExecutor } from "./prompt"
import { switchNodeManifest, switchNodeExecutor } from "./switch"
import { endNodeManifest, endNodeExecutor } from "./end"
import { httpRequestNodeManifest, httpRequestNodeExecutor } from "./http-request"
import { scriptNodeManifest, scriptNodeExecutor } from "./script"
import { workflowCallNodeManifest, workflowCallNodeExecutor } from "./workflow-call"
import { codexNodeManifest, codexNodeExecutor } from "./codex"
import { claudeCodeNodeManifest, claudeCodeNodeExecutor } from "./claude-code"
import { documentTemplateNodeManifest } from "../app-capabilities/document-template/workflow-node/manifest"
import { documentTemplateNodeExecutor } from "../app-capabilities/document-template/workflow-node/executor.main"
import { textExtractNodeManifest } from "../app-capabilities/text-extractor/workflow-node/manifest"
import { textExtractNodeExecutor } from "../app-capabilities/text-extractor/workflow-node/executor.main"

nodeTypeRegistry.register(textNodeManifest, textNodeExecutor)
nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(httpRequestNodeManifest, httpRequestNodeExecutor)
nodeTypeRegistry.register(scriptNodeManifest, scriptNodeExecutor)
nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
nodeTypeRegistry.register(codexNodeManifest, codexNodeExecutor)
nodeTypeRegistry.register(claudeCodeNodeManifest, claudeCodeNodeExecutor)
nodeTypeRegistry.register(documentTemplateNodeManifest, documentTemplateNodeExecutor)
nodeTypeRegistry.register(textExtractNodeManifest, textExtractNodeExecutor)
