# LEDRING permissions extension, v1

URI: `https://github.com/FelixFangX/ledring/blob/main/docs/extensions/permissions-v1.md`

An optional [A2A](https://a2a-protocol.org/) Agent Card extension (`capabilities.extensions[]`, `required: false`) that declares what an agent runs with, so a caller can judge it before delegating.

```json
{
  "tools": ["Read", "Grep", "Bash"],
  "model": "sonnet",
  "permissions": { "allow": ["Bash(npm test:*)"], "ask": ["Bash(git tag:*)"], "deny": ["Read(.env)"] },
  "mcpServers": [{ "name": "issues", "transport": "stdio" }]
}
```

- `tools`: tool names the agent may call; empty means it inherits all tools from its host.
- `permissions`: rules in Claude Code permission syntax.
- `mcpServers`: names and transports only. Commands, arguments, URLs, headers and environment values are never included.
