import type { NextApiRequest, NextApiResponse } from 'next'

import { notion } from '../../lib/notion-api'

// Only allow redirects to Notion / AWS S3 origins (SSRF guard)
const ALLOWED_HOSTS = ['amazonaws.com', 'notion.so']

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

/**
 * API route that serves Notion file blocks (PDF, audio, video, file) under the
 * site's own domain so that embedded links never expire.
 *
 * On every request it fetches a fresh signed URL from Notion by calling
 * getPage(pageId), so the redirect target is always valid regardless of when
 * the page was first rendered.  Works for public workspaces without any token;
 * set NOTION_TOKEN for private workspaces.
 *
 * Query params:
 *   blockId – Notion block ID of the file block
 *   pageId  – Notion page ID that contains the block
 */
export default async function notionFileHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
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
    // Fetch the page to get a brand-new signed URL for this block.
    // notion-client calls getSignedFileUrls internally when signFileUrls=true.
    // This requires NOTION_TOKEN for private workspaces; falls back below if it throws.
    const recordMap = await notion.getPage(pageId, {
      fetchMissingBlocks: false,
      fetchCollections: false,
      signFileUrls: true
    })

    const freshUrl: string | undefined = recordMap?.signed_urls?.[blockId]

    if (freshUrl) {
      // SSRF guard: only redirect to Notion/S3 origins
      if (!isAllowedHost(freshUrl)) {
        return res.status(400).json({ error: 'Unexpected redirect target' })
      }

      // Cache for 55 minutes — well within Notion's ~1 h signature window
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=3300, stale-while-revalidate=86400'
      )
      return res.redirect(302, freshUrl)
    }

    // signFileUrls succeeded but no signed URL was returned for this block —
    // fall through to the raw-URL fallback below.
    const rawUrl: string | undefined =
      (recordMap?.block?.[blockId]?.value as any)?.properties?.source?.[0]?.[0]

    if (!rawUrl) {
      return res.status(404).json({ error: 'File URL not found for block' })
    }

    if (!isAllowedHost(rawUrl)) {
      return res.status(400).json({ error: 'Unexpected redirect target' })
    }

    return res.redirect(302, rawUrl)
  } catch (err) {
    // getSignedFileUrls requires auth (NOTION_TOKEN). If it throws, retry the
    // page fetch without signing and redirect to the raw (possibly short-lived) URL.
    console.warn(
      'notion-file: signFileUrls failed (missing NOTION_TOKEN?), falling back to raw URL',
      err
    )

    try {
      const recordMap = await notion.getPage(pageId, {
        fetchMissingBlocks: false,
        fetchCollections: false,
        signFileUrls: false
      })

      const rawUrl: string | undefined =
        (recordMap?.block?.[blockId]?.value as any)?.properties?.source?.[0]?.[0]

      if (!rawUrl) {
        return res.status(404).json({ error: 'File URL not found for block' })
      }

      if (!isAllowedHost(rawUrl)) {
        return res.status(400).json({ error: 'Unexpected redirect target' })
      }

      return res.redirect(302, rawUrl)
    } catch (fallbackErr) {
      console.error('notion-file: fallback fetch also failed', fallbackErr)
      return res.status(502).json({ error: 'Failed to fetch signed URL' })
    }
  }
}
