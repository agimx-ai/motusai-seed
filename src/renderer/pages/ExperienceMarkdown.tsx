import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from '@motus-ai/seed-sdk';
import { ImagePreview } from '@motus-ai/seed-sdk/react';
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
  const { t } = useTranslation();
  const [root, setRoot] = useState<ShadowRoot>();
  const [preview, setPreview] = useState<{ articleId: string; src: string; alt: string }>();
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

        const approvedUrls = new Set(images.values());
        const previewable = new Set(Array.from(markdownBody.querySelectorAll('img')).filter((image) =>
          approvedUrls.has(image.getAttribute('src') ?? ''),
        ));
        const open = (event: MouseEvent | KeyboardEvent) => {
          const image = event.target;
          if (!(image instanceof HTMLImageElement) || !previewable.has(image)) return;
          if (event instanceof KeyboardEvent && (event.repeat || (event.key !== 'Enter' && event.key !== ' '))) return;
          if (image.complete && !image.naturalWidth) return;
          event.preventDefault();
          image.focus({ preventScroll: true });
          setPreview({ articleId: article.id, src: image.src, alt: image.alt });
        };
        for (const image of previewable) {
          image.tabIndex = 0;
          image.setAttribute('role', 'button');
          image.setAttribute('aria-haspopup', 'dialog');
          image.setAttribute('aria-label', image.alt
            ? t('experienceTips.imagePreview.openNamed', { name: image.alt })
            : t('experienceTips.imagePreview.open'));
        }
        markdownBody.addEventListener('click', open);
        markdownBody.addEventListener('keydown', open);
        return () => {
          markdownBody.removeEventListener('click', open);
          markdownBody.removeEventListener('keydown', open);
          for (const image of previewable) {
            image.removeAttribute('tabindex');
            image.removeAttribute('role');
            image.removeAttribute('aria-haspopup');
            image.removeAttribute('aria-label');
          }
        };
      },
    }, dark);
  }, [article.id, article.images, dark, onReadingMinutes, t]);
  const body = useMemo(() => <MarkdownRenderer markdown={article.body} plugins={plugins} />, [article.body, plugins]);

  return (
    <div ref={attachRoot} className="experience-article-body">
      {root && createPortal(
        <>
          <style>{`
            :where(.markdown-body, .markdown-body *) { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
            :where(.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6) { font: inherit; }
            :where(.markdown-body img) { display: block; max-width: 100%; height: auto; }
            .markdown-body img[role="button"] { cursor: zoom-in; }
            .markdown-body img[role="button"]:focus-visible { outline: 2px solid var(--color-info, Highlight); outline-offset: 3px; }
            :where(.markdown-body ol) { list-style: decimal; padding-inline-start: 1.75rem; }
            :where(.markdown-body ul) { list-style: disc; padding-inline-start: 1.75rem; }
            :where(.markdown-body .contains-task-list, .markdown-body .task-list-item) { list-style: none; }
            :where(.markdown-body .contains-task-list) { padding-inline-start: 0; }
            :where(.markdown-body table) { border-collapse: collapse; }
            ${embeddedArticleStyles(theme, dark)}
          `}</style>
          <div onErrorCapture={onImageError}>
            {body}
          </div>
        </>,
        root,
      )}
      {preview?.articleId === article.id && (
        <ImagePreview
          src={preview.src}
          alt={preview.alt}
          title={preview.alt || t('experienceTips.imagePreview.title')}
          labels={{
            close: t('experienceTips.imagePreview.close'),
            fit: t('experienceTips.imagePreview.fit'),
            zoom: t('experienceTips.imagePreview.zoom'),
            loadFailed: t('experienceTips.imagePreview.loadFailed'),
          }}
          onClose={() => setPreview(undefined)}
          download={{
            label: t('experienceTips.imagePreview.download'),
            onClick: () => {
              void window.motusSeed.downloadExperienceTipImage(preview.src).catch(() => {
                toast.error(t('experienceTips.imagePreview.downloadFailed'));
              });
            },
          }}
        />
      )}
    </div>
  );
}
