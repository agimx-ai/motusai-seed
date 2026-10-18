# MotusAI Seed 0.3.2

Improve the reliability of official plugin packages built for multiple operating systems.

## Fixes

- **Cross-platform plugin packages**: Normalize author-provided text resources during plugin builds so Windows, macOS and Linux packages share the same verified content.

## Usage notes

- **Plugin developers**: `@motus-ai/seed-plugin-tools` 0.1.2 keeps UTF-8 text resources consistent while leaving binary resources and native sidecars unchanged.
