import { nodeTypeRegistry } from "./registry"
import { promptNodeManifest, promptNodeExecutor } from "./prompt"
import { switchNodeManifest, switchNodeExecutor } from "./switch"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
