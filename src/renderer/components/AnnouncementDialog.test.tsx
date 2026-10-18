// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementDialog } from './AnnouncementDialog';
import type { SeedAnnouncement } from '../../shared/announcements';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const id = '550e8400-e29b-41d4-a716-446655440001';
const announcement: SeedAnnouncement = {
  id,
  template: 'immersive',
  title: { 'zh-CN': '把声音，变成文字。', 'en-US': 'Turn sound into words.' },
  description: { 'zh-CN': '录音结束，直接获得转写结果。', 'en-US': 'Get a transcript when recording ends.' },
  button_label: { 'zh-CN': '了解更多', 'en-US': 'Learn more' },
  dismiss_label: { 'zh-CN': '知道了', 'en-US': 'Got it' },
  background_url: 'https://cloud.example/image.png',
  action: { kind: 'url', url: 'https://example.com' },
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'motusSeed', {
    configurable: true,
    value: {
      announcementBackground: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
      dismissAnnouncement: vi.fn().mockResolvedValue(undefined),
      activateAnnouncement: vi.fn().mockResolvedValue(undefined),
    },
  });
});
afterEach(cleanup);
describe('fixed announcement template', () => {
  it.each(['immersive', 'image-above'] as const)('renders %s using the shared action buttons', async (template) => {
    render(<AnnouncementDialog announcements={[{ ...announcement, template }]} locale="zh-CN" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    expect(document.querySelector('dialog')?.dataset.template).toBe(template);
    expect(screen.getByRole('button', { name: '了解更多' }).className).toContain('seed-action-button');
    expect(screen.getByRole('button', { name: '知道了' }).className).toContain('seed-action-button');
    const brand = screen.getByText('MotusAI Seed');
    expect(brand.closest('header')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    await waitFor(() => expect(window.motusSeed.dismissAnnouncement).toHaveBeenCalledWith(id));
  });
  it('renders locale-specific real text and independent background, activates by ID only', async () => {
    render(<AnnouncementDialog announcements={[announcement]} locale="zh-CN" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    expect(screen.getByText('把声音，变成文字。')).toBeTruthy();
    expect(document.querySelector('img[src^="data:"]')).toBeTruthy();
    fireEvent.click(screen.getByText('了解更多'));
    await waitFor(() => expect(window.motusSeed.activateAnnouncement).toHaveBeenCalledWith(id));
    expect(window.motusSeed.dismissAnnouncement).not.toHaveBeenCalled();
  });
  it('marks read on Escape and close, without accepting native automatic closure before persistence', async () => {
    render(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    const event = new Event('cancel', { cancelable: true });
    fireEvent(document.querySelector('dialog')!, event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(window.motusSeed.dismissAnnouncement).toHaveBeenCalledWith(id));
  });
  it('waits for another modal to close instead of stealing its focus', async () => {
    const other = document.createElement('dialog');
    other.showModal();
    document.body.append(other);
    render(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await act(async () => {});
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    other.remove();
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
  });
  it('keeps a failed action visible and offers retry instead of silently marking read', async () => {
    vi.mocked(window.motusSeed.activateAnnouncement).mockRejectedValueOnce(new Error('failed'));
    render(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    fireEvent.click(screen.getByText('Learn more'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(window.motusSeed.dismissAnnouncement).not.toHaveBeenCalled();
  });
});

describe('announcement navigation', () => {
  const second: SeedAnnouncement = {
    ...announcement,
    id: '550e8400-e29b-41d4-a716-446655440002',
    template: 'image-above',
    title: { 'zh-CN': '第二条介绍', 'en-US': 'Second announcement' },
  };
  const previous = () => screen.getByRole('button', { name: 'announcements.previous' }) as HTMLButtonElement;
  const next = () => screen.getByRole('button', { name: 'announcements.next' }) as HTMLButtonElement;

  it('hides navigation for a single announcement and renders nothing for an empty list', async () => {
    const view = render(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    expect(screen.queryByRole('group', { name: 'announcements.navigation' })).toBeNull();
    view.rerender(<AnnouncementDialog announcements={[]} locale="en-US" />);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('switches both templates in the same open dialog without marking either as read', async () => {
    render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    const dialog = document.querySelector('dialog')!;
    expect(screen.getByRole('status').textContent).toBe('1 / 2');
    expect(previous().disabled).toBe(true);
    fireEvent.click(next());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Second announcement'));
    expect(document.querySelector('dialog')).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(dialog.dataset.template).toBe('image-above');
    expect(screen.getByRole('status').textContent).toBe('2 / 2');
    expect(next().disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    await waitFor(() => expect(dialog.dataset.template).toBe('immersive'));
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toBe('1 / 2');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 / 2'));
    expect(window.motusSeed.dismissAnnouncement).not.toHaveBeenCalled();
    expect(window.motusSeed.activateAnnouncement).not.toHaveBeenCalled();
  });

  it('keeps the selected ID across updates and selects the adjacent remaining item after removal', async () => {
    const view = render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    fireEvent.click(next());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 / 2'));
    const added = { ...announcement, id: '550e8400-e29b-41d4-a716-446655440003' };
    view.rerender(<AnnouncementDialog announcements={[added, announcement, second]} locale="en-US" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Second announcement');
    expect(screen.getByRole('status').textContent).toBe('3 / 3');
    fireEvent.click(screen.getByText('Got it'));
    await waitFor(() => expect(window.motusSeed.dismissAnnouncement).toHaveBeenCalledWith(second.id));
    view.rerender(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Turn sound into words.'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('blocks navigation during an action and invokes only the currently selected ID', async () => {
    let resolve!: () => void;
    vi.mocked(window.motusSeed.activateAnnouncement).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    fireEvent.click(next());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 / 2'));
    fireEvent.click(screen.getByText('Learn more'));
    expect(previous().disabled).toBe(true);
    fireEvent.keyDown(document.querySelector('dialog')!, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toBe('2 / 2');
    expect(window.motusSeed.activateAnnouncement).toHaveBeenCalledWith(second.id);
    await act(async () => resolve());
    fireEvent.click(previous());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 / 2'));
  });

  it('preloads neighbours, keeps the complete current card until decoding finishes, and reuses cached images', async () => {
    let resolve!: (url: string) => void;
    vi.mocked(window.motusSeed.announcementBackground)
      .mockResolvedValueOnce('data:image/png;base64,FIRST')
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
    render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('FIRST');
    expect(window.motusSeed.announcementBackground).toHaveBeenCalledWith(second.id);
    fireEvent.click(next());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Turn sound into words.');
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('FIRST');
    expect(screen.getByRole('status').textContent).toBe('1 / 2');
    let decoded!: () => void;
    vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          decoded = done;
        }),
    );
    await act(async () => resolve('data:image/png;base64,SECOND'));
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('FIRST');
    await act(async () => decoded());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Second announcement');
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('SECOND');
    fireEvent.click(previous());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 / 2'));
    expect(window.motusSeed.announcementBackground).toHaveBeenCalledTimes(2);
    expect(window.motusSeed.dismissAnnouncement).not.toHaveBeenCalled();
  });

  it('keeps the existing background while a replacement loads and invalidates the old cache by URL', async () => {
    let resolve!: (url: string) => void;
    vi.mocked(window.motusSeed.announcementBackground)
      .mockResolvedValueOnce('data:image/png;base64,ORIGINAL')
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
    const view = render(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    const replacement = { ...announcement, background_url: 'https://cloud.example/replaced.png' };
    view.rerender(<AnnouncementDialog announcements={[replacement]} locale="en-US" />);
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('ORIGINAL');
    await act(async () => resolve('data:image/png;base64,REPLACEMENT'));
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('REPLACEMENT');
    expect(window.motusSeed.announcementBackground).toHaveBeenCalledTimes(2);
  });

  it('allows retry after a failed preload instead of caching the failure', async () => {
    vi.mocked(window.motusSeed.announcementBackground)
      .mockResolvedValueOnce('data:image/png;base64,FIRST')
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('data:image/png;base64,SECOND');
    render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    await act(async () => {});
    fireEvent.click(next());
    const retry = await screen.findByRole('button', { name: 'announcements.retryImage' });
    fireEvent.click(retry);
    await waitFor(() => expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('SECOND'));
    expect(screen.queryByRole('button', { name: 'announcements.retryImage' })).toBeNull();
  });

  it('ignores a late image response after the requested announcement is removed', async () => {
    let resolve!: (url: string) => void;
    vi.mocked(window.motusSeed.announcementBackground)
      .mockResolvedValueOnce('data:image/png;base64,FIRST')
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
    const view = render(<AnnouncementDialog announcements={[announcement, second]} locale="en-US" />);
    await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(true));
    fireEvent.click(next());
    view.rerender(<AnnouncementDialog announcements={[announcement]} locale="en-US" />);
    await act(async () => resolve('data:image/png;base64,REMOVED'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Turn sound into words.');
    expect(document.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toContain('FIRST');
    expect(window.motusSeed.dismissAnnouncement).not.toHaveBeenCalled();
  });
});
