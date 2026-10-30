import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const share = await mkdtemp(join(tmpdir(), 'eshop-share-'))
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

/**
 * A fake SMB share for the production store (`IMAGE_STORE=smb`): `test/fake-smbclient/smbclient` is put first on
 * PATH and keeps the share's files in a temporary folder, answering like a Samba 4 server without shadow copies.
 * Services started with `startSmbService` talk to it through the real SMB adapter. One share per test file
 * (node --test runs each file in its own process, so changing PATH here is local to that file).
 */
export async function fakeSmbShare(): Promise<{ remove(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'fake-smb-'))
  const fakeBin = fileURLToPath(new URL('./fake-smbclient', import.meta.url))
  const originalPath = process.env.PATH
  process.env.PATH = `${fakeBin}:${originalPath}`
  process.env.FAKE_SMB_ROOT = root
  return {
    async remove() {
      process.env.PATH = originalPath
      delete process.env.FAKE_SMB_ROOT
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** Starts the real service on a random port against the fake SMB share (see `fakeSmbShare`). */
export async function startSmbService(options: { demoImagesDir?: string } = {}): Promise<TestService> {
  const service = await start({
    port: 0,
    host: '127.0.0.1',
    store: { kind: 'smb', host: 'samba.test', share: 'eshop-test', username: 'u', password: 'p' },
    demoImagesDir: options.demoImagesDir,
    logLevel: 'silent',
  })
  return { url: service.url, stop: () => service.close() }
}
