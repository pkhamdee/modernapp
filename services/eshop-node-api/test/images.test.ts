// Seam 3: eshop-node-api's HTTP API, driven over real HTTP against a temporary folder standing in
// for the SMB share. Tests assert on HTTP responses only.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startTestService, type TestService } from './harness.ts'

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f2b36c0000000049454e44ae426082', 'hex')

let service: TestService

before(async () => {
  service = await startTestService()
})

after(async () => {
  await service.stop()
})

async function upload(area: string, body: Buffer, contentType = 'image/png') {
  return fetch(`${service.url}/internal/images/${area}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new Uint8Array(body),
  })
}

describe('public images', () => {
  test('an uploaded public image is served under /images/public/<id>', async () => {
    const uploaded = await upload('public', png)
    assert.equal(uploaded.status, 201)
    const { id, url } = (await uploaded.json()) as { id: string; url: string }
    assert.equal(url, `/images/public/${id}`)

    const read = await fetch(`${service.url}${url}`)

    assert.equal(read.status, 200)
    assert.equal(read.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png)
  })

  test('an unknown public image is not found', async () => {
    const read = await fetch(`${service.url}/images/public/no-such-image.png`)
    assert.equal(read.status, 404)
  })
})

describe('private images (ID card photos)', () => {
  test('are never served through the public /images route', async () => {
    const uploaded = await upload('private', png)
    assert.equal(uploaded.status, 201)
    const { id, url } = (await uploaded.json()) as { id: string; url: string | null }
    assert.equal(url, null)

    for (const path of [
      `/images/public/${id}`,
      `/images/private/${id}`,
      `/images/public/..%2Fprivate%2F${id}`,
      `/images/public/%2e%2e/private/${id}`,
      `/images/${id}`,
    ]) {
      const read = await fetch(`${service.url}${path}`)
      assert.equal(read.status, 404, path)
    }
  })

  test('are returned to eshop-api over the internal API', async () => {
    const { id } = (await (await upload('private', png)).json()) as { id: string }

    const read = await fetch(`${service.url}/internal/images/private/${id}`)

    assert.equal(read.status, 200)
    assert.equal(read.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png)
  })
})

describe('upload', () => {
  test('refuses files that are not images', async () => {
    const response = await upload('public', Buffer.from('<html></html>'), 'text/html')
    assert.equal(response.status, 415)
  })

  test('refuses an empty image', async () => {
    const response = await upload('public', Buffer.alloc(0))
    assert.equal(response.status, 400)
  })

  test('refuses an unknown area', async () => {
    const response = await upload('secret', png)
    assert.equal(response.status, 404)
  })
})

test('health checks report live, and ready when the share is reachable', async () => {
  assert.equal((await fetch(`${service.url}/healthz/live`)).status, 200)
  assert.equal((await fetch(`${service.url}/healthz/ready`)).status, 200)
})
