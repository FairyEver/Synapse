import path from "node:path"

type ScriptName = "allocate-address.sh" | "boundary-score.py" | "tiling-check.py"

type ScriptRunRequest = {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Record<string, string>
}

type ScriptRunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type DragonScaleScriptRunnerDeps = {
  readonly scriptsRoot: string
  // Production wiring must provide a permission-checked, audited process runner.
  readonly run: (request: ScriptRunRequest) => Promise<ScriptRunResult>
}

export class DragonScaleScriptRunner {
  private readonly scriptsRoot: string
  private readonly runCommand: (request: ScriptRunRequest) => Promise<ScriptRunResult>

  constructor(deps: DragonScaleScriptRunnerDeps) {
    this.scriptsRoot = deps.scriptsRoot
    this.runCommand = deps.run
  }

  async run(
    scriptName: string,
    options: { readonly vaultPath: string; readonly args: readonly string[] },
  ): Promise<ScriptRunResult> {
    if (!isSupportedScript(scriptName)) {
      throw new Error("Unsupported DragonScale script.")
    }
    return this.runCommand({
      command: path.join(this.scriptsRoot, scriptName),
      args: options.args,
      env: {
        SYNAPSE_KB_VAULT_ROOT: options.vaultPath,
      },
    })
  }
}

function isSupportedScript(scriptName: string): scriptName is ScriptName {
  return scriptName === "allocate-address.sh"
    || scriptName === "boundary-score.py"
    || scriptName === "tiling-check.py"
}
