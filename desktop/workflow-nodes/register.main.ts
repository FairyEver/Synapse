import { nodeTypeRegistry } from "./registry"
import { promptNodeManifest, promptNodeExecutor } from "./prompt"
import { switchNodeManifest, switchNodeExecutor } from "./switch"
import { endNodeManifest, endNodeExecutor } from "./end"
import { httpRequestNodeManifest, httpRequestNodeExecutor } from "./http-request"
import { scriptNodeManifest, scriptNodeExecutor } from "./script"
import { workflowCallNodeManifest, workflowCallNodeExecutor } from "./workflow-call"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(httpRequestNodeManifest, httpRequestNodeExecutor)
nodeTypeRegistry.register(scriptNodeManifest, scriptNodeExecutor)
nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
