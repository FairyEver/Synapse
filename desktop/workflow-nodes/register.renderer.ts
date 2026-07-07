// Renderer-side node registration.
//
// Registers manifests ONLY. Executors live next to each node in
// `executor.main.ts` and pull in main-process modules (logging, fs, electron),
// so importing them from a Vite-bundled renderer module fails with
// "path is externalized" / "__dirname is not defined". This file is the
// renderer's safe entry point: it imports each `*/manifest.ts` directly and
// never reaches into `index.ts` or `executor.main.ts`.
import { nodeTypeRegistry } from "./registry"
import { promptNodeManifest } from "./prompt/manifest"
import { switchNodeManifest } from "./switch/manifest"
import { endNodeManifest } from "./end/manifest"
import { httpRequestNodeManifest } from "./http-request/manifest"
import { scriptNodeManifest } from "./script/manifest"
import { workflowCallNodeManifest } from "./workflow-call/manifest"
import { codexNodeManifest } from "./codex/manifest"
import { claudeCodeNodeManifest } from "./claude-code/manifest"
import { documentTemplateNodeManifest } from "../app-capabilities/document-template/workflow-node/manifest"
import { screenshotNodeManifest } from "../app-capabilities/screenshot/workflow-node/manifest"
import { swarmTaskNodeManifest } from "../app-capabilities/swarm-task/workflow-node/manifest"

nodeTypeRegistry.registerManifest(promptNodeManifest)
nodeTypeRegistry.registerManifest(switchNodeManifest)
nodeTypeRegistry.registerManifest(endNodeManifest)
nodeTypeRegistry.registerManifest(httpRequestNodeManifest)
nodeTypeRegistry.registerManifest(scriptNodeManifest)
nodeTypeRegistry.registerManifest(workflowCallNodeManifest)
nodeTypeRegistry.registerManifest(codexNodeManifest)
nodeTypeRegistry.registerManifest(claudeCodeNodeManifest)
nodeTypeRegistry.registerManifest(documentTemplateNodeManifest)
nodeTypeRegistry.registerManifest(screenshotNodeManifest)
nodeTypeRegistry.registerManifest(swarmTaskNodeManifest)
