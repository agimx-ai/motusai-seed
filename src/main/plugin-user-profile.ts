import type { SeedUserProfile } from '@motus-ai/seed-sdk';
import type { TerminalUserProfile } from '../shared/contracts';

/** Explicitly project public fields so account/session data cannot cross this broker. */
export function pluginUserProfile(user: TerminalUserProfile | undefined): SeedUserProfile | null {
  if (!user) return null;
  let avatar: string | null = null;
  if (user.avatarDataUrl && user.avatarDataUrl.length <= 16_384) {
    try {
      const url = new URL(user.avatarDataUrl);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) avatar = url.href;
    } catch {
      // An unavailable avatar does not hide the account's display name.
    }
  }
  return { display_name: user.displayName, avatar_url: avatar };
}
