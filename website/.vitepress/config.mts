import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Synapse',
  description: 'Where Ideas Connect —— 面向团队的 AI Rules 与 Skills 分享平台',

  lastUpdated: true,
  cleanUrls: true,

  srcExclude: ['README.md'],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/icon.png' }]
  ],

  vite: {
    server: {
      port: 5174
    }
  },

  themeConfig: {
    logo: '/icon.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '产品介绍', link: '/guide/introduction' },
      { text: '下载', link: '/guide/download' },
      { text: 'FAQ', link: '/guide/faq' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '了解 Synapse',
          items: [
            { text: '产品介绍', link: '/guide/introduction' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '功能特性', link: '/guide/features' }
          ]
        },
        {
          text: '开始使用',
          items: [
            { text: '下载与安装', link: '/guide/download' },
            { text: '常见问题', link: '/guide/faq' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/FairyEver/Synapse' }
    ],

    footer: {
      message: 'Where Ideas Connect',
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

    lastUpdatedText: '最后更新于',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
})
