# MotusAI Seed 0.3.6

Provide a shared system notification API for plugins and simplify plugin updates after a client upgrade.

## New

- **System notifications**: Plugins can use Seed SDK to send notifications with a title, body and image, handle show, click and close events, and choose whether to navigate when clicked.
- **Notification setting**: Control the client's system notifications in General settings. Enabled by default.

## Improvements

- **Plugin updates after upgrades**: Automatically check and update installed plugins after a client upgrade. This can be disabled in plugin settings.

## Fixes

- **Toggle alignment**: Center the toggle thumb within its track instead of displaying it below the center.

## Usage notes

- **Notification scope**: The SDK exposes APIs shared by macOS, Windows and Linux. Display, click support and close events depend on system permissions, Do Not Disturb settings and the desktop notification service.
- **Plugin compatibility**: The accompanying official plugin updates require MotusAI Seed 0.3.6 or later.
