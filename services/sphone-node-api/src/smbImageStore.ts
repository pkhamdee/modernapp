import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { areas, type Area, type ImageStore } from './imageStore.ts'

const exec = promisify(execFile)

export interface SmbOptions {
  /** Samba/Windows host, e.g. samba.thirdparty.svc.cluster.local */
  host: string
  port?: number
  /** Share name for this environment, e.g. sphone-dev */
  share: string
  domain?: string
  username: string
  password: string
}

const notFound = /NT_STATUS_(OBJECT_NAME_NOT_FOUND|NO_SUCH_FILE|OBJECT_PATH_NOT_FOUND)/

/**
 * The share, reached over SMB3 with Samba's own `smbclient` (NTLMv2, works against Samba and Windows file
 * servers alike). Each operation is one short smbclient run; callers only pass validated areas and IDs, so
 * the names are safe inside smbclient commands. Credentials go in a 0600 auth file, never on the command line.
 */
export function smbImageStore(options: SmbOptions): ImageStore {
  let workDir: string | undefined

  async function scratch(): Promise<string> {
    if (!workDir) {
      workDir = await mkdtemp(join(tmpdir(), 'smb-'))
      const auth = [`username = ${options.username}`, `password = ${options.password}`, `domain = ${options.domain ?? 'WORKGROUP'}`]
      await writeFile(join(workDir, 'auth'), `${auth.join('\n')}\n`, { mode: 0o600 })
    }
    return workDir
  }

  /** Runs smbclient commands; resolves with combined output, rejects with it on failure. */
  async function smb(command: string): Promise<string> {
    const dir = await scratch()
    const args = [`//${options.host}/${options.share}`, '-A', join(dir, 'auth'), '-p', String(options.port ?? 445), '-m', 'SMB3', '-c', command]
    try {
      const { stdout, stderr } = await exec('smbclient', args, { timeout: 15_000, maxBuffer: 1024 * 1024 })
      const output = `${stdout}${stderr}`
      if (/NT_STATUS_/.test(output) && !/NT_STATUS_OK/.test(output)) throw new SmbError(command, output)
      return output
    } catch (error) {
      if (error instanceof SmbError) throw error
      const { stdout = '', stderr = '', message } = error as { stdout?: string; stderr?: string; message: string }
      throw new SmbError(command, `${stdout}${stderr}` || message)
    }
  }

  const remote = (area: Area, id: string) => `${area}\\${id}`

  return {
    async init() {
      for (const area of areas) {
        try {
          await smb(`mkdir ${area}`)
        } catch (error) {
          if (!(error instanceof SmbError && /NT_STATUS_OBJECT_NAME_COLLISION/.test(error.output))) throw error
        }
      }
    },
    async put(area, id, content) {
      const local = join(await scratch(), randomUUID())
      try {
        await writeFile(local, content)
        await smb(`put "${local}" "${remote(area, id)}"`)
      } finally {
        await rm(local, { force: true })
      }
    },
    async get(area, id) {
      const local = join(await scratch(), randomUUID())
      try {
        await smb(`get "${remote(area, id)}" "${local}"`)
        return await readFile(local)
      } catch (error) {
        if (error instanceof SmbError && notFound.test(error.output)) return undefined
        throw error
      } finally {
        await rm(local, { force: true })
      }
    },
    async exists(area, id) {
      try {
        await smb(`allinfo "${remote(area, id)}"`)
        return true
      } catch (error) {
        if (error instanceof SmbError && notFound.test(error.output)) return false
        throw error
      }
    },
    async check() {
      await smb('ls')
    },
  }
}

class SmbError extends Error {
  readonly output: string
  constructor(command: string, output: string) {
    super(`smbclient "${command.split(' ')[0]}" failed: ${output.trim().split('\n').at(-1)}`)
    this.output = output
  }
}
