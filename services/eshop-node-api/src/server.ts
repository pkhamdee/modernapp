// Container entry point: configuration comes from the environment.
//   PORT                     default 8080
//   IMAGE_STORE              smb (default) | folder
//   SMB_HOST, SMB_PORT, SMB_SHARE, SMB_DOMAIN, SMB_USERNAME, SMB_PASSWORD   for smb
//   IMAGE_FOLDER             for folder (local development)
//   DEMO_IMAGES_DIR          demo Product photos to publish at startup (unset: none)
//   LOG_LEVEL                default info
import type { Level } from 'pino'
import { start, type StoreConfig } from './main.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

const env = process.env

const store: StoreConfig =
  (env.IMAGE_STORE ?? 'smb') === 'folder'
    ? { kind: 'folder', root: required('IMAGE_FOLDER') }
    : {
        kind: 'smb',
        host: required('SMB_HOST'),
        port: env.SMB_PORT ? Number(env.SMB_PORT) : undefined,
        share: required('SMB_SHARE'),
        domain: env.SMB_DOMAIN,
        username: required('SMB_USERNAME'),
        password: required('SMB_PASSWORD'),
      }

const service = await start({
  port: Number(env.PORT ?? 8080),
  store,
  demoImagesDir: env.DEMO_IMAGES_DIR || undefined,
  logLevel: (env.LOG_LEVEL as Level | undefined) ?? 'info',
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void service.close().finally(() => process.exit(0))
  })
}
