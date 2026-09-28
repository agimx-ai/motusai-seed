import { FileText, X } from 'lucide-react'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { ActionButton } from './ActionButton'
import { IconButton } from './IconButton'
import { Tooltip } from './Tooltip'

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
  chooseRef?: MutableRefObject<(() => void) | null>
}

export function selectLocalFiles(files: FileList | null, value: string | string[], options: Pick<FileInputControlProps, 'multiple' | 'accept' | 'singleFileError' | 'tooManyFilesError' | 'localFileError' | 'fileTypeError' | 'getPathForFile'>): { value?: string | string[]; error?: string } {
  if (!files?.length) return {}
  if (!options.multiple && files.length !== 1) return { error: options.singleFileError }
  try {
    const paths = Array.from(files, options.getPathForFile)
    if (paths.some((path) => !path)) return { error: options.localFileError }
    if (options.accept?.length && paths.some((path) => !options.accept!.some((extension) => path.toLowerCase().endsWith(extension.toLowerCase())))) {
      return { error: options.fileTypeError }
    }
    const next = options.multiple ? [...new Set([...(Array.isArray(value) ? value : []), ...paths])] : paths[0]!
    if (Array.isArray(next) && next.length > 32) return { error: options.tooManyFilesError || options.singleFileError }
    return { value: next }
  } catch { return { error: options.localFileError } }
}

export function FileInputControl({ value, multiple = false, accept, label, chooseLabel, dropLabel, clearLabel, singleFileError, tooManyFilesError, localFileError, fileTypeError, getPathForFile, onChange, chooseRef }: FileInputControlProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!chooseRef) return
    chooseRef.current = () => inputRef.current?.click()
    return () => { chooseRef.current = null }
  }, [chooseRef])
  const choose = (files: FileList | null) => {
    const selected = selectLocalFiles(files, value, { multiple, accept, singleFileError, tooManyFilesError, localFileError, fileTypeError, getPathForFile })
    if (selected.error) setError(selected.error)
    else if (selected.value !== undefined) { setError(''); onChange(selected.value) }
  }
  const paths = Array.isArray(value) ? value : value ? [value] : []
  const fileInput = <input ref={inputRef} className="hidden" type="file" multiple={multiple} accept={accept?.join(',')} aria-label={label} tabIndex={-1}
    onChange={(event) => { choose(event.target.files); event.target.value = '' }} />
  if (chooseRef && paths.length === 0) return <>{fileInput}{error && <p className="mb-0 mt-1 text-[12px] text-danger" role="alert">{error}</p>}</>
  return <div
    className={`min-w-0 ${dragging && !chooseRef ? 'rounded-[var(--radius-control)] ring-2 ring-info-border' : ''}`}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); choose(event.dataTransfer.files) }}
  >
    {fileInput}
    {paths.length === 0 ? <div className={`flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] ${dragging ? 'bg-info-soft' : ''}`}>
      <ActionButton type="button" onClick={() => inputRef.current?.click()} aria-label={`${label}: ${chooseLabel}`}>{chooseLabel}</ActionButton>
      <span className="min-w-0 truncate text-[12px] text-muted-foreground">{dropLabel}</span>
    </div> : <div className="space-y-1">
      {paths.map((path) => {
        const parts = path.split(/[\\/]/)
        const fileName = parts.at(-1) || path
        return <div className="flex min-h-10 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-card px-2.5 py-1" key={path}>
          <FileText size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1"><Tooltip content={<span className="break-all">{path}</span>}><span className="block truncate text-[13px] text-foreground">{fileName}</span></Tooltip></span>
          <IconButton icon={<X size={14} />} label={`${clearLabel}: ${fileName}`} tone="danger-hover" showTooltip={false} onClick={() => { setError(''); onChange(multiple ? paths.filter((item) => item !== path) : '') }} />
        </div>
      })}
      {!chooseRef && <ActionButton type="button" onClick={() => inputRef.current?.click()} aria-label={`${label}: ${chooseLabel}`}>{chooseLabel}</ActionButton>}
    </div>}
    {error && <p className="mb-0 mt-1 text-[12px] text-danger" role="alert">{error}</p>}
  </div>
}
