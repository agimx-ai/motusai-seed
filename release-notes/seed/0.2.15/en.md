# MotusAI Seed 0.2.15

Add a shared model and thinking-level experience, automatic plugin-setting saves, theme-aware icons and clearer connection status, while improving plugin reloads and update downloads.

## New

- **Model and thinking controls**: Plugins can use one shared settings control while supplying their own model list, grouping and per-model thinking levels.
- **Automatic settings saves**: Plugins can declare standalone settings forms that save changes automatically without a separate Save button.

## Improvements

- **Selection experience**: Keep the section heading and thinking level visible while only the model list scrolls. Mouse, keyboard and focus behavior now share consistent form height, radius, borders and spacing.
- **Theme-aware icons**: Providers can supply light and dark icons. Colored artwork keeps its original colors while monochrome icons follow the active theme.
- **Connection status**: Plugin configuration profiles use clearer status pills, with direct actions when reconnection is available.

## Fixes

- **Plugin reloads**: Restart changed plugins with their latest runtime definition instead of continuing from a stale snapshot after installation or update.
- **Update downloads**: Use single-range update requests for better compatibility with object storage and proxy environments.

## Usage notes

- **Companion plugins**: Update to Agent Harness 0.2.30 and WeCom Bot 0.2.6, and install the first Weixin Bot release, 0.1.0.
- **Seed SDK 0.2.6**: Exposes model grouping, thinking-level and light/dark icon configuration types.
