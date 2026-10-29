import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { smbImageStore } from '../src/smbImageStore.ts'

// The SMB adapter against a fake `smbclient` (test/fake-smbclient) that answers like a Samba 4 share without
// shadow copies. Regression: `allinfo` on an existing file ends with NT_STATUS_INVALID_DEVICE_REQUEST, which made
// `exists` throw, so demo seeding never finished and readiness stayed 503 after the first start.
const fakeBin = fileURLToPath(new URL('./fake-smbclient', import.meta.url))
let share: string
let originalPath: string | undefined

before(async () => {
  share = await mkdtemp(join(tmpdir(), 'fake-smb-'))
  originalPath = process.env.PATH
  process.env.PATH = `${fakeBin}:${originalPath}`
  process.env.FAKE_SMB_ROOT = share
})

after(async () => {
  process.env.PATH = originalPath
  delete process.env.FAKE_SMB_ROOT
  await rm(share, { recursive: true, force: true })
})

const store = () => smbImageStore({ host: 'samba.test', share: 'sphone-test', username: 'u', password: 'p' })

test('a stored image exists and a missing one does not', async () => {
  const smb = store()
  await smb.init()
  await smb.put('public', 'demo-phone.svg', Buffer.from('<svg/>'))

  assert.equal(await smb.exists('public', 'demo-phone.svg'), true)
  assert.equal(await smb.exists('public', 'missing.svg'), false)
})

test('starting again over a share that already has the areas and images works', async () => {
  const smb = store()
  await smb.init()
  await smb.put('private', 'card.png', Buffer.from('png'))

  const restarted = store()
  await restarted.init()

  assert.equal(await restarted.exists('private', 'card.png'), true)
  assert.deepEqual(await restarted.get('private', 'card.png'), Buffer.from('png'))
  assert.equal(await restarted.get('private', 'nope.png'), undefined)
})
