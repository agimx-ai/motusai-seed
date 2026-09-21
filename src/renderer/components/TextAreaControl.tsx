import type { TextareaHTMLAttributes } from 'react'
import { cx } from '../lib/display'

type TextAreaControlProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function TextAreaControl({ className, ...props }: TextAreaControlProps) {
  return <textarea
    className={cx(
      'min-h-24 w-full resize-none overflow-y-auto rounded-[10px] border border-input bg-card px-3 py-2 text-[13px] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/35',
      className,
    )}
    {...props}
  />
}
