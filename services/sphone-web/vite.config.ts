import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local development: run sphone-api with `dotnet run` (http://localhost:5080).
    proxy: { '/api': 'http://localhost:5080' },
  },
})
