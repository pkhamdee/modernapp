import type { AddressInfo } from 'node:net'
import { pino, type Level } from 'pino'
import { createApp } from './app.ts'
import { seedDemoImages } from './demoImages.ts'
import { folderImageStore } from './folderImageStore.ts'
import type { ImageStore } from './imageStore.ts'
import { smbImageStore, type SmbOptions } from './smbImageStore.ts'

export type StoreConfig = { kind: 'folder'; root: string } | ({ kind: 'smb' } & SmbOptions)

export interface Config {
  port: number
  host?: string
  store: StoreConfig
  /** Folder of demo Product photos copied into the public area at startup (skipped when unset). */
  demoImagesDir?: string
  logLevel?: Level | 'silent'
}

export interface RunningService {
  url: string
  close(): Promise<void>
}

export async function start(config: Config): Promise<RunningService> {
  // JSON logs to stdout.
  const logger = pino({ level: config.logLevel ?? 'info', base: { service: 'eshop-node-api' } })
  const store: ImageStore = config.store.kind === 'folder' ? folderImageStore(config.store.root) : smbImageStore(config.store)

  // Create the areas and publish demo photos. The share may come up after us (e.g. Samba restarting), so a
  // failed attempt is retried in the background; until one succeeds the service reports not ready.
  let prepared = false
  let retry: NodeJS.Timeout | undefined
  const prepare = async (): Promise<void> => {
    try {
      await store.init()
      if (config.demoImagesDir) await seedDemoImages(store, config.demoImagesDir, logger)
      prepared = true
    } catch (error) {
      logger.warn({ err: error }, 'image share not ready; retrying in 5s')
      retry = setTimeout(() => void prepare(), 5_000)
    }
  }
  await prepare()

  const app = createApp(store, logger, () => prepared)
  const server = app.listen(config.port, config.host ?? '0.0.0.0')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { address, port } = server.address() as AddressInfo
  logger.info({ port, store: config.store.kind }, 'eshop-node-api listening')

  return {
    url: `http://${address.includes(':') ? `[${address}]` : address}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        clearTimeout(retry)
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections()
      }),
  }
}
