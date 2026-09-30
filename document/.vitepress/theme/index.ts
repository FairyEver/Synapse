import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import NotificationRequestBuilder from './components/NotificationRequestBuilder.vue'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('NotificationRequestBuilder', NotificationRequestBuilder)
  }
} satisfies Theme
