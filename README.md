# figma-svg-to-icon-mcp

An MCP (Model Context Protocol) server that extracts SVG icons from Figma and generates React TSX icon components — automatically, from your AI assistant.

Works with **GitHub Copilot**, **Claude**, and any MCP-compatible AI assistant.

## Setup

### Prerequisites

- Node.js 18+
- VS Code with GitHub Copilot (agent mode) or Claude Desktop
- A Figma personal access token

### 1. Get a Figma Token

Go to [figma.com](https://figma.com) → Settings → Security → **Personal access tokens** → Generate new token.

Scopes needed: `file_content:read`

### 2. Configure your MCP client

**VS Code (`.vscode/mcp.json` or user settings):**

```json
{
 "servers": {
  "figma-svg-to-icon-mcp": {
   "type": "stdio",
   "command": "npx",
   "args": ["-y", "figma-svg-to-icon-mcp"],
   "env": {
    "FIGMA_TOKEN": "figd_your_token_here"
   }
  }
 }
}
```

**Claude Desktop (`claude_desktop_config.json`):**

```json
{
 "mcpServers": {
  "figma-svg-to-icon-mcp": {
   "command": "npx",
   "args": ["-y", "figma-svg-to-icon-mcp"],
   "env": {
    "FIGMA_TOKEN": "figd_your_token_here"
   }
  }
 }
}
```

> **Note:** Each user needs their own `FIGMA_TOKEN`. Tokens are tied to Figma account permissions.

## What it does

Point it at any Figma node URL and it will:

1. Fetch the full node tree via Figma REST API (handles deeply nested instances)
2. Detect icon nodes by name pattern + size
3. Export clean SVG via Figma's image export API
4. Check your existing `components/icons` folder for duplicates (name + path similarity)
5. Generate `.tsx` icon components in a consistent format

**Generated component format:**

```tsx
interface IconProps {
 className?: string;
}

export default function ArrowRightIcon({ className }: IconProps) {
 return (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 20 20" fill="none" className={className}>
   <path d="..." stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
 );
}
```

## Usage

Once configured, just tell your AI assistant:

```
Extract all icons from this Figma node and save new ones to my icons folder.

figma_url: https://www.figma.com/design/FILEID/Name?node-id=1234-5678
icons_dir: /absolute/path/to/your/project/src/components/icons
```

### Options

| Parameter       | Description                                                 | Default  |
| --------------- | ----------------------------------------------------------- | -------- |
| `figma_url`     | Figma node URL with `node-id`                               | required |
| `icons_dir`     | Absolute path to icons folder                               | required |
| `dry_run`       | Preview without writing files                               | `false`  |
| `copy_existing` | Write similar icons with `-copy` suffix instead of skipping | `false`  |

### Dry run (preview only)

```
Extract icons — dry run only, don't write files.

figma_url: https://www.figma.com/design/xxx?node-id=1234-5678
icons_dir: /Users/you/project/src/components/icons
dry_run: true
```

### Convert a single SVG

```
Convert this SVG to an icon component and save it.

icon_name: arrow-right
icons_dir: /Users/you/project/src/components/icons
svg_code: <svg viewBox="0 0 24 24">...</svg>
```

## How icon detection works

Icons are identified by:

- **Type:** `INSTANCE`, `COMPONENT`, `VECTOR`, or `BOOLEAN_OPERATION`
- **Name:** kebab-case pattern — `wallet-03`, `arrow-right`, `x-close` ✅
  - Excluded: `Frame 123`, `Group`, `Solid`, `Bold`, `Featured icon` ❌
- **Size:** Square dimensions in common icon sizes: 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64px

## Duplicate detection

Before writing a file, the server checks your existing icons folder using:

1. **Name similarity** — fuzzy match on component name (70%+ threshold)
2. **SVG path similarity** — Jaccard similarity on path data (85%+ threshold)

If either matches, the icon is skipped (or written with `-copy` suffix if `copy_existing: true`).

## Tools

| Tool                       | Description                                 |
| -------------------------- | ------------------------------------------- |
| `extract_icons_from_figma` | Main tool — extracts icons from a Figma URL |
| `svg_to_icon`              | Convert a raw SVG string to a TSX component |

## Contributing

Issues and PRs welcome at [https://github.com/Pruthvik1/figma-svg-to-icon-mcp](https://github.com/Pruthvik1/figma-svg-to-icon-mcp).

## License

MIT
