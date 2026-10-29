import { randomUUID } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import {
  contentTypeOf,
  contentTypes,
  extensionFor,
  isArea,
  isImageId,
  type ImageStore,
} from './imageStore.ts'

const maxImageBytes = 10 * 1024 * 1024

/**
 * HTTP API.
 *   /images/public/<id>          public read; the only routes the Gateway forwards (HTTPRoute /images)
 *   /internal/images/<area>      upload (POST) and read (GET /<id>) for sphone-api, cluster-internal only
 *   /healthz/live, /healthz/ready probes
 */
export function createApp(store: ImageStore, logger: Logger, isPrepared: () => boolean): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.startsWith('/healthz') ?? false } }))

  app.get('/healthz/live', (_req, res) => {
    res.json({ status: 'live' })
  })

  app.get('/healthz/ready', async (_req, res) => {
    try {
      if (!isPrepared()) throw new Error('share areas not prepared yet')
      await store.check()
      res.json({ status: 'ready' })
    } catch (error) {
      logger.warn({ err: error }, 'image share not reachable')
      res.status(503).json({ status: 'unavailable' })
    }
  })

  // Public read. Private images are never served here, whatever path is asked for.
  app.get('/images/public/:id', async (req, res) => {
    await sendImage(store, 'public', req.params.id, res, { public: true })
  })

  app.use('/images', (_req, res) => {
    res.status(404).end()
  })

  const internal = express.Router()

  internal.post(
    '/:area',
    express.raw({ type: Object.values(contentTypes), limit: maxImageBytes }),
    async (req: Request<{ area: string }>, res) => {
      const { area } = req.params
      if (!isArea(area)) return void res.status(404).end()

      const ext = extensionFor(req.get('content-type') ?? '')
      if (!ext) return void res.status(415).json({ error: `Content-Type must be one of ${Object.values(contentTypes).join(', ')}` })
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return void res.status(400).json({ error: 'Empty image' })

      const id = `${randomUUID()}.${ext}`
      await store.put(area, id, req.body)
      req.log.info({ area, imageId: id, bytes: req.body.length }, 'image stored')

      res.status(201).json({ id, area, url: area === 'public' ? `/images/public/${id}` : null })
    },
  )

  internal.get('/:area/:id', async (req: Request<{ area: string; id: string }>, res) => {
    const { area, id } = req.params
    if (!isArea(area)) return void res.status(404).end()
    await sendImage(store, area, id, res, { public: false })
  })

  app.use('/internal/images', internal)

  app.use((_req, res) => {
    res.status(404).end()
  })

  // Express 5 routes rejected promises here. Body-parser errors (e.g. 413 too large) carry their own status.
  app.use((error: Error & { status?: number }, req: Request, res: Response, _next: express.NextFunction) => {
    const status = error.status && error.status < 500 ? error.status : 500
    if (status === 500) req.log.error({ err: error }, 'request failed')
    res.status(status).json({ error: status === 500 ? 'Internal error' : error.message })
  })

  return app
}

async function sendImage(
  store: ImageStore,
  area: 'public' | 'private',
  id: string,
  res: Response,
  options: { public: boolean },
): Promise<void> {
  if (!isImageId(id)) return void res.status(404).end()

  const content = await store.get(area, id)
  if (!content) return void res.status(404).end()

  res.set({
    'content-type': contentTypeOf(id),
    'x-content-type-options': 'nosniff',
    // SVGs are images, not documents: never let one run script if opened directly.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    // Image IDs are never reused, so public images can be cached forever.
    'cache-control': options.public ? 'public, max-age=31536000, immutable' : 'private, no-store',
  })
  res.send(content)
}
