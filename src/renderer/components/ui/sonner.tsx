import type { CSSProperties } from 'react'
import { CircleCheck, CircleHelp, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

type SonnerVariables = CSSProperties & Record<`--${string}`, string>
type SeedToasterProps = ToasterProps & { contentInsetLeft?: number }

const sonnerStyle: SonnerVariables = {
  '--normal-bg': 'var(--card)',
  '--normal-text': 'var(--foreground)',
  '--normal-border': 'var(--border)',
  '--success-bg': 'var(--card)',
  '--success-text': 'var(--seed-success)',
  '--success-border': 'color-mix(in srgb, var(--seed-success) 46%, transparent)',
  '--info-bg': 'var(--seed-control-soft)',
  '--info-text': 'var(--seed-control)',
  '--info-border': 'color-mix(in srgb, var(--seed-control) 46%, transparent)',
  '--warning-bg': 'var(--seed-warning-soft)',
  '--warning-text': 'var(--seed-warning)',
  '--warning-border': 'color-mix(in srgb, var(--seed-warning) 46%, transparent)',
  '--error-bg': 'var(--seed-toast-error-bg)',
  '--error-text': 'var(--seed-toast-error-text)',
  '--error-border': 'var(--seed-toast-error-border)',
}

const iconProps = { size: 14, strokeWidth: 2.1, 'aria-hidden': true as const }

export function Toaster({ theme = 'system', contentInsetLeft = 0, ...props }: SeedToasterProps) {
  return <Sonner
    theme={theme}
    position="top-center"
    richColors
    gap={8}
    offset={{ top: 18 }}
    visibleToasts={4}
    closeButton
    icons={{
      success: <CircleCheck {...iconProps} />,
      info: <CircleHelp {...iconProps} />,
      warning: <TriangleAlert {...iconProps} />,
      error: <CircleX {...iconProps} />,
      loading: <LoaderCircle {...iconProps} className="animate-spin" />,
    }}
    toastOptions={{
      duration: 4_000,
      style: {
        left: `calc(50% + ${contentInsetLeft / 2}px)`,
        width: 'max-content',
        maxWidth: `min(520px, calc(100vw - ${contentInsetLeft + 36}px))`,
        height: '40px',
        padding: '6px 10px 6px 15px',
        borderRadius: '12px',
        boxShadow: 'none',
        translate: '-50% 0',
      },
      classNames: {
        toast: 'seed-toast border font-sans',
        icon: 'seed-toast-icon',
        content: 'seed-toast-content max-h-[160px] overflow-y-auto overscroll-contain text-left',
        title: 'text-[14px] font-semibold leading-5',
        description: 'text-[12px] leading-[18px] opacity-80',
        actionButton: 'seed-toast-action',
        cancelButton: 'seed-toast-cancel',
        closeButton: 'seed-toast-close',
      },
    }}
    style={sonnerStyle}
    {...props}
  />
}
