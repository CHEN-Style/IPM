import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'IPM_');
  const cloudBaseURL = env.IPM_CLOUD_BASE_URL || process.env.IPM_CLOUD_BASE_URL || '';

  return {
    define: {
      'process.env.IPM_CLOUD_BASE_URL': JSON.stringify(cloudBaseURL),
    },
    build: {
      rollupOptions: {
        external: [
          'better-sqlite3',
          'canvas',
          'jsdom',
          '@earendil-works/pi-coding-agent',
          'turndown',
          '@langchain/anthropic',
          '@langchain/google-genai',
          '@anthropic-ai/sdk',
          '@google/generative-ai',
          'ppu-paddle-ocr',
          'onnxruntime-node',
          'onnxruntime-web',
          'onnxruntime-common',
          'ppu-ocv',
          '@napi-rs/canvas',
        ],
      },
    },
  };
});
