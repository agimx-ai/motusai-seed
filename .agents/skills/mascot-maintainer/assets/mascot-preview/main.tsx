import { createRoot } from 'react-dom/client'
import { SeedlingMascot } from '../src/renderer/components/SeedlingMascot'
import { buildConfig } from '../src/shared/build-config.generated'
import type { CompanionConnectionAccessory, CompanionVisualState } from '../src/renderer/lib/companion'
import '../src/renderer/styles.css'
import './preview.css'

const params = new URLSearchParams(window.location.search)
const group = params.get('group') ?? 'all'
const theme = params.get('theme') ?? 'light'
const motion = params.get('motion') ?? 'normal'
const detail = params.get('detail') ?? 'false'

if (theme === 'dark') document.documentElement.dataset.theme = 'dark'
if (motion === 'reduce') document.documentElement.dataset.reducedMotion = 'true'
if (detail === 'true') document.documentElement.dataset.detail = 'true'

type PreviewState = {
  state: CompanionVisualState
  label: string
  accessory?: CompanionConnectionAccessory
}

const baseStates: PreviewState[] = [
  { state: 'idle', label: '空闲待命' },
  { state: 'running', label: '收到任务' },
  { state: 'working', label: '持续工作' },
  { state: 'waiting', label: '等待确认' },
  { state: 'review', label: '任务完成' },
  { state: 'failed', label: '任务失败' },
  { state: 'listening', label: '正在聆听' },
  { state: 'paused', label: '录音暂停' },
  { state: 'processing', label: '整理录音' },
  { state: 'unconfigured', label: '尚未配置' },
  { state: 'disconnected', label: '连接断开' },
  { state: 'reconnecting', label: '重新连接' },
  { state: 'connectionFailed', label: '重连失败' },
  { state: 'connectionRestored', label: '连接恢复' },
]

const combinedStates: PreviewState[] = [
  { state: 'working', label: '工作中 · 正在重连', accessory: 'reconnecting' },
  { state: 'listening', label: '聆听中 · 连接异常', accessory: 'connectionFailed' },
  { state: 'processing', label: '整理中 · 连接恢复', accessory: 'connectionRestored' },
  { state: 'waiting', label: '等待中 · 连接断开', accessory: 'disconnected' },
]

const stateGroups = [
  { value: 'all', label: '全部状态' },
  { value: 'core', label: '任务' },
  { value: 'audio', label: '录音' },
  { value: 'connection', label: '连接' },
  { value: 'combined', label: '并发组合' },
] as const

const focusGroups = [
  { value: 'working', label: '持续工作' },
  { value: 'reconnecting', label: '重新连接' },
  { value: 'restored', label: '连接恢复' },
] as const

const groups = [...stateGroups, ...focusGroups]

function statesForGroup(value: string): PreviewState[] {
  if (value === 'combined') return combinedStates
  if (value === 'connection') return baseStates.slice(9)
  if (value === 'working') return baseStates.filter(({ state }) => state === 'working')
  if (value === 'reconnecting') return baseStates.filter(({ state }) => state === 'reconnecting')
  if (value === 'restored') return baseStates.filter(({ state }) => state === 'connectionRestored')
  if (value === 'core') return baseStates.slice(0, 6)
  if (value === 'audio') return baseStates.slice(6, 9)
  return [...baseStates, ...combinedStates]
}

function hrefFor(key: string, value: string, defaultValue: string) {
  const next = new URLSearchParams(params)
  if (value === defaultValue) next.delete(key)
  else next.set(key, value)
  const query = next.toString()
  return `${window.location.pathname}${query ? `?${query}` : ''}`
}

function Choice({ queryKey, value, current, defaultValue, children }: {
  queryKey: string
  value: string
  current: string
  defaultValue: string
  children: string
}) {
  const active = value === current
  return <a className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} href={hrefFor(queryKey, value, defaultValue)}>
    {children}
  </a>
}

function Controls() {
  return <nav className="controls" aria-label="预览选项">
    <div className="controls__row">
      <span>状态</span>
      <div className="controls__choices">
        {stateGroups.map((item) => <Choice key={item.value} queryKey="group" value={item.value} current={group} defaultValue="all">{item.label}</Choice>)}
      </div>
    </div>
    <div className="controls__row">
      <span>聚焦</span>
      <div className="controls__choices">
        {focusGroups.map((item) => <Choice key={item.value} queryKey="group" value={item.value} current={group} defaultValue="all">{item.label}</Choice>)}
      </div>
    </div>
    <div className="controls__row">
      <span>显示</span>
      <div className="controls__choices">
        <Choice queryKey="theme" value="light" current={theme} defaultValue="light">浅色</Choice>
        <Choice queryKey="theme" value="dark" current={theme} defaultValue="light">深色</Choice>
        <Choice queryKey="motion" value="normal" current={motion} defaultValue="normal">正常动画</Choice>
        <Choice queryKey="motion" value="reduce" current={motion} defaultValue="normal">减弱动态</Choice>
        <Choice queryKey="detail" value="false" current={detail} defaultValue="false">总览</Choice>
        <Choice queryKey="detail" value="true" current={detail} defaultValue="false">放大</Choice>
      </div>
    </div>
  </nav>
}

function Card({ state, label, accessory }: PreviewState) {
  return <article data-state={state} data-accessory={accessory ?? ''}>
    <SeedlingMascot state={state} connectionAccessory={accessory} label={`检查${label}`} />
    <strong>{label}</strong>
    <code>{state}{accessory ? ` + ${accessory}` : ''}</code>
  </article>
}

function Preview() {
  const states = statesForGroup(group)
  const title = groups.find((item) => item.value === group)?.label ?? '全部状态'

  return <main>
    <header className="preview-header">
      <div>
        <span>MotusAI Seed · 开发工具</span>
        <h1>伙伴状态预览</h1>
        <p>直接渲染生产组件 · 点击伙伴可检查互动反馈</p>
      </div>
      <div className="preview-header__summary">
        <strong>{title}</strong>
        <small>{states.length} 个画面 · {buildConfig.appName} / {buildConfig.branding}</small>
      </div>
    </header>
    <Controls />
    <section className="gallery">{states.map((item) => <Card key={`${item.state}-${item.accessory ?? ''}`} {...item} />)}</section>
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
