import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// test 字段由 vitest 读取；vite 自身的类型不含该字段，这里整体断言一次
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)
