# MotusAI Seed 0.3.12

Add Plugin development mode and AI client setup from the companion page, with clearer development feedback, more resilient file browsing and interface refinements.

## New

- **Plugin development mode**: Enable the switch in Plugin settings to load and hot-reload local development plugins. Source builds and installed releases use the same switch; disabling it restores authorized installed plugins and preserves their data.
- **AI client setup**: Copy setup instructions from the companion page to connect Seed tools with Claude Code, Codex, DeepSeek Harness, WorkBuddy and VS Code.

## Improvements

- **Development feedback**: SDK development tools distinguish file synchronization, waiting for the client, a disabled switch, loading, successful loading and failures. Loading acknowledgements apply only to the current build.
- **Official sample project**: Development documentation links to the [seed-sample-plugin](https://github.com/agimx-ai/seed-sample-plugin) template, a plugin project ready to build, test and customize.
- **Interface and menus**: Refine companion-page icons, hover feedback and notification spacing, simplify native menus and provide developer-tools keyboard shortcuts.

## Fixes

- **File browsing**: Skip inaccessible or removed directory entries so other files can still be listed.
- **Icons and error messages**: Display fallback content when icons fail to load, and improve consistency in error messages and presentation.

## Usage notes

- **Matching versions**: The client and SDK both use version 0.3.12. Plugin development mode is off by default; upgrade both the client and SDK to use the new CLI loading feedback.
