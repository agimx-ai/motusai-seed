# MCP client icons

Brand marks identify compatible desktop clients. They are bundled locally; the overview never loads remote images.

- `claude.svg`: [Simple Icons, Claude](https://github.com/simple-icons/simple-icons/blob/develop/icons/claude.svg), CC0; filled with the warm brand color for the grayscale-to-color animation.
- `openai.svg`: [Simple Icons 13.21.0, OpenAI](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/openai.svg), CC0; identifies Codex by OpenAI.
- `workbuddy.svg`: [WorkBuddy official website logo](https://assets.workbuddy.cn/web/workbuddy/a5b2fb510f0e7b156f19d072fae0cd12ae1f2f19/assets/logo.svg).
- `vscode.png`: [Visual Studio Code official website icon](https://code.visualstudio.com/assets/apple-touch-icon.png).

# Compatibility evidence (2026-10-27)

The overview lists local desktop clients with documented HTTP MCP support. This does not claim a completed end-to-end test in every client.

- [Claude Code HTTP MCP configuration](https://code.claude.com/docs/en/mcp).
- [Codex HTTP MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), including a localhost example.
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration); requires GitHub Copilot agent tools running on the same machine as Seed.
- [WorkBuddy connector transport types](https://open.workbuddy.cn/docs/connector) and [iEasyRun's published WorkBuddy loopback HTTP integration](https://idevicefarm.com/en/docs/mcp/). WorkBuddy's connector UI uses `streamableHttp`; its desktop MCP configuration example uses `http`.

The copied instructions preserve other MCP entries and ask the receiving AI to select its own client's format, reload, and verify tool discovery. Seed must stay running and signed in on the same computer. Remote/cloud agent sessions cannot use this machine's loopback endpoint.
