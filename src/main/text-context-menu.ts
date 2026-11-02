import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import type { NativeMenuMessages } from './i18n/native-menu';

/** Native editing commands act on the focused document's selection. */
export function textContextMenu(
  { isEditable, selectionText, editFlags }: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>,
  messages: NativeMenuMessages,
): MenuItemConstructorOptions[] {
  if (!isEditable) return selectionText ? [{ role: 'copy', label: messages.copy, enabled: editFlags.canCopy }] : [];
  return [
    { role: 'cut', label: messages.cut, enabled: editFlags.canCut },
    { role: 'copy', label: messages.copy, enabled: editFlags.canCopy },
    { role: 'paste', label: messages.paste, enabled: editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: messages.selectAll, enabled: editFlags.canSelectAll },
  ];
}
