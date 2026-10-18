// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileInputControl, selectLocalFiles, StatusLine } from '@motus-ai/seed-sdk/react';

afterEach(cleanup);
const options = {
  multiple: true,
  accept: ['.pdf', '.docx'],
  maxFiles: 32,
  getPathForFile: (file: File) => (file.name.startsWith('/') ? file.name : ''),
  singleFileError: 'single',
  tooManyFilesError: 'limit',
  localFileError: 'local',
  fileTypeError: 'type',
};
const files = (...names: string[]) => names.map((name) => new File(['test'], name)) as unknown as FileList;
describe('SDK file field and passive status presentation', () => {
  it('validates local paths, extensions and deduplicated count before submitting', () => {
    expect(selectLocalFiles(files('/a.PDF', '/b.docx'), ['/a.PDF'], options)).toEqual({ value: ['/a.PDF', '/b.docx'] });
    expect(selectLocalFiles(files('/bad.exe'), [], options)).toEqual({ error: 'type' });
    expect(selectLocalFiles(files('remote.pdf'), [], options)).toEqual({ error: 'local' });
    expect(selectLocalFiles(files(...Array.from({ length: 33 }, (_, i) => `/${i}.pdf`)), [], options)).toEqual({
      error: 'limit',
    });
    expect(selectLocalFiles(files('/a.pdf', '/b.pdf'), '', { ...options, multiple: false })).toEqual({
      error: 'single',
    });
    expect(selectLocalFiles(null, [], options)).toEqual({});
  });
  it('retains the original file row and removes exactly the selected path', () => {
    const change = vi.fn();
    render(
      <FileInputControl
        {...options}
        value={['/a.pdf', '/b.docx']}
        label="Files"
        chooseLabel="Choose"
        dropLabel="Drop"
        clearLabel="Remove"
        onChange={change}
      />,
    );
    expect(screen.getByText('a.pdf').closest('.border')?.className).toContain('min-h-10');
    fireEvent.click(screen.getByRole('button', { name: 'Remove: a.pdf' }));
    expect(change).toHaveBeenCalledExactlyOnceWith(['/b.docx']);
  });
  it('blocks removal, file selection and drops while disabled; releases the picker reference', () => {
    const change = vi.fn(),
      chooseRef = { current: null as (() => void) | null };
    const { unmount, container } = render(
      <FileInputControl
        {...options}
        value={['/a.pdf']}
        disabled
        chooseRef={chooseRef}
        label="Files"
        chooseLabel="Choose"
        dropLabel="Drop"
        clearLabel="Remove"
        onChange={change}
      />,
    );
    expect((screen.getByRole('button', { name: 'Remove: a.pdf' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(container.querySelector('input')!, { target: { files: files('/b.pdf') } });
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: files('/c.pdf'), types: ['Files'] } });
    expect(change).not.toHaveBeenCalled();
    expect(chooseRef.current).toBeTypeOf('function');
    unmount();
    expect(chooseRef.current).toBeNull();
  });
  it('renders caller-selected status tone and optional actions, without interpreting business states', () => {
    render(
      <StatusLine tone="success" actions={<button>Copy</button>}>
        Done
      </StatusLine>,
    );
    expect(screen.getByRole('status').querySelector('[aria-hidden]')?.className).toContain('seed-success');
    expect(screen.getByRole('status').textContent).toContain('Done');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
