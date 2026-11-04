import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { dedupe: ['react','react-dom','three','@react-three/fiber'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    rolldownOptions: {
      input: {main:'index.html',bottle:'bottle.html',render:'render.html'},
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three'
          if (id.includes('/node_modules/@react-three/')) return 'renderer'
        },
      },
    },
  },
})
