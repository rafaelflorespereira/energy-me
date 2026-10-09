import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createCheckInsApi,
  fetchSharedView,
  fromApiValues,
  shareUrl,
  toApiValues,
  tokenFromHash,
} from './checkinsApi'
import { emptyValues, type Values } from './domain/feelings'
import { localRepository, remoteRepository } from './repository'

const VALUES: Values = { ...emptyValues(), raiva: 1, alegria: 4, medo: 2 }
const API_VALUES = { anger: 1, frustration: 0, worry: 0, joy: 4, sadness: 0, guilt: 0, fear: 2 }

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  for (const r of responses) fetch.mockResolvedValueOnce(r)
  const getToken = vi.fn(async (renew: boolean) => (renew ? 'fresh' : 'stale'))
  const api = createCheckInsApi({ baseUrl: 'https://api.test/', getToken, fetch })
  return { api, fetch, getToken }
}

describe('feeling key translation', () => {
  it('round-trips app values through the English API keys without loss', () => {
    expect(toApiValues(VALUES)).toEqual(API_VALUES)
    expect(fromApiValues(toApiValues(VALUES))).toEqual(VALUES)
  })
})

describe('check-ins API client', () => {
  it('PUTs English keys with the access token and returns the saved check-in', async () => {
    const { api, fetch } = setup(response(200, { date: '2026-10-07', values: API_VALUES, createdAt: 'a', updatedAt: 'b' }))
    expect(await api.put('2026-10-07', VALUES)).toEqual({ date: '2026-10-07', values: VALUES })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.test/checkins/2026-10-07')
    expect(init?.method).toBe('PUT')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer stale')
    expect(JSON.parse(init?.body as string)).toEqual({ values: API_VALUES })
  })

  it('reads every page before returning the history', async () => {
    const { api, fetch } = setup(
      response(200, { items: [{ date: '2026-10-01', values: API_VALUES }], nextCursor: 'abc=' }),
      response(200, { items: [{ date: '2026-10-02', values: API_VALUES }], nextCursor: null }),
    )
    expect((await api.list()).map((c) => c.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(fetch.mock.calls[1][0]).toBe('https://api.test/checkins?cursor=abc%3D')
  })

  it('renews the token once after a 401 and then gives up', async () => {
    const ok = setup(response(401, {}), response(200, { items: [], nextCursor: null }))
    expect(await ok.api.list()).toEqual([])
    expect(ok.getToken.mock.calls.map((c) => c[0])).toEqual([false, true])
    expect(new Headers(ok.fetch.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer fresh')

    const denied = setup(response(401, {}), response(401, {}))
    await expect(denied.api.list()).rejects.toMatchObject({ status: 401 })
    expect(denied.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not call the API without a token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = createCheckInsApi({ baseUrl: 'https://api.test', getToken: async () => null, fetch })
    await expect(api.list()).rejects.toBeInstanceOf(ApiError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces server and network failures instead of an empty history', async () => {
    const server = setup(response(503, { error: 'SERVICE_UNAVAILABLE' }))
    await expect(server.api.list()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' })

    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('offline'))
    const api = createCheckInsApi({ baseUrl: 'https://api.test', getToken: async () => 't', fetch })
    await expect(api.put('2026-10-07', VALUES)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('drops malformed items from the server', async () => {
    const { api } = setup(
      response(200, {
        items: [
          { date: '2026-10-01', values: API_VALUES },
          { date: '2026-10-02', values: { ...API_VALUES, joy: 9 } },
          { date: '2026-10-03', values: { raiva: 1 } },
        ],
        nextCursor: null,
      }),
    )
    expect((await api.list()).map((c) => c.date)).toEqual(['2026-10-01'])
  })
})

describe('repositories', () => {
  it('remote save only updates the list after the server confirms', async () => {
    const { api } = setup(response(500, {}))
    const repo = remoteRepository(api)
    expect(repo.remote).toBe(true)
    expect(repo.replaceAll).toBeUndefined()
    await expect(repo.save([], { date: '2026-10-07', values: VALUES })).rejects.toBeInstanceOf(ApiError)
  })

  it('local repository keeps working without an API URL', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
    })
    const repo = localRepository('alice')
    const next = await repo.save([], { date: '2026-10-07', values: VALUES })
    expect(await repo.load()).toEqual(next)
    vi.unstubAllGlobals()
  })
})

describe('share link', () => {
  const TOKEN = 'a'.repeat(43)

  it('creates, reads and revokes the link with the owner token', async () => {
    const share = { createdAt: '2026-10-09T12:00:00.000Z', expiresAt: null }
    const { api, fetch } = setup(
      response(201, { token: TOKEN, share }),
      response(200, { share }),
      response(200, { share: null }),
    )
    expect(await api.createShare(null)).toEqual({ token: TOKEN, share })
    expect(await api.getShare()).toEqual(share)
    await api.revokeShare()
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['https://api.test/share', 'PUT'],
      ['https://api.test/share', 'GET'],
      ['https://api.test/share', 'DELETE'],
    ])
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ expiresInDays: null })
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer stale')
    }
  })

  it('puts the token after the # and only accepts well-formed tokens', () => {
    expect(shareUrl('https://energy-me.vercel.app/', TOKEN)).toBe(`https://energy-me.vercel.app/ver#${TOKEN}`)
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash('#abc')).toBeNull()
    expect(tokenFromHash('')).toBeNull()
  })

  it('reads the shared view without credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      response(200, {
        items: [
          { date: '2026-10-08', values: API_VALUES },
          { date: '2026-10-01', values: API_VALUES },
        ],
        expiresAt: '2026-10-16T12:00:00.000Z',
      }),
    )
    const view = await fetchSharedView('https://api.test/', TOKEN, { fetch })
    expect(view).toEqual({
      checkins: [
        { date: '2026-10-01', values: VALUES },
        { date: '2026-10-08', values: VALUES },
      ],
      expiresAt: '2026-10-16T12:00:00.000Z',
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`https://api.test/public/share/${TOKEN}`)
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    expect(init?.credentials).toBe('omit')
  })

  it('reports a revoked or expired link as null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(404, { error: 'NOT_FOUND' }))
    expect(await fetchSharedView('https://api.test', TOKEN, { fetch })).toBeNull()
  })
})
