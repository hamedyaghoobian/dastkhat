import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// content/ (the letters) lives beside app/, so the dev server may read one level up.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  optimizeDeps: { include: ['harfbuzzjs/hb.js', 'harfbuzzjs/hbjs.js'] },
})
