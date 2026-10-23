# MotusAI Seed 0.3.10

Add multilevel breadcrumbs and back navigation for plugins, keep child pages focused, and improve notification buttons and long-content layouts.

## New

- **Plugin navigation**: Plugins can use the SDK to set header breadcrumbs, navigate to ancestors, or go back one level. Long paths prioritize the first and last two levels; hovering or focusing a middle level expands its label while later levels shrink as needed.

## Improvements

- **Child pages**: Collapse plugin information and release notes on child pages, then restore them at the plugin home page without reloading the plugin page when changing levels.
- **Header interaction**: Preserve the original Plugins title style and use a more compact breadcrumb hover background without moving text or arrows.

## Fixes

- **Notification layout**: Match action button colors to notification types, place buttons on a separate row for multiline content, correct cancel button styling in dark mode, and improve keyboard focus indicators.

## Usage notes

- **SDK version**: The client and `@motus-ai/seed-sdk` share the same version starting with this release. Multilevel navigation requires client and SDK version `0.3.10` or later; plugins supporting older clients should check whether `app.navigation` is available.
