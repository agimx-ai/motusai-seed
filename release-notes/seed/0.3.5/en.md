# MotusAI Seed 0.3.5

Add an Ubuntu desktop installer using the same production build and release workflow as Windows and macOS.

## New

- **Ubuntu installer**: Provide a DEB installer and Linux update feed for Ubuntu 24.04 x86_64.

## Fixes

- **Linux application icon**: Include standard system icon sizes and align launcher and window identities to avoid the default gear icon.

## Usage notes

- **Desktop session and secure storage**: Launch the application in a normal desktop session. Login credentials depend on the system keyring; unavailable secure storage does not fall back to plaintext. Ubuntu login and native capabilities still require on-device acceptance testing.
- **Linux recording scope**: Microphone capture is supported; system audio and mixed capture are not yet supported. Native capabilities such as computer control depend on the desktop session and system permissions.
