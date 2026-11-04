import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '@motus-ai/seed-sdk/react';

describe('MarkdownContent', () => {
  it('renders completed and partial Markdown through the shared renderer', () => {
    expect(renderToStaticMarkup(<MarkdownContent>{'**done**'}</MarkdownContent>)).toContain(
      'data-streamdown="strong">done</span>',
    );
    expect(renderToStaticMarkup(<MarkdownContent streaming>{'**in progress'}</MarkdownContent>)).toContain(
      'in progress',
    );
  });

  it('preserves existing comfortable typography by default', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{'Summary\n\n## Heading\n\nParagraph\n\n- First\n- Second'}</MarkdownContent>,
    );
    expect(html).toContain('leading-6');
    expect(html).toContain('space-y-4');
    expect(html).toContain('class="my-3"');
    expect(html).toContain('mb-2 mt-6');
  });

  it('keeps table semantics and offers copying as the only table action', () => {
    const html = renderToStaticMarkup(<MarkdownContent>{'| Name | Count |\n| --- | ---: |\n| Items | 3 |'}</MarkdownContent>);
    expect(html).toContain('data-streamdown="table-wrapper"');
    expect(html).toContain('data-streamdown="table-header" class="seed-markdown-table-head"');
    expect(html).toContain('style="text-align:right"');
    expect(html).toContain('title="Copy table"');
    expect(html).not.toContain('title="Download table"');
    expect(html).not.toContain('title="View fullscreen"');
  });
});
