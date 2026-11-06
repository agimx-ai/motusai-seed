import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { Streamdown, defaultRehypePlugins, type Components, type StreamdownProps } from 'streamdown';
import { MarkdownTableHeader } from './MarkdownTableHeader';

export type MarkdownImage = { src: string; alt: string; title?: string };
export type MarkdownLink = { href: string; children: ReactNode; title?: string };
type ImageRenderer = (image: MarkdownImage) => ReactNode;
type LinkRenderer = (link: MarkdownLink) => ReactNode;
const ImageRendererContext = createContext<ImageRenderer | undefined>(undefined);
const LinkRendererContext = createContext<LinkRenderer | undefined>(undefined);
function ReferencedLink({ href = '', children, title }: ComponentProps<'a'>) {
  const render = useContext(LinkRendererContext);
  return (
    <>
      {(href ? render?.({ href, children, ...(title ? { title } : {}) }) : undefined) ?? (
        <span title={href} className="text-accent underline underline-offset-2">
          {children}
        </span>
      )}
    </>
  );
}
function ReferencedImage({ src = '', alt = '', title }: ComponentProps<'img'>) {
  const render = useContext(ImageRendererContext);
  if (!src) return <span>{alt}</span>;
  return <>{render?.({ src, alt, ...(title ? { title } : {}) }) ?? <span>{alt}</span>}</>;
}

const noProtocols: readonly string[] = [];

/** Shared renderer. Resource resolution and link activation belong to the calling plugin. */
export function MarkdownContent({
  children,
  streaming = false,
  renderImage,
  imageProtocols = noProtocols,
  renderLink,
  linkProtocols = noProtocols,
}: {
  children: string;
  streaming?: boolean;
  /** Resolve and render explicitly referenced images within the caller's resource scope. No automatic loading. */
  renderImage?: ImageRenderer;
  /** Additional image-only protocols passed to renderImage, never to browser img src or ordinary links. */
  imageProtocols?: readonly string[];
  /** Render only links the caller can resolve. Return null/undefined to keep a link inert. */
  renderLink?: LinkRenderer;
  /** Additional link-only protocols passed to renderLink, never activated by this component. */
  linkProtocols?: readonly string[];
}) {
  const rehypePlugins = useMemo<StreamdownProps['rehypePlugins']>(() => {
    if (!renderImage && !renderLink) return undefined;
    const sanitize = defaultRehypePlugins.sanitize;
    if (!Array.isArray(sanitize)) throw new Error('Markdown sanitizer configuration is unavailable.');
    const [plugin, schema] = sanitize;
    const protocols = imageProtocols.filter((protocol) => /^[a-z][a-z0-9+.-]*$/i.test(protocol));
    const links = linkProtocols.filter((protocol) => /^[a-z][a-z0-9+.-]*$/i.test(protocol));
    return Object.entries(defaultRehypePlugins)
      .filter(([name]) => name !== 'raw')
      .map(([name, value]) =>
        name === 'sanitize'
          ? [
              plugin,
              {
                ...schema,
                protocols: {
                  ...schema.protocols,
                  src: [...(schema.protocols?.src || []), ...(renderImage ? protocols : [])],
                  href: [...(schema.protocols?.href || []), ...(renderLink ? links : [])],
                },
              },
            ]
          : value,
      );
  }, [Boolean(renderImage), imageProtocols, Boolean(renderLink), linkProtocols]);
  const resourceComponents = { ...(renderImage ? { img: ReferencedImage } : {}), a: ReferencedLink } as Components;
  return (
    <ImageRendererContext.Provider value={renderImage}>
      <LinkRendererContext.Provider value={renderLink}>
        <div className="seed-markdown text-[13px] leading-6 text-foreground">
          <Streamdown
            mode={streaming ? 'streaming' : 'static'}
            controls={{ table: { copy: true, download: false, fullscreen: false } }}
            tableMaxHeight={0}
            skipHtml
            rehypePlugins={rehypePlugins}
            components={{
              ...resourceComponents,
              h1: ({ children }) => <h1 className="mb-3 mt-0 text-[20px] font-semibold">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-6 text-[16px] font-semibold">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-2 mt-5 text-[14px] font-semibold">{children}</h3>,
              p: ({ children }) => <p className="my-3">{children}</p>,
              ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
              thead: MarkdownTableHeader,
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
              ),
              code: ({ children }) => (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{children}</code>
              ),
              pre: ({ children }) => (
                <pre className="my-4 overflow-auto rounded-[10px] bg-muted p-4 font-mono text-[12px] leading-5">
                  {children}
                </pre>
              ),
            }}
          >
            {children}
          </Streamdown>
        </div>
      </LinkRendererContext.Provider>
    </ImageRendererContext.Provider>
  );
}
