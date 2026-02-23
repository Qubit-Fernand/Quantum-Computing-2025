import { ExtendedRecordMap } from 'notion-types'

/**
 * Block types that Notion stores as uploaded files and issues signed URLs for.
 * We want to proxy these through our API so that the links in the page never
 * expire, regardless of how long the Notion-signed URL remains valid.
 */
const FILE_BLOCK_TYPES = new Set(['pdf', 'file', 'audio', 'video'])

/**
 * Return true when the URL originates from Notion / AWS S3 hosting and
 * therefore carries expiring query-string signatures.
 */
function isNotionHostedUrl(url: string): boolean {
  if (!url) return false
  try {
    const { hostname } = new URL(url)
    return (
      hostname.endsWith('amazonaws.com') ||
      hostname === 'notion.so' ||
      hostname.endsWith('.notion.so')
    )
  } catch {
    return false
  }
}

/**
 * Rewrite every signed Notion file URL stored in `recordMap.signed_urls` for
 * file-type blocks (PDF, audio, video, generic file) to point to our local
 * `/api/notion-file` proxy route instead.
 *
 * The proxy route calls notion.getPage at click-time to obtain a brand-new
 * signed URL, so the link embedded in the page never expires regardless of
 * how long the user keeps the tab open.
 *
 * Image blocks are intentionally left unchanged so that Next.js image
 * optimisation (mapImageUrl + next/image) continues to work as before.
 */
export function rewriteNotionFileUrls(
  recordMap: ExtendedRecordMap,
  pageId: string
): ExtendedRecordMap {
  if (!recordMap?.signed_urls) {
    return recordMap
  }

  const rewritten: Record<string, string> = {}

  for (const [blockId, signedUrl] of Object.entries(recordMap.signed_urls)) {
    if (typeof signedUrl !== 'string') {
      continue
    }

    const block = recordMap.block?.[blockId]?.value
    const blockType = block?.type as string | undefined

    if (
      blockType &&
      FILE_BLOCK_TYPES.has(blockType) &&
      isNotionHostedUrl(signedUrl)
    ) {
      // Store only blockId + pageId — no signed URL in the HTML.
      // The API handler fetches a fresh signed URL from Notion at click-time.
      rewritten[blockId] = `/api/notion-file?blockId=${encodeURIComponent(
        blockId
      )}&pageId=${encodeURIComponent(pageId)}`
    } else {
      rewritten[blockId] = signedUrl
    }
  }

  return { ...recordMap, signed_urls: rewritten }
}
