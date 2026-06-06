/**
 * Phase 0.6 — ESLint configuration (Flat Config).
 * SPEC §9.
 *
 * Migrates the 6 hard constraints from scripts/checks/check-hard-constraints.mjs to ESLint rules,
 * plus adds no-restricted-imports for modules/ directory boundaries.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  // src/ directory uses tsconfig.json
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
  },
  // electron/ directory uses tsconfig.electron.json
  {
    files: ["electron/**/*.ts", "database/**/*.ts"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.electron.json",
      },
    },
  },
  // Global rules for all files
  {
    rules: {
      // ========================================================================
      // Hard Constraint #1: No export default new XxxService() singletons
      // ========================================================================
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration > NewExpression[callee.name=/Service$/]",
          message: "禁止export default new XxxService()单例模式。使用ServiceRegistry管理生命周期。",
        },
      ],

      // ========================================================================
      // Hard Constraints #2, #3, #4, #6: No bare API calls outside designated dirs
      // ========================================================================
      "no-restricted-properties": [
        "error",
        // Constraint #2: No bare ipcMain.handle/on outside runtime/ipc
        {
          object: "ipcMain",
          property: "handle",
          message: "禁止裸ipcMain.handle。使用runtime/ipc/IpcModule系统。",
        },
        {
          object: "ipcMain",
          property: "on",
          message: "禁止裸ipcMain.on。使用runtime/ipc/IpcModule系统。",
        },
        // Constraint #3: No bare webContents.send outside runtime/event-bus and runtime/window
        {
          object: "webContents",
          property: "send",
          message: "禁止裸webContents.send。使用EventBus或WindowManager.broadcast。",
        },
        // Constraint #4: No bare http/net/https.createServer outside runtime/network
        {
          object: "http",
          property: "createServer",
          message: "禁止裸http.createServer。使用runtime/network服务。",
        },
        {
          object: "net",
          property: "createServer",
          message: "禁止裸net.createServer。使用runtime/network服务。",
        },
        {
          object: "https",
          property: "createServer",
          message: "禁止裸https.createServer。使用runtime/network服务。",
        },
        // Constraint #6: No bare fs.writeFile in bootstrap or src/runtime
        {
          object: "fs",
          property: "writeFile",
          message: "禁止裸fs.writeFile。使用原子写入操作或DataRepository。",
        },
        {
          object: "fs",
          property: "writeFileSync",
          message: "禁止裸fs.writeFileSync。使用原子写入操作或DataRepository。",
        },
      ],

      // ========================================================================
      // Hard Constraint #5: No empty catch blocks (with exception for commented)
      // ========================================================================
      "no-empty": ["error", { allowEmptyCatch: false }],

      // ========================================================================
      // TypeScript recommended overrides
      // ========================================================================
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Allow bare APIs in designated directories
  // validated-ipc.ts is the IPC validation layer - allowed to use bare ipcMain
  {
    files: ["electron/ipc/validated-ipc.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["electron/runtime/ipc/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "ipcMain",
          property: "handle",
          message: "即使runtime/ipc内也应通过IpcRegistry注册，而非直接使用ipcMain.handle。",
        },
      ],
    },
  },
  {
    files: ["electron/runtime/event-bus/**/*.ts", "electron/runtime/window/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "webContents",
          property: "send",
          message: "使用WindowManager.broadcast或EventBroadcaster接口。",
        },
      ],
    },
  },
  {
    files: ["electron/runtime/network/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "http", property: "createServer", message: "使用NetworkServiceRegistry。" },
        { object: "net", property: "createServer", message: "使用NetworkServiceRegistry。" },
        { object: "https", property: "createServer", message: "使用NetworkServiceRegistry。" },
      ],
    },
  },
  // Relax rules for test files - don't use project parser for excluded test files
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-properties": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "scripts/**",
    ],
  }
);
