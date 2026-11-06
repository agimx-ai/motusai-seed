# MotusAI Seed 0.3.16

More complete plugin entry points, page navigation and content presentation, with Cloud-managed companion introductions.

## New

- **Plugin navigation**: Plugins can register sidebar groups, pages and actions in the upper-right "+" menu through the SDK, with badges and light/dark SVG icons alongside existing Lucide icons.
- **Back and forward**: Navigate through client browsing history, with window navigation adapted for macOS and Windows.
- **Reduced motion**: Choose system, on or off in settings; the client and SDK components follow the same animation preference.
- **Companion introductions**: Load bilingual introductions and enabled states from Cloud. Links are optional: linked bubbles show an arrow, while introductions without links remain plain bubbles.

## Improvements

- **Sidebar layout**: Drag to resize the sidebar, with refined indentation, icon alignment, keyboard focus and quick-action spacing. Long labels now fade at the end.
- **Standalone plugin pages**: Refined titles, action buttons and breadcrumb spacing; plugins can control horizontal content layout and open their own settings pages.
- **Markdown presentation**: Consistent tables with sticky headers and a copy-only toolbar, a shared table background variable, and caller-controlled image and link rendering.
- **Text and file actions**: SDK support for selectable text and native editing menus; plugins can open files or choose an application within their authorized scope.
- **Companion layout**: Refined spacing between introduction bubbles, the copy bar and client icons, with bottom content included in normal layout sizing.

## Fixes

- **Plugin page recovery**: Fixed the current page remaining in a loading state after hot reload. A page that fails to open no longer affects other pages or sidebar entries.
- **Dialog tooltips**: Fixed tooltips appearing when a dialog closes and returns focus to its trigger.
- **Cloud resource access**: Reads and subscriptions now check the resources actually authorized for each plugin, restricting access across resources.
- **Diagnostic records**: Collect active JSONL sessions by record timestamps within the requested range while retaining complete contents of matching sessions.

## Usage notes

- **Matching versions**: The client and SDK both update to 0.3.16. Set each plugin's minimum client version according to the interfaces it uses.
- **Introduction configuration**: Introductions without links require support in both Cloud and the client. Older clients that reject this configuration retain their last valid cache.
