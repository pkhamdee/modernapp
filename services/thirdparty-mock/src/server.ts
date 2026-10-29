import { createApp } from './app.ts'
import { log } from './log.ts'

const port = Number(process.env.PORT ?? 4000)

const server = createApp().listen(port, () => {
  log('info', 'thirdparty-mock listening', { port })
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log('info', 'shutting down', { signal })
    server.close(() => process.exit(0))
  })
}
