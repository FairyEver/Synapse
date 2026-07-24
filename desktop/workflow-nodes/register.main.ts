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
import { fileOpenerNodeManifest, fileOpenerNodeExecutor } from "../app-capabilities/file-opener/workflow-node"
import { documentTemplateNodeManifest } from "../app-capabilities/document-template/workflow-node/manifest"
import { documentTemplateNodeExecutor } from "../app-capabilities/document-template/workflow-node/executor.main"
import { textExtractNodeManifest } from "../app-capabilities/text-extractor/workflow-node/manifest"
import { textExtractNodeExecutor } from "../app-capabilities/text-extractor/workflow-node/executor.main"
import { textFileWriterNodeManifest, textFileWriterNodeExecutor } from "../app-capabilities/text-file-writer/workflow-node"
import {
  htmlGeneratorEjsFileNodeExecutor,
  htmlGeneratorEjsFileNodeManifest,
  htmlGeneratorEjsNodeExecutor,
  htmlGeneratorEjsNodeManifest,
} from "../app-capabilities/html-generator/workflow-node"
import {
  systemNotifierNodeExecutor,
  systemNotifierNodeManifest,
} from "../app-capabilities/system-notifier/workflow-node"
import {
  jsonRepairNodeExecutor,
  jsonRepairNodeManifest,
} from "../app-capabilities/json-repair/workflow-node"
import {
  javascriptRunNodeExecutor,
  javascriptRunNodeManifest,
} from "../app-capabilities/javascript-run/workflow-node"
import {
  nodejsRunNodeExecutor,
  nodejsRunNodeManifest,
} from "../app-capabilities/nodejs-run/workflow-node"

nodeTypeRegistry.register(textNodeManifest, textNodeExecutor)
nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(httpRequestNodeManifest, httpRequestNodeExecutor)
nodeTypeRegistry.register(scriptNodeManifest, scriptNodeExecutor)
nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
nodeTypeRegistry.register(codexNodeManifest, codexNodeExecutor)
nodeTypeRegistry.register(claudeCodeNodeManifest, claudeCodeNodeExecutor)
nodeTypeRegistry.register(fileOpenerNodeManifest, fileOpenerNodeExecutor)
nodeTypeRegistry.register(documentTemplateNodeManifest, documentTemplateNodeExecutor)
nodeTypeRegistry.register(textExtractNodeManifest, textExtractNodeExecutor)
nodeTypeRegistry.register(textFileWriterNodeManifest, textFileWriterNodeExecutor)
nodeTypeRegistry.register(htmlGeneratorEjsNodeManifest, htmlGeneratorEjsNodeExecutor)
nodeTypeRegistry.register(htmlGeneratorEjsFileNodeManifest, htmlGeneratorEjsFileNodeExecutor)
nodeTypeRegistry.register(systemNotifierNodeManifest, systemNotifierNodeExecutor)
nodeTypeRegistry.register(jsonRepairNodeManifest, jsonRepairNodeExecutor)
nodeTypeRegistry.register(javascriptRunNodeManifest, javascriptRunNodeExecutor)
nodeTypeRegistry.register(nodejsRunNodeManifest, nodejsRunNodeExecutor)
