import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Builds the service worker (ADR 0006, #59): writes src/pwa/sw.js to dist/sw.js with this build's static files
 * (everything in dist/ except the page itself, which always comes from the network) and a hash of their contents.
 * A new deploy therefore ships a byte-different sw.js, which browsers pick up on the next visit.
 */
function serviceWorker(): Plugin {
  let root = ''
  let publicDir = ''
  return {
    name: 'eshop-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const files = new Map<string, string | Uint8Array>()
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else files.set(relative(publicDir, path).split(sep).join('/'), readFileSync(path))
        }
      }
      if (publicDir) walk(publicDir)
      for (const output of Object.values(bundle)) {
        files.set(output.fileName, output.type === 'chunk' ? output.code : output.source)
      }

      const paths = [...files.keys()]
        .filter((name) => name !== 'index.html' && !name.startsWith('.vite/') && !name.endsWith('.map'))
        .sort()
      const hash = createHash('sha256')
      for (const name of paths) hash.update(name).update('\0').update(files.get(name)!).update('\0')
      const version = hash.digest('hex').slice(0, 16)

      const template = 'src/pwa/sw.js'
      const source = readFileSync(join(root, template), 'utf8')
      if (!source.includes("'__ESHOP_VERSION__'") || !source.includes("'__ESHOP_PRECACHE__'")) {
        this.error(`${template} lost its build placeholders`)
      }
      if (!paths.includes('offline.html')) this.error('public/offline.html is missing')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source
          .replace("'__ESHOP_VERSION__'", JSON.stringify(version))
          .replace("'__ESHOP_PRECACHE__'", JSON.stringify(paths.map((name) => `/${name}`))),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    // Local development: run eshop-api with `dotnet run` (http://localhost:5080)
    // and eshop-node-api with `npm run dev` (http://localhost:8081).
    proxy: { '/api': 'http://localhost:5080', '/images': 'http://localhost:8081' },
  },
})
