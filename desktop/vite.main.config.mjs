import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        'canvas',
        'jsdom',
        '@earendil-works/pi-coding-agent',
        'turndown',
        'ppu-paddle-ocr',
        'onnxruntime-node',
        'onnxruntime-web',
        'onnxruntime-common',
        'ppu-ocv',
        '@napi-rs/canvas',
      ],
    },
  },
});
