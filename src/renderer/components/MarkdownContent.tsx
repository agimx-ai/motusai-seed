import ReactMarkdown from 'react-markdown'
import { Tooltip } from './Tooltip'

export function MarkdownContent({ children }: { children: string }) {
  return <div className="text-[13px] leading-6 text-foreground">
    <ReactMarkdown components={{
      h1: ({ children }) => <h1 className="mb-3 mt-0 text-[20px] font-semibold">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 mt-6 text-[16px] font-semibold">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-2 mt-5 text-[14px] font-semibold">{children}</h3>,
      p: ({ children }) => <p className="my-3">{children}</p>,
      ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
      blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>,
      code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{children}</code>,
      pre: ({ children }) => <pre className="my-4 overflow-auto rounded-[10px] bg-muted p-4 font-mono text-[12px] leading-5">{children}</pre>,
      a: ({ children, href }) => (
        <Tooltip content={href}>
          <span className="text-accent underline underline-offset-2">{children}</span>
        </Tooltip>
      ),
    }}>{children}</ReactMarkdown>
  </div>
}
