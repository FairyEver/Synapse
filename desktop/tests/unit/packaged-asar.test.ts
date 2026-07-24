import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const redactionUnpackedSegments = ["app.asar.unpacked", "dist-electron", "src", "lib", "agent-redaction.js"]

function nativeClaudePackageNames(platform: NodeJS.Platform, arch: string): readonly string[] {
  if (platform === "linux") {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
    ]
  }
  if (platform === "darwin" || platform === "win32") {
    return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]
  }
  return []
}

function currentClaudeBinarySegments(): readonly string[] {
  const packageName = nativeClaudePackageNames(process.platform, process.arch)[0]
  if (!packageName) {
    return ["app.asar.unpacked", "node_modules", "@anthropic-ai", "unsupported", "claude"]
  }
  return [
    "app.asar.unpacked",
    "node_modules",
    ...packageName.split("/"),
    process.platform === "win32" ? "claude.exe" : "claude",
  ]
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

const SYNTHETIC_UNPDF_PACKAGE_JSON = '{"license":"MIT"}\n'
const SYNTHETIC_UNPDF_LICENSE = [
  "MIT License",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'THE SOFTWARE IS PROVIDED "AS IS"',
  "",
].join("\n")
const SYNTHETIC_MAMMOTH_PACKAGE_JSON = '{"license":"BSD-2-Clause"}\n'
const SYNTHETIC_MAMMOTH_LICENSE = [
  "Redistribution and use in source and binary forms, with or without modification, are permitted",
  "1. Redistributions of source code must retain the above copyright notice",
  "2. Redistributions in binary form must reproduce the above copyright notice",
  'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"',
  "",
].join("\n")
const DOCUMENT_EXTRACTION_MAIN_PATH =
  "dist-electron/app-capabilities/text-extractor/main"
const SYNTHETIC_DOCUMENT_EXTRACTION_FILES: Readonly<Record<string, string>> = {
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/service.js`]:
    "const { launchTextExtractionWorker } = require('./worker-launch')\n",
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/service.js.map`]: "{}",
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/worker-launch.js`]: [
    "const path = require('node:path')",
    "const { Worker } = require('node:worker_threads')",
    "function launchTextExtractionWorker(input) {",
    "  const bytes = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength)",
    "  return (input.workerFactory || ((filename, options) => new Worker(filename, options)))(path.join(input.baseDir, 'worker.js'), {",
    "    workerData: { bytes, format: input.format, maxPages: input.maxPages, maxTextBytes: input.maxTextBytes },",
    "    transferList: [bytes],",
    "    resourceLimits: { maxOldGenerationSizeMb: input.maxOldGenerationSizeMb },",
    "  })",
    "}",
    "module.exports = { launchTextExtractionWorker }",
    "",
  ].join("\n"),
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/worker-launch.js.map`]: "{}",
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/worker.js`]: [
    "const { parentPort, workerData } = require('node:worker_threads')",
    "// unpdf mammoth pizzip",
    "const result = workerData.format === 'pdf'",
    "  ? { text: 'packaged pdf smoke', pages: 1 }",
    "  : { text: 'packaged docx smoke' }",
    "parentPort.postMessage({ type: 'success', result })",
    "",
  ].join("\n"),
  [`${DOCUMENT_EXTRACTION_MAIN_PATH}/worker.js.map`]: "{}",
  "node_modules/unpdf/package.json": SYNTHETIC_UNPDF_PACKAGE_JSON,
  "node_modules/unpdf/LICENSE": SYNTHETIC_UNPDF_LICENSE,
  "node_modules/unpdf/dist/index.cjs": "module.exports = {}\n",
  "node_modules/unpdf/dist/pdfjs.mjs": "export {}\n",
  "node_modules/mammoth/package.json": SYNTHETIC_MAMMOTH_PACKAGE_JSON,
  "node_modules/mammoth/LICENSE": SYNTHETIC_MAMMOTH_LICENSE,
  "node_modules/mammoth/lib/index.js": "{}\n",
  "node_modules/pizzip/package.json": "{}\n",
  "node_modules/pizzip/js/index.js": "{}\n",
  "node_modules/@xmldom/xmldom/package.json": "{}\n",
  "node_modules/jszip/package.json": "{}\n",
  "node_modules/pako/package.json": "{}\n",
  "node_modules/xmlbuilder/package.json": "{}\n",
}

type DocumentExtractionContentOverrides = Readonly<Record<string, string>>

function documentExtractionFiles(
  overrides: DocumentExtractionContentOverrides = {},
): Readonly<Record<string, string>> {
  return { ...SYNTHETIC_DOCUMENT_EXTRACTION_FILES, ...overrides }
}

const HTML_GENERATION_MAIN_PATH =
  "dist-electron/app-capabilities/html-generator/main"
const SYNTHETIC_HTML_GENERATION_FILES: Readonly<Record<string, string>> = {
  [`${HTML_GENERATION_MAIN_PATH}/service.js`]:
    "const { launchHtmlGenerationWorker } = require('./worker-launch')\n",
  [`${HTML_GENERATION_MAIN_PATH}/service.js.map`]: "{}",
  [`${HTML_GENERATION_MAIN_PATH}/worker-launch.js`]: [
    "const path = require('node:path')",
    "const { Worker } = require('node:worker_threads')",
    "function launchHtmlGenerationWorker(input) {",
    "  const workerBaseDir = input.baseDir.replace(/([\\\\/])app\\.asar(?=[\\\\/])/, '$1app.asar.unpacked')",
    "  return (input.workerFactory || ((filename, options) => new Worker(filename, options)))(path.join(workerBaseDir, 'worker.js'), {",
    "    workerData: input.workerData,",
    "    resourceLimits: { maxOldGenerationSizeMb: input.maxOldGenerationSizeMb },",
    "    stdout: true,",
    "    stderr: true,",
    "  })",
    "}",
    "module.exports = { launchHtmlGenerationWorker }",
    "",
  ].join("\n"),
  [`${HTML_GENERATION_MAIN_PATH}/worker-launch.js.map`]: "{}",
  [`${HTML_GENERATION_MAIN_PATH}/worker.js`]: [
    "const { parentPort, workerData } = require('node:worker_threads')",
    "// ejs-runtime fileLoader",
    "parentPort.postMessage({ type: 'started' })",
    "const html = workerData.template.replace('<%= data.title %>', String(workerData.data.title))",
    "parentPort.postMessage({ type: 'success', html, size: Buffer.byteLength(html, 'utf8') })",
    "",
  ].join("\n"),
  [`${HTML_GENERATION_MAIN_PATH}/worker.js.map`]: "{}",
  [`${HTML_GENERATION_MAIN_PATH}/ejs-runtime.js`]: "module.exports = require('ejs')\n",
  [`${HTML_GENERATION_MAIN_PATH}/ejs-runtime.js.map`]: "{}",
  "node_modules/ejs/package.json":
    '{"version":"6.0.1","main":"./lib/cjs/ejs.js","license":"Apache-2.0"}\n',
  "node_modules/ejs/LICENSE": "Apache License\nVersion 2.0, January 2004\n",
  "node_modules/ejs/lib/cjs/ejs.js": "module.exports = {}\n",
  "node_modules/ejs/lib/cjs/utils.js": "module.exports = {}\n",
}
const SYNTHETIC_JSON_REPAIR_FILES = {
  "node_modules/repair-json-stream/package.json": JSON.stringify({
    name: "repair-json-stream",
    version: "1.3.1",
    license: "MIT",
    main: "./dist/index.cjs",
    exports: {
      ".": {
        require: { default: "./dist/index.cjs" },
      },
      "./extract": {
        require: { default: "./dist/extract.cjs" },
      },
    },
  }),
  "node_modules/repair-json-stream/LICENSE":
    "MIT License\nPermission is hereby granted, free of charge\n",
  "node_modules/repair-json-stream/dist/index.cjs":
    "exports.repairJson = input => input === '{value:1}' ? '{\"value\":1}' : input\n",
  "node_modules/repair-json-stream/dist/extract.cjs":
    "exports.stripLlmWrapper = input => input.startsWith('Result: ') ? input.slice(8) : input; exports.extractAllJson = input => [input.slice(input.indexOf('{'), input.lastIndexOf('}') + 1)]\n",
  "node_modules/jsonrepair/package.json": JSON.stringify({
    name: "jsonrepair",
    version: "3.15.0",
    license: "ISC",
    main: "lib/cjs/index.js",
    exports: {
      ".": {
        require: "./lib/cjs/index.js",
      },
    },
  }),
  "node_modules/jsonrepair/LICENSE.md":
    "The ISC License\nPermission to use, copy, modify, and/or distribute\n",
  "node_modules/jsonrepair/lib/cjs/package.json":
    "{\"type\":\"commonjs\"}\n",
  "node_modules/jsonrepair/lib/cjs/index.js":
    "exports.jsonrepair = () => '{\"value\":\"a\\\\\"b\\\\\"c\"}'\n",
  "node_modules/jsonrepair/lib/cjs/regular/jsonrepair.js":
    "exports.jsonrepair = require('../index.js').jsonrepair\n",
  "node_modules/jsonrepair/lib/cjs/utils/JSONRepairError.js":
    "exports.JSONRepairError = Error\n",
  "node_modules/jsonrepair/lib/cjs/utils/stringUtils.js":
    "exports.isWhitespace = value => /\\s/.test(value)\n",
} as const

interface CreateAsarBufferOptions {
  readonly includeHtmlGeneration?: boolean
  readonly includeJsonRepair?: boolean
  readonly omitJsonRepairRootExport?: boolean
  readonly omitJsonRepairExtractExport?: boolean
  readonly textExtractionContentOverrides?: DocumentExtractionContentOverrides
  readonly includeClaudeRuntimeGuard?: boolean
  readonly includeDeploymentConfig?: boolean
  readonly includeTextExtraction?: boolean
  readonly includePreloadBundle?: boolean
  readonly includeScriptRuntime?: boolean
  readonly includeSharedPackage?: boolean
  readonly includeUsageAnalysisWorkers?: boolean
  readonly includeUnpackedSourceMaps?: boolean
  readonly omitTextExtractionIntegrity?: string
}

function createPackedFileNode(offset: number, content: Buffer, unpacked = false) {
  return {
    size: content.length,
    offset: String(offset),
    integrity: { hash: hash(content) },
    ...(unpacked ? { unpacked: true } : {}),
  }
}

function createUnpackedFileNode(content?: string) {
  const bytes = content === undefined ? undefined : Buffer.from(content)
  return {
    size: bytes?.length ?? 1,
    offset: "0",
    unpacked: true,
    ...(bytes ? { integrity: { hash: hash(bytes) } } : {}),
  }
}

function createUnpackedJsFiles(includeSourceMaps: boolean) {
  return {
    "agent-redaction.js": createUnpackedFileNode(),
    ...(includeSourceMaps ? { "agent-redaction.js.map": createUnpackedFileNode() } : {}),
  }
}

function createUsageAnalysisFiles(includeSourceMaps: boolean) {
  const files = {
    "conversation-worker.js": createUnpackedFileNode(),
    "cc-conversation-service.js": createUnpackedFileNode(),
    "cc-service.js": createUnpackedFileNode(),
    "refresh-worker.js": createUnpackedFileNode(),
    "db-schema.js": createUnpackedFileNode(),
  }
  if (!includeSourceMaps) return files
  return {
    ...files,
    "conversation-worker.js.map": createUnpackedFileNode(),
    "cc-conversation-service.js.map": createUnpackedFileNode(),
    "cc-service.js.map": createUnpackedFileNode(),
    "refresh-worker.js.map": createUnpackedFileNode(),
    "db-schema.js.map": createUnpackedFileNode(),
  }
}

function createModelPriceFiles(includeSourceMaps: boolean) {
  return {
    "index.js": createUnpackedFileNode(),
    ...(includeSourceMaps ? { "index.js.map": createUnpackedFileNode() } : {}),
  }
}

function createTextExtractionFiles(
  files: Readonly<Record<string, string>>,
  omitIntegrity?: string,
) {
  const node = (fileName: string) => {
    const relativePath = `${DOCUMENT_EXTRACTION_MAIN_PATH}/${fileName}`
    return createUnpackedFileNode(relativePath === omitIntegrity ? undefined : files[relativePath])
  }
  return {
    main: {
      files: {
        "service.js": node("service.js"),
        "service.js.map": node("service.js.map"),
        "worker-launch.js": node("worker-launch.js"),
        "worker-launch.js.map": node("worker-launch.js.map"),
        "worker.js": node("worker.js"),
        "worker.js.map": node("worker.js.map"),
      },
    },
  }
}

function createHtmlGenerationFiles(files: Readonly<Record<string, string>>) {
  const node = (fileName: string) => createUnpackedFileNode(
    files[`${HTML_GENERATION_MAIN_PATH}/${fileName}`],
  )
  return {
    main: {
      files: {
        "service.js": node("service.js"),
        "service.js.map": node("service.js.map"),
        "worker-launch.js": node("worker-launch.js"),
        "worker-launch.js.map": node("worker-launch.js.map"),
        "worker.js": node("worker.js"),
        "worker.js.map": node("worker.js.map"),
        "ejs-runtime.js": node("ejs-runtime.js"),
        "ejs-runtime.js.map": node("ejs-runtime.js.map"),
      },
    },
  }
}

function createEjsFiles(files: Readonly<Record<string, string>>) {
  return {
    "package.json": createUnpackedFileNode(files["node_modules/ejs/package.json"]),
    LICENSE: createUnpackedFileNode(files["node_modules/ejs/LICENSE"]),
    lib: {
      files: {
        cjs: {
          files: {
            "ejs.js": createUnpackedFileNode(files["node_modules/ejs/lib/cjs/ejs.js"]),
            "utils.js": createUnpackedFileNode(files["node_modules/ejs/lib/cjs/utils.js"]),
          },
        },
      },
    },
  }
}

function createUnpdfFiles(files: Readonly<Record<string, string>>, omitIntegrity?: string) {
  const node = (relativePath: string) => createUnpackedFileNode(
    relativePath === omitIntegrity ? undefined : files[relativePath],
  )
  return {
    "package.json": node("node_modules/unpdf/package.json"),
    LICENSE: node("node_modules/unpdf/LICENSE"),
    dist: {
      files: {
        "index.cjs": node("node_modules/unpdf/dist/index.cjs"),
        "pdfjs.mjs": node("node_modules/unpdf/dist/pdfjs.mjs"),
      },
    },
  }
}

function createTextExtractionPackageFiles(
  packageName: string,
  entryDirectory: string,
  entryFile: string,
  files: Readonly<Record<string, string>>,
  omitIntegrity?: string,
) {
  const packagePath = `node_modules/${packageName}/package.json`
  const entryPath = `node_modules/${packageName}/${entryDirectory}/${entryFile}`
  return {
    "package.json": createUnpackedFileNode(packagePath === omitIntegrity ? undefined : files[packagePath]),
    [entryDirectory]: {
      files: {
        [entryFile]: createUnpackedFileNode(entryPath === omitIntegrity ? undefined : files[entryPath]),
      },
    },
  }
}

function createPackageManifestFiles(
  packageName: string,
  files: Readonly<Record<string, string>>,
  omitIntegrity?: string,
) {
  const packagePath = `node_modules/${packageName}/package.json`
  return {
    "package.json": createUnpackedFileNode(packagePath === omitIntegrity ? undefined : files[packagePath]),
  }
}

function createAsarBuffer(options: CreateAsarBufferOptions = {}): Buffer {
  const {
    includeHtmlGeneration = true,
    includeJsonRepair = true,
    omitJsonRepairRootExport = false,
    omitJsonRepairExtractExport = false,
    textExtractionContentOverrides = {},
    includeClaudeRuntimeGuard = true,
    includeDeploymentConfig = true,
    includeTextExtraction = true,
    includePreloadBundle = true,
    includeScriptRuntime = true,
    includeSharedPackage = true,
    includeUsageAnalysisWorkers = false,
    includeUnpackedSourceMaps = true,
    omitTextExtractionIntegrity,
  } = options
  const documentFiles = documentExtractionFiles(textExtractionContentOverrides)
  const htmlGenerationFiles = SYNTHETIC_HTML_GENERATION_FILES
  const packageJson = Buffer.from(JSON.stringify({ main: "dist-electron/electron/main.js" }), "utf8")
  const mainJs = Buffer.from("require('./bootstrap/descriptors.js')\n", "utf8")
  const preloadJs = Buffer.from("const { contextBridge } = require('electron')\n", "utf8")
  const diagnosticsService = Buffer.from("const id = 'app.claude-runtime'; const message = '内置 Claude Code runtime';\n", "utf8")
  const claudeRuntimeBinary = Buffer.from("export function inspectPackagedClaudeRuntime() {} // 内置 Claude Code runtime\n", "utf8")
  const claudeSdkSession = Buffer.from("inspectPackagedClaudeRuntime(); queryOptions.pathToClaudeCodeExecutable = executablePath;\n", "utf8")
  const deploymentConfig = Buffer.from("exports.SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG = { apiBaseUrl: 'https://app.example.com/api' };\n", "utf8")
  const sharedIndex = Buffer.from("export const DESKTOP_CLIENT_ID = 'synapse-desktop';\n", "utf8")
  const scriptRuntimeSmokeBootstrap = Buffer.from("exports.startScriptRuntimeSmokeBootstrap = async () => {}\n", "utf8")
  const scriptRuntimeSmoke = Buffer.from("exports.runScriptRuntimeSmoke = async () => {}\n", "utf8")
  const chromiumWorkerRunner = Buffer.from("exports.runChromiumWorkerScript = async () => ({ status: 'success' })\n", "utf8")
  const nodeCliRunner = Buffer.from("exports.runNodeCliScript = async () => ({ status: 'success' })\n", "utf8")
  let offset = 0
  const packageNode = createPackedFileNode(offset, packageJson)
  offset += packageJson.length
  const mainNode = createPackedFileNode(offset, mainJs)
  offset += mainJs.length
  const preloadNode = createPackedFileNode(offset, preloadJs)
  if (includePreloadBundle) {
    offset += preloadJs.length
  }
  const diagnosticsNode = createPackedFileNode(offset, diagnosticsService)
  if (includeClaudeRuntimeGuard) {
    offset += diagnosticsService.length
  }
  const claudeRuntimeBinaryNode = createPackedFileNode(offset, claudeRuntimeBinary)
  if (includeClaudeRuntimeGuard) {
    offset += claudeRuntimeBinary.length
  }
  const claudeSdkSessionNode = createPackedFileNode(offset, claudeSdkSession)
  if (includeClaudeRuntimeGuard) {
    offset += claudeSdkSession.length
  }
  const deploymentConfigNode = createPackedFileNode(offset, deploymentConfig)
  if (includeDeploymentConfig) {
    offset += deploymentConfig.length
  }
  const sharedIndexNode = createPackedFileNode(offset, sharedIndex)
  if (includeSharedPackage) {
    offset += sharedIndex.length
  }
  const scriptRuntimeSmokeNode = createPackedFileNode(offset, scriptRuntimeSmoke)
  if (includeScriptRuntime) {
    offset += scriptRuntimeSmoke.length
  }
  const scriptRuntimeSmokeBootstrapNode = createPackedFileNode(offset, scriptRuntimeSmokeBootstrap)
  if (includeScriptRuntime) {
    offset += scriptRuntimeSmokeBootstrap.length
  }
  const chromiumWorkerRunnerNode = createPackedFileNode(offset, chromiumWorkerRunner)
  if (includeScriptRuntime) {
    offset += chromiumWorkerRunner.length
  }
  const nodeCliRunnerNode = createPackedFileNode(offset, nodeCliRunner)
  if (includeScriptRuntime) {
    offset += nodeCliRunner.length
  }
  const jsonRepairPackageJson = JSON.parse(
    SYNTHETIC_JSON_REPAIR_FILES["node_modules/repair-json-stream/package.json"],
  )
  if (omitJsonRepairRootExport) {
    delete jsonRepairPackageJson.exports["."]
  }
  if (omitJsonRepairExtractExport) {
    delete jsonRepairPackageJson.exports["./extract"]
  }
  const jsonRepairFiles = {
    ...SYNTHETIC_JSON_REPAIR_FILES,
    "node_modules/repair-json-stream/package.json": JSON.stringify(jsonRepairPackageJson),
  }
  const jsonRepairBuffers = Object.fromEntries(
    Object.entries(jsonRepairFiles)
      .map(([relativePath, content]) => [relativePath, Buffer.from(content, "utf8")]),
  ) as Record<keyof typeof SYNTHETIC_JSON_REPAIR_FILES, Buffer>
  const jsonRepairNodes = Object.fromEntries(
    Object.entries(jsonRepairBuffers).map(([relativePath, content]) => {
      const node = createPackedFileNode(offset, content)
      offset += content.length
      return [relativePath, node]
    }),
  ) as Record<keyof typeof SYNTHETIC_JSON_REPAIR_FILES, ReturnType<typeof createPackedFileNode>>
  const header = Buffer.from(JSON.stringify({
    files: {
      "package.json": packageNode,
      "dist-electron": {
        files: {
          electron: {
            files: {
              "main.js": mainNode,
              ...(includeScriptRuntime
                ? {
                    "script-runtime-smoke-bootstrap.js": scriptRuntimeSmokeBootstrapNode,
                    "script-runtime-smoke.js": scriptRuntimeSmokeNode,
                  }
                : {}),
              ...(includePreloadBundle ? { "preload.js": preloadNode } : {}),
              generated: {
                files: {
                  ...(includeDeploymentConfig
                    ? {
                        "deployment-config.generated.js": deploymentConfigNode,
                      }
                    : {}),
                },
              },
              services: {
                files: {
                  ...(includeClaudeRuntimeGuard
                    ? {
                        "diagnostics-service.js": diagnosticsNode,
                        "agent-runtime": {
                          files: {
                            "claude-runtime-binary.js": claudeRuntimeBinaryNode,
                            "claude-sdk-session.js": claudeSdkSessionNode,
                          },
                        },
                      }
                    : {}),
                  ...(includeUsageAnalysisWorkers
                    ? {
                        "model-price": {
                          files: createModelPriceFiles(includeUnpackedSourceMaps),
                        },
                        "usage-analysis": {
                          files: createUsageAnalysisFiles(includeUnpackedSourceMaps),
                        },
                      }
                    : {}),
                },
              },
            },
          },
          ...(includeTextExtraction || includeHtmlGeneration || includeScriptRuntime
            ? {
                "app-capabilities": {
                  files: {
                    ...(includeTextExtraction
                      ? {
                          "text-extractor": {
                            files: createTextExtractionFiles(
                              documentFiles,
                              omitTextExtractionIntegrity,
                            ),
                          },
                        }
                      : {}),
                    ...(includeHtmlGeneration
                      ? {
                          "html-generator": {
                            files: createHtmlGenerationFiles(htmlGenerationFiles),
                          },
                        }
                      : {}),
                    ...(includeScriptRuntime
                      ? {
                          "script-runtime": {
                            files: {
                              main: {
                                files: {
                                  "chromium-worker-runner.js": chromiumWorkerRunnerNode,
                                  "node-cli-runner.js": nodeCliRunnerNode,
                                },
                              },
                            },
                          },
                        }
                      : {}),
                  },
                },
              }
            : {}),
          src: {
            files: {
              lib: {
                files: createUnpackedJsFiles(includeUnpackedSourceMaps),
              },
            },
          },
        },
      },
      "node_modules": {
        files: {
          "@synapse": {
            files: {
              shared: {
                files: {
                  dist: {
                    files: {
                      ...(includeSharedPackage
                        ? {
                            "index.js": sharedIndexNode,
                          }
                        : {}),
                    },
                  },
                },
              },
            },
          },
          ...(includeTextExtraction
            ? {
                unpdf: {
                  files: createUnpdfFiles(documentFiles, omitTextExtractionIntegrity),
                },
                mammoth: {
                  files: {
                    ...createTextExtractionPackageFiles(
                      "mammoth",
                      "lib",
                      "index.js",
                      documentFiles,
                      omitTextExtractionIntegrity,
                    ),
                    LICENSE: createUnpackedFileNode(
                      omitTextExtractionIntegrity === "node_modules/mammoth/LICENSE"
                        ? undefined
                        : documentFiles["node_modules/mammoth/LICENSE"],
                    ),
                  },
                },
                pizzip: {
                  files: createTextExtractionPackageFiles(
                    "pizzip",
                    "js",
                    "index.js",
                    documentFiles,
                    omitTextExtractionIntegrity,
                  ),
                },
                "@xmldom": {
                  files: {
                    xmldom: {
                      files: createPackageManifestFiles(
                        "@xmldom/xmldom",
                        documentFiles,
                        omitTextExtractionIntegrity,
                      ),
                    },
                  },
                },
                jszip: {
                  files: createPackageManifestFiles("jszip", documentFiles, omitTextExtractionIntegrity),
                },
                pako: {
                  files: createPackageManifestFiles("pako", documentFiles, omitTextExtractionIntegrity),
                },
                xmlbuilder: {
                  files: createPackageManifestFiles("xmlbuilder", documentFiles, omitTextExtractionIntegrity),
                },
              }
            : {}),
          ...(includeHtmlGeneration
            ? {
                ejs: {
                  files: createEjsFiles(htmlGenerationFiles),
                },
              }
            : {}),
          ...(includeJsonRepair
            ? {
                "repair-json-stream": {
                  files: {
                    "package.json": jsonRepairNodes["node_modules/repair-json-stream/package.json"],
                    LICENSE: jsonRepairNodes["node_modules/repair-json-stream/LICENSE"],
                    dist: {
                      files: {
                        "index.cjs": jsonRepairNodes["node_modules/repair-json-stream/dist/index.cjs"],
                        "extract.cjs": jsonRepairNodes["node_modules/repair-json-stream/dist/extract.cjs"],
                      },
                    },
                  },
                },
                jsonrepair: {
                  files: {
                    "package.json": jsonRepairNodes["node_modules/jsonrepair/package.json"],
                    "LICENSE.md": jsonRepairNodes["node_modules/jsonrepair/LICENSE.md"],
                    lib: {
                      files: {
                        cjs: {
                          files: {
                            "package.json": jsonRepairNodes["node_modules/jsonrepair/lib/cjs/package.json"],
                            "index.js": jsonRepairNodes["node_modules/jsonrepair/lib/cjs/index.js"],
                            regular: {
                              files: {
                                "jsonrepair.js": jsonRepairNodes["node_modules/jsonrepair/lib/cjs/regular/jsonrepair.js"],
                              },
                            },
                            utils: {
                              files: {
                                "JSONRepairError.js": jsonRepairNodes["node_modules/jsonrepair/lib/cjs/utils/JSONRepairError.js"],
                                "stringUtils.js": jsonRepairNodes["node_modules/jsonrepair/lib/cjs/utils/stringUtils.js"],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              }
            : {}),
        },
      },
    },
  }), "utf8")
  const headerPadding = Buffer.alloc((4 - (header.length % 4)) % 4)
  const headerPickleSize = 8 + header.length + headerPadding.length
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(headerPickleSize, 4)
  prefix.writeUInt32LE(headerPickleSize - 4, 8)
  prefix.writeUInt32LE(header.length, 12)
  return Buffer.concat([
    prefix,
    header,
    headerPadding,
    packageJson,
    mainJs,
    ...(includePreloadBundle ? [preloadJs] : []),
    ...(includeClaudeRuntimeGuard ? [diagnosticsService] : []),
    ...(includeClaudeRuntimeGuard ? [claudeRuntimeBinary] : []),
    ...(includeClaudeRuntimeGuard ? [claudeSdkSession] : []),
    ...(includeDeploymentConfig ? [deploymentConfig] : []),
    ...(includeSharedPackage ? [sharedIndex] : []),
    ...(includeScriptRuntime
      ? [scriptRuntimeSmoke, scriptRuntimeSmokeBootstrap, chromiumWorkerRunner, nodeCliRunner]
      : []),
    ...(includeJsonRepair ? Object.values(jsonRepairBuffers) : []),
  ])
}

describe("packaged asar verification", () => {
  it("does not apply sandbox inheritance to nested macOS executables", async () => {
    const entitlements = await readFile(
      path.join(process.cwd(), "build/entitlements.mac.inherit.plist"),
      "utf8",
    )

    expect(entitlements).not.toContain("com.apple.security.inherit")
  })

  async function writeUnpackedFixture(
    resourcesPath: string,
    segments: readonly string[],
    content = "x",
    options: { readonly sourceMap?: boolean } = {},
  ) {
    const filePath = path.join(resourcesPath, ...segments)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
    if (options.sourceMap !== false && segments[0] === "app.asar.unpacked" && segments.includes("dist-electron") && path.basename(filePath).endsWith(".js")) {
      await writeFile(`${filePath}.map`, "{}")
    }
    return filePath
  }

  async function writeRequiredExtraResourceFixtures(resourcesPath: string) {
    await writeUnpackedFixture(resourcesPath, ["synapse-skill", "SKILL.md"], "# Synapse Skill\n")
    await writeUnpackedFixture(resourcesPath, ["synapse-skill", "database", "index.md"], "# Database\n")
    await writeUnpackedFixture(resourcesPath, ["knowledge-base", "synapse-knowledge-base-template", "CLAUDE.md"], "# Knowledge Base\n")
  }

  async function writeTextExtractionRuntimeFixtures(
    resourcesPath: string,
    overrides: DocumentExtractionContentOverrides = {},
  ) {
    for (const [relativePath, content] of Object.entries(documentExtractionFiles(overrides))) {
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", ...relativePath.split("/")],
        content,
        { sourceMap: false },
      )
    }
  }

  async function writeHtmlGenerationRuntimeFixtures(resourcesPath: string) {
    for (const [relativePath, content] of Object.entries(SYNTHETIC_HTML_GENERATION_FILES)) {
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", ...relativePath.split("/")],
        content,
        { sourceMap: false },
      )
    }
  }

  async function writeExtraResourceFixtures(
    resourcesPath: string,
    overrides: DocumentExtractionContentOverrides = {},
  ) {
    await writeRequiredExtraResourceFixtures(resourcesPath)
    await writeTextExtractionRuntimeFixtures(resourcesPath, overrides)
    await writeHtmlGenerationRuntimeFixtures(resourcesPath)
  }

  async function expectJsonRepairExportFailure(
    options: Pick<
      CreateAsarBufferOptions,
      "omitJsonRepairRootExport" | "omitJsonRepairExtractExport"
    >,
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer(options))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "packaged JSON Repair package-name resolution smoke failed",
        ),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  it("verifies a Windows-style resources directory with unpacked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified packaged text extraction worker smoke")
      expect(result.stdout).toContain("Verified packaged JSON Repair runtime smoke")
      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the JSON Repair runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(
        path.join(resourcesPath, "app.asar"),
        createAsarBuffer({ includeJsonRepair: false }),
      )
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("JSON Repair runtime is missing from packed app.asar"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects a packaged JSON Repair dependency missing its root export", async () => {
    await expectJsonRepairExportFailure({ omitJsonRepairRootExport: true })
  })

  it("rejects a packaged JSON Repair dependency missing its extract subpath export", async () => {
    await expectJsonRepairExportFailure({ omitJsonRepairExtractExport: true })
  })

  it("verifies a macOS app bundle resources directory with unpacked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const appPath = path.join(root, "Synapse.app")
      const resourcesPath = path.join(appPath, "Contents", "Resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        appPath,
      ])

      expect(result.stdout).toContain("Verified Synapse.app")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing required extraResources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeTextExtractionRuntimeFixtures(resourcesPath)
      await writeHtmlGenerationRuntimeFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("missing extra resource"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the text extraction runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        includeTextExtraction: false,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("text extraction service is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages whose text extraction worker cannot complete the packaged smoke", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    const overrides = {
      [`${DOCUMENT_EXTRACTION_MAIN_PATH}/worker.js`]:
        "// unpdf mammoth pizzip\nthrow new Error('packaged worker smoke failure')\n",
    }
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        textExtractionContentOverrides: overrides,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath, overrides)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("text extraction worker smoke failed"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages whose document extraction service bypasses the packaged worker launch contract", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    const overrides = {
      [`${DOCUMENT_EXTRACTION_MAIN_PATH}/service.js`]: "const workerPath = 'worker.js'\n",
    }
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        textExtractionContentOverrides: overrides,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath, overrides)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("text extraction service bypasses the worker launch contract"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects document extraction runtime entries missing ASAR integrity metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        omitTextExtractionIntegrity: `${DOCUMENT_EXTRACTION_MAIN_PATH}/service.js`,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("unpacked file integrity metadata is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects a same-length stale document extraction source map", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeFile(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "app-capabilities",
        "text-extractor",
        "main",
        "worker-launch.js.map",
      ), "[]")

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("unpacked file integrity mismatch: dist-electron/app-capabilities/text-extractor/main/worker-launch.js.map"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects an empty document extraction source map", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeFile(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "app-capabilities",
        "text-extractor",
        "main",
        "worker.js.map",
      ), "")

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("unpacked file size mismatch: dist-electron/app-capabilities/text-extractor/main/worker.js.map"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing a document parser license from the release archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await unlink(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "mammoth",
        "LICENSE",
      ))

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("missing unpacked file: node_modules/mammoth/LICENSE"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects stale unpacked document parser license bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      const licensePath = path.join(resourcesPath, "app.asar.unpacked", "node_modules", "unpdf", "LICENSE")
      const license = await readFile(licensePath)
      await writeFile(licensePath, Buffer.alloc(license.length, "x"))

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("unpacked file integrity mismatch: node_modules/unpdf/LICENSE"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects an empty document parser license", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeFile(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "mammoth",
        "LICENSE",
      ), "")

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("document parser license is empty: mammoth"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects the wrong document parser license identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeFile(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "unpdf",
        "package.json",
      ), '{"license":"ISC"}\n')

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("document parser license identity mismatch: unpdf must be MIT"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects wrong document parser license content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeFile(path.join(
        resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "unpdf",
        "LICENSE",
      ), "Copyright only; no license grant.\n")

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("document parser license content mismatch: unpdf (MIT)"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the Claude SDK native binary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("Claude SDK native binary is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the packaged Claude runtime guard", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeClaudeRuntimeGuard: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("packaged Claude runtime guard"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the sandboxed preload bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includePreloadBundle: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("sandboxed preload bundle is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the shared workspace runtime package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeSharedPackage: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("node_modules/@synapse/shared/dist/index.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the script runtime packaged gate entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeScriptRuntime: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("script runtime packaged gate entry is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects unpacked Electron JavaScript without sibling source maps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        includeUsageAnalysisWorkers: true,
        includeUnpackedSourceMaps: false,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments, "module.exports = {}\n", { sourceMap: false })
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-service.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "model-price", "index.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("missing unpacked source map"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects unpacked usage analysis workers with dependencies outside their unpacked closure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeUsageAnalysisWorkers: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "require('./cc-conversation-service')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "require('../error-sanitize')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "require('./db-schema')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
      )

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("usage analysis worker dependency escapes unpacked closure"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("accepts unpacked usage analysis workers with model price directory dependencies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeUsageAnalysisWorkers: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "require('./cc-service')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-service.js"],
        "require('../model-price')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "model-price", "index.js"],
        "module.exports = {}\n",
      )

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
