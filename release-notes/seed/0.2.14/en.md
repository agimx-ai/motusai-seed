# MotusAI Seed 0.2.14

Improve plugin settings and QR-based setup, and let plugins safely add host-managed configuration profiles.

## New

- **Actions beside settings**: Plugins can place related actions next to a settings heading and keep compact management controls with their configuration.
- **Configuration help links**: Help controls beside settings can open official documentation supplied by the plugin.
- **Safe profile creation**: Plugins can add Seed-managed configuration profiles without reading or replacing existing secrets.

## Improvements

- **Action result dialogs**: Dialogs can show localized plugin-provided titles and close automatically when an operation finishes. Closing an unfinished dialog also cancels the pending operation correctly.
- **Settings layout**: Align headings, fields and content areas consistently while removing unnecessary indentation and whitespace.

## Usage notes

- **Companion plugin**: Update WeCom Bot to 0.2.5 to use QR-based bot setup and the refreshed bot management interface.
