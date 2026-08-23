<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import CopyMarkdownButton from './components/CopyMarkdownButton.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #doc-before>
      <CopyMarkdownButton />
    </template>

    <template #home-hero-info-before>
      <CopyMarkdownButton placement="home" />
    </template>

    <template #page-top>
      <CopyMarkdownButton placement="page" />
    </template>
  </Layout>
</template>
