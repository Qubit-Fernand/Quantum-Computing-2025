import { NotionAPI } from 'notion-client'

export const notion = new NotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL,
  // Set NOTION_TOKEN (the token_v2 cookie from a logged-in Notion session) to
  // enable authenticated requests.  Required for private workspaces and for
  // re-signing file URLs via the /api/notion-file proxy route.
  authToken: process.env.NOTION_TOKEN
})
