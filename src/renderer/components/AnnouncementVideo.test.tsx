// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementVideo } from './AnnouncementVideo';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('announcement video playback', () => {
  it('plays with original audio, pauses on demand and releases playback when unmounted', async () => {
    const view = render(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" />);
    const video = document.querySelector('video')!;
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
    expect(video.loop).toBe(false);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(document.querySelector('img')).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
    const hitArea = screen.getByRole('button', { name: 'announcements.playVideo' });
    const marker = hitArea.querySelector('span')!;
    expect(marker.className).toContain('size-14!');
    expect(marker.className).toContain('bg-card/65');
    fireEvent.click(hitArea);
    const pauseArea = await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    expect(pauseArea.querySelector('span')).toBeNull();
    fireEvent.click(pauseArea);
    await screen.findByRole('button', { name: 'announcements.playVideo' });
    expect(video.pause).toHaveBeenCalled();
    video.currentTime = 9;
    fireEvent.click(screen.getByRole('button', { name: 'announcements.playVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    expect(document.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(9);
    vi.mocked(video.pause).mockClear();
    view.unmount();
    expect(video.pause).toHaveBeenCalled();
  });
  it('shows the uploaded cover and leaves video unloaded until play', () => {
    render(
      <AnnouncementVideo
        src="https://cloud.example/video.mp4"
        poster="https://cloud.example/cover.png"
        className="background"
      />,
    );
    const video = document.querySelector('video')!;
    expect(video.poster).toBe('https://cloud.example/cover.png');
    expect(video.preload).toBe('none');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
    expect(video.play).not.toHaveBeenCalled();
    expect(document.querySelector('.lucide-play')).toBeTruthy();
  });
  it('waits for the dialog to open and offers retry without an image on playback failure', async () => {
    const view = render(
      <AnnouncementVideo src="https://cloud.example/video.mp4" className="background" active={false} />,
    );
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    view.rerender(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" active />);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'announcements.playVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    fireEvent.error(document.querySelector('video')!);
    fireEvent.click(await screen.findByRole('button', { name: 'announcements.retryVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    expect(document.querySelector('img')).toBeNull();
  });
  it('holds the final frame until explicitly replayed, including after the dialog becomes active again', async () => {
    const view = render(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" />);
    const video = document.querySelector('video')!;
    fireEvent.click(screen.getByRole('button', { name: 'announcements.playVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    video.currentTime = 75;
    vi.mocked(video.play).mockClear();
    fireEvent.ended(video);
    await screen.findByRole('button', { name: 'announcements.replayVideo' });
    expect(video.currentTime).toBe(75);
    expect(video.play).not.toHaveBeenCalled();
    view.rerender(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" active={false} />);
    view.rerender(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" active />);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: 'announcements.replayVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
    expect(document.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledOnce();
  });
  it('respects reduced motion while permitting explicit playback', async () => {
    reduced = true;
    render(<AnnouncementVideo src="https://cloud.example/video.mp4" className="background" />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'announcements.playVideo' }));
    await screen.findByRole('button', { name: 'announcements.pauseVideo' });
  });
});
