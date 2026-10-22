// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ButtonComponent, toast } from '@motus-ai/seed-sdk';
import { Toaster } from '@motus-ai/seed-sdk/react';

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
});

describe('shared SDK notifications', () => {
  it('delivers root API calls to one complete Toaster, with updates and a working close button', async () => {
    render(<Toaster theme="light" contentInsetLeft={224} />);
    act(() => {
      toast.success('Plugin saved', { id: 'shared-update', duration: Infinity });
      toast.info('Client refreshed', { id: 'shared-client', duration: Infinity });
    });
    const saved = (await screen.findByText('Plugin saved')).closest('[data-sonner-toast]') as HTMLElement;
    await screen.findByText('Client refreshed');
    expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
    expect(saved.getAttribute('data-type')).toBe('success');
    expect(saved.classList.contains('seed-toast')).toBe(true);
    expect(saved.style.minHeight).toBe('40px');

    act(() => {
      toast.error('Plugin failed', { id: 'shared-update', description: 'Try again', duration: Infinity });
    });
    const failed = (await screen.findByText('Plugin failed')).closest('[data-sonner-toast]') as HTMLElement;
    expect(failed.getAttribute('data-type')).toBe('error');
    expect(screen.queryByText('Plugin saved')).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(2);
    fireEvent.click(failed.querySelector('button[data-close-button]')!);
    await waitFor(() => expect(screen.queryByText('Plugin failed')).toBeNull());
    expect(screen.getByText('Client refreshed')).toBeTruthy();
  });

  it('routes rejected DOM control callbacks through the shared error presentation', async () => {
    render(<Toaster theme="light" />);
    const container = document.createElement('div');
    document.body.append(container);
    const control = new ButtonComponent(container).setButtonText('Save').onClick(async () => {
      throw new Error('Callback failed');
    });
    try {
      fireEvent.click(control.buttonEl);
      const message = await screen.findByText('Callback failed');
      expect(message.closest('[data-sonner-toast]')?.getAttribute('data-type')).toBe('error');
    } finally {
      await control.unload();
      container.remove();
    }
  });
});
