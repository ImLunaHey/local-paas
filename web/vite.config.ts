import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API stays on loopback. Preserve Origin for its allowlist, but send the
// upstream Host so the API does not need to trust proxy-facing hostnames.
const proxy = { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } }
const publicOrigin = process.env.PUBLIC_ORIGIN
const allowedHosts = publicOrigin ? [new URL(publicOrigin).hostname] : []

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5188, allowedHosts, proxy },
  preview: { host: '127.0.0.1', port: 5188, allowedHosts, proxy },
})
