import { Component, type Disposer } from './component.js';
import { toast } from 'sonner';
import type { App, Plugin } from './plugin.js';

function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const child = parent.ownerDocument.createElement(tag);
  if (className) child.className = className;
  parent.append(child);
  return child;
}

function report(work: unknown): void {
  if (work && typeof (work as Promise<unknown>).then === 'function') {
    void Promise.resolve(work).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  }
}

export class BaseComponent extends Component {
  constructor(readonly containerEl: HTMLElement) {
    super();
  }
  setDisabled(disabled: boolean): this {
    for (const control of this.containerEl.querySelectorAll('input, select, textarea, button'))
      (control as HTMLInputElement).disabled = disabled;
    return this;
  }
}

export class ValueComponent<T, E extends HTMLElement> extends BaseComponent {
  protected change?: (value: T) => unknown;
  constructor(
    container: HTMLElement,
    readonly inputEl: E,
    private readonly read: () => T,
    private readonly write: (value: T) => void,
  ) {
    super(container);
    this.registerDomEvent(inputEl, 'change', () => {
      if (this.change) report(this.change(this.read()));
    });
  }
  getValue(): T {
    return this.read();
  }
  setValue(value: T): this {
    this.write(value);
    return this;
  }
  onChange(callback: (value: T) => unknown): this {
    this.change = callback;
    return this;
  }
}

export class TextComponent extends ValueComponent<string, HTMLInputElement> {
  constructor(container: HTMLElement) {
    const input = element(container, 'input', 'seed-input');
    input.type = 'text';
    super(
      container,
      input,
      () => input.value,
      (value) => {
        input.value = value;
      },
    );
  }
  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }
}
export class TextAreaComponent extends ValueComponent<string, HTMLTextAreaElement> {
  constructor(container: HTMLElement) {
    const input = element(container, 'textarea', 'seed-input');
    super(
      container,
      input,
      () => input.value,
      (value) => {
        input.value = value;
      },
    );
  }
  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }
}
export class ToggleComponent extends ValueComponent<boolean, HTMLInputElement> {
  constructor(container: HTMLElement) {
    const input = element(container, 'input', 'seed-toggle');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    super(
      container,
      input,
      () => input.checked,
      (value) => {
        input.checked = value;
      },
    );
  }
}
export class DropdownComponent extends ValueComponent<string, HTMLSelectElement> {
  readonly selectEl: HTMLSelectElement;
  constructor(container: HTMLElement) {
    const input = element(container, 'select', 'seed-input');
    super(
      container,
      input,
      () => input.value,
      (value) => {
        input.value = value;
      },
    );
    this.selectEl = input;
  }
  addOption(value: string, display: string): this {
    const option = element(this.inputEl, 'option');
    option.value = value;
    option.textContent = display;
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [value, text] of Object.entries(options)) this.addOption(value, text);
    return this;
  }
}
export class SliderComponent extends ValueComponent<number, HTMLInputElement> {
  constructor(container: HTMLElement) {
    const input = element(container, 'input', 'seed-slider');
    input.type = 'range';
    super(
      container,
      input,
      () => Number(input.value),
      (value) => {
        input.value = String(value);
      },
    );
  }
  setLimits(min: number, max: number, step: number): this {
    this.inputEl.min = String(min);
    this.inputEl.max = String(max);
    this.inputEl.step = String(step);
    return this;
  }
}
export class ButtonComponent extends BaseComponent {
  readonly buttonEl: HTMLButtonElement;
  private click?: () => unknown;
  constructor(container: HTMLElement) {
    super(container);
    this.buttonEl = element(container, 'button', 'seed-button');
    this.buttonEl.type = 'button';
    this.registerDomEvent(this.buttonEl, 'click', () => {
      if (this.click) report(this.click());
    });
  }
  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }
  setTooltip(text: string): this {
    this.buttonEl.title = text;
    return this;
  }
  setCta(): this {
    this.buttonEl.classList.add('mod-cta');
    return this;
  }
  setWarning(): this {
    this.buttonEl.classList.add('mod-warning');
    return this;
  }
  onClick(callback: () => unknown): this {
    this.click = callback;
    return this;
  }
  override setDisabled(value: boolean): this {
    this.buttonEl.disabled = value;
    return this;
  }
}

/** Optional building blocks; custom DOM/components do not require a new host renderer. */
export class Setting extends Component {
  readonly settingEl: HTMLDivElement;
  readonly infoEl: HTMLDivElement;
  readonly nameEl: HTMLDivElement;
  readonly descEl: HTMLDivElement;
  readonly controlEl: HTMLDivElement;
  constructor(container: HTMLElement) {
    super();
    this.settingEl = element(container, 'div', 'seed-setting');
    this.infoEl = element(this.settingEl, 'div', 'seed-setting-info');
    this.nameEl = element(this.infoEl, 'div', 'seed-setting-name');
    this.descEl = element(this.infoEl, 'div', 'seed-setting-description');
    this.controlEl = element(this.settingEl, 'div', 'seed-setting-controls');
    this.register(() => this.settingEl.remove());
  }
  setName(value: string): this {
    this.nameEl.textContent = value;
    return this;
  }
  setDesc(value: string): this {
    this.descEl.textContent = value;
    return this;
  }
  setHeading(): this {
    this.settingEl.classList.add('is-heading');
    return this;
  }
  setDisabled(value: boolean): this {
    for (const item of this.controlEl.querySelectorAll('input,select,textarea,button'))
      (item as HTMLInputElement).disabled = value;
    return this;
  }
  addComponent<T extends BaseComponent>(factory: (container: HTMLElement) => T): T {
    const child = this.addChild(factory(this.controlEl));
    const label = this.nameEl.textContent;
    if (label)
      for (const input of child.containerEl.querySelectorAll('input,select,textarea'))
        input.setAttribute('aria-label', label);
    return child;
  }
  addText(callback: (component: TextComponent) => unknown): this {
    callback(this.addComponent((el) => new TextComponent(el)));
    return this;
  }
  addTextArea(callback: (component: TextAreaComponent) => unknown): this {
    callback(this.addComponent((el) => new TextAreaComponent(el)));
    return this;
  }
  addToggle(callback: (component: ToggleComponent) => unknown): this {
    callback(this.addComponent((el) => new ToggleComponent(el)));
    return this;
  }
  addDropdown(callback: (component: DropdownComponent) => unknown): this {
    callback(this.addComponent((el) => new DropdownComponent(el)));
    return this;
  }
  addSlider(callback: (component: SliderComponent) => unknown): this {
    callback(this.addComponent((el) => new SliderComponent(el)));
    return this;
  }
  addButton(callback: (component: ButtonComponent) => unknown): this {
    callback(this.addComponent((el) => new ButtonComponent(el)));
    return this;
  }
}

export class PluginSettingTab extends Component {
  readonly containerEl: HTMLElement;
  private displayScope?: Component;
  constructor(
    readonly app: App,
    readonly plugin: Plugin,
  ) {
    super();
    this.containerEl = document.createElement('section');
    this.containerEl.className = 'seed-settings';
  }
  /** Plugin code owns rendering and persistence. No form schema or control-name interpreter. */
  display(): void | Promise<void> {}
  async show(): Promise<void> {
    await this.hide();
    this.displayScope = super.addChild(new Component());
    try {
      await this.display();
    } catch (error) {
      await this.hide();
      throw error;
    }
  }
  override addChild<T extends Component>(child: T): T {
    return this.displayScope ? this.displayScope.addChild(child) : super.addChild(child);
  }
  override register(disposer: Disposer): void {
    if (this.displayScope) this.displayScope.register(disposer);
    else super.register(disposer);
  }
  async update(): Promise<void> {
    await this.show();
  }
  async hide(): Promise<void> {
    const scope = this.displayScope;
    this.displayScope = undefined;
    if (scope) await this.removeChild(scope);
    this.containerEl.replaceChildren();
  }
  override onunload(): void {
    this.containerEl.remove();
  }
}

export type ViewHost = { containerEl: HTMLElement; close(): Promise<void>; setTitle(title: string): void };
export abstract class View extends Component {
  readonly containerEl: HTMLElement;
  constructor(
    readonly app: App,
    readonly host: ViewHost,
  ) {
    super();
    this.containerEl = host.containerEl;
  }
  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getState(): Record<string, unknown> {
    return {};
  }
  async setState(_state: Record<string, unknown>): Promise<void> {}
  getEphemeralState(): Record<string, unknown> {
    return {};
  }
  setEphemeralState(_state: Record<string, unknown>): void {}
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  onResize(): void {}
  override async onload(): Promise<void> {
    this.register(() => this.onClose());
    await this.onOpen();
  }
}
export abstract class ItemView extends View {
  readonly contentEl: HTMLElement;
  constructor(app: App, host: ViewHost) {
    super(app, host);
    this.contentEl = element(this.containerEl, 'div', 'seed-view-content');
    this.register(() => this.contentEl.remove());
  }
}

export class Modal extends Component {
  readonly modalEl: HTMLDialogElement;
  readonly contentEl: HTMLDivElement;
  private readonly previousFocus: Element | null;
  constructor(readonly app: App) {
    super();
    this.previousFocus = document.activeElement;
    this.modalEl = document.createElement('dialog');
    this.modalEl.className = 'seed-modal';
    this.contentEl = element(this.modalEl, 'div', 'seed-modal-content');
    this.registerDomEvent(this.modalEl, 'cancel', (event) => {
      event.preventDefault();
      void this.close();
    });
    this.register(() => {
      this.modalEl.remove();
      if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
    });
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
  async open(): Promise<void> {
    await this.load();
  }
  async close(): Promise<void> {
    await this.unload();
  }
  override async onload(): Promise<void> {
    document.body.append(this.modalEl);
    this.modalEl.showModal();
    await this.onOpen();
  }
  override onunload(): void {
    this.onClose();
  }
}

export class MenuItem {
  constructor(readonly buttonEl: HTMLButtonElement) {}
  setTitle(value: string): this {
    this.buttonEl.textContent = value;
    return this;
  }
  setDisabled(value: boolean): this {
    this.buttonEl.disabled = value;
    return this;
  }
  onClick(callback: () => unknown): this {
    this.buttonEl.onclick = () => {
      report(callback());
    };
    return this;
  }
}
export class Menu extends Component {
  readonly menuEl = document.createElement('div');
  constructor() {
    super();
    this.menuEl.className = 'seed-menu';
    this.menuEl.setAttribute('role', 'menu');
    this.register(() => this.menuEl.remove());
  }
  addItem(callback: (item: MenuItem) => void): this {
    const button = element(this.menuEl, 'button', 'seed-menu-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    callback(new MenuItem(button));
    this.registerDomEvent(button, 'click', () => {
      void this.unload();
    });
    return this;
  }
  showAtPosition(position: { x: number; y: number }): void {
    document.body.append(this.menuEl);
    this.menuEl.style.left = position.x + 'px';
    this.menuEl.style.top = position.y + 'px';
    this.registerDomEvent(document, 'pointerdown', (event) => {
      if (!this.menuEl.contains(event.target as Node)) void this.unload();
    });
    this.registerDomEvent(document, 'keydown', (event) => {
      if (event.key === 'Escape') void this.unload();
    });
    this.menuEl.querySelector('button')?.focus();
  }
}
