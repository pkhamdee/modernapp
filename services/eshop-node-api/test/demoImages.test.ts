import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startTestService, type TestService } from './harness.ts'

// The photos eshop-api's demo catalog refers to (DemoData.cs) are published at startup.
const demoImagesDir = fileURLToPath(new URL('../demo-images', import.meta.url))

let service: TestService

before(async () => {
  service = await startTestService({ demoImagesDir })
})

after(async () => {
  await service.stop()
})

test('demo Product photos are served publicly after startup', async () => {
  for (const id of ['demo-iphone-17.svg', 'demo-yadea-e8s-pro.svg']) {
    const read = await fetch(`${service.url}/images/public/${id}`)
    assert.equal(read.status, 200, id)
    assert.equal(read.headers.get('content-type'), 'image/svg+xml')
  }
})
