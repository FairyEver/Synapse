type EjsCompileOptions = {
  readonly _with: false
  readonly strict: true
  readonly localsName: "data"
  readonly delimiter: "%"
  readonly openDelimiter: "<"
  readonly closeDelimiter: ">"
  readonly async: false
  readonly compileDebug: true
  readonly debug: false
  readonly rmWhitespace: false
  readonly cache: false
  readonly filename: false
  readonly root: readonly string[]
  readonly views: readonly string[]
  readonly includer: (originalPath: string, parsedPath?: string) => never
  readonly escape: (value: unknown) => string
  readonly context: undefined
  readonly outputFunctionName: undefined
  readonly destructuredLocals: undefined
  readonly unsafePrototypeLocals: false
  readonly legacyInclude: false
}

export type EjsRuntime = {
  compile(template: string, options: EjsCompileOptions): (data: Record<string, unknown>) => string
  escapeXML(value: unknown): string
  fileLoader: (filePath: string) => unknown
}

// EJS 6 ships its own JavaScript runtime without a maintained matching type package.
// Keep the dependency API contained at this Worker-only boundary.
export const ejsRuntime = require("ejs") as EjsRuntime
