import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local development: run eshop-api with `dotnet run` (http://localhost:5080)
    // and eshop-node-api with `npm run dev` (http://localhost:8081).
    proxy: { '/api': 'http://localhost:5080', '/images': 'http://localhost:8081' },
  },
})
