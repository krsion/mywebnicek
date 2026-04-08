import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import topLevelAwait from 'vite-plugin-top-level-await'
import wasm from 'vite-plugin-wasm'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  base: '/MyDenicek/',
  resolve: {
    alias: {
      '@mydenicek/document': path.resolve(__dirname, '../../packages/mydenicek-core/src/index.ts'),
      '@mydenicek/react': path.resolve(__dirname, '../../packages/mydenicek-react/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: ['@jsr/mydenicek__core'],
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tsconfigPaths(),
    wasm(),
    topLevelAwait(),
  ],
  server: {
  },
})
