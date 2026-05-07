import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Synapse AI Studio',
  description: 'Where Ideas Connect - 跨编辑器 Rule、Skill 与本地工作流管理工具',

  lastUpdated: true,
  cleanUrls: true,

  srcExclude: ['README.md'],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/icon.png' }]
  ],

  vite: {
    server: {
      port: 5174,
      open: true
    }
  },

  themeConfig: {
    logo: '/icon.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/start/install' },
      { text: '用户指南', link: '/guide/concepts' },
      { text: '团队协作', link: '/team/repository-structure' },
      { text: '高级功能', link: '/advanced/' },
      { text: '开发者', link: '/developer/' },
      { text: '参考', link: '/reference/synapse-mcp-capabilities' }
    ],

    sidebar: {
      '/start/': [{ text: '快速开始', items: [
        { text: '下载与安装', link: '/start/install' },
        { text: '配置内容仓库', link: '/start/repository' },
        { text: '安装第一个内容', link: '/start/first-install' }
      ]}],
      '/guide/': [{ text: '用户指南', items: [
        { text: '核心概念', link: '/guide/concepts' },
        { text: 'Rule', link: '/guide/rules' },
        { text: 'Skill', link: '/guide/skills' },
        { text: '编辑器安装', link: '/guide/editors' },
        { text: '设置', link: '/guide/settings' }
      ]}],
      '/team/': [{ text: '团队协作', items: [
        { text: '仓库结构', link: '/team/repository-structure' },
        { text: '内容编写', link: '/team/content-authoring' },
        { text: '分享与审核', link: '/team/share-review' }
      ]}],
      '/advanced/': [{ text: '高级功能', items: [
        { text: '总览', link: '/advanced/' },
        { text: 'Agent', link: '/advanced/agent' },
        { text: 'Prompts', link: '/advanced/prompts' },
        { text: 'Database', link: '/advanced/database' },
        { text: 'Task Scheduler', link: '/advanced/task-scheduler' },
        { text: 'Token Usage', link: '/advanced/token-usage' },
        { text: 'Editor Scan', link: '/advanced/editor-scan' },
        { text: 'Diagnostics', link: '/advanced/diagnostics' }
      ]}],
      '/developer/': [{ text: '开发者', items: [
        { text: '总览', link: '/developer/' },
        { text: '本地开发', link: '/developer/local-development' },
        { text: '项目结构', link: '/developer/project-structure' },
        { text: '构建与发布', link: '/developer/build-release' },
        { text: '能力矩阵', link: '/developer/capability-naming-matrix' },
        { text: '能力维护', link: '/developer/capability-authoring' }
      ]}],
      '/reference/': [{ text: '参考', items: [
        { text: '常见问题', link: '/reference/faq' },
        { text: '排障', link: '/reference/troubleshooting' },
        { text: '术语表', link: '/reference/glossary' },
        { text: 'MCP 能力', link: '/reference/synapse-mcp-capabilities' }
      ]}]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/FairyEver/Synapse' }
    ],

    footer: {
      message: 'Where Ideas Connect',
      copyright: `Copyright © ${new Date().getFullYear()} Synapse AI Studio`
    },

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdatedText: '最后更新于',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
})
