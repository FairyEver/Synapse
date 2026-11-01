import {defineConfig} from "vitest/config"
import path from "node:path"

// Explicit offline suite: a shallow production checkout need not contain the pinned old Git object.
export default defineConfig({
 root:path.resolve(import.meta.dirname,"../.."),
 test:{environment:"node",include:["test/poker-roll-research/*.checks.ts"],globals:false,maxWorkers:1},
})
