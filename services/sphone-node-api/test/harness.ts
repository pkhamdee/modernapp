import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { start } from '../src/main.ts'

export interface TestService {
  /** Base URL of the running service, e.g. http://127.0.0.1:54321 */
  url: string
  stop(): Promise<void>
}

/**
 * Starts the real service on a random port with a fresh temporary folder standing in for the SMB share.
 * `demoImagesDir` seeds demo Product photos exactly as the container does at startup.
 */
export async function startTestService(options: { demoImagesDir?: string } = {}): Promise<TestService> {
  const share = await mkdtemp(join(tmpdir(), 'sphone-share-'))
  const service = await start({
    port: 0,
    host: '127.0.0.1',
    store: { kind: 'folder', root: share },
    demoImagesDir: options.demoImagesDir,
    logLevel: 'silent',
  })
  return {
    url: service.url,
    async stop() {
      await service.close()
      await rm(share, { recursive: true, force: true })
    },
  }
}
