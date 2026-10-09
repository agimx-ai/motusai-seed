# Seed 0.2.8: Release highlights and bilingual tool names

Review release highlights after installation or upgrades, and share consistent English and Chinese tool names with connected apps.

## New

- **Release highlights**: Show the current version's changes once after installation or an upgrade. Acknowledged notes are not shown again.

## Improvements

- **Tool names**: Plugins can declare short English and Chinese names for apps to display in their own interface language. Invocation identifiers and arguments remain unchanged.
- **Plugin actions**: More compact action controls retain their existing behavior and hints.
- **Developer interfaces**: SDK 0.2.2 adds bilingual name types and updated development guidance.

## Fixes

- **Long requests**: Align cloud-relay request limits and preserve overflow errors so the Agent can compact context or report a clear failure.

## Usage notes

- **Coordinated upgrade**: The new official plugin releases require Seed 0.2.8 or later to read their name declarations. Update the client before updating plugins.
