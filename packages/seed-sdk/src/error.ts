import type { SeedBillingReceipt } from './index.js';

export type SeedPluginErrorParameter = string | number | boolean;

export class SeedPluginError extends Error {
  readonly code: string;
  readonly params: Record<string, SeedPluginErrorParameter>;
  /** Host-owned settlement metadata; absent or incomplete never means zero. */
  billing?: SeedBillingReceipt;

  constructor(code: string, fallbackMessage: string, params: Record<string, SeedPluginErrorParameter> = {}) {
    super(fallbackMessage);
    this.name = 'SeedPluginError';
    this.code = code;
    this.params = params;
  }
}
