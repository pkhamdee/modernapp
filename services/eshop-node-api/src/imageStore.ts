/**
 * Where images live. Each environment has one share with two areas:
 *   public/  Product and Lot photos, served to anyone under /images/public/<id>
 *   private/ ID card photos, returned only to eshop-api over the internal API
 */
export type Area = 'public' | 'private'

export const areas: readonly Area[] = ['public', 'private']

export function isArea(value: string): value is Area {
  return (areas as readonly string[]).includes(value)
}

/** Image types we accept, keyed by the file extension that ends every image ID. */
export const contentTypes = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const

export type Extension = keyof typeof contentTypes

export function extensionFor(contentType: string): Extension | undefined {
  const type = contentType.split(';')[0]?.trim().toLowerCase()
  return (Object.keys(contentTypes) as Extension[]).find((ext) => contentTypes[ext] === type)
}

/**
 * Image IDs are `<name>.<ext>`: lowercase letters, digits and dashes, then a known extension.
 * The strict shape also makes IDs safe to use as file names on the share.
 */
const imageIdPattern = /^[a-z0-9][a-z0-9-]{0,99}\.(jpg|png|webp|svg)$/

export function isImageId(value: string): boolean {
  return imageIdPattern.test(value)
}

export function contentTypeOf(id: string): string {
  const ext = id.slice(id.lastIndexOf('.') + 1) as Extension
  return contentTypes[ext]
}

/** Port to the share. Callers pass only validated areas and image IDs. */
export interface ImageStore {
  /** Creates the public and private areas if they are missing. */
  init(): Promise<void>
  put(area: Area, id: string, content: Buffer): Promise<void>
  /** The image's bytes, or undefined when there is no such image in that area. */
  get(area: Area, id: string): Promise<Buffer | undefined>
  exists(area: Area, id: string): Promise<boolean>
  /** Throws when the share cannot be reached (readiness check). */
  check(): Promise<void>
}
