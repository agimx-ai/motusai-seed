# MotusAI Seed 0.3.0

Update the plugin framework, introduce cloud-managed feature announcements, and unify plugin settings and selection controls.

## New

- **New plugin framework**: Plugins independently provide features and settings while Seed supplies shared controls, permissions, and runtime services.
- **Feature introductions**: Receive cloud-configured image and text introductions with immersive and image-above layouts, multi-item navigation, and local read tracking.
- **Cascading selection**: Shared dropdowns support hierarchical options, stable menu widths, and keyboard navigation.

## Improvements

- **Plugin pages**: Unify collection typography, icons, workflow connectors, and button layout; distribute installed icons evenly without resizing them.
- **Plugin-owned presentation**: Plugins provide model groups, business options, and text; internal tool names no longer appear in detail cards.
- **File collaboration**: Controlled file-change watching lets Personal Assistant and other plugins respond to changes in authorized directories.

## Usage notes

- **Companion plugins**: This release uses Plugin API v2. Update the corresponding official plugins; older plugin implementations require migration before running on this release.
- **Developer tools**: Use Seed SDK 0.3.0 and seed-plugin-tools 0.1.0 for plugin development.
