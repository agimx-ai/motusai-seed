# MotusAI Seed 0.3.15

Find plugins, review activity and adjust appearance more easily, with improved recording recovery and richer feature introductions.

## New

- **Plugin filters**: Filter search results by label and individual organization to find the tools you need.
- **Feature introductions**: Display video and Markdown introductions, with optional video posters and theme-aware text layouts.
- **Plugin user profiles**: The SDK offers read-only access to the current account's display name and avatar for plugins such as Web Publishing, without exposing sign-in credentials.

## Improvements

- **Activity history**: Combine search and category filters, show daily totals, refine cards and status spacing, and preserve specific plugin startup failure reasons.
- **Appearance settings**: Group settings into Appearance, System and About, add visual theme previews, and align native macOS icons in development and installed clients.
- **Shared dialogs**: Reduce the SDK dialog's bottom spacing for a more compact action area.

## Fixes

- **Recording recovery**: Pause capture during system sleep, wait for real audio before resuming, and exclude sleep from recorded duration. Update the Recording and Transcription plugin as well.
- **Connection recovery**: Prevent errors when cancelling an unfinished WebSocket connection after wake.
- **Activity pagination**: Ignore outdated filter responses and prevent duplicate or mixed results when loading more entries.
- **Account avatars**: Retry failed avatar loads after temporary network errors.

## Usage notes

- **Matching versions**: The client and SDK are released together as 0.3.15. Web Publishing requires this client version or later to use the new user profile interface.
