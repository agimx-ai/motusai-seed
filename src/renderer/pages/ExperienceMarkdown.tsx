import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MarkdownRenderer,
  defaultMarkdownTheme,
  embeddedArticleStyles,
  isTheme,
  markdownPlugins,
  restrictedMarkdownMedia,
} from '@motus-ai/seed-sdk/reader';
import type { ExperienceTipArticle } from '../../shared/experience-tips';

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const wordsPerMinute = 200;

export function ExperienceMarkdown({ article, dark, onReadingMinutes, onImageError }: {
  article: ExperienceTipArticle;
  dark: boolean;
  onReadingMinutes: (minutes: number) => void;
  onImageError: () => void;
}) {
  const [root, setRoot] = useState<ShadowRoot>();
  const attachRoot = useCallback((host: HTMLDivElement | null) => {
    if (host) setRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);
  const theme = isTheme(article.theme) ? article.theme : defaultMarkdownTheme;
  const plugins = useMemo(() => {
    const images = new Map(article.images.map(({ id, url }) => ['experience-image:' + id, url]));
    return markdownPlugins({
      ...restrictedMarkdownMedia(images),
      viewerEffect: ({ markdownBody }) => {
        let words = 0;
        const text = markdownBody.innerText ?? markdownBody.textContent ?? '';
        for (const line of text.split('\n')) {
          for (const segment of wordSegmenter.segment(line)) {
            if (segment.isWordLike) words++;
          }
        }
        onReadingMinutes(Math.ceil(words / wordsPerMinute));
      },
    }, dark);
  }, [article.images, dark, onReadingMinutes]);

  return (
    <div ref={attachRoot}>
      {root && createPortal(
        <>
          <style>{`
            :where(.markdown-body, .markdown-body *) { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
            :where(.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6) { font: inherit; }
            :where(.markdown-body img) { display: block; max-width: 100%; height: auto; }
            :where(.markdown-body ol) { list-style: decimal; padding-inline-start: 1.75rem; }
            :where(.markdown-body ul) { list-style: disc; padding-inline-start: 1.75rem; }
            :where(.markdown-body .contains-task-list, .markdown-body .task-list-item) { list-style: none; }
            :where(.markdown-body .contains-task-list) { padding-inline-start: 0; }
            :where(.markdown-body table) { border-collapse: collapse; }
            ${embeddedArticleStyles(theme, dark)}
          `}</style>
          <div onErrorCapture={onImageError} style={{ padding: 16 }}>
            <MarkdownRenderer markdown={article.body} plugins={plugins} />
          </div>
        </>,
        root,
      )}
    </div>
  );
}
