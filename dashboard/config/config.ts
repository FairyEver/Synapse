import { defineConfig } from '@umijs/max';
import defaultSettings from './defaultSettings';
import proxy from './proxy';
import routes from './routes';

const { UMI_ENV = 'dev' } = process.env;

const config = defineConfig({
  hash: true,
  esbuildMinifyIIFE: true,
  base: '/dashboard/',
  publicPath: '/dashboard/',
  routes,
  ignoreMomentLocale: true,
  proxy: proxy[UMI_ENV as keyof typeof proxy],
  fastRefresh: true,
  model: {},
  initialState: {},
  title: 'Synapse',
  layout: {
    locale: false,
    ...defaultSettings,
  },
  moment2dayjs: {
    preset: 'antd',
    plugins: ['duration', 'relativeTime'],
  },
  antd: {
    appConfig: {},
    configProvider: {
      variant: 'filled',
    },
  },
  request: {},
  reactQuery: {},
  access: {},
  define: {
    'process.env.CI': process.env.CI,
    __APP_VERSION__: require('./../package.json').version,
    __UMI_VERSION__: require('@umijs/max/package.json').version,
  },
});

export default config as Record<string, unknown>;
