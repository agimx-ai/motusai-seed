# MotusAI Seed 0.3.11

Update plugins independently without restarting unrelated plugins, and show remaining credit allowance in the sidebar.

## New

- **Credit allowance ring**: Show the remaining allowance for the current funding cycle, starting from the balance after the latest credit deposit. The outer ring turns green, amber or red according to the remaining percentage, while the diamond stays gray. A two-line tooltip shows the percentage and allowance; clicking opens usage details.

## Fixes

- **Independent reloads**: Updating or configuring a plugin preserves unchanged plugin instances while tool consumers refresh available capabilities dynamically.
- **Background tool calls**: Completed request ancestry no longer leaks into background tasks, and progress polling no longer causes false cycle errors. Genuine cycle prevention, approvals and auditing remain enforced.
- **System proxy**: Add permission-checked system proxy resolution so plugin requests can follow the configured network route.

## Usage notes

- **Matching versions**: The client and SDK both use version 0.3.11. Upgrade the client before installing this release of Agent Harness or WeCom Bot.
