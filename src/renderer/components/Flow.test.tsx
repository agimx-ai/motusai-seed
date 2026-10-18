// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Flow, FlowStep } from '@motus-ai/seed-sdk/react';

afterEach(cleanup);

it('keeps the flow connector independent of conflicting display utilities and preserves step content', () => {
  const { container } = render(
    <Flow summary="Route summary">
      <FlowStep icon="A" title="Device">
        Origin
      </FlowStep>
      <FlowStep icon="B" title="Relay" muted>
        Forwarding
      </FlowStep>
      <FlowStep icon="C" title="Provider">
        Destination
      </FlowStep>
    </Flow>,
  );
  const line = container.querySelector('.seed-flow-connector')!;
  expect(line.getAttribute('aria-hidden')).toBe('true');
  expect(line.className).toContain('border-t-2 border-dashed border-border');
  expect(line.className).not.toMatch(/(?:^|\s)(?:hidden|block|\S+:(?:hidden|block))(?:\s|$)/);
  expect([...container.querySelectorAll('strong')].map((step) => step.textContent)).toEqual([
    'Device',
    'Relay',
    'Provider',
  ]);
  expect(container.querySelector('p')?.textContent).toBe('Route summary');
});
