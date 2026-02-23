import type { NextApiRequest, NextApiResponse } from 'next'
import fetch from 'node-fetch'

import { notion } from '../../lib/notion-api'

const ALLOWED_HOSTS = ['amazonaws.com', 'notion.so']
const PASSTHROUGH_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified'
]

export const config = {
  api: {
    responseLimit: false
  }
}

function isAllowedHost(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl)
    return ALLOWED_HOSTS.some(
      (host) => hostname === host || hostname.endsWith('.' + host)
    )
  } catch {
    return false
  }
}

function getRawSourceUrl(recordMap: any, blockId: string): string | undefined {
  const rawUrl = recordMap?.block?.[blockId]?.value?.properties?.source?.[0]?.[0]
  return typeof rawUrl === 'string' ? rawUrl : undefined
}

async function resolvePdfUrl(pageId: string, blockId: string): Promise<string> {
  try {
    const recordMap = await notion.getPage(pageId, {
      fetchMissingBlocks: false,
      fetchCollections: false,
      signFileUrls: true
    })

    const freshUrl = recordMap?.signed_urls?.[blockId]
    if (typeof freshUrl === 'string') {
      return freshUrl
    }

    const fallbackUrl = getRawSourceUrl(recordMap, blockId)
    if (fallbackUrl) {
      return fallbackUrl
    }
  } catch {
    // fall through and retry without signFileUrls
  }

  const fallbackMap = await notion.getPage(pageId, {
    fetchMissingBlocks: false,
    fetchCollections: false,
    signFileUrls: false
  })

  const fallbackUrl = getRawSourceUrl(fallbackMap, blockId)
  if (!fallbackUrl) {
    throw new Error('File URL not found for block')
  }

  return fallbackUrl
}

export default async function assetsPdfHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { blockId, pageId } = req.query
  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'Missing blockId parameter' })
  }

  if (!pageId || typeof pageId !== 'string') {
    return res.status(400).json({ error: 'Missing pageId parameter' })
  }

  try {
    const upstreamUrl = await resolvePdfUrl(pageId, blockId)

    if (!isAllowedHost(upstreamUrl)) {
      return res.status(400).json({ error: 'Unexpected file host' })
    }

    const headers: Record<string, string> = {}
    if (typeof req.headers.range === 'string') {
      headers.range = req.headers.range
    }
    if (typeof req.headers['if-none-match'] === 'string') {
      headers['if-none-match'] = req.headers['if-none-match']
    }
    if (typeof req.headers['if-modified-since'] === 'string') {
      headers['if-modified-since'] = req.headers['if-modified-since']
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers
    })

    res.status(upstreamRes.status)

    for (const header of PASSTHROUGH_HEADERS) {
      const value = upstreamRes.headers.get(header)
      if (value) {
        res.setHeader(header, value)
      }
    }

    if (!res.getHeader('cache-control')) {
      res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=3600')
    }

    if (req.method === 'HEAD') {
      return res.end()
    }

    if (!upstreamRes.body) {
      return res.end()
    }

    upstreamRes.body.on('error', () => {
      if (!res.writableEnded) {
        res.destroy()
      }
    })

    upstreamRes.body.pipe(res)
  } catch (err) {
    console.error('assets-pdf proxy failed', err)
    return res.status(502).json({ error: 'Failed to proxy PDF' })
  }
}
