const apiPort = process.env.SYNAPSE_SERVER_API_PORT ?? '3001';

export default {
  dev: {
    '/api/': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
    '/v1/': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
    '/healthz': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
  },
  test: {},
  pre: {},
};
