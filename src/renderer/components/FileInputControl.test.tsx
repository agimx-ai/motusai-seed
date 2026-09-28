import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileInputControl, selectLocalFiles } from './FileInputControl'

describe('FileInputControl', () => {
  it('uses the same path-only validation for picker and view drops', () => {
    const options = {
      multiple: true, accept: ['.docx', '.pdf'], singleFileError: 'One file', tooManyFilesError: 'Too many',
      localFileError: 'Local only', fileTypeError: 'Wrong type', getPathForFile: (file: File) => file.name,
    }
    const dropped = [{ name: '/tmp/URS.docx' }, { name: '/tmp/FS.pdf' }] as unknown as FileList
    expect(selectLocalFiles(dropped, ['/tmp/URS.docx'], options)).toEqual({ value: ['/tmp/URS.docx', '/tmp/FS.pdf'] })
    expect(selectLocalFiles([{ name: '/tmp/image.png' }] as unknown as FileList, [], options)).toEqual({ error: 'Wrong type' })
    expect(selectLocalFiles([{ name: '' }] as unknown as FileList, [], options)).toEqual({ error: 'Local only' })
  })

  it('renders selected files as compact, separated rows without visible paths', () => {
    const html = renderToStaticMarkup(<FileInputControl
      value={['/tmp/URS.docx', '/tmp/FS.pdf']} multiple label="Sources" chooseLabel="Choose files"
      dropLabel="Drop files" clearLabel="Clear" singleFileError="One file only" localFileError="Local only"
      fileTypeError="Wrong type" getPathForFile={() => ''} onChange={() => undefined} />)
    expect(html).toContain('multiple=""')
    expect(html).toContain('URS.docx')
    expect(html).toContain('FS.pdf')
    expect(html).toContain('space-y-1')
    expect(html).toContain('min-h-10')
    expect(html).not.toContain('>tmp</span>')
    expect(html).not.toContain('title="/tmp/URS.docx"')
    expect(html).toContain('aria-label="Clear: URS.docx"')
  })

  it('does not show an empty drop field when the toolbar provides file selection', () => {
    const html = renderToStaticMarkup(<FileInputControl
      value={[]} multiple label="Sources" chooseLabel="Choose files" chooseRef={{ current: null }}
      dropLabel="Drop files" clearLabel="Clear" singleFileError="One file only" localFileError="Local only"
      fileTypeError="Wrong type" getPathForFile={() => ''} onChange={() => undefined} />)
    expect(html).not.toContain('Drop files')
    expect(html).toContain('type="file"')
  })
})
