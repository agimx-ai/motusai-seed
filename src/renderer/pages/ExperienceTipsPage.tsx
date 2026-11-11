import { toast } from '@motus-ai/seed-sdk';
import { ActionButton, SegmentedControl } from '@motus-ai/seed-sdk/react';
import { Clock, Eye, MoreHorizontal, ThumbsUp, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { experienceTipSearchLimit, type ExperienceTipArticle, type ExperienceTipRead, type ExperienceTipRemoval, type ExperienceTipSort, type ExperienceTipSummary } from '../../shared/experience-tips';
import { ExperienceMarkdown } from './ExperienceMarkdown';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HeaderActionButton, HeaderRefreshButton } from '../components/HeaderActionButton';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PageEmptyState } from '../components/PageEmptyState';
import { SearchInput } from '../components/SearchInput';
import { useSeedI18n } from '../i18n';
import { userFacingErrorMessage } from '../lib/errors';
import './ExperienceTipsPage.css';

const minimumSkeletonDurationMs = 250;

async function readExperienceTips(request: ExperienceTipRead, signal: AbortSignal, showSkeleton: boolean) {
  if (!showSkeleton) return window.motusSeed.readExperienceTips(request);

  const minimumDuration = new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, minimumSkeletonDurationMs);
    signal.addEventListener('abort', finish, { once: true });
  });
  try {
    return await window.motusSeed.readExperienceTips(request);
  } finally {
    await minimumDuration;
  }
}

const formatDate = (date: string | null, language: string) => date
  ? new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(date))
  : '';

function TipCover({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="experience-cover rounded-md border border-border"
      onError={() => setFailed(true)}
    />
  );
}

function TipViewCount({ count, compact = false }: { count: number; compact?: boolean }) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const formatted = new Intl.NumberFormat(locale, { notation: compact ? 'compact' : 'standard' }).format(count);
  return (
    <span className="experience-metric">
      <Eye size={14} aria-hidden="true" />
      <span aria-hidden="true">{formatted}</span>
      <span className="sr-only">{t('experienceTips.viewCount', { count })}</span>
    </span>
  );
}

function TipMetadata({ item }: { item: ExperienceTipSummary }) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const compact = new Intl.NumberFormat(locale, { notation: 'compact' });
  return (
    <small className="experience-meta">
      <span>{item.author}</span>
      {item.view_count !== undefined && <TipViewCount count={item.view_count} compact />}
      {item.like_count !== undefined && (
        <span className="experience-metric">
          <ThumbsUp size={14} aria-hidden="true" />
          <span aria-hidden="true">{compact.format(item.like_count)}</span>
          <span className="sr-only">{t('experienceTips.likeCount', { count: item.like_count })}</span>
        </span>
      )}
      {item.published_at && <time dateTime={item.published_at}>{formatDate(item.published_at, locale)}</time>}
    </small>
  );
}

function TipListSkeleton({ label, mine, ranked }: { label: string; mine: boolean; ranked: boolean }) {
  return (
    <LoadingSkeleton label={label}>
      <ul className="experience-list">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="experience-row">
            {ranked && <span className="experience-rank"><span className="mx-auto block h-4 w-3 rounded bg-border/70" /></span>}
            <div className="experience-row-main me-auto w-3/5">
              <span className={`my-0.5 block h-3.5 max-w-full rounded bg-border ${index % 2 ? 'w-32' : 'w-44'}`} />
              <span className="my-1 block h-2.5 w-24 max-w-full rounded bg-border/70" />
            </div>
            {mine && <span className="block h-6 w-16 rounded-full bg-border/70" />}
          </li>
        ))}
      </ul>
    </LoadingSkeleton>
  );
}

type SubmissionRemoval = ExperienceTipRemoval & { title: string; unlisted: boolean };

function SubmissionActions({ item, action, onSelect }: {
  item: ExperienceTipSummary;
  action: ExperienceTipRemoval['action'];
  onSelect: (removal: SubmissionRemoval) => void;
}) {
  const { t } = useTranslation();
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const Icon = action === 'withdraw' ? Undo2 : Trash2;
  return (
    <>
      <HeaderActionButton
        ref={trigger}
        compact
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label={t('experienceTips.removal.moreActions', { title: item.title })}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </HeaderActionButton>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        role="menu"
        className="experience-submission-menu w-max rounded-[12px] border border-border bg-card p-1.5 shadow-[var(--overlay-shadow)]"
        onToggle={(event) => {
          if (event.currentTarget.matches(':popover-open')) event.currentTarget.querySelector('button')?.focus();
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-start text-[12px] text-danger hover:bg-danger-soft"
          onClick={() => {
            menu.current?.hidePopover();
            trigger.current?.focus();
            onSelect({ tipId: item.tip_id, versionId: item.id, title: item.title, action, unlisted: Boolean(item.unlisted) });
          }}
        >
          <Icon size={14} aria-hidden="true" />
          {t(item.unlisted ? 'experienceTips.unlisted.delete' : `experienceTips.removal.${action}.label`)}
        </button>
      </div>
    </>
  );
}

type TipCounts = Pick<ExperienceTipSummary, 'view_count' | 'like_count'>;

function ArticlePage({ id, dark, onCountsChange }: {
  id: string;
  dark: boolean;
  onCountsChange: (id: string, counts: TipCounts) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const [article, setArticle] = useState<ExperienceTipArticle>();
  const [readingMinutes, setReadingMinutes] = useState(0);
  const [error, setError] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [liking, setLiking] = useState(false);
  const [likeFailed, setLikeFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setImageFailed(false);
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      try {
        const value = await readExperienceTips({ kind: 'article', tipId: id }, controller.signal, !article);
        if (!('body' in value)) throw new Error('The article is unavailable.');
        if (!controller.signal.aborted) {
          setArticle(value);
          onCountsChange(id, value);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    });
    return () => controller.abort();
  }, [id, onCountsChange, retry]);
  const articleLoaded = Boolean(article);
  useEffect(() => { if (articleLoaded) heading.current?.focus(); }, [articleLoaded]);

  async function toggleLike() {
    if (liking || article?.liked === undefined) return;
    setLiking(true);
    setLikeFailed(false);
    try {
      const stats = await window.motusSeed.setExperienceTipLike({ tipId: id, liked: !article.liked });
      setArticle((current) => current && { ...current, ...stats });
      onCountsChange(id, stats);
    } catch {
      setLikeFailed(true);
    } finally {
      setLiking(false);
    }
  }

  const retryButton = <ActionButton type="button" disabled={liking} onClick={() => setRetry((value) => value + 1)}>{t('experienceTips.retry')}</ActionButton>;
  if (error && !article) return <PageEmptyState role="alert" title={t('experienceTips.articleLoadFailed')} action={retryButton} />;

  return (
    <>
      {article ? (
        <article className="experience-article">
          <header className="experience-article-header">
            <h1 ref={heading} tabIndex={-1} className="font-bold">{article.title}</h1>
            <div className="experience-meta experience-article-byline">
              <span>{article.author}</span>
              {article.published_at && <time dateTime={article.published_at}>{formatDate(article.published_at, locale)}</time>}
              {article.view_count !== undefined && <TipViewCount count={article.view_count} />}
              {article.liked !== undefined && (
                <button
                  type="button"
                  className="experience-metric experience-like"
                  aria-pressed={article.liked}
                  aria-disabled={liking || undefined}
                  onClick={() => void toggleLike()}
                >
                  <ThumbsUp size={14} aria-hidden="true" />
                  <span className="sr-only">{t('experienceTips.like')}</span>
                  {article.like_count !== undefined && (
                    <>
                      <span aria-hidden="true">{new Intl.NumberFormat(locale).format(article.like_count)}</span>
                      <span className="sr-only">{t('experienceTips.likeCount', { count: article.like_count })}</span>
                    </>
                  )}
                </button>
              )}
              {readingMinutes > 0 && (
                <span className="experience-metric">
                  <Clock size={14} aria-hidden="true" />
                  {t('experienceTips.readingTime', { count: readingMinutes })}
                </span>
              )}
            </div>
            {likeFailed && <p className="experience-message" role="alert">{t('experienceTips.likeFailed')}</p>}
          </header>
          <ExperienceMarkdown article={article} dark={dark} onReadingMinutes={setReadingMinutes} onImageError={() => setImageFailed(true)} />
        </article>
      ) : (
        <LoadingSkeleton label={t('experienceTips.loading')} contentClassName="experience-article">
          <div className="experience-article-header">
            <span className="mb-4 block h-8 w-1/2 rounded bg-border" />
            <span className="block h-3 w-28 rounded bg-border/70" />
          </div>
          <div className="space-y-3">
            <span className="block h-3.5 w-full rounded bg-border/70" />
            <span className="block h-3.5 w-11/12 rounded bg-border/70" />
            <span className="block h-3.5 w-3/5 rounded bg-border/70" />
          </div>
        </LoadingSkeleton>
      )}
      {error && <p className="experience-message" role="alert">{t('experienceTips.articleLoadFailed')}</p>}
      {imageFailed && <p className="experience-message" role="status">{t('experienceTips.imageFailed')}</p>}
      {(error || imageFailed) && retryButton}
    </>
  );
}

export function ExperienceTipsPage({ actionsContainer, onArticleChange, dark }: {
  actionsContainer: HTMLDivElement | null;
  dark: boolean;
  onArticleChange: (article: { title: string; onBack: () => void } | undefined) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const [kind, setKind] = useState<'articles' | 'my-submissions'>('articles');
  const [sort, setSort] = useState<ExperienceTipSort>('latest');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [composingSearch, setComposingSearch] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<ExperienceTipSummary>();
  const articleId = selectedArticle?.tip_id;
  const [items, setItems] = useState<ExperienceTipSummary[]>([]);
  const updateCounts = useCallback((tipId: string, { view_count, like_count }: TipCounts) => {
    if (view_count === undefined && like_count === undefined) return;
    setItems((current) => current.map((item) => item.tip_id === tipId ? { ...item, view_count, like_count } : item));
  }, []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [removal, setRemoval] = useState<SubmissionRemoval>();
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState('');
  const active = useRef<AbortController | null>(null);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement>(null);
  const mine = kind === 'my-submissions';
  const ranked = !mine && sort === 'popular';
  const List = ranked ? 'ol' : 'ul';
  const showListState = !articleId && !items.length && !loading;
  const listErrorTitle = t(mine ? 'experienceTips.submissionsLoadFailed' : 'experienceTips.loadFailed');
  const refreshLabel = t(error ? 'experienceTips.retry' : 'experienceTips.refresh');
  const searchLabel = t(mine ? 'experienceTips.searchSubmissions' : 'experienceTips.searchArticles');

  useLayoutEffect(() => {
    if (!selectedArticle) return;
    onArticleChange({
      title: selectedArticle.title,
      onBack: () => {
        setSelectedArticle(undefined);
        requestAnimationFrame(() => openButton.current?.focus());
      },
    });
    return () => onArticleChange(undefined);
  }, [selectedArticle, onArticleChange]);

  async function load(before: string | null) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(false);
    try {
      const filters = { ...(before ? { before } : {}), ...(query ? { query } : {}) };
      const page = await readExperienceTips(
        kind === 'articles' ? { kind, sort, ...filters } : { kind, ...filters },
        controller.signal,
        !items.length,
      );
      if (!('items' in page)) throw new Error('The list is unavailable.');
      if (controller.signal.aborted) return;
      setItems((current) => before
        ? [...current, ...page.items.filter((item) => !current.some(({ id }) => id === item.id))]
        : page.items);
      setCursor(ranked ? null : page.next_cursor);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    return () => active.current?.abort();
  }, [kind, sort, query]);

  useEffect(() => {
    const nextQuery = searchInput.trim();
    if (composingSearch || nextQuery === query) return;
    const timer = window.setTimeout(() => {
      resetList();
      setQuery(nextQuery);
    }, nextQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [composingSearch, searchInput, query]);

  function resetList() {
    active.current?.abort();
    setItems([]);
    setCursor(null);
    setError(false);
    setLoading(true);
  }

  function selectList(nextKind: typeof kind) {
    if (kind === nextKind) return;
    resetList();
    setKind(nextKind);
  }

  function selectSort(nextSort: ExperienceTipSort) {
    if (sort === nextSort) return;
    resetList();
    setSort(nextSort);
  }

  async function confirmRemoval() {
    if (!removal || removing) return;
    setRemoving(true);
    setRemovalError('');
    try {
      const { tipId, versionId, action } = removal;
      const request = { tipId, versionId, action };
      await window.motusSeed.removeExperienceTip(request);
      if (!section.current) return;
      setItems((current) => current.filter((item) => request.action === 'delete-tip'
        ? item.tip_id !== request.tipId
        : item.id !== request.versionId));
      setRemoval(undefined);
      toast.success(t(`experienceTips.removal.${request.action}.success`));
      requestAnimationFrame(() => section.current?.focus({ preventScroll: true }));
      void load(null);
    } catch (reason) {
      setRemovalError(userFacingErrorMessage(reason));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section ref={section} tabIndex={-1} className={`mx-auto flex min-h-full max-w-[54rem] flex-col text-foreground ${articleId ? 'pt-4' : ''} ${showListState ? '' : 'pb-8'}`} aria-label={t('nav.experience-tips')}>
      {actionsContainer && !articleId && createPortal(
        <HeaderRefreshButton label={refreshLabel} refreshing={loading} onClick={() => void load(null)} />,
        actionsContainer,
      )}
      {articleId && <ArticlePage key={articleId} id={articleId} dark={dark} onCountsChange={updateCounts} />}
      <div hidden={Boolean(articleId)} className={showListState ? 'flex flex-1 flex-col' : undefined}>
        <div className="sticky top-0 z-20 shrink-0 bg-background pt-4">
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <SearchInput
              className="min-w-[min(100%,280px)] flex-1"
              clearLabel={t('common.clearSearch')}
              label={searchLabel}
              maxLength={experienceTipSearchLimit}
              onCompositionStart={() => setComposingSearch(true)}
              onCompositionEnd={(event) => {
                setSearchInput(event.currentTarget.value);
                setComposingSearch(false);
              }}
              onValueChange={setSearchInput}
              placeholder={searchLabel}
              value={searchInput}
            />
            <SegmentedControl
              className="h-[34px] [&]:rounded-full [&>button]:h-7 [&>button]:rounded-full"
              label={t('nav.experience-tips')}
              value={kind}
              options={[
                { value: 'articles', label: t('experienceTips.articles') },
                { value: 'my-submissions', label: t('experienceTips.submissions') },
              ]}
              onValueChange={selectList}
            />
          </div>
          {!mine && (
            <div className="flex pb-3">
              <SegmentedControl
                label={t('experienceTips.sort.label')}
                value={sort}
                options={[
                  { value: 'latest', label: t('experienceTips.sort.latest') },
                  { value: 'popular', label: t('experienceTips.sort.popular') },
                ]}
                onValueChange={selectSort}
              />
            </div>
          )}
        </div>
        {items.length > 0 && <List className="experience-list" aria-busy={loading}>
          {items.map((item, index) => (
            <li key={item.id}>
              {mine ? (
                <div className="experience-row">
                  <div className="experience-row-main">
                    <strong>{item.title}</strong>
                    <small>{formatDate(item.submitted_at, locale)}</small>
                    {item.review_note && (
                      <blockquote className="experience-feedback border-s-2 border-border ps-3 text-muted-foreground">
                        {item.review_note}
                      </blockquote>
                    )}
                    {item.unlisted && (
                      <>
                        <small>{t('experienceTips.unlisted.date', { date: formatDate(item.unlisted.at, locale) })}</small>
                        <p className="experience-feedback text-muted-foreground">
                          {t('experienceTips.unlisted.reason', { reason: item.unlisted.reason })}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="experience-status" data-state={item.unlisted ? 'unlisted' : item.state}>
                      {t(item.unlisted ? 'experienceTips.unlisted.status' : `experienceTips.state.${item.state === 'published' && item.removal_action === null ? 'superseded' : item.state}`)}
                    </span>
                    {item.removal_action && (
                      <SubmissionActions item={item} action={item.removal_action} onSelect={(request) => {
                        setRemovalError('');
                        setRemoval(request);
                      }} />
                    )}
                  </div>
                </div>
              ) : (
                <button type="button" className="experience-row" onClick={(event) => {
                  openButton.current = event.currentTarget;
                  setSelectedArticle(item);
                }}>
                  {ranked && (
                    <span className="experience-rank font-bold" data-place={index < 3 ? index + 1 : undefined}>
                      {index + 1}
                    </span>
                  )}
                  <div className="experience-row-main experience-article-row-main">
                    <strong className="truncate">{item.title}</strong>
                    <span className="experience-row-excerpt truncate text-[13px] text-muted-foreground">{item.excerpt}</span>
                    <TipMetadata item={item} />
                  </div>
                  <TipCover key={item.cover_url} url={item.cover_url} />
                </button>
              )}
            </li>
          ))}
        </List>}
        {loading && !items.length && <TipListSkeleton label={t('experienceTips.loading')} mine={mine} ranked={ranked} />}
        {error && items.length > 0 && (
          <p className="experience-message text-center" role="alert">{listErrorTitle}</p>
        )}
        {showListState && (error
          ? <PageEmptyState role="alert" title={listErrorTitle} description={t('experienceTips.refreshToRetry')} />
          : <PageEmptyState
              title={t(query ? 'experienceTips.noSearchResults' : mine ? 'experienceTips.noSubmissions' : 'experienceTips.noArticles')}
              description={t(query ? 'experienceTips.noSearchResultsDescription' : mine ? 'experienceTips.noSubmissionsDescription' : 'experienceTips.noArticlesDescription')}
            />
        )}
        {cursor && <div className="experience-controls">
          <ActionButton type="button" busy={loading} onClick={() => void load(cursor)}>{t('experienceTips.more')}</ActionButton>
        </div>}
      </div>
      {removal && (
        <ConfirmDialog
          open
          title={t(removal.unlisted ? 'experienceTips.unlisted.delete' : `experienceTips.removal.${removal.action}.label`)}
          description={t(removal.unlisted ? 'experienceTips.unlisted.deleteDescription' : `experienceTips.removal.${removal.action}.description`, { title: removal.title })}
          confirmLabel={t(removal.unlisted ? 'experienceTips.unlisted.delete' : `experienceTips.removal.${removal.action}.label`)}
          cancelLabel={t('common.cancel')}
          tone="danger"
          busy={removing}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => setRemoval(undefined)}
        >
          {removalError && <p role="alert" className="m-0 text-danger">{removalError}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
