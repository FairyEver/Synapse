// Renderer-side node registration.
//
// Registers manifests ONLY. Executors live next to each node in
// `executor.main.ts` and pull in main-process modules (logging, fs, electron),
// so importing them from a Vite-bundled renderer module fails with
// "path is externalized" / "__dirname is not defined". This file is the
// renderer's safe entry point: it imports each `*/manifest.ts` directly and
// never reaches into `index.ts` or `executor.main.ts`.
import { nodeTypeRegistry } from "./registry"
import { textNodeManifest } from "./text/manifest"
import { promptNodeManifest } from "./prompt/manifest"
import { switchNodeManifest } from "./switch/manifest"
import { endNodeManifest } from "./end/manifest"
import { httpRequestNodeManifest } from "./http-request/manifest"
import { scriptNodeManifest } from "./script/manifest"
import { workflowCallNodeManifest } from "./workflow-call/manifest"
import { codexNodeManifest } from "./codex/manifest"
import { claudeCodeNodeManifest } from "./claude-code/manifest"
import { fileOpenerNodeManifest } from "../app-capabilities/file-opener/workflow-node/manifest"
import { documentTemplateNodeManifest } from "../app-capabilities/document-template/workflow-node/manifest"
import { textExtractNodeManifest } from "../app-capabilities/text-extractor/workflow-node/manifest"
import { textFileWriterNodeManifest } from "../app-capabilities/text-file-writer/workflow-node/manifest"
import { htmlGeneratorEjsFileNodeManifest, htmlGeneratorEjsNodeManifest } from "../app-capabilities/html-generator/workflow-node/manifest"
import { systemNotifierNodeManifest } from "../app-capabilities/system-notifier/workflow-node/manifest"
import { jsonRepairNodeManifest } from "../app-capabilities/json-repair/workflow-node/manifest"
import { javascriptRunNodeManifest } from "../app-capabilities/javascript-run/workflow-node/manifest"
import { nodejsRunNodeManifest } from "../app-capabilities/nodejs-run/workflow-node/manifest"

nodeTypeRegistry.registerManifest(textNodeManifest)
nodeTypeRegistry.registerManifest(promptNodeManifest)
nodeTypeRegistry.registerManifest(switchNodeManifest)
nodeTypeRegistry.registerManifest(endNodeManifest)
nodeTypeRegistry.registerManifest(httpRequestNodeManifest)
nodeTypeRegistry.registerManifest(scriptNodeManifest)
nodeTypeRegistry.registerManifest(workflowCallNodeManifest)
nodeTypeRegistry.registerManifest(codexNodeManifest)
nodeTypeRegistry.registerManifest(claudeCodeNodeManifest)
nodeTypeRegistry.registerManifest(fileOpenerNodeManifest)
nodeTypeRegistry.registerManifest(documentTemplateNodeManifest)
nodeTypeRegistry.registerManifest(textExtractNodeManifest)
nodeTypeRegistry.registerManifest(textFileWriterNodeManifest)
nodeTypeRegistry.registerManifest(htmlGeneratorEjsNodeManifest)
nodeTypeRegistry.registerManifest(htmlGeneratorEjsFileNodeManifest)
nodeTypeRegistry.registerManifest(systemNotifierNodeManifest)
nodeTypeRegistry.registerManifest(jsonRepairNodeManifest)
nodeTypeRegistry.registerManifest(javascriptRunNodeManifest)
nodeTypeRegistry.registerManifest(nodejsRunNodeManifest)
