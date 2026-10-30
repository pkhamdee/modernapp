import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fakeSmbShare, startSmbService } from './harness.ts'

// The service as deployed (IMAGE_STORE=smb), driven over HTTP, against a fake smbclient that answers like a
// Samba 4 share without shadow copies. Regression (PR #34): there `allinfo` on an existing file ends with
// NT_STATUS_INVALID_DEVICE_REQUEST, so once demo photos were on the share, a restarted service could never finish
// seeding and stayed not ready (503).
const demoImagesDir = fileURLToPath(new URL('../demo-images', import.meta.url))
let share: Awaited<ReturnType<typeof fakeSmbShare>>

before(async () => {
  share = await fakeSmbShare()
})

after(async () => {
  await share.remove()
})

test('images stored on the SMB share are served, and a missing one is not found', async () => {
  const service = await startSmbService()
  try {
    const upload = await fetch(`${service.url}/internal/images/public`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('png bytes'),
    })
    assert.equal(upload.status, 201)
    const { url } = (await upload.json()) as { url: string }

    const read = await fetch(`${service.url}${url}`)
    assert.equal(read.status, 200)
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), Buffer.from('png bytes'))
    assert.equal((await fetch(`${service.url}/images/public/missing.png`)).status, 404)
  } finally {
    await service.stop()
  }
})

test('a service restarted over a share that already holds the demo photos becomes ready and keeps serving', async () => {
  const first = await startSmbService({ demoImagesDir })
  assert.equal((await fetch(`${first.url}/healthz/ready`)).status, 200)
  const upload = await fetch(`${first.url}/internal/images/private`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from('card'),
  })
  const { id } = (await upload.json()) as { id: string }
  await first.stop()

  const restarted = await startSmbService({ demoImagesDir })
  try {
    assert.equal((await fetch(`${restarted.url}/healthz/ready`)).status, 200)
    assert.equal((await fetch(`${restarted.url}/images/public/demo-iphone-17.svg`)).status, 200)
    const card = await fetch(`${restarted.url}/internal/images/private/${id}`)
    assert.equal(card.status, 200)
    assert.deepEqual(Buffer.from(await card.arrayBuffer()), Buffer.from('card'))
  } finally {
    await restarted.stop()
  }
})
