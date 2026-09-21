import { describe, expect, it } from 'vitest'
import { seedCapabilityMethodSchema, seedPluginConfigurationSchema, seedPluginManagementViewSchema, seedPluginManifestSchema } from './plugin-manifest'

const text = (value: string) => ({ en_US: value, zh_Hans: value })

describe('capability billing settlement annotation', () => {
  const method = { name: 'search', risk: 'read', annotations: {
    'billing.settlement': 'cloud_relay', 'billing.relay_template': 'searxng_search', 'billing.product': 'web.search',
  } }

  it('accepts an explicit Cloud relay settlement boundary', () => {
    expect(seedCapabilityMethodSchema.parse(method).annotations['billing.settlement']).toBe('cloud_relay')
  })

  it('rejects unknown modes and contradictory billing exemption', () => {
    expect(seedCapabilityMethodSchema.safeParse({ ...method, annotations: { 'billing.settlement': 'local' } }).success).toBe(false)
    expect(seedCapabilityMethodSchema.safeParse({ ...method, annotations: {
      'billing.settlement': 'cloud_relay', 'billing.exempt': true,
    } }).success).toBe(false)
    expect(seedCapabilityMethodSchema.safeParse({ ...method, annotations: {
      ...method.annotations, 'billing.mode': 'per_call',
    } }).success).toBe(false)
  })
})

describe('plugin detail presentation schema', () => {
  it('supports a framework-rendered route declared by the plugin', () => {
    const manifest = seedPluginManifestSchema.parse({
      id: 'com.example.files',
      name: text('Files'),
      labels: ['utilities'],
      version: '1.0.0',
      min_seed_version: '0.2.0',
      publisher: 'example',
      icon: './assets/icon.svg',
      runtime: { kind: 'native-host' },
      caps: ['./caps/files.yaml'],
      detail_presentation: {
        renderer: 'seed.route',
        summary: text('Files stay on this device.'),
        nodes: [
          { icon: 'agent', title: text('Agent'), description: text('Requests an operation') },
          { icon: 'shield', title: text('File Engine'), description: text('Checks and executes') },
          { icon: 'folder', title: text('Local files'), description: text('Read and modify') },
        ],
      },
    })
    expect(manifest.detailPresentation).toMatchObject({ renderer: 'seed.route' })
    expect(manifest.detailPresentation?.nodes).toHaveLength(3)
  })
})

describe('plugin dynamic configuration options schema', () => {
  const configuration = {
    id: 'source', schema_version: 1, renderer: 'seed.profiles', title: text('Source'), description: text('Source'), fields: [],
    profiles: {
      id_prefix: 'source', min_items: 1, max_items: 2, default_required: true, summary_fields: ['value'],
      fields: [
        { key: 'endpoint', type: 'url', label: text('Endpoint'), description: text('Service endpoint.'), help_url: 'https://docs.example.com/endpoints', schemes: ['https'] },
        { key: 'value', type: 'text', label: text('Value'), dynamic_options: { depends_on: ['endpoint'] } },
      ],
      actions: { save: { label: text('Save') } },
    },
  }

  it('allows an optional empty profile collection', () => {
    const optional: any = structuredClone(configuration)
    optional.profiles.min_items = 0
    optional.profiles.default_required = false
    optional.profiles.default_group = 'conversation-model'
    expect(seedPluginConfigurationSchema.parse(optional).profiles).toMatchObject({ minItems: 0, defaultGroup: 'conversation-model' })
  })

  it('supports framework-rendered source selection routes for a default group', () => {
    const grouped: any = structuredClone(configuration)
    grouped.profiles.default_group = 'conversation-model'
    grouped.source_presentation = {
      mode: 'relay',
      summary: text('Requests are relayed without storage.'),
      origin: { title: text('Device'), description: text('Starts the request') },
      relay: { title: text('Seed Cloud'), description: text('Relay only') },
      destination: { title: text('Provider'), description: text('Processes the request') },
    }
    expect(seedPluginConfigurationSchema.parse(grouped).sourcePresentation).toMatchObject({ mode: 'relay' })
    delete grouped.profiles.default_group
    expect(() => seedPluginConfigurationSchema.parse(grouped)).toThrow('来源展示必须属于一个默认配置组')
  })

  it('supports a standalone form without profile declarations', () => {
    const form = {
      id: 'hosted-model', schema_version: 1, renderer: 'seed.form', title: text('Hosted model'), description: text('Hosted model'),
      fields: [{ key: 'model', type: 'text', label: text('Model'), required: true }],
      actions: { save: { label: text('Save') } },
    }
    const parsed = seedPluginConfigurationSchema.parse(form)
    expect(parsed.profiles.minItems).toBe(0)
    expect(parsed.profiles.maxItems).toBe(1)
    expect(seedPluginConfigurationSchema.safeParse({ ...form, profiles: configuration.profiles }).success).toBe(false)
  })

  it('keeps dynamic options generic and resolves declared dependencies', () => {
    const parsed = seedPluginConfigurationSchema.parse(configuration)
    expect(parsed.profiles.fields[1]?.dynamicOptions).toEqual({ dependsOn: ['endpoint'], requiredFields: [] })
    expect(parsed.profiles.fields[0]?.helpUrl).toBe('https://docs.example.com/endpoints')
    const independent: any = structuredClone(configuration)
    independent.profiles.fields[1].dynamic_options = {}
    expect(seedPluginConfigurationSchema.parse(independent).profiles.fields[1]?.dynamicOptions).toEqual({ dependsOn: [], requiredFields: [] })
  })

  it('supports a generic single-selection dynamic option list', () => {
    const list: any = structuredClone(configuration)
    list.renderer = 'seed.option-list'
    list.profiles.max_items = 1
    list.profiles.fields = [{ key: 'value', type: 'text', label: text('Value'), dynamic_options: {} }]
    list.profiles.summary_fields = ['value']
    list.profiles.actions.set_default = { label: text('Set as default'), selected_label: text('Default') }
    expect(seedPluginConfigurationSchema.parse(list)).toMatchObject({ renderer: 'seed.option-list' })

    const dependent: any = structuredClone(list)
    dependent.profiles.fields[0].dynamic_options.depends_on = ['value']
    expect(() => seedPluginConfigurationSchema.parse(dependent)).toThrow('动态选项列表不能依赖其他配置字段')

    const multiple: any = structuredClone(list)
    multiple.profiles.max_items = 2
    expect(() => seedPluginConfigurationSchema.parse(multiple)).toThrow('选项列表只能保存一个选中项')
  })

  it('supports a generic display-only dynamic catalog list', () => {
    const catalog: any = structuredClone(configuration)
    catalog.renderer = 'seed.catalog-list'
    catalog.profiles.min_items = 0
    catalog.profiles.max_items = 1
    catalog.profiles.default_required = false
    catalog.profiles.fields = [{ key: 'value', type: 'text', label: text('Value'), dynamic_options: {} }]
    catalog.profiles.summary_fields = ['value']
    delete catalog.profiles.actions.add
    delete catalog.profiles.actions.remove
    delete catalog.profiles.actions.set_default
    expect(seedPluginConfigurationSchema.parse(catalog)).toMatchObject({ renderer: 'seed.catalog-list' })

    const selectable: any = structuredClone(catalog)
    selectable.profiles.actions.set_default = { label: text('Set as default'), selected_label: text('Default') }
    expect(() => seedPluginConfigurationSchema.parse(selectable)).toThrow('只读目录列表不能声明档案操作')

    const required: any = structuredClone(catalog)
    required.profiles.min_items = 1
    expect(() => seedPluginConfigurationSchema.parse(required)).toThrow('只读目录列表不能要求保存选中项')
  })

  it('allows profiles to opt into framework connection status', () => {
    const withStatus: any = structuredClone(configuration)
    withStatus.profiles.status = { source: 'connections', refresh_interval_ms: 1_500 }
    expect(seedPluginConfigurationSchema.parse(withStatus).profiles.status).toEqual({
      source: 'connections',
      refreshIntervalMs: 1_500,
    })
  })

  it('accepts localized placeholders only on input fields', () => {
    const withPlaceholder: any = structuredClone(configuration)
    withPlaceholder.profiles.fields[0].placeholder = { en_US: 'https://example.com', zh_Hans: 'https://example.com' }
    expect(seedPluginConfigurationSchema.parse(withPlaceholder).profiles.fields[0]?.placeholder).toEqual(withPlaceholder.profiles.fields[0].placeholder)
    withPlaceholder.profiles.fields[0].placeholder = { en_US: 'Only English' }
    expect(seedPluginConfigurationSchema.safeParse(withPlaceholder).success).toBe(false)
    withPlaceholder.profiles.fields[0] = { key: 'endpoint', type: 'select', label: text('Endpoint'), options: [{ value: 'one', label: text('One') }], placeholder: text('Choose') }
    expect(seedPluginConfigurationSchema.safeParse(withPlaceholder).success).toBe(false)
  })

  it('rejects invalid field types and undeclared dependencies', () => {
    const invalidType: any = structuredClone(configuration)
    invalidType.profiles.fields[1] = { key: 'value', type: 'url', label: text('Value'), schemes: ['https'], dynamic_options: { depends_on: ['endpoint'] } }
    expect(() => seedPluginConfigurationSchema.parse(invalidType)).toThrow('只有文本字段')
    const invalidDependency: any = structuredClone(configuration)
    invalidDependency.profiles.fields[1].dynamic_options = { depends_on: ['missing'] }
    expect(() => seedPluginConfigurationSchema.parse(invalidDependency)).toThrow('动态选项依赖了不存在的字段')
    const invalidRequirement: any = structuredClone(configuration)
    invalidRequirement.profiles.fields[1].dynamic_options = { required_fields: ['missing'] }
    expect(() => seedPluginConfigurationSchema.parse(invalidRequirement)).toThrow('动态选项要求了不存在的字段')
    const insecureHelpUrl: any = structuredClone(configuration)
    insecureHelpUrl.profiles.fields[0].help_url = 'http://docs.example.com/endpoints'
    expect(() => seedPluginConfigurationSchema.parse(insecureHelpUrl)).toThrow('帮助链接必须使用 HTTPS')
    const helpUrlWithoutDescription: any = structuredClone(configuration)
    delete helpUrlWithoutDescription.profiles.fields[0].description
    expect(() => seedPluginConfigurationSchema.parse(helpUrlWithoutDescription)).toThrow('帮助链接必须同时声明字段说明')
  })
})

describe('plugin management view schema', () => {
  it('parses plugin-defined actions, input fields and refresh behavior', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'workflow',
      renderer: 'seed.collection',
      title: text('Workflow'),
      description: text('Manage a workflow.'),
      source: { capability: 'workflow', method: 'view' },
      refresh_interval_ms: 1_000,
      toolbar: [{ type: 'action', action_id: 'start' }, { type: 'refresh' }],
      actions: [{
        id: 'start',
        label: text('Start'),
        icon: 'record',
        tone: 'primary',
        placement: 'toolbar',
        target: { capability: 'workflow', method: 'start' },
        visible_when: { path: 'state', in: ['idle'] },
        input: {
          title: text('Start workflow'),
          confirm_label: text('Start'),
          fields: [{
            key: 'goal',
            type: 'textarea',
            label: text('Goal'),
            description: text('Describe the goal.'),
            help_url: 'https://docs.example.com/goals',
            required: true,
            max_length: 500,
            initial_value_path: 'draft.goal',
          }],
        },
      }],
    })

    expect(view.refreshIntervalMs).toBe(1_000)
    expect(view.actions[0]).toMatchObject({
      id: 'start',
      visibleWhen: { path: 'state', in: ['idle'] },
      input: {
        confirmLabel: text('Start'),
        fields: [{ maxLength: 500, initialValuePath: 'draft.goal', helpUrl: 'https://docs.example.com/goals' }],
      },
    })
  })

  it('rejects unsupported renderer action metadata', () => {
    expect(() => seedPluginManagementViewSchema.parse({
      id: 'workflow', renderer: 'seed.collection', title: text('Workflow'), description: text('Workflow'),
      actions: [{ id: 'start', label: text('Start'), icon: 'plugin-private-icon', target: { capability: 'workflow', method: 'start' } }],
    })).toThrow()
  })

  it('supports plugin-defined toolbar ordering', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'skills', renderer: 'seed.collection', title: text('Skills'), description: text('Manage installed Skills.'),
      actions: [{
        id: 'open-folder', label: text('Open folder'), icon: 'folder', display: 'icon', placement: 'toolbar',
        target: { capability: 'skills', method: 'open-folder' },
      }],
      toolbar: [{ type: 'refresh' }, { type: 'action', action_id: 'open-folder' }],
    })

    expect(view.actions[0]).toMatchObject({ icon: 'folder', display: 'icon', placement: 'toolbar' })
    expect(view.toolbar).toEqual([{ type: 'refresh' }, { type: 'action', actionId: 'open-folder' }])
  })

  it('rejects missing, misplaced, or duplicate toolbar entries', () => {
    const action = { id: 'open-folder', label: text('Open folder'), target: { capability: 'skills', method: 'open-folder' } }
    const base = { id: 'skills', renderer: 'seed.collection', title: text('Skills'), description: text('Skills') }
    expect(() => seedPluginManagementViewSchema.parse({ ...base, actions: [action] })).toThrow('未被 toolbar 引用')
    expect(() => seedPluginManagementViewSchema.parse({ ...base, toolbar: [{ type: 'action', action_id: 'missing' }] })).toThrow('不存在的动作')
    expect(() => seedPluginManagementViewSchema.parse({ ...base, toolbar: [{ type: 'refresh' }, { type: 'refresh' }] })).toThrow('不能重复')
  })

  it('supports extensible collection presentations and named preview data sources', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'resources', renderer: 'seed.collection', title: text('Resources'), description: text('Manage resources.'),
      source: { capability: 'resources', method: 'list' },
      data_sources: {
        preview: { capability: 'resources', method: 'get', parameters: ['id'] },
      },
      props: {
        items_path: 'resources',
        presentation: { layout: 'cards', columns: 2, item_icon: { type: 'static', src: 'data:image/svg+xml;base64,PHN2Zy8+' } },
        preview: {
          mode: 'modal', renderer: 'markdown', frontmatter: 'hide', source: 'preview', argument_bindings: { id: 'id' },
          title_field: 'resource.name', description_field: 'resource.description', content_field: 'resource.content',
          visible_when: { path: 'state', in: ['ready'] },
        },
      },
      actions: [{
        id: 'remove', label: text('Remove'), icon: 'trash', tone: 'danger', placement: 'item_footer',
        target: { capability: 'resources', method: 'remove' }, argument_bindings: { id: 'id' },
        confirmation: { title: text('Remove?'), confirm_label: text('Remove') },
      }],
    })

    expect(view.dataSources.preview).toEqual({ capability: 'resources', method: 'get', arguments: {}, parameters: ['id'] })
    expect(view.props).toMatchObject({
      presentation: { layout: 'cards', columns: 2, item_icon: { type: 'static', src: 'data:image/svg+xml;base64,PHN2Zy8+', darkSrc: undefined } },
      preview: { mode: 'modal', renderer: 'markdown', frontmatter: 'hide', source: 'preview', argumentBindings: { id: 'id' }, titleField: 'resource.name', visibleWhen: { path: 'state', in: ['ready'] } },
    })
    expect(view.actions[0]).toMatchObject({ placement: 'item_footer', argumentBindings: { id: 'id' }, confirmation: { confirmLabel: text('Remove') } })
  })

  it('rejects collection previews with undeclared data sources or parameters', () => {
    const base = {
      id: 'resources', renderer: 'seed.collection', title: text('Resources'), description: text('Resources'),
      source: { capability: 'resources', method: 'list' },
    }
    expect(() => seedPluginManagementViewSchema.parse({
      ...base,
      props: { preview: { mode: 'modal', renderer: 'markdown', source: 'missing', argument_bindings: { id: 'id' }, title_field: 'name', content_field: 'content' } },
    })).toThrow('不存在的数据源')
    expect(() => seedPluginManagementViewSchema.parse({
      ...base,
      data_sources: { preview: { capability: 'resources', method: 'get' } },
      props: { preview: { mode: 'modal', renderer: 'markdown', source: 'preview', argument_bindings: { id: 'id' }, title_field: 'name', content_field: 'content' } },
    })).toThrow('未由数据源声明')
  })

  it('requires every management view to describe its purpose', () => {
    expect(() => seedPluginManagementViewSchema.parse({
      id: 'skills', renderer: 'seed.collection', title: text('Skills'),
    })).toThrow()
  })
})

describe('plugin capability consumption schema', () => {
  it('accepts the Agimx plugin category', () => {
    const manifest = seedPluginManifestSchema.parse({
      id: 'com.example.agimx-plugin',
      version: '1.0.0',
      min_seed_version: '0.1.67',
      publisher: 'example',
      name: text('Agimx Plugin'),
      labels: ['agimx'],
      icon: './assets/icon.svg',
      runtime: { kind: 'native-host' },
      caps: ['./caps/plugin.yaml'],
    })

    expect(manifest.labels).toEqual(['agimx'])
    expect(manifest.minSeedVersion).toBe('0.1.67')
    expect(() => seedPluginManifestSchema.parse({
      id: 'com.example.agimx-plugin', version: '1.0.0', publisher: 'example',
      name: text('Agimx Plugin'), labels: ['agimx'], icon: './assets/icon.svg',
      runtime: { kind: 'native-host' }, caps: ['./caps/plugin.yaml'],
    })).toThrow()
  })

  it('accepts a reusable method annotation matcher', () => {
    const manifest = seedPluginManifestSchema.parse({
      id: 'com.example.agent',
      version: '1.0.0',
      min_seed_version: '0.1.67',
      publisher: 'example',
      name: text('Agent'),
      labels: ['utilities'],
      icon: './assets/icon.svg',
      runtime: { kind: 'native-host' },
      caps: ['./caps/agent.yaml'],
      consumes: [{ match: { method_annotation: 'agent.tool', equals: true } }],
    })

    expect(manifest.consumes).toEqual([{ match: { method_annotation: 'agent.tool', equals: true } }])
  })
})

describe('plugin network permission schema', () => {
  const manifest = {
    id: 'com.example.connector',
    version: '1.0.0',
    min_seed_version: '0.1.67',
    publisher: 'example',
    name: text('Connector'),
    labels: ['utilities'],
    icon: './assets/icon.svg',
    runtime: { kind: 'native-host' },
    caps: ['./caps/connector.yaml'],
  }

  it('accepts only the generic outbound network scopes', () => {
    expect(seedPluginManifestSchema.parse({ ...manifest, permissions: [
      'network.connect.internet', 'network.connect.lan', 'network.connect.loopback',
    ] }).permissions).toEqual(['network.connect.internet', 'network.connect.lan', 'network.connect.loopback'])
    expect(() => seedPluginManifestSchema.parse({ ...manifest, permissions: ['network'] })).toThrow(/网络权限必须是/)
    expect(() => seedPluginManifestSchema.parse({ ...manifest, permissions: ['network.vendor-bot'] }))
      .toThrow(/网络权限必须是/)
  })
})
