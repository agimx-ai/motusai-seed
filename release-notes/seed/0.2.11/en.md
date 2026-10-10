# MotusAI Seed 0.2.11

Strengthen plugin file writes with safe snapshot saving for native Canvas and other progressively generated files.

## New

- **Create-only files**: The file Broker can create new files without replacing an existing file, including one created concurrently by another caller.

## Improvements

- **Revision checks**: Serialize writes to the same path and recheck the revision before replacement. Calls carrying an old revision cannot recreate a deleted file.
- **Complete snapshots**: Publish complete temporary files and clean up temporary files after both success and failure.

## Usage notes

- **Editing boundaries**: Disk revision checks do not protect unsaved changes in other applications and are not a cross-process atomic compare-and-swap. Avoid simultaneous manual and Agent edits to the same file.
