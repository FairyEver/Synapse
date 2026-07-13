import { nodeTypeRegistry } from "./registry"
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
import { swarmTaskNodeManifest } from "../app-capabilities/swarm-task/workflow-node/manifest"
import { swarmTaskNodeExecutor } from "../app-capabilities/swarm-task/workflow-node/executor.main"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(httpRequestNodeManifest, httpRequestNodeExecutor)
nodeTypeRegistry.register(scriptNodeManifest, scriptNodeExecutor)
nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
nodeTypeRegistry.register(codexNodeManifest, codexNodeExecutor)
nodeTypeRegistry.register(claudeCodeNodeManifest, claudeCodeNodeExecutor)
nodeTypeRegistry.register(documentTemplateNodeManifest, documentTemplateNodeExecutor)
nodeTypeRegistry.register(swarmTaskNodeManifest, swarmTaskNodeExecutor)
