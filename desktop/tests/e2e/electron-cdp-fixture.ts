import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn, type ChildProcess } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import WebSocket from "ws"

type JsonObject = Record<string, unknown>

type ElectronCdpApp = {
  readonly client: CdpClient
  readonly paths: {
    readonly fakeBin: string
    readonly gitLogPath: string
    readonly home: string
    readonly root: string
    readonly userData: string
  }
  readonly openGitWindow: () => Promise<CdpPage>
  readonly page: CdpPage
  readonly process: ChildProcess
  readonly stop: () => Promise<void>
}

type LaunchOptions = {
  readonly fakeGitScript?: string
  readonly repositoryRegistry?: JsonObject
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "../..")
const workspaceRoot = path.resolve(desktopRoot, "..")

export async function launchElectronCdpApp(options: LaunchOptions = {}): Promise<ElectronCdpApp> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-git-e2e-"))
  const home = path.join(root, "home")
  const userData = path.join(root, "userData")
  const xdgConfig = path.join(root, "xdg")
  const fakeBin = path.join(root, "bin")
  const gitLogPath = path.join(home, "git-credential.log")
  const shellPath = path.join(root, "fake-shell")

  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(userData, { recursive: true }),
    mkdir(xdgConfig, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ])
  await writeFile(shellPath, "#!/bin/sh\nprintf '__SYNAPSE_PATH_BEGIN__%s__SYNAPSE_PATH_END__\\n' \"$PATH\"\n", "utf8")
  await chmod(shellPath, 0o755)

  if (options.fakeGitScript) {
    const gitPath = path.join(fakeBin, "git")
    await writeFile(gitPath, options.fakeGitScript, "utf8")
    await chmod(gitPath, 0o755)
  }
  await writeFile(path.join(fakeBin, "ssh"), "#!/bin/sh\nexit 1\n", "utf8")
  await chmod(path.join(fakeBin, "ssh"), 0o755)

  if (options.repositoryRegistry) {
    const registryPath = path.join(userData, "git-client", "repositories.json")
    await mkdir(path.dirname(registryPath), { recursive: true })
    await writeFile(registryPath, `${JSON.stringify(options.repositoryRegistry, null, 2)}\n`, "utf8")
  }

  const launchArgs = [
      "--remote-debugging-port=0",
      `--user-data-dir=${userData}`,
      desktopRoot,
    ]
  if (process.platform === "linux" && process.env.CI) {
    launchArgs.unshift("--no-sandbox")
  }

  const child = spawn(electronExecutablePath(), launchArgs, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
      HOME: home,
      PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
      SHELL: shellPath,
      TMPDIR: path.join(root, "tmp"),
      XDG_CONFIG_HOME: xdgConfig,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const endpoint = await waitForDevToolsEndpoint(userData, child)
  const client = await CdpClient.connect(endpoint)
  const firstPage = await client.waitForPage()
  const page = new CdpPage(client, firstPage.sessionId)
  await page.waitFor(() => Boolean((window as unknown as { synapse?: unknown }).synapse), 30_000)

  return {
    client,
    paths: { fakeBin, gitLogPath, home, root, userData },
    page,
    process: child,
    openGitWindow: async () => {
      const windowPromise = client.waitForNewPage()
      await page.evaluate("window.synapse.apps.openSystemApp('git')")
      const gitTarget = await windowPromise
      const gitPage = new CdpPage(client, gitTarget.sessionId)
      await gitPage.waitForText("仓库", 30_000)
      return gitPage
    },
    stop: () => stopElectron(client, child, root),
  }
}

export class CdpPage {
  constructor(
    private readonly client: CdpClient,
    private readonly sessionId: string,
  ) {}

  async clickText(text: string): Promise<void> {
    await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const candidates = Array.from(document.querySelectorAll("button, [role=button], [role=tab], [role=menuitem], a, input[type=button], input[type=submit]"));
      const textOf = (candidate) => (candidate.innerText || candidate.textContent || "").trim();
      const element = candidates.find((candidate) => isVisible(candidate) && textOf(candidate) === wanted)
        ?? candidates.find((candidate) => isVisible(candidate) && textOf(candidate).includes(wanted))
        ?? Array.from(document.querySelectorAll("*")).find((candidate) => isVisible(candidate) && (candidate.innerText || candidate.textContent || "").trim() === wanted);
      if (!element) throw new Error("Text target not found: " + wanted);
      if (element instanceof HTMLButtonElement && element.type === "submit" && element.form) {
        element.form.requestSubmit(element);
      } else {
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.click();
      }
      return true;
    })()`)
  }

  async clickByAriaLabel(label: string): Promise<void> {
    await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const element = Array.from(document.querySelectorAll("[aria-label]"))
        .find((candidate) => candidate.getAttribute("aria-label") === wanted);
      if (!element) throw new Error("ARIA target not found: " + wanted);
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.click();
      return true;
    })()`)
  }

  async fillByLabel(label: string, value: string): Promise<void> {
    await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const value = ${JSON.stringify(value)};
      const labels = Array.from(document.querySelectorAll("label"));
      const label = labels.find((candidate) => (candidate.innerText || candidate.textContent || "").trim() === wanted);
      if (!label) throw new Error("Label not found: " + wanted);
      const forId = label.getAttribute("for");
      const control = label.control || (forId ? document.getElementById(forId) : null);
      if (!control) throw new Error("Control not found for label: " + wanted);
      control.focus();
      const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("Value setter not found for label: " + wanted);
      setter.call(control, value);
      control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`)
  }

  async text(): Promise<string> {
    const result = await this.evaluate("document.body?.innerText ?? ''")
    return String(result ?? "")
  }

  async valueByLabel(label: string): Promise<string> {
    const result = await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const label = Array.from(document.querySelectorAll("label")).find((candidate) => (candidate.innerText || candidate.textContent || "").trim() === wanted);
      if (!label) throw new Error("Label not found: " + wanted);
      const forId = label.getAttribute("for");
      const control = label.control || (forId ? document.getElementById(forId) : null);
      if (!control) throw new Error("Control not found for label: " + wanted);
      return control.value;
    })()`)
    return String(result ?? "")
  }

  async waitForText(text: string, timeoutMs = 10_000): Promise<void> {
    await this.waitForExpression(`document.body?.innerText.includes(${JSON.stringify(text)})`, timeoutMs)
  }

  async waitForTextGone(text: string, timeoutMs = 10_000): Promise<void> {
    await this.waitForExpression(`!document.body?.innerText.includes(${JSON.stringify(text)})`, timeoutMs)
  }

  async waitFor<T>(predicate: () => Promise<T | null | undefined> | T | null | undefined, timeoutMs: number): Promise<T> {
    const startedAt = Date.now()
    const source = predicate.toString()
    let lastError: unknown
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const result = await this.evaluate(`(${source})()`) as T | null | undefined
        if (result) return result
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (lastError instanceof Error) throw lastError
    const body = await this.text().catch(() => "")
    throw new Error(`Timed out waiting for Electron UI.\n${body}`)
  }

  async evaluate(expression: string): Promise<unknown> {
    return await this.client.evaluate(this.sessionId, expression)
  }

  private async waitForExpression(expression: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await this.evaluate(expression)) return
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (lastError instanceof Error) throw lastError
    const body = await this.text().catch(() => "")
    throw new Error(`Timed out waiting for Electron UI.\n${body}`)
  }
}

type CdpPageTarget = {
  readonly sessionId: string
  readonly targetId: string
}

type CdpResponse = {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: unknown
  readonly error?: { readonly message?: string }
  readonly sessionId?: string
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, {
    readonly reject: (error: Error) => void
    readonly resolve: (value: unknown) => void
  }>()
  private readonly targetCreatedWaiters: Array<(targetId: string) => void> = []

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(String(data)))
  }

  static async connect(endpoint: string): Promise<CdpClient> {
    const socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Electron CDP.")), 10_000)
      socket.once("open", () => {
        clearTimeout(timeout)
        resolve()
      })
      socket.once("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
    const client = new CdpClient(socket)
    await client.send("Target.setDiscoverTargets", { discover: true })
    return client
  }

  async waitForPage(): Promise<CdpPageTarget> {
    return await this.waitForPageTarget(new Set())
  }

  async waitForNewPage(): Promise<CdpPageTarget> {
    const seen = new Set((await this.getPageTargets()).map((target) => target.targetId))
    return await this.waitForPageTarget(seen)
  }

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }, sessionId) as {
      exceptionDetails?: { text?: string; exception?: { description?: string } }
      result?: { value?: unknown }
    }
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "CDP evaluation failed.")
    }
    return result.result?.value
  }

  close(): void {
    this.socket.close()
  }

  private async getPageTargets(): Promise<Array<{ targetId: string }>> {
    const result = await this.send("Target.getTargets") as {
      targetInfos?: Array<{ targetId: string; type: string }>
    }
    return (result.targetInfos ?? []).filter((target) => target.type === "page")
  }

  private async waitForPageTarget(seen: ReadonlySet<string>): Promise<CdpPageTarget> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 30_000) {
      const target = (await this.getPageTargets()).find((candidate) => !seen.has(candidate.targetId))
      if (target) return await this.attach(target)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("Timed out waiting for Electron page target.")
  }

  private async attach(target: { targetId: string } | string): Promise<CdpPageTarget> {
    const targetId = typeof target === "string" ? target : target.targetId
    const result = await this.send("Target.attachToTarget", {
      flatten: true,
      targetId,
    }) as { sessionId?: string }
    if (!result.sessionId) throw new Error("Electron CDP target did not return a session id.")
    await this.send("Runtime.enable", {}, result.sessionId)
    return { targetId, sessionId: result.sessionId }
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = this.nextId++
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params }
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for CDP response: ${method}`))
      }, 10_000)
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
      })
    })
    this.socket.send(JSON.stringify(payload))
    return promise
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as CdpResponse
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP command failed."))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (message.method === "Target.targetCreated") {
      const targetInfo = message.params?.targetInfo as { targetId?: string; type?: string } | undefined
      if (targetInfo?.type === "page" && targetInfo.targetId) {
        for (const waiter of this.targetCreatedWaiters.splice(0)) {
          waiter(targetInfo.targetId)
        }
      }
    }
  }
}

export function fakeGitScript(input: {
  readonly cloneFailure?: "https-auth" | "ssh-auth" | null
  readonly cloneSucceedsAfterCredential?: boolean
  readonly helper?: string
  readonly missingIdentity?: boolean
} = {}): string {
  const helper = input.helper ?? "osxkeychain"
  return `#!/bin/sh
set -eu
log="$HOME/git-credential.log"
cmd="\${1:-}"
if [ "$cmd" = "--version" ]; then
  echo "git version 2.50.0"
  exit 0
fi
if [ "$cmd" = "config" ]; then
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "--get-all" ] && [ "\${4:-}" = "credential.helper" ]; then
    echo "${helper}"
    exit 0
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "user.name" ] && [ -n "\${4:-}" ]; then
    mkdir -p "$HOME"
    { grep -v '^  name = ' "$HOME/.gitconfig" 2>/dev/null || true; echo "[user]"; echo "  name = \${4:-}"; } > "$HOME/.gitconfig.tmp"
    mv "$HOME/.gitconfig.tmp" "$HOME/.gitconfig"
    exit 0
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "user.email" ] && [ -n "\${4:-}" ]; then
    mkdir -p "$HOME"
    { grep -v '^  email = ' "$HOME/.gitconfig" 2>/dev/null || true; echo "[user]"; echo "  email = \${4:-}"; } > "$HOME/.gitconfig.tmp"
    mv "$HOME/.gitconfig.tmp" "$HOME/.gitconfig"
    exit 0
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "user.name" ]; then
    ${input.missingIdentity ? "if [ -f \"$HOME/.gitconfig\" ] && grep -q '^  name = ' \"$HOME/.gitconfig\"; then\n      sed -n 's/^  name = //p' \"$HOME/.gitconfig\" | tail -n 1\n      exit 0\n    fi\n    exit 1" : "echo 'Synapse E2E'\n    exit 0"}
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "user.email" ]; then
    ${input.missingIdentity ? "if [ -f \"$HOME/.gitconfig\" ] && grep -q '^  email = ' \"$HOME/.gitconfig\"; then\n      sed -n 's/^  email = //p' \"$HOME/.gitconfig\" | tail -n 1\n      exit 0\n    fi\n    exit 1" : "echo 'synapse-e2e@example.com'\n    exit 0"}
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "--show-origin" ]; then
    echo "file:$HOME/.gitconfig\\tconfigured"
    exit 0
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "--unset-all" ]; then
    exit 5
  fi
  if [ "\${2:-}" = "--global" ] && [ "\${3:-}" = "--add" ]; then
    exit 0
  fi
fi
if [ "$cmd" = "credential" ]; then
  if [ -n "$log" ]; then
    {
      echo "action=\${2:-}"
      cat
    } >> "$log"
  else
    cat >/dev/null
  fi
  exit 0
fi
if [ "$cmd" = "status" ]; then
  echo "# branch.head main"
  echo "# branch.upstream origin/main"
  echo "# branch.ab +0 -0"
  exit 0
fi
if [ "$cmd" = "rev-parse" ]; then
  echo ".git/index.lock"
  echo ".git/MERGE_HEAD"
  echo ".git/rebase-merge"
  echo ".git/rebase-apply"
  echo ".git/CHERRY_PICK_HEAD"
  exit 0
fi
if [ "$cmd" = "clone" ]; then
  target="\${4:-}"
  ${input.cloneSucceedsAfterCredential ? "if [ -n \"$log\" ] && [ -s \"$log\" ]; then\n    mkdir -p \"$target/.git\"\n    exit 0\n  fi" : ""}
  ${input.cloneFailure === "ssh-auth"
    ? "echo 'git@github.com: Permission denied (publickey).' >&2\n  echo 'fatal: Could not read from remote repository.' >&2"
    : "echo \"fatal: Authentication failed for 'https://user:synapse-e2e-canary-token@git.company.com/team/docs.git/'\" >&2"}
  exit 128
fi
exit 0
`
}

function electronExecutablePath(): string {
  if (process.platform === "darwin") {
    return path.join(desktopRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
  }
  if (process.platform === "win32") {
    return path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe")
  }
  return path.join(desktopRoot, "node_modules", "electron", "dist", "electron")
}

async function waitForDevToolsEndpoint(userData: string, child: ChildProcess): Promise<string> {
  const activePortPath = path.join(userData, "DevToolsActivePort")
  const startedAt = Date.now()
  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk)
  })
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before DevTools became available.\n${stderr}`)
    }
    if (existsSync(activePortPath)) {
      const { readFile } = await import("node:fs/promises")
      const [port, id] = (await readFile(activePortPath, "utf8")).trim().split("\n")
      if (port && id) return `ws://127.0.0.1:${port}${id}`
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Electron DevTools.\n${stderr}`)
}

async function stopElectron(client: CdpClient, child: ChildProcess, root: string): Promise<void> {
  client.close()
  if (child.exitCode === null) {
    child.kill("SIGTERM")
    await waitForChildExit(child, 2_000)
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await waitForChildExit(child, 2_000)
  }
  if (existsSync(root)) {
    await rm(root, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const handleExit = () => {
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      child.off("exit", handleExit)
      resolve()
    }, timeoutMs)
    child.once("exit", handleExit)
  })
}

export { desktopRoot, workspaceRoot }
