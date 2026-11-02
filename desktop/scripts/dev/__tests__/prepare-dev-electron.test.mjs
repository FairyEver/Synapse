import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import vm from "node:vm"
import { prepareDevElectron } from "../prepare-dev-electron.mjs"

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse dev ' $() "))
  t.after(() => rm(root, { recursive: true, force: true }))
  const desktopRoot = path.join(root, "desktop")
  const contents = path.join(root, "vendor/Electron.app/Contents")
  const electronExecutable = path.join(contents, "MacOS/Electron")
  await mkdir(path.dirname(electronExecutable), { recursive: true })
  await mkdir(path.join(contents, "Resources"))
  await mkdir(desktopRoot)
  await writeFile(electronExecutable, "runtime fixture")
  await writeFile(path.join(contents, "Resources/default_app.asar"), "welcome page")
  await writeFile(path.join(contents, "Info.plist"), JSON.stringify({
    CFBundleIdentifier: "com.github.Electron",
    CFBundleExecutable: "Electron",
    LSMinimumSystemVersion: "13.0",
  }))
  await writeFile(path.join(desktopRoot, "package.json"), JSON.stringify({
    name: "@synapse/desktop", productName: "Synapse", version: "1.2.3",
    main: "dist-electron/electron/main.js",
  }))
  return { desktopRoot, electronExecutable, contents, devServerUrl: "http://127.0.0.1:19732" }
}

test("Windows and Linux keep the existing Electron launch", async () => {
  for (const platform of ["win32", "linux"]) {
    assert.deepEqual(await prepareDevElectron({ platform, desktopRoot: "/unused" }), { command: "electron .", appRoot: null })
  }
})

test("macOS protocol launch loads Synapse without command-line arguments", { skip: process.platform !== "darwin" }, async (t) => {
  const input = await fixture(t)
  const { command } = await prepareDevElectron({ ...input, platform: "darwin" })
  // Exercise the exact shell command passed to nodemon, including hostile path characters.
  const executable = execFileSync("/bin/sh", ["-c", `printf '%s' ${command}`], { encoding: "utf8" })
  assert.notEqual(executable, input.electronExecutable)
  assert.equal(await readFile(executable, "utf8"), "runtime fixture")
  const contents = path.resolve(executable, "../..")
  const plist = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(contents, "Info.plist")], { encoding: "utf8" }))
  assert.notEqual(plist.CFBundleIdentifier, "com.github.Electron")
  assert.equal(plist.CFBundleExecutable, "Electron")
  assert.equal(plist.LSMinimumSystemVersion, "13.0")
  assert.deepEqual(plist.CFBundleURLTypes[0].CFBundleURLSchemes, ["synapse"])
  const appDir = path.join(contents, "Resources/app")
  const pkg = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8"))
  assert.equal(pkg.productName, "Synapse")
  const calls = []
  const processStub = { env: {}, chdir: (dir) => calls.push(["cwd", dir]) }
  vm.runInNewContext(await readFile(path.join(appDir, pkg.main), "utf8"), {
    process: processStub,
    require: (id) => {
      if (id === "electron") return { app: { setAppPath: (dir) => calls.push(["appPath", dir]) } }
      calls.push(["main", id])
    },
  })
  assert.equal(processStub.env.VITE_DEV_SERVER_URL, "http://127.0.0.1:19732")
  assert.deepEqual(calls, [
    ["appPath", input.desktopRoot], ["cwd", input.desktopRoot],
    ["main", path.join(input.desktopRoot, "dist-electron/electron/main.js")],
  ])
  // Preparing the bundle must never patch the shared pnpm Electron installation.
  const originalPlist = JSON.parse(await readFile(path.join(input.contents, "Info.plist"), "utf8"))
  assert.equal(originalPlist.CFBundleIdentifier, "com.github.Electron")
  assert.equal(originalPlist.CFBundleURLTypes, undefined)
  assert.notEqual(await realpath(executable), input.electronExecutable)

  const nextLaunch = await prepareDevElectron({ ...input, devServerUrl: "http://127.0.0.1:19733", platform: "darwin" })
  assert.equal(nextLaunch.command, command)
  vm.runInNewContext(await readFile(path.join(appDir, pkg.main), "utf8"), {
    process: processStub,
    require: (id) => id === "electron" ? { app: { setAppPath() {} } } : undefined,
  })
  assert.equal(processStub.env.VITE_DEV_SERVER_URL, "http://127.0.0.1:19733")
})

test("macOS preparation fails when the Electron runtime is missing", { skip: process.platform !== "darwin" }, async (t) => {
  const input = await fixture(t)
  await assert.rejects(prepareDevElectron({ ...input, electronExecutable: "/missing/Electron.app/Contents/MacOS/Electron", platform: "darwin" }), /ENOENT/)
})
