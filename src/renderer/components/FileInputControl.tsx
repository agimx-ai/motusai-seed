import { FileUp, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { ActionButton } from './ActionButton'
import { IconButton } from './IconButton'

type FileInputControlProps = {
  value: string | string[]
  multiple?: boolean
  accept?: string[]
  label: string
  chooseLabel: string
  dropLabel: string
  clearLabel: string
  singleFileError: string
  tooManyFilesError?: string
  localFileError: string
  fileTypeError: string
  getPathForFile(file: File): string
  onChange(value: string | string[]): void
}

export function FileInputControl({ value, multiple = false, accept, label, chooseLabel, dropLabel, clearLabel, singleFileError, tooManyFilesError, localFileError, fileTypeError, getPathForFile, onChange }: FileInputControlProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const choose = (files: FileList | null) => {
    if (!files?.length) return
    if (!multiple && files.length !== 1) { setError(singleFileError); return }
    try {
      const paths = Array.from(files, getPathForFile)
      if (paths.some((path) => !path)) { setError(localFileError); return }
      if (accept?.length && paths.some((path) => !accept.some((extension) => path.toLowerCase().endsWith(extension.toLowerCase())))) {
        setError(fileTypeError)
        return
      }
      const next = multiple ? [...new Set([...(Array.isArray(value) ? value : []), ...paths])] : paths[0]!
      if (Array.isArray(next) && next.length > 32) { setError(tooManyFilesError || singleFileError); return }
      setError('')
      onChange(next)
    } catch { setError(localFileError) }
  }
  return <div
    className="min-w-0"
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files) }}
  >
    <input ref={inputRef} className="hidden" type="file" multiple={multiple} accept={accept?.join(',')} aria-label={label} tabIndex={-1}
      onChange={(event) => { choose(event.target.files); event.target.value = '' }} />
    <div className={`seed-text-input w-full min-w-0 gap-2 ${dragging ? '!border-accent' : ''}`}>
      <FileUp size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={`min-w-0 flex-1 truncate ${(Array.isArray(value) ? value.length : value) ? '!text-foreground' : ''}`} title={Array.isArray(value) ? value.join('\n') : value || undefined}>{Array.isArray(value) ? (value.length ? `${label} · ${value.length}` : dropLabel) : value ? value.split(/[\\/]/).at(-1) : dropLabel}</span>
      <ActionButton type="button" className="!min-w-0" onClick={() => inputRef.current?.click()} aria-label={`${label}: ${chooseLabel}`}>{chooseLabel}</ActionButton>
      {(Array.isArray(value) ? value.length > 0 : Boolean(value)) && <IconButton icon={<X size={14} />} label={clearLabel} onClick={() => { setError(''); onChange(multiple ? [] : '') }} />}
    </div>
    {(Array.isArray(value) ? value.length > 0 : Boolean(value)) && <div className="mb-0 mt-1 space-y-1 break-all text-[12px] text-muted-foreground">{(Array.isArray(value) ? value : [value]).map((path) => <div className="flex items-start gap-1" key={path}><span className="min-w-0 flex-1">{path}</span>{multiple && <IconButton icon={<X size={12} />} label={`${clearLabel}: ${path}`} onClick={() => onChange((value as string[]).filter((item) => item !== path))} />}</div>)}</div>}
    {error && <p className="mb-0 mt-1 text-[12px] text-danger" role="alert">{error}</p>}
  </div>
}
