import { BrainCircuit, Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils';
import { usePluginStyleScope } from '../style-scope';
import { DiscreteSlider } from './DiscreteSlider';
import { ThemedIcon } from './ThemedIcon';

export type SelectControlOption<Value extends string> = {
  value: Value;
  label: string;
  disabled?: boolean;
  group?: string;
  iconDataUrl?: string;
  iconDarkDataUrl?: string;
};

type SelectControlProps<Value extends string> = {
  value: Value;
  options: Array<SelectControlOption<Value>>;
  onValueChange: (value: Value) => void;
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  closeOnSelect?: boolean;
  portal?: boolean;
  variant?: 'compact' | 'form' | 'model';
  size?: 'default' | 'form';
  modelMenu?: {
    groups: readonly { value: string; label: string }[];
    thinking?: {
      label: string;
      value: string;
      levels: string[];
      labels: Record<string, string>;
      unselectedLabel: string;
      emptyLabel: string;
      onChange(value: string): void;
    };
  };
};

export function SelectControl<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  placeholder = label,
  className,
  disabled = false,
  loading = false,
  closeOnSelect = true,
  portal = false,
  variant = 'compact',
  size = 'default',
  modelMenu,
}: SelectControlProps<Value>) {
  const [open, setOpen] = useState(false);
  const [modelMenuMounted, setModelMenuMounted] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const [availableHeight, setAvailableHeight] = useState<number>();
  const [portalPosition, setPortalPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  }>();
  const [modelWidth, setModelWidth] = useState<number>();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelMeasureRef = useRef<HTMLSpanElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label || placeholder;
  const indexedOptions = options.map((option, index) => ({ option, index }));
  const modelGroups = (modelMenu?.groups ?? []).map((group) => ({
    key: group.value,
    label: group.label,
    items: indexedOptions.filter(({ option }) => option.group === group.value),
  }));
  const ungroupedOptions = indexedOptions.filter(
    ({ option }) => !modelMenu?.groups.some((group) => option.group === group.value),
  );
  const thinkingLevels = modelMenu?.thinking?.levels ?? [];
  const thinkingDisplayLabel =
    variant === 'model' && selected && modelMenu?.thinking && thinkingLevels.length > 0
      ? modelMenu.thinking.labels[modelMenu.thinking.value] || modelMenu.thinking.labels.default
      : undefined;
  const triggerDisplayLabel = thinkingDisplayLabel ? `${displayLabel} · ${thinkingDisplayLabel}` : displayLabel;
  const containsTarget = (target: EventTarget | null) =>
    target instanceof Node && Boolean(rootRef.current?.contains(target) || listboxRef.current?.contains(target));

  useLayoutEffect(() => {
    if (variant !== 'model') return;
    const trigger = triggerRef.current;
    const labelMeasure = labelMeasureRef.current;
    if (!trigger || !labelMeasure) return;
    const style = getComputedStyle(trigger);
    const icons = Array.from(trigger.querySelectorAll(':scope > svg, :scope > .seed-themed-icon'));
    const collapsedWidth = Math.ceil(
      labelMeasure.getBoundingClientRect().width +
        icons.reduce((width, icon) => width + icon.getBoundingClientRect().width, 0) +
        parseFloat(style.columnGap || '0') * icons.length +
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth),
    );
    if (!open) setModelWidth(collapsedWidth);
  }, [variant, triggerDisplayLabel, selected?.iconDataUrl, selected?.iconDarkDataUrl, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const trigger = triggerRef.current;
      const listbox = listboxRef.current;
      const viewport = scrollViewportRef.current;
      if (!trigger || !listbox || !viewport) return;
      const triggerRect = trigger.getBoundingClientRect();
      const style = getComputedStyle(listbox);
      const inset = (...values: string[]) => values.reduce((total, value) => total + (parseFloat(value) || 0), 0);
      const fixedHeight = [footerRef.current].reduce((height, section) => {
        if (!section) return height;
        const sectionStyle = getComputedStyle(section);
        return height + section.offsetHeight + inset(sectionStyle.marginTop, sectionStyle.marginBottom);
      }, 0);
      // Measure the full list plus its fixed siblings, not the clipped scroll viewport.
      const menuHeight =
        viewport.scrollHeight +
        fixedHeight +
        inset(style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth);
      const menuWidth = viewport.scrollWidth + inset(style.paddingLeft, style.paddingRight);
      const gap = 5;
      const viewportPadding = 8;
      const topInset = variant === 'model' ? 56 : viewportPadding;
      const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - viewportPadding);
      const spaceAbove = Math.max(0, triggerRect.top - gap - topInset);
      const nextPlacement = menuHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';
      setPlacement(nextPlacement);
      setAvailableHeight(Math.floor(nextPlacement === 'bottom' ? spaceBelow : spaceAbove));
      if (portal) {
        const maxHeight = Math.floor(nextPlacement === 'bottom' ? spaceBelow : spaceAbove);
        const width = Math.min(Math.max(triggerRect.width, listbox.scrollWidth, menuWidth), window.innerWidth - 16);
        if (variant === 'model') setModelWidth(width);
        const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - width - 8));
        const top =
          nextPlacement === 'top' ? triggerRect.top - gap - Math.min(menuHeight, maxHeight) : triggerRect.bottom + gap;
        setPortalPosition({ left, top, width, maxHeight });
      }
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open, options.length, thinkingLevels.length, modelMenu?.thinking?.emptyLabel, portal, variant]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!containsTarget(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  useEffect(() => {
    if (variant !== 'model') return;
    if (open) {
      setModelMenuMounted(true);
      return;
    }
    if (!modelMenuMounted) return;
    // Also remove the exiting portal when animations are disabled or interrupted.
    const timeout = window.setTimeout(() => setModelMenuMounted(false), 160);
    return () => window.clearTimeout(timeout);
  }, [open, modelMenuMounted, variant]);

  const menuVisible = open && (!portal || Boolean(portalPosition));
  useEffect(() => {
    if (menuVisible) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, menuVisible]);

  useEffect(() => {
    if (disabled || loading) setOpen(false);
  }, [disabled, loading]);

  const move = (direction: 1 | -1) => {
    let next = activeIndex;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    if (closeOnSelect) {
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } else {
      setActiveIndex(index);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.target === triggerRef.current && ['Enter', ' '].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Tab' && variant === 'model') return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
      if (event.key === 'Escape' || (event.key === 'Tab' && portal)) {
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const indexes = options.map((_, index) => index).filter((index) => !options[index]?.disabled);
      const next = event.key === 'Home' ? indexes[0] : indexes.at(-1);
      if (next !== undefined) setActiveIndex(next);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      choose(activeIndex);
    }
  };

  const optionButton = (option: SelectControlOption<Value>, index: number) => (
    <button
      ref={(node) => {
        optionRefs.current[index] = node;
      }}
      key={option.value}
      type="button"
      className={cx(
        'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-[7px] text-left outline-none transition-colors disabled:cursor-default disabled:opacity-45',
        variant === 'model' ? 'min-h-8 scroll-mt-8 px-3 text-[13px]' : 'h-7 px-2 text-[13px]',
        index === activeIndex
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      role="option"
      aria-selected={option.value === value}
      disabled={option.disabled}
      tabIndex={index === activeIndex ? 0 : -1}
      onPointerMove={() => !option.disabled && setActiveIndex(index)}
      onClick={() => choose(index)}
    >
      <span className="flex min-w-0 items-center gap-2">
        {variant === 'model' &&
          (option.iconDataUrl ? (
            <ThemedIcon iconDataUrl={option.iconDataUrl} iconDarkDataUrl={option.iconDarkDataUrl} />
          ) : (
            <BrainCircuit className="shrink-0 text-muted-foreground" size={16} strokeWidth={1.8} aria-hidden="true" />
          ))}
        <span className="truncate">{option.label}</span>
      </span>
      {option.value === value && (
        <Check className="shrink-0" size={variant === 'model' ? 16 : 13} strokeWidth={1.9} aria-hidden="true" />
      )}
    </button>
  );

  const scope = usePluginStyleScope();
  const listbox = (open || (variant === 'model' && modelMenuMounted)) && (
    <div
      ref={listboxRef}
      data-plugin-view-portal={portal ? scope : undefined}
      id={listboxId}
      className={cx(
        'z-[110] flex flex-col overflow-hidden border border-border bg-card shadow-[0_8px_24px_rgba(0,0,0,.10)]',
        variant === 'model'
          ? cx(
              'min-w-[260px] rounded-[16px] py-3 pl-2 pr-1',
              placement === 'top' ? 'seed-model-menu--top' : 'seed-model-menu--bottom',
              open ? 'seed-model-menu--enter' : 'seed-model-menu--exit pointer-events-none',
            )
          : 'rounded-[10px] p-1',
        portal ? 'fixed' : 'absolute right-0 min-w-full',
        !portal && (placement === 'top' ? 'bottom-[calc(100%+5px)] origin-bottom' : 'top-[calc(100%+5px)] origin-top'),
      )}
      style={
        portal
          ? { ...portalPosition, visibility: portalPosition ? 'visible' : 'hidden' }
          : { maxHeight: availableHeight }
      }
      role={variant === 'model' ? 'dialog' : 'listbox'}
      aria-label={label}
      aria-hidden={variant === 'model' && !open ? true : undefined}
      inert={variant === 'model' && !open}
      onAnimationEnd={(event) => {
        if (variant === 'model' && !open && event.target === event.currentTarget) setModelMenuMounted(false);
      }}
    >
      <div
        ref={scrollViewportRef}
        className={cx('min-h-0 min-w-0 overflow-x-hidden overflow-y-auto', variant === 'model' && 'pr-1')}
      >
        {variant === 'model' && modelMenu ? (
          <div className="grid gap-px" role="listbox" aria-label={label}>
            {modelGroups
              .filter((group) => group.items.length > 0)
              .map((group, groupIndex) => (
                <div key={group.key} className="grid gap-px pt-1 first:pt-0" role="group" aria-label={group.label}>
                  <div
                    className={cx(
                      'sticky top-0 z-10 truncate bg-card px-3 pb-1 text-[11px] font-medium leading-4 text-muted-foreground',
                      groupIndex === 0 ? 'pt-0' : 'pt-2',
                    )}
                    role="presentation"
                  >
                    {group.label}
                  </div>
                  {group.items.map(({ option, index }) => optionButton(option, index))}
                </div>
              ))}
            {ungroupedOptions.map(({ option, index }) => optionButton(option, index))}
          </div>
        ) : (
          options.map(optionButton)
        )}
      </div>
      {variant === 'model' && modelMenu?.thinking && (
        <div
          ref={footerRef}
          className="mr-1 mt-1 shrink-0 border-t border-border px-3 pt-2"
          role="group"
          aria-label={modelMenu.thinking.label}
        >
          {thinkingLevels.length > 0 ? (
            <DiscreteSlider
              key={thinkingLevels.join('\0')}
              label={modelMenu.thinking.label}
              value={modelMenu.thinking.value}
              active={open}
              options={thinkingLevels.map((level) => ({
                value: level,
                label: modelMenu.thinking!.labels[level] || level,
              }))}
              placeholder={modelMenu.thinking.labels.default!}
              unselectedLabel={modelMenu.thinking.unselectedLabel}
              onChange={modelMenu.thinking.onChange}
            />
          ) : (
            <div className="text-[12px] text-muted-foreground">{modelMenu.thinking.emptyLabel}</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cx(
        'relative inline-flex shrink-0',
        variant === 'model' && 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        className,
      )}
      style={variant === 'model' ? { width: modelWidth } : undefined}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (open && !containsTarget(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        style={size === 'form' ? { height: 'var(--text-input-height)' } : undefined}
        className={cx(
          'inline-flex items-center rounded-[var(--radius-control)] border font-normal text-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-50',
          variant === 'model' ? 'justify-start gap-2' : 'justify-between gap-3',
          variant === 'model' && size === 'form'
            ? 'h-[var(--text-input-height)] w-full border-input bg-card px-[var(--text-input-padding-x)] text-[var(--text-input-font-size)] hover:bg-muted focus-visible:border-foreground/35'
            : variant === 'form'
              ? 'h-[var(--text-input-height)] w-full border-input bg-card px-[var(--text-input-padding-x)] text-[var(--text-input-font-size)] hover:bg-muted'
              : variant === 'model'
                ? 'seed-action-button w-full border-border bg-card px-2 hover:bg-muted'
                : 'h-[30px] w-fit border-border bg-card px-2.5 text-[13px] hover:bg-muted',
        )}
        aria-label={label}
        aria-haspopup={variant === 'model' ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        onClick={() => {
          setActiveIndex(selectedIndex);
          if (!open) setPortalPosition(undefined);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(event.key === 'End' ? options.length - 1 : selectedIndex);
          setOpen(true);
        }}
      >
        {variant === 'model' &&
          (selected?.iconDataUrl ? (
            <ThemedIcon iconDataUrl={selected.iconDataUrl} iconDarkDataUrl={selected.iconDarkDataUrl} />
          ) : (
            <BrainCircuit className="shrink-0 text-muted-foreground" size={16} strokeWidth={1.8} aria-hidden="true" />
          ))}
        {variant === 'model' ? (
          <span className="seed-model-trigger-value flex min-w-0 items-baseline">
            <span className="truncate">{displayLabel}</span>
            {thinkingDisplayLabel && <span className="shrink-0 text-muted-foreground"> · {thinkingDisplayLabel}</span>}
          </span>
        ) : (
          <span className="truncate">{displayLabel}</span>
        )}
        {variant === 'model' && (
          <span
            ref={labelMeasureRef}
            className="pointer-events-none absolute whitespace-nowrap opacity-0"
            aria-hidden="true"
          >
            {triggerDisplayLabel}
          </span>
        )}
        {loading ? (
          <LoaderCircle
            className="shrink-0 animate-spin text-muted-foreground"
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            className={cx(
              'shrink-0 text-muted-foreground transition-transform duration-150',
              variant === 'model' && 'ml-auto',
              open && 'rotate-180',
            )}
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )}
      </button>
      {portal ? listbox && createPortal(listbox, document.body) : listbox}
    </div>
  );
}
