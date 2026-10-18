// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionButton,
  ComponentProvider,
  DisclosureControl,
  FieldLabel,
  StatusBadge,
  TextInputControl,
} from '@motus-ai/seed-sdk/react';

afterEach(cleanup);
describe('shared settings presentation', () => {
  it('carries the plugin style scope into portals without marking platform content', async () => {
    render(
      <ComponentProvider locale="en-US" pluginId="com.example.scoped">
        <FieldLabel description="Scoped help">Field</FieldLabel>
      </ComponentProvider>,
    );
    fireEvent.focus(screen.getByLabelText('Scoped help'));
    expect((await screen.findByRole('tooltip')).dataset.pluginViewPortal).toBe('com.example.scoped');
  });
  it('retains primary and disabled styles in the shared button', () => {
    render(
      <ActionButton tone="primary" busy>
        Save
      </ActionButton>,
    );
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain('bg-accent');
    expect(button.className).toContain('seed-action-button');
  });
  it('shows field help on keyboard focus, without putting the hint in the page layout', async () => {
    render(<FieldLabel description="Private service hint">Strategy</FieldLabel>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByLabelText('Private service hint'));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Private service hint');
    fireEvent.blur(screen.getByLabelText('Private service hint'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('keeps a status action separate from a disclosure and exposes the expanded state', () => {
    const toggle = vi.fn(),
      reconnect = vi.fn();
    render(
      <DisclosureControl
        open={false}
        label="Account"
        onToggle={toggle}
        actionsVisible
        actions={
          <StatusBadge tone="danger" onClick={reconnect}>
            Reconnect
          </StatusBadge>
        }
      >
        Account
      </DisclosureControl>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
    const disclosure = screen.getByRole('button', { name: 'Account' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('uses the existing input class and a non-action status for connected accounts', () => {
    render(
      <>
        <TextInputControl aria-label="Name" defaultValue="Example" />
        <StatusBadge tone="success">Connected</StatusBadge>
      </>,
    );
    expect(screen.getByRole('textbox').className).toBe('seed-text-input');
    expect(screen.getByText('Connected').className).toContain('border-success/30');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
