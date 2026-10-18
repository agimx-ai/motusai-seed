// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedControlOption } from '@motus-ai/seed-sdk/react';

afterEach(cleanup);
const options: SegmentedControlOption<string>[] = [
  { value: 'first', label: 'First' },
  { value: 'disabled', label: 'Disabled', disabled: true },
  { value: 'last', label: 'Last' },
];
function Controlled() {
  const [value, setValue] = useState('first');
  return <SegmentedControl value={value} options={options} onValueChange={setValue} label="Sources" />;
}

describe('shared segmented control', () => {
  it('preserves the original dimensions, styles and selection behavior', () => {
    render(<Controlled />);
    expect(screen.getByRole('radiogroup').className).toContain('h-[30px]');
    expect(screen.getByRole('radio', { name: 'First' }).className).toContain('rounded-[8px]');
    expect(screen.getByRole('radio', { name: 'First' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Last' }).tabIndex).toBe(-1);
    fireEvent.click(screen.getByRole('radio', { name: 'Last' }));
    expect(screen.getByRole('radio', { name: 'Last' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Last' }).tabIndex).toBe(0);
  });

  it('moves focus and selection with arrows, skips disabled options and wraps', () => {
    render(<Controlled />);
    const first = screen.getByRole('radio', { name: 'First' });
    const last = screen.getByRole('radio', { name: 'Last' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(last);
    expect(last.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(last);
  });

  it('never changes a disabled option and accepts an empty collection', () => {
    const change = vi.fn();
    const { rerender } = render(
      <SegmentedControl value="disabled" options={[options[1]]} onValueChange={change} label="Disabled group" />,
    );
    const disabled = screen.getByRole('radio') as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    fireEvent.click(disabled);
    fireEvent.keyDown(disabled, { key: 'Home' });
    expect(change).not.toHaveBeenCalled();
    rerender(<SegmentedControl value="" options={[]} onValueChange={change} label="Empty group" />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
