import type { SeedInvocation } from '@motus-ai/seed-sdk';
import type { WorkerCommand } from '../shared/contracts';

export type PluginInvokeContext = Omit<SeedInvocation, 'principal' | 'signal'> &
  Partial<Pick<SeedInvocation, 'principal' | 'signal'>>;

export type PluginHostServices = {
  configuration(): Extract<WorkerCommand, { type: 'configure' }> | null;
  invoke_host(service: string, args: Record<string, unknown>): Promise<unknown>;
};
