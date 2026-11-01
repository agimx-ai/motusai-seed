/** Public presentation data for the current Seed account; never includes credentials. */
export type SeedUserProfile = {
  display_name: string;
  avatar_url: string | null;
};

export type SeedUserService = {
  /** Returns null when Seed is signed out. Does not open a login or authorization flow. */
  getProfile(signal?: AbortSignal): Promise<SeedUserProfile | null>;
};

export function createUserProfileClient(
  invokeHost: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
): SeedUserService {
  return {
    async getProfile(signal) {
      const active = signal ? AbortSignal.any([owner, signal]) : owner;
      active.throwIfAborted();
      const value = await invokeHost('seed.user-profile', { operation: 'read' });
      active.throwIfAborted();
      if (value === null) return null;
      const profile = value as SeedUserProfile;
      if (
        !profile ||
        typeof profile.display_name !== 'string' ||
        profile.display_name.length > 200 ||
        (profile.avatar_url !== null && typeof profile.avatar_url !== 'string')
      )
        throw new Error('Invalid user profile response.');
      if (profile.avatar_url !== null) {
        let url: URL;
        try {
          url = new URL(profile.avatar_url);
        } catch {
          throw new Error('Invalid user avatar URL.');
        }
        if (
          profile.avatar_url.length > 16_384 ||
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error('Invalid user avatar URL.');
      }
      return { display_name: profile.display_name, avatar_url: profile.avatar_url };
    },
  };
}
