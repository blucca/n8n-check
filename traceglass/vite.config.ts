import { defineConfig } from 'vite';
import { agentNative } from '@agent-native/core/vite';

// Optional absolute cache/SDK paths support a shared dependency installation.
// A normal checkout needs none of these environment variables.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  cacheDir: process.env.TRACEGLASS_VITE_CACHE || 'node_modules/.vite',
  server: { host: '127.0.0.1', port: 8098, strictPort: true },
  plugins: [...agentNative({
    legacySpa: true, tailwind: false, port: 8098,
    fsAllow: process.env.TRACEGLASS_SDK_DIR ? [process.env.TRACEGLASS_SDK_DIR] : [],
    nitro: { buildDir: process.env.TRACEGLASS_NITRO_DIR || 'node_modules/.nitro' },
  })],
});
