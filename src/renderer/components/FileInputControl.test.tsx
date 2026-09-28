import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileInputControl } from './FileInputControl'

describe('FileInputControl', () => {
  it('renders multiple selected paths in the shared file control', () => {
    const html = renderToStaticMarkup(<FileInputControl
      value={['/tmp/URS.docx', '/tmp/FS.pdf']} multiple label="Sources" chooseLabel="Choose files"
      dropLabel="Drop files" clearLabel="Clear" singleFileError="One file only" localFileError="Local only"
      fileTypeError="Wrong type" getPathForFile={() => ''} onChange={() => undefined} />)
    expect(html).toContain('seed-text-input')
    expect(html).toContain('multiple=""')
    expect(html).toContain('/tmp/URS.docx')
    expect(html).toContain('/tmp/FS.pdf')
  })
})
