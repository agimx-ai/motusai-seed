import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SelectControlOption } from './SelectControl';
import { ThemedIcon } from './ThemedIcon';
import { cx } from '../utils';

const unavailable = <Value extends string>(option: SelectControlOption<Value>) =>
  Boolean(option.disabled || option.children?.length === 0);

/** Menu content only: SelectControl owns the trigger, portal, placement and dismissal. */
export function CascadingSelectOptions<Value extends string>({
  options,
  value,
  label,
  menuId,
  visible,
  initialIndex,
  onSelect,
  onClose,
  onColumnsChange,
}: {
  options: SelectControlOption<Value>[];
  value: Value;
  label: string;
  menuId: string;
  visible: boolean;
  initialIndex: number;
  onSelect(option: SelectControlOption<Value>): void;
  onClose(): void;
  onColumnsChange(count: number): void;
}) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const [active, setActive] = useState({ level: 0, index: initialIndex });
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const columns = [{ options, label }];
  for (const index of expanded) {
    const option = columns.at(-1)!.options[index];
    if (!option?.children?.length || option.disabled) break;
    columns.push({ options: option.children, label: option.label });
  }
  const level = Math.min(active.level, columns.length - 1);
  const rows = columns[level].options;
  const index =
    rows[active.index] && !unavailable(rows[active.index])
      ? active.index
      : rows.findIndex((option) => !unavailable(option));
  useEffect(() => onColumnsChange(columns.length), [columns.length, onColumnsChange]);
  useEffect(() => {
    setExpanded((current) => (current.length >= columns.length ? current.slice(0, columns.length - 1) : current));
  }, [options, columns.length]);
  useEffect(() => {
    if (!visible) return;
    const button = buttons.current.get(`${level}:${index}`);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [visible, level, index, columns.length, options]);

  function enter(column: number, row: number) {
    const option = columns[column].options[row];
    if (unavailable(option)) return;
    if (option.children) {
      if (!option.children.length) return;
      setExpanded([...expanded.slice(0, column), row]);
      setActive({
        level: column + 1,
        index: Math.max(
          0,
          option.children.findIndex((child) => !unavailable(child)),
        ),
      });
    } else onSelect(option);
  }
  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(
        event.key,
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') return onClose();
    if (event.key === 'ArrowLeft') {
      if (level > 0) {
        setActive({ level: level - 1, index: expanded[level - 1] });
        setExpanded(expanded.slice(0, level - 1));
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      if (index >= 0 && (event.key !== 'ArrowRight' || rows[index].children)) enter(level, index);
      return;
    }
    const enabled = rows.map((option, row) => (unavailable(option) ? -1 : row)).filter((row) => row >= 0);
    if (!enabled.length) return;
    const position = enabled.indexOf(index);
    const next =
      event.key === 'Home'
        ? enabled[0]
        : event.key === 'End'
          ? enabled.at(-1)!
          : enabled[(position + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
    setActive({ level, index: next });
  }

  return (
    <div className="flex min-h-0 min-w-full flex-1 items-stretch" onKeyDown={keyDown}>
      {columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          id={`${menuId}-column-${columnIndex}`}
          role={columnIndex === 0 ? 'group' : 'menu'}
          aria-label={column.label}
          data-select-column
          className={cx(
            'min-h-0 min-w-[220px] flex-1 overflow-y-auto',
            columnIndex > 0 && 'ml-1 border-l border-border pl-1',
          )}
        >
          {column.options.map((option, row) => {
            const branch = option.children !== undefined;
            const selected = !branch && option.value === value;
            const expandedHere = branch && expanded[columnIndex] === row && columns.length > columnIndex + 1;
            const focused = columnIndex === level && row === index;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  if (node) buttons.current.set(`${columnIndex}:${row}`, node);
                  else buttons.current.delete(`${columnIndex}:${row}`);
                }}
                type="button"
                aria-label={option.label}
                aria-description={option.description || undefined}
                role={branch ? 'menuitem' : 'menuitemradio'}
                aria-haspopup={branch ? 'menu' : undefined}
                aria-expanded={branch ? expandedHere : undefined}
                aria-controls={expandedHere ? `${menuId}-column-${columnIndex + 1}` : undefined}
                aria-checked={branch ? undefined : selected}
                disabled={unavailable(option)}
                tabIndex={focused ? 0 : -1}
                className={cx(
                  'flex w-full min-w-0 items-center justify-between gap-3 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-muted focus:bg-muted disabled:cursor-default disabled:opacity-45',
                  expandedHere && 'bg-muted',
                )}
                onFocus={() =>
                  setActive((current) =>
                    current.level === columnIndex && current.index === row
                      ? current
                      : { level: columnIndex, index: row },
                  )
                }
                onClick={() => enter(columnIndex, row)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.iconDataUrl && (
                    <ThemedIcon iconDataUrl={option.iconDataUrl} iconDarkDataUrl={option.iconDarkDataUrl} />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                    )}
                  </span>
                </span>
                {branch ? (
                  <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  selected && <Check size={13} className="shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
