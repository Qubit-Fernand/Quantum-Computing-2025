import { ExtendedRecordMap } from 'notion-types'

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

export function rewriteNotionPdfUrls(
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

    if (blockType === 'pdf' && isNotionHostedUrl(signedUrl)) {
      rewritten[blockId] = `/assets-pdf/${encodeURIComponent(
        pageId
      )}/${encodeURIComponent(blockId)}`
    } else {
      rewritten[blockId] = signedUrl
    }
  }

  return {
    ...recordMap,
    signed_urls: rewritten
  }
}
