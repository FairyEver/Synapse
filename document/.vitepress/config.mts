import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import {
  replaceDocumentDeploymentLinks,
  resolveDocumentAppPublicUrl
} from './deployment-links.mjs'

const appPublicUrl = resolveDocumentAppPublicUrl(process.env, process.argv.includes('dev'))

export default defineConfig({
  base: '/document/',
  lang: 'zh-CN',
  title: 'Synapse',
  description: 'Synapse 文档',
  cleanUrls: true,
  srcExclude: ['README.md'],

  async transformPageData(pageData, { siteConfig }) {
    if (!pageData.filePath) return

    return {
      rawMarkdown: replaceDocumentDeploymentLinks(
        await readFile(resolve(siteConfig.srcDir, pageData.filePath), 'utf8'),
        appPublicUrl
      )
    }
  },

  markdown: {
    config(markdown) {
      markdown.core.ruler.before('normalize', 'synapse-deployment-links', (state) => {
        state.src = replaceDocumentDeploymentLinks(state.src, appPublicUrl)
      })
    }
  },

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
              text: '获取公共链接文件',
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
