import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { areas, type Area, type ImageStore } from './imageStore.ts'

/** A local folder laid out like the share: used by tests and local development. */
export function folderImageStore(root: string): ImageStore {
  const path = (area: Area, id: string) => join(root, area, id)

  return {
    async init() {
      for (const area of areas) await mkdir(join(root, area), { recursive: true })
    },
    async put(area, id, content) {
      await writeFile(path(area, id), content)
    },
    async get(area, id) {
      try {
        return await readFile(path(area, id))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async exists(area, id) {
      try {
        await access(path(area, id))
        return true
      } catch {
        return false
      }
    },
    async check() {
      await stat(root)
    },
  }
}
