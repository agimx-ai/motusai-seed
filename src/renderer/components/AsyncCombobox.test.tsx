// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncCombobox, type AsyncComboboxProps } from '@motus-ai/seed-sdk/react';

afterEach(cleanup);
const options = [
  { value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' },
  { value: 'other-model-id', label: 'Other model' },
];
const defaults: AsyncComboboxProps = {
  value: '',
  options,
  placeholder: 'Enter or search',
  label: 'Model',
  loading: false,
  emptyMessage: 'No matches',
  unavailableMessage: 'Unavailable',
  refreshLabel: 'Retry',
  onChange: () => {},
  onRefresh: () => {},
};
function Controlled({ initial = '', ...props }: Partial<AsyncComboboxProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <AsyncCombobox {...defaults} {...props} value={value} onChange={setValue} />;
}

describe('shared editable search combobox', () => {
  it('retains one input with the original height and integrated dropdown button', () => {
    render(<Controlled initial="deepseek-flash" required maxLength={200} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(document.querySelectorAll('input')).toHaveLength(1);
    expect(input.value).toBe('DeepSeek V4.1 Flash');
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(200);
    expect(input.parentElement?.className).toContain('h-9');
    expect(input.parentElement?.className).toContain('rounded-[10px]');
    expect(input.parentElement?.querySelector('button')).not.toBeNull();
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  it('filters by label or ID, accepts free text and returns the selected value, not its label', async () => {
    const change = vi.fn();
    render(<AsyncCombobox {...defaults} value="" onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: 'DeepSeek V4.1 Flash' }));
    expect(change).toHaveBeenLastCalledWith('deepseek-flash');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')));
    expect(screen.queryByRole('listbox')).toBeNull();
    cleanup();
    render(<Controlled />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'V4.1' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'OTHER-MODEL-ID' } });
    expect(screen.getByRole('option').textContent).toContain('Other model');
    fireEvent.change(input, { target: { value: 'my-unlisted-model' } });
    expect((input as HTMLInputElement).value).toBe('my-unlisted-model');
    expect(screen.getByText('No matches')).not.toBeNull();
  });

  it('supports arrow/Enter selection, Escape/Tab and outside dismissal without submitting a form', () => {
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <Controlled />
      </form>,
    );
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((input as HTMLInputElement).value).toBe('Other model');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(input);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps loading, empty and failed states distinct and retries through the same button', () => {
    const retry = vi.fn();
    const { rerender } = render(<AsyncCombobox {...defaults} options={[]} loading />);
    fireEvent.click(screen.getByRole('button'));
    expect(document.querySelector('svg.lucide-loader-circle')).not.toBeNull();
    expect(screen.queryByText('No matches')).toBeNull();
    rerender(<AsyncCombobox {...defaults} options={[]} />);
    expect(screen.getByText('No matches')).not.toBeNull();
    rerender(<AsyncCombobox {...defaults} options={[]} error="Private upstream error" onRefresh={retry} />);
    expect(screen.getByText('Unavailable')).not.toBeNull();
    expect(screen.queryByText('Private upstream error')).toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('preserves rich labels and cached selected names without preventing direct input', () => {
    render(
      <Controlled
        initial="cached"
        options={[]}
        valueOption={{
          value: 'cached',
          label: 'Cached model',
          iconDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
          badges: [{ label: 'Preview', tone: 'info' }],
        }}
      />,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('Cached model');
    expect(screen.getByText('Preview')).not.toBeNull();
    expect(input.className).toContain('text-transparent');
    expect(input.classList.contains('text-foreground')).toBe(false);
    fireEvent.change(input, { target: { value: 'another-id' } });
    expect(input.value).toBe('another-id');
    expect(input.className).not.toContain('text-transparent');
    expect(input.classList.contains('text-foreground')).toBe(true);
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('does not select a suggestion on an IME confirmation Enter', () => {
    render(<Controlled />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'DeepSeek' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect((input as HTMLInputElement).value).toBe('DeepSeek');
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  it('disables both parts and removes pending focus/listeners when unmounted', () => {
    const change = vi.fn();
    const { rerender, unmount } = render(<AsyncCombobox {...defaults} onChange={change} />);
    fireEvent.click(screen.getByRole('button'));
    rerender(<AsyncCombobox {...defaults} disabled onChange={change} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    expect(change).not.toHaveBeenCalled();
    rerender(<AsyncCombobox {...defaults} onChange={change} />);
    const remove = vi.spyOn(document, 'removeEventListener');
    fireEvent.click(screen.getByRole('button'));
    unmount();
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    remove.mockRestore();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const next = render(<AsyncCombobox {...defaults} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getAllByRole('option')[0]);
    next.unmount();
    expect(cancel).toHaveBeenCalledWith(expect.any(Number));
    cancel.mockRestore();
  });
});
