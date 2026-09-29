import { describe, expect, it } from 'vitest'
import { seedPluginManagementViewSchema } from './plugin-manifest'
import { invalidManagementInput, managementFormArguments, resolveManagementInitialValues, resolveManagementInputFields, resolveManagementModelValues } from './plugin-management-form'

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
  it('resolves select options from view data and validates the selected value', () => {
    const dynamic = seedPluginManagementViewSchema.parse({
      id: 'models', renderer: 'seed.panel', title: localized('Models'), description: localized('Models'),
      props: { blocks: [{ type: 'text', value_path: 'result' }] }, toolbar: [{ type: 'action', action_id: 'start' }], actions: [{ id: 'start', label: localized('Start'), target: { capability: 'draft', method: 'start' }, input: {
        mode: 'inline', fields: [{ key: 'model', type: 'select', label: localized('Model'), options_path: 'catalog.options' }],
      } }],
    }).actions[0]!.input!.fields
    const resolved = resolveManagementInputFields(dynamic, { catalog: { options: [
      { value: 'model-1', label: localized('Model 1'), group: 'seed', icon_data_url: 'data:image/png;base64,iVBORw0KGgo=', is_default: true, thinking_levels: ['off', 'low'] },
      { value: 'model-1', label: localized('Duplicate') },
      { value: 'invalid', label: 'Invalid label' },
    ] } })
    expect(resolved[0]?.options).toEqual([{ value: 'model-1', label: localized('Model 1'), group: 'seed', icon_data_url: 'data:image/png;base64,iVBORw0KGgo=', is_default: true, thinking_levels: ['off', 'low'] }])
    expect(invalidManagementInput(resolved, { model: 'model-1' })).toBeNull()
    expect(invalidManagementInput(resolved, { model: 'unknown' })).toBe('model')
    expect(invalidManagementInput(resolveManagementInputFields(dynamic, {}), { model: 'model-1' })).toBe('model')
  })

  it('selects the listed default model without adding a synthetic default option', () => {
    const modelView = seedPluginManagementViewSchema.parse({
      id: 'models', renderer: 'seed.panel', title: localized('Models'), description: localized('Models'),
      props: { blocks: [{ type: 'text', value_path: 'result' }] },
      toolbar: [{ type: 'select_field', field_key: 'model', control: 'model_select' }, { type: 'action', action_id: 'start' }],
      actions: [{ id: 'start', label: localized('Start'), target: { capability: 'draft', method: 'start' }, input: {
        mode: 'inline', fields: [{ key: 'model', type: 'select', required: true, label: localized('Model'), options_path: 'models' }],
      } }],
    })
    const modelFields = resolveManagementInputFields(modelView.actions[0]!.input!.fields, { models: [
      { value: 'custom-1', label: localized('Custom'), group: 'custom' },
      { value: 'seed-1', label: localized('Seed'), group: 'seed', is_default: true },
    ] })
    expect(resolveManagementModelValues(modelView.toolbar, modelFields, {})).toMatchObject({ model: 'seed-1' })
    expect(resolveManagementModelValues(modelView.toolbar, modelFields, { model: 'custom-1' })).toMatchObject({ model: 'custom-1' })
    expect(invalidManagementInput(modelFields, managementFormArguments(modelFields, resolveManagementModelValues(modelView.toolbar, modelFields, {})))).toBeNull()
  })

  it('restores plugin-provided model and files while preserving user edits and validating current options', () => {
    const definition = {
      id: 'remembered', renderer: 'seed.panel', title: localized('Remembered'), description: localized('Remembered'),
      props: { blocks: [{ type: 'text', value_path: 'result' }] },
      toolbar: [
        { type: 'select_field', field_key: 'model', control: 'model_select', thinking_field_key: 'thinking', on_change_action_id: 'save_model' },
        { type: 'file_input', on_change_action_id: 'save_files' },
        { type: 'action', action_id: 'start' },
      ],
      actions: [
        { id: 'save_model', placement: 'field_change', label: localized('Save model'), target: { capability: 'draft', method: 'save' }, input: { mode: 'field_change', fields: [
          { key: 'model', type: 'select', label: localized('Model'), options_path: 'models' },
          { key: 'thinking', type: 'select', label: localized('Thinking'), options: [{ value: 'low', label: localized('Low') }] },
        ] } },
        { id: 'save_files', placement: 'field_change', label: localized('Save files'), target: { capability: 'draft', method: 'save' }, input: { mode: 'field_change', fields: [
          { key: 'files', type: 'files', label: localized('Files') },
        ] } },
        { id: 'start', label: localized('Start'), target: { capability: 'draft', method: 'start' }, input: { mode: 'inline', drop_target: 'files', fields: [
          { key: 'model', type: 'select', label: localized('Model'), options_path: 'models', initial_value_path: 'selected_model' },
          { key: 'thinking', type: 'select', label: localized('Thinking'), options: [{ value: 'low', label: localized('Low') }], initial_value_path: 'selected_thinking' },
          { key: 'files', type: 'files', label: localized('Files'), initial_value_path: 'selected_files' },
        ] } },
      ],
    }
    const panel = seedPluginManagementViewSchema.parse(definition)
    const source = { models: [
      { value: 'model-1', label: localized('Model 1'), is_default: true, thinking_levels: ['low'] },
      { value: 'model-2', label: localized('Model 2'), thinking_levels: ['low'] },
    ], selected_model: 'model-2', selected_thinking: 'low', selected_files: ['/tmp/URS.docx'] }
    const inputFields = resolveManagementInputFields(panel.actions.find((action) => action.id === 'start')!.input!.fields, source)
    const restored = resolveManagementModelValues(panel.toolbar, inputFields, resolveManagementInitialValues(inputFields, source, {}))
    expect(restored).toEqual({ model: 'model-2', thinking: 'low', files: ['/tmp/URS.docx'] })
    expect(resolveManagementInitialValues(inputFields, source, { model: 'model-1', files: [] })).toEqual({ model: 'model-1', thinking: 'low', files: [] })
    expect(seedPluginManagementViewSchema.safeParse({ ...definition, toolbar: [{ type: 'file_input', on_change_action_id: 'save_model' }] }).success).toBe(false)
  })

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
