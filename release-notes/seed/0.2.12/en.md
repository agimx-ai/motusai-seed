# MotusAI Seed 0.2.12

Add full-screen capture and safe binary saving for plugins, with clearer system permission guidance and plugin errors.

## New

- **Full-screen capture**: Plugins can list displays and capture a selected full screen at its actual pixel dimensions, including multi-monitor selection.
- **Binary saving**: Safely save PNG and other binary files with path protection, revision checks and create-only writes that do not overwrite existing files.

## Fixes

- **macOS permission guidance**: Register the capture request with the system before explaining how to grant Screen Recording to the running app. Quit and reopen the app after granting access.
- **Plugin error details**: Preserve declared error parameters across process boundaries so permission failures include complete, actionable guidance.
- **Directory writes**: Add regression coverage for writing files and Canvas documents after creating missing nested directories.

## Usage notes

- **System access**: Full-screen capture requires Screen Recording permission. Capture and saving remain subject to plugin declarations and write approval.
