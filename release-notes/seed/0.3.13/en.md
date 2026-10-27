# MotusAI Seed 0.3.13

Fix file browsing on Windows when individual system files cannot be inspected.

## Fixes

- **Windows file browsing**: Skip unsupported system entries such as `DumpStack.log.tmp` while listing a drive root, so other available files and folders remain visible.

## Usage notes

- **Matching versions**: The client and SDK both use version 0.3.13.
