module.exports = {
  hooks: {
    updateConfig(config) {
      // pnpm 12 不再把 .npmrc 自定义项传给依赖安装脚本，保留原 Electron 下载镜像。
      return {
        ...config,
        extraEnv: {
          ...config.extraEnv,
          ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
        },
      }
    },
  },
}
