import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const GRAFANA = 'https://unified-dash-grafana.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io'
const AUTH = 'Basic ' + Buffer.from('admin:ZenLabs@2025!').toString('base64')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: GRAFANA,
        changeOrigin: true,
        secure: false,
        headers: { Authorization: AUTH },
      },
    },
  },
})
