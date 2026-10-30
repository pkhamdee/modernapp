import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { isImageId, type ImageStore } from './imageStore.ts'

/**
 * Copies the demo Product photos (file name = image ID, e.g. demo-iphone-17.svg) into the public area,
 * skipping any already there. eshop-api's demo catalog refers to these IDs.
 */
export async function seedDemoImages(store: ImageStore, dir: string, logger: Logger): Promise<void> {
  const ids = (await readdir(dir)).filter(isImageId)
  let added = 0
  for (const id of ids) {
    if (await store.exists('public', id)) continue
    await store.put('public', id, await readFile(join(dir, id)))
    added++
  }
  logger.info({ demoImages: ids.length, added }, 'demo images seeded')
}
