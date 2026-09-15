import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

const EMOJIBASE_FILES = ['compact.json', 'shortcodes/emojibase.json']
const emojibaseDir = fileURLToPath(new URL('./node_modules/emojibase-data/en/', import.meta.url))

/** Serves the emoji picker's data from our own origin instead of a CDN. */
function emojibaseData(): Plugin {
  const read = (file: string) => readFileSync(emojibaseDir + file)
  return {
    name: 'othermuks-emojibase',
    configureServer(server) {
      server.middlewares.use('/emojibase/en', (req, res, next) => {
        const file = req.url?.split('?')[0].replace(/^\//, '')
        if (!file || !EMOJIBASE_FILES.includes(file)) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(read(file))
      })
    },
    generateBundle() {
      for (const file of EMOJIBASE_FILES) {
        this.emitFile({ type: 'asset', fileName: `emojibase/en/${file}`, source: read(file) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The client talks to gomuks on the same origin (cookie auth). In dev, proxy
  // /_gomuks to the backend named in .env.local (GOMUKS_BACKEND=https://...).
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.GOMUKS_BACKEND || 'http://localhost:29325'

  const proxy: Record<string, ProxyOptions> = {
    '/_gomuks': {
      target: backend,
      changeOrigin: true,
      // Compressed event streams get buffered in transit; ask the backend for identity encoding.
      headers: { 'Accept-Encoding': 'identity' },
      // Tell the nginx in front of us (Nginx Proxy Manager) not to buffer SSE.
      configure: proxy => {
        proxy.on('proxyRes', res => {
          if (res.headers['content-type']?.startsWith('text/event-stream')) {
            res.headers['x-accel-buffering'] = 'no'
          }
        })
      },
    },
  }

  // Reached through Nginx Proxy Manager in Docker (othermuks.aguiarvieira.pt), which can't use host
  // loopback and connects over both IPv4 and IPv6. '::' listens dual-stack.
  const listen = {
    host: '::',
    port: 5173,
    strictPort: true,
    allowedHosts: ['othermuks.aguiarvieira.pt'],
    proxy,
  }

  return {
    // Relative asset paths, so the build also works from a sub-path such as GitHub Pages (user.github.io/repo/).
    base: './',
    plugins: [react(), tailwindcss(), emojibaseData()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // `npm run dev`: unbundled, no HMR websocket (the app only uses SSE).
    server: { ...listen, hmr: false },
    // `npm run serve`: rebuilds on change and serves the production bundle, which is far lighter to load.
    preview: listen,
  }
})
