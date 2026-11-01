import { describe, expect, it, vi } from 'vitest';
import { PluginService, type PluginServices, type PluginManifest } from '@motus-ai/seed-sdk';

const manifest: PluginManifest = {
  id: 'com.example.profile',
  name: 'Profile',
  version: '1.0.0',
  minAppVersion: '0.3.14',
  description: 'Profile fixture',
  author: 'Example',
};
const profile = { display_name: '测试用户', avatar_url: 'https://example.test/avatar.webp' };
function fixture(value: unknown) {
  const invokeHost = vi.fn(async () => value);
  const service = new PluginService({ invokeHost } as unknown as PluginServices, manifest);
  return { service, invokeHost };
}

describe('SDK read-only current user profile', () => {
  it('reads only presentation fields and never starts authorization', async () => {
    const { service, invokeHost } = fixture({ ...profile, access_token: 'private', email: 'private@example.test' });
    await service.load();
    try {
      await expect(service.app.user.getProfile()).resolves.toEqual(profile);
      expect(invokeHost).toHaveBeenCalledExactlyOnceWith('seed.user-profile', { operation: 'read' });
    } finally {
      await service.unload();
    }
  });
  it('returns null when signed out and preserves a profile without an avatar', async () => {
    for (const value of [null, { ...profile, avatar_url: null }]) {
      const { service } = fixture(value);
      await service.load();
      try {
        await expect(service.app.user.getProfile()).resolves.toEqual(value);
      } finally {
        await service.unload();
      }
    }
  });
  it.each([
    undefined,
    {},
    { ...profile, avatar_url: 'javascript:alert(1)' },
    { ...profile, avatar_url: 'https://user:secret@example.test/a' },
    { ...profile, avatar_url: 'file:///private/avatar.png' },
  ])('rejects an invalid host response', async (value) => {
    const { service } = fixture(value);
    await service.load();
    try {
      await expect(service.app.user.getProfile()).rejects.toThrow('Invalid user');
    } finally {
      await service.unload();
    }
  });
  it('does not deliver a profile after cancellation or service unload', async () => {
    const { service, invokeHost } = fixture(profile);
    await service.load();
    const abort = new AbortController();
    abort.abort();
    await expect(service.app.user.getProfile(abort.signal)).rejects.toThrow();
    expect(invokeHost).not.toHaveBeenCalled();
    let finish!: (value: typeof profile) => void;
    invokeHost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.app.user.getProfile();
    await service.unload();
    finish(profile);
    await expect(pending).rejects.toThrow();
    await expect(service.app.user.getProfile()).rejects.toThrow();
  });
});
