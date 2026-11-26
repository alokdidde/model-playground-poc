export const CITE_HREF = "#cite";

/**
 * Turn "[Model Name]" (or gpt-oss's full-width "【Model Name】") citations into
 * links the Markdown renderer shows as chips. Real Markdown links
 * ("[text](url)") are left alone.
 */
export function linkCitations(text: string): string {
  return text
    .replace(/【([^】\n]{2,80})】/g, (_, name: string) => `[${name}](${CITE_HREF})`)
    .replace(/\[([^\]\n]{2,80})\](?!\()/g, (_, name: string) => `[${name}](${CITE_HREF})`);
}
