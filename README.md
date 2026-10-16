# RepoCompass

An MCP server that lets AI agents (such as GitHub Copilot in VS Code) explore a GitHub
repository and write onboarding guides with architecture diagrams.

## Tools

| Tool | What it does |
| --- | --- |
| `repo_map` | Lists the repository tree. With `path`, lists one folder (use this for large repos). |
| `find_files` | Finds relevant files for a topic by matching file paths. |
| `read_file` | Reads a file, 400 lines per call, with `startLine` for paging. |

Prompt: `onboarding_guide` (arguments `owner`, `repo`) produces an onboarding guide with a Mermaid diagram.

## Authentication

The server uses your own GitHub token, so it can only read what you can already read.
Create a fine-grained personal access token with read-only access to **Contents** and **Metadata**
for the repositories you want to explore. Prefer short expiry dates.

## Use with VS Code (Copilot)

Add to your **user-level** MCP configuration (Command Palette: "MCP: Open User Configuration"):

```json
{
  "servers": {
    "repocompass": {
      "type": "http",
      "url": "https://repo-compass-chi.vercel.app/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Never put a token in a file that is committed to git. In the normal Copilot Chat view you can use a
prompt instead of a literal token: add an `inputs` entry with `"type": "promptString"` and
`"password": true`, and reference it as `${input:github_token}`. The Agent tab does not support
input variables, so it needs the literal token above.

Then open Copilot Chat in Agent mode, enable the `repocompass` tools and ask, for example:
"Use RepoCompass to explain the architecture of owner/repo."

## Self-hosting

No environment variables are needed. Deploy this repository to Vercel, or run it locally:

```bash
npm install
npm run dev   # http://localhost:3000/mcp
```

## Notes

- Stateless by design: every request creates its own server and uses only the token it was sent.
- Very large repositories may be truncated by GitHub; explore them folder by folder with `repo_map`.
- Files over about 900 KB cannot be read through the GitHub API.
