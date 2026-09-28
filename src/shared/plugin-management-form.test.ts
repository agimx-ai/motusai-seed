import { describe, expect, it } from 'vitest'
import { seedPluginManagementViewSchema } from './plugin-manifest'
import { invalidManagementInput, managementFormArguments } from './plugin-management-form'

const localized = (value: string) => ({ en_US: value, zh_Hans: value })
const view = seedPluginManagementViewSchema.parse({
  id: 'form', renderer: 'seed.collection', title: localized('Form'), description: localized('Form'),
  toolbar: [{ type: 'action', action_id: 'submit' }],
  actions: [{ id: 'submit', label: localized('Submit'), target: { capability: 'form', method: 'submit' }, input: {
    title: localized('Submit'), confirm_label: localized('Submit'), fields: [
      { key: 'email', type: 'email', label: localized('Email'), required: true },
      { key: 'count', type: 'number', label: localized('Count'), min_value: 1, max_value: 10 },
      { key: 'mode', type: 'select', label: localized('Mode'), options: [{ value: 'one', label: localized('One') }] },
      { key: 'agree', type: 'checkbox', label: localized('Agree'), required: true },
      { key: 'document', type: 'file', label: localized('Document'), accept: ['.pdf'] },
    ],
  } }],
})
const fields = view.actions[0]!.input!.fields

describe('plugin management form values', () => {
  it('submits typed numbers and booleans while keeping local file paths as strings', () => {
    const values = managementFormArguments(fields, { email: 'a@example.com', count: '3', mode: 'one', agree: true, document: '/tmp/report.pdf' })
    expect(values).toEqual({ email: 'a@example.com', count: 3, mode: 'one', agree: true, document: '/tmp/report.pdf' })
    expect(invalidManagementInput(fields, values)).toBeNull()
  })

  it('rejects missing required values, invalid types, range violations and unaccepted files', () => {
    const valid = { email: 'a@example.com', count: 3, mode: 'one', agree: true, document: '/tmp/report.pdf' }
    expect(invalidManagementInput(fields, { ...valid, email: '' })).toBe('email')
    expect(invalidManagementInput(fields, { ...valid, count: 11 })).toBe('count')
    expect(invalidManagementInput(fields, { ...valid, count: '3' })).toBe('count')
    expect(invalidManagementInput(fields, { ...valid, mode: 'unknown' })).toBe('mode')
    expect(invalidManagementInput(fields, { ...valid, agree: false })).toBe('agree')
    expect(invalidManagementInput(fields, { ...valid, document: '../report.pdf' })).toBe('document')
    expect(invalidManagementInput(fields, { ...valid, document: 'C:\\Reports\\report.docx' })).toBe('document')
    expect(invalidManagementInput(fields, { ...valid, document: 'C:\\Reports\\report.PDF' })).toBeNull()
  })

  it('rejects nonexistent calendar dates', () => {
    const dateFields = seedPluginManagementViewSchema.parse({
      id: 'dates', renderer: 'seed.collection', title: localized('Dates'), description: localized('Dates'),
      toolbar: [{ type: 'action', action_id: 'submit' }],
      actions: [{ id: 'submit', label: localized('Submit'), target: { capability: 'form', method: 'submit' }, input: {
        title: localized('Date'), confirm_label: localized('Submit'), fields: [{ key: 'day', type: 'date', label: localized('Day'), required: true }],
      } }],
    }).actions[0]!.input!.fields
    expect(invalidManagementInput(dateFields, { day: '2026-02-29' })).toBe('day')
    expect(invalidManagementInput(dateFields, { day: '2024-02-29' })).toBeNull()
  })

  it('passes multiple local files as absolute path arrays', () => {
    const multiFields = seedPluginManagementViewSchema.parse({
      id: 'files', renderer: 'seed.collection', title: localized('Files'), description: localized('Files'),
      toolbar: [{ type: 'action', action_id: 'submit' }],
      actions: [{ id: 'submit', label: localized('Submit'), target: { capability: 'form', method: 'submit' }, input: {
        title: localized('Files'), confirm_label: localized('Submit'), fields: [
          { key: 'sources', type: 'files', label: localized('Sources'), required: true, accept: ['.pdf', '.docx'] },
        ],
      } }],
    }).actions[0]!.input!.fields
    const paths = ['/tmp/URS.docx', 'D:\\Docs\\FS.pdf']
    expect(managementFormArguments(multiFields, { sources: paths })).toEqual({ sources: paths })
    expect(invalidManagementInput(multiFields, { sources: paths })).toBeNull()
    expect(invalidManagementInput(multiFields, { sources: [] })).toBe('sources')
    expect(invalidManagementInput(multiFields, { sources: ['/tmp/URS.docx', '../FS.pdf'] })).toBe('sources')
    expect(invalidManagementInput(multiFields, { sources: ['/tmp/URS.txt'] })).toBe('sources')
  })
})
