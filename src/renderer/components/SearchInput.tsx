import { Search, X } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from '../lib/display'

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value'> & {
  clearLabel: string
  label: string
  value: string
  onValueChange: (value: string) => void
  className?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({
  clearLabel,
  label,
  value,
  onValueChange,
  className,
  ...props
}, ref) {
  return (
    <div className={cx('flex h-[34px] w-full items-center gap-2.5 rounded-full border border-input bg-card px-3 text-muted-foreground transition-colors focus-within:border-foreground/30', className)}>
      <Search aria-hidden="true" size={17} />
      <input
        ref={ref}
        aria-label={label}
        className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...props}
      />
      {value && (
        <button
          aria-label={clearLabel}
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onValueChange('')}
          type="button"
        >
          <X aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
})
