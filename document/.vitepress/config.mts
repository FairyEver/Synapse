import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/document/',
  lang: 'zh-CN',
  title: 'Synapse',
  description: 'Synapse 文档',
  cleanUrls: true,
  srcExclude: ['README.md'],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/document/synapse-logo.png' }]
  ],

  vite: {
    publicDir: fileURLToPath(new URL('../../dashboard/public', import.meta.url)),
    server: {
      port: 19773,
      strictPort: true,
      open: false
    }
  },

  themeConfig: {
    logo: '/synapse-logo.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '开放接口', link: '/open-api/' }
    ],

    sidebar: {
      '/open-api/': [
        { text: '概览', link: '/open-api/' },
        {
          text: 'API',
          collapsed: false,
          items: [
            {
              text: '获取分享链接文件',
              link: '/open-api/api/share-link-download'
            }
          ]
        }
      ]
    },

    footer: {
      message: 'Synapse documentation',
      copyright: `Copyright © ${new Date().getFullYear()} Synapse`
    },

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
})
