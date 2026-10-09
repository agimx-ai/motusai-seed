import { Streamdown, type Components } from 'streamdown'
import { Tooltip } from './Tooltip'

const compactListComponents: Components = {
  li: ({ children }) => <li className="py-0">{children}</li>,
}

export function MarkdownContent({ children, streaming = false, compact = false }: { children: string; streaming?: boolean; compact?: boolean }) {
  return <div className={`text-[13px] ${compact ? 'leading-[22px]' : 'leading-6'} text-foreground`}>
    <Streamdown mode={streaming ? 'streaming' : 'static'} className={compact ? 'space-y-2.5 [&>h2]:mt-4 [&>h3]:mt-3' : undefined} components={{
      h1: ({ children }) => <h1 className="mb-3 mt-0 text-[20px] font-semibold">{children}</h1>,
      h2: ({ children }) => <h2 className={`${compact ? '' : 'mb-2 mt-6'} text-[16px] font-semibold`}>{children}</h2>,
      h3: ({ children }) => <h3 className={`${compact ? '' : 'mb-2 mt-5'} text-[14px] font-semibold`}>{children}</h3>,
      p: ({ children }) => <p className={compact ? undefined : 'my-3'}>{children}</p>,
      ul: ({ children }) => <ul className={`${compact ? 'space-y-1.5' : 'my-3 space-y-1'} list-disc pl-5`}>{children}</ul>,
      ol: ({ children }) => <ol className={`${compact ? 'space-y-1.5' : 'my-3 space-y-1'} list-decimal pl-5`}>{children}</ol>,
      ...(compact ? compactListComponents : {}),
      blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>,
      code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{children}</code>,
      pre: ({ children }) => <pre className="my-4 overflow-auto rounded-[10px] bg-muted p-4 font-mono text-[12px] leading-5">{children}</pre>,
      a: ({ children, href }) => (
        <Tooltip content={href}>
          <span className="text-accent underline underline-offset-2">{children}</span>
        </Tooltip>
      ),
    }}>{children}</Streamdown>
  </div>
}
