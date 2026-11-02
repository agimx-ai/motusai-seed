import { describe, expect, it } from 'vitest';
import { textContextMenu } from './text-context-menu';
import messages from './i18n/locales/zh-CN/menu.json';

const editFlags = { canUndo: false, canRedo: false, canCut: false, canCopy: true, canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: false };
describe('native text context menu', () => {
  it('offers only copy for selected read-only text, and no menu for unselected content', () => {
    expect(textContextMenu({ isEditable: false, selectionText: '报告正文', editFlags }, messages)).toEqual([{ role: 'copy', label: messages.copy, enabled: true }]);
    expect(textContextMenu({ isEditable: false, selectionText: '', editFlags }, messages)).toEqual([]);
  });
  it('uses native edit availability for editable fields, including disabled copy and cut', () => {
    expect(textContextMenu({ isEditable: true, selectionText: '', editFlags: { ...editFlags, canCopy: false } }, messages)).toEqual([
      { role: 'cut', label: messages.cut, enabled: false },
      { role: 'copy', label: messages.copy, enabled: false },
      { role: 'paste', label: messages.paste, enabled: true },
      { type: 'separator' },
      { role: 'selectAll', label: messages.selectAll, enabled: true },
    ]);
  });
});
