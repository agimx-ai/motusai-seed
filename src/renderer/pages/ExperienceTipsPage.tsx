import { toast } from '@motus-ai/seed-sdk';
import { ActionButton, SegmentedControl, StatusBadge } from '@motus-ai/seed-sdk/react';
import { Clock, Eye, MoreHorizontal, Pencil, Pin, ThumbsUp, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { experienceTipSearchLimit, type ExperienceTipActivityTab, type ExperienceTipArticle, type ExperienceTipCounts, type ExperienceTipRead, type ExperienceTipRemoval, type ExperienceTipSort, type ExperienceTipSummary } from '../../shared/experience-tips';
import { NavigationCount } from '../components/NavigationCount';
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
  const List = ranked ? 'ol' : 'ul';
  return (
    <LoadingSkeleton label={label}>
      <List className="experience-list">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index}>
            {mine ? (
              <div className="experience-row">
                <div className="experience-row-main">
                  <strong><span className="inline-block h-3.5 w-44 max-w-full rounded bg-border align-middle" /></strong>
                  <small><span className="inline-block h-2.5 w-24 max-w-full rounded bg-border/70 align-middle" /></small>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusBadge className="w-16">&nbsp;</StatusBadge>
                  <span className="grid size-7 place-items-center">
                    <span className="size-3.5 rounded bg-border/70" />
                  </span>
                </div>
              </div>
            ) : (
              <div className="experience-row experience-article-row">
                {ranked && <span className="experience-rank"><span className="mx-auto block h-4 w-3 rounded bg-border/70" /></span>}
                <div className="experience-row-main experience-article-row-main">
                  <span className={`h-3.5 max-w-full self-center rounded bg-border ${index % 2 ? 'w-32' : 'w-44'}`} />
                  <span className="h-3 w-4/5 self-center rounded bg-border/70" />
                  <span className="experience-meta">
                    <span className="h-2.5 w-12 rounded bg-border/70" />
                    <span className="h-2.5 w-7 rounded bg-border/70" />
                    <span className="h-2.5 w-7 rounded bg-border/70" />
                    <span className="h-2.5 w-16 rounded bg-border/70" />
                  </span>
                </div>
                <span className="experience-cover aspect-[3/2] rounded-md bg-border/70" />
              </div>
            )}
          </li>
        ))}
      </List>
    </LoadingSkeleton>
  );
}

type SubmissionRemoval = ExperienceTipRemoval & { title: string; unlisted: boolean };

function SubmissionDate({ item, locale }: { item: ExperienceTipSummary; locale: string }) {
  const { t } = useTranslation();
  const published = item.state === 'published' && item.removal_action !== null ? item.published_at : null;
  const date = item.unlisted?.at ?? published ?? item.submitted_at;
  if (!date) return null;

  const label = item.unlisted ? 'unlisted' : published ? 'published' : 'submitted';
  const formatted = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
  return (
    <small>
      {t(`experienceTips.submissionDate.${label}`)}{' '}
      <time dateTime={date}>{formatted}</time>
    </small>
  );
}

function SubmissionStatus({ item }: { item: ExperienceTipSummary }) {
  const { t } = useTranslation();
  if (item.unlisted) return <StatusBadge>{t('experienceTips.unlisted.status')}</StatusBadge>;
  if (item.state === 'pending') {
    const state = item.ai_review_status === 'running' ? 'reviewing'
      : item.ai_review_status === 'failed' || item.ai_review_status === 'needs_review' ? 'awaitingManualReview'
      : 'pending';
    return <StatusBadge tone="info">{t(`experienceTips.state.${state}`)}</StatusBadge>;
  }

  const state = item.state === 'published' && item.removal_action === null ? 'superseded' : item.state;
  const tone = state === 'returned' ? 'warning' : state === 'published' ? 'success' : 'neutral';
  return <StatusBadge tone={tone}>{t(`experienceTips.state.${state}`)}</StatusBadge>;
}

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
  const edit = item.state === 'returned' && !item.unlisted;
  const closeMenu = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
  };
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
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = items.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {edit && (
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-start text-[12px] text-foreground hover:bg-muted"
            onClick={() => {
              closeMenu();
              void window.motusSeed.openExperienceTipSource({ tipId: item.tip_id, reviewNotes: item.review_notes ?? [] })
                .catch(() => toast.error(t('experienceTips.openSourceFailed')));
            }}
          >
            <Pencil size={14} aria-hidden="true" />
            {t('experienceTips.editSource')}
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-start text-[12px] text-danger hover:bg-danger-soft"
          onClick={() => {
            closeMenu();
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

function ArticlePage({ id, title, dark, onCountsChange }: {
  id: string;
  title?: string;
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
        <article className="experience-article seed-selectable-text">
          <header className="experience-article-header">
            <h1 ref={heading} tabIndex={-1} className="experience-article-title">{article.title}</h1>
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
            <div className="experience-article-title">
              <span className={`rounded bg-border text-transparent [box-decoration-break:clone]${title ? '' : ' inline-block w-3/5'}`}>
                {title || '\u00a0'}
              </span>
            </div>
            <div className="experience-meta experience-article-byline min-h-6">
              <span className="h-3 w-16 rounded bg-border/70" />
              <span className="h-3 w-24 rounded bg-border/70" />
              <span className="h-3 w-8 rounded bg-border/70" />
              <span className="h-3 w-8 rounded bg-border/70" />
              <span className="h-3 w-20 rounded bg-border/70" />
            </div>
          </div>
          <div className="experience-article-body space-y-6">
            <div className="space-y-3">
              <span className="block h-3.5 w-full rounded bg-border/70" />
              <span className="block h-3.5 w-11/12 rounded bg-border/70" />
              <span className="block h-3.5 w-3/5 rounded bg-border/70" />
            </div>
            <div className="space-y-3">
              <span className="block h-3.5 w-full rounded bg-border/70" />
              <span className="block h-3.5 w-4/5 rounded bg-border/70" />
            </div>
          </div>
        </LoadingSkeleton>
      )}
      {error && <p className="experience-message" role="alert">{t('experienceTips.articleLoadFailed')}</p>}
      {imageFailed && <p className="experience-message" role="status">{t('experienceTips.imageFailed')}</p>}
      {(error || imageFailed) && retryButton}
    </>
  );
}

export function ExperienceTipsPage({ actionsContainer, onArticleChange, dark, counts, onRefreshCounts, onViewActivity }: {
  actionsContainer: HTMLDivElement | null;
  dark: boolean;
  counts?: ExperienceTipCounts;
  onRefreshCounts: () => void;
  onViewActivity: (tab: ExperienceTipActivityTab) => void;
  onArticleChange: (article: { onBack: () => void } | undefined) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const [kind, setKind] = useState<ExperienceTipActivityTab>('articles');
  const [sort, setSort] = useState<ExperienceTipSort>('latest');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [composingSearch, setComposingSearch] = useState(false);
  const [articleId, setArticleId] = useState<string>();
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
  const loadedPages = useRef(1);
  const viewedActivity = useRef<ExperienceTipActivityTab>(undefined);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement>(null);
  const mine = kind === 'my-submissions';
  const ranked = !mine && sort === 'popular';
  const List = ranked ? 'ol' : 'ul';
  const showListState = !articleId && !items.length && !loading;
  const listErrorTitle = t(mine ? 'experienceTips.submissionsLoadFailed' : 'experienceTips.loadFailed');
  const refreshLabel = t(error ? 'experienceTips.retry' : 'experienceTips.refresh');
  const searchLabel = t(mine ? 'experienceTips.searchSubmissions' : 'experienceTips.searchArticles');
  const tabCount = (count?: number) => !count ? undefined : (
    <NavigationCount notification>{new Intl.NumberFormat(locale).format(count)}</NavigationCount>
  );

  useEffect(() => {
    if (articleId || query) {
      viewedActivity.current = undefined;
      return;
    }
    if (!counts || loading || error) return;
    const unread = kind === 'articles' ? counts.articles : counts.my_submissions;
    if (viewedActivity.current === kind && !unread) return;
    viewedActivity.current = kind;
    onViewActivity(kind);
  }, [articleId, query, kind, counts, loading, error, onViewActivity]);

  useLayoutEffect(() => {
    if (!articleId) return;
    onArticleChange({
      onBack: () => {
        setArticleId(undefined);
        requestAnimationFrame(() => {
          if (openButton.current?.isConnected) openButton.current.focus();
          else section.current?.focus({ preventScroll: true });
        });
      },
    });
    return () => onArticleChange(undefined);
  }, [articleId, onArticleChange]);

  async function load(before: string | null, pages = 1) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(false);
    try {
      const refreshed: ExperienceTipSummary[] = [];
      let nextCursor = before;
      let fetchedPages = 0;
      do {
        const filters = { ...(nextCursor ? { before: nextCursor } : {}), ...(query ? { query } : {}) };
        const page = await readExperienceTips(
          kind === 'articles' ? { kind, sort, ...filters } : { kind, ...filters },
          controller.signal,
          !items.length,
        );
        if (controller.signal.aborted) return;
        if (!('items' in page)) throw new Error('The list is unavailable.');
        refreshed.push(...page.items);
        nextCursor = page.next_cursor;
        fetchedPages++;
      } while (nextCursor && fetchedPages < pages);
      setItems((current) => before
        ? [...current, ...refreshed.filter((item) => !current.some(({ id }) => id === item.id))]
        : refreshed);
      loadedPages.current = before ? loadedPages.current + fetchedPages : fetchedPages;
      setCursor(ranked ? null : nextCursor);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const refreshList = useEffectEvent((eventType: 'experience.articles.changed' | 'experience.review.changed') => {
    if (mine === (eventType === 'experience.review.changed')) void load(null, mine ? loadedPages.current : 1);
  });

  useEffect(() => window.motusSeed.subscribe((event) => {
    if (event.type === 'experience.articles.changed' || event.type === 'experience.review.changed')
      refreshList(event.type);
  }), []);

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
    loadedPages.current = 1;
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
      onRefreshCounts();
      if (!section.current) return;
      setItems((current) => current.filter((item) => request.action === 'delete-tip'
        ? item.tip_id !== request.tipId
        : item.id !== request.versionId));
      setRemoval(undefined);
      toast.success(t(`experienceTips.removal.${request.action}.success`));
      requestAnimationFrame(() => section.current?.focus({ preventScroll: true }));
      void load(null, loadedPages.current);
    } catch (reason) {
      setRemovalError(userFacingErrorMessage(reason));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section ref={section} tabIndex={-1} className={`mx-auto flex min-h-full max-w-[54rem] flex-col text-foreground ${articleId ? 'pt-4' : ''} ${showListState ? '' : 'pb-8'}`} aria-label={t('nav.experience-tips')}>
      {actionsContainer && !articleId && createPortal(
        <HeaderRefreshButton label={refreshLabel} refreshing={loading} onClick={() => {
          onRefreshCounts();
          void load(null);
        }} />,
        actionsContainer,
      )}
      {articleId && (
        <ArticlePage
          key={articleId}
          id={articleId}
          title={items.find((item) => item.tip_id === articleId)?.title}
          dark={dark}
          onCountsChange={updateCounts}
        />
      )}
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
                { value: 'articles', label: t('experienceTips.articles'), trailing: tabCount(counts?.articles) },
                { value: 'my-submissions', label: t('experienceTips.submissions'), trailing: tabCount(counts?.my_submissions) },
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
                    <SubmissionDate item={item} locale={locale} />
                    {item.review_notes?.length ? (
                      <blockquote className="experience-feedback border-s-2 border-border ps-3 text-muted-foreground">
                        <ol className="m-0 list-decimal space-y-1 ps-5">
                          {item.review_notes.map((note, index) => <li key={index}>{note}</li>)}
                        </ol>
                      </blockquote>
                    ) : null}
                    {item.unlisted && (
                      <p className="experience-feedback text-muted-foreground">
                        {t('experienceTips.unlisted.reason', { reason: item.unlisted.reason })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <SubmissionStatus item={item} />
                    {item.removal_action && (
                      <SubmissionActions item={item} action={item.removal_action} onSelect={(request) => {
                        setRemovalError('');
                        setRemoval(request);
                      }} />
                    )}
                  </div>
                </div>
              ) : (
                <button type="button" className="experience-row experience-article-row" onClick={(event) => {
                  openButton.current = event.currentTarget;
                  setArticleId(item.tip_id);
                }}>
                  {ranked && (
                    <span className="experience-rank font-bold" data-place={index < 3 ? index + 1 : undefined}>
                      {index + 1}
                    </span>
                  )}
                  <div className="experience-row-main experience-article-row-main">
                    <div className="flex min-w-0 items-center gap-2">
                      {!ranked && item.pinned && (
                        <StatusBadge tone="info" className="h-5! gap-1 px-1.5!">
                          <Pin size={11} aria-hidden="true" />
                          {t('experienceTips.pinned')}
                        </StatusBadge>
                      )}
                      <strong className="truncate">{item.title}</strong>
                    </div>
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
