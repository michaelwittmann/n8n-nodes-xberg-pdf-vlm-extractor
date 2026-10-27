# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n custom node package called `n8n-nodes-xberg-pdf-vlm-extractor`. The node is designed to extract data from PDF files using Vision Language Models (VLMs).

**Status**: Initial project setup - no node implementation yet.

## Development Environment Setup

### Prerequisites
- Node.js (for n8n node development)
- Docker or Podman (required for `n8n-node dev` command from n8n 3.0+)
- `@n8n/node-cli` installed globally: `npm install --global @n8n/node-cli`

### Creating the Node Structure
If starting from scratch, use the n8n-node CLI to scaffold the project:
```bash
n8n-node new n8n-nodes-xberg-pdf-vlm-extractor --template programmatic/example
```

For declarative-style nodes (HTTP API integration), use:
```bash
n8n-node new n8n-nodes-xberg-pdf-vlm-extractor --template declarative/custom
```

## Required Project Structure

An n8n custom node package must include:

### Required Directories
- `nodes/` - Contains node implementation files
  - `<NodeName>.node.ts` - Base node file (e.g., `PdfVlmExtractor.node.ts`)
  - `<NodeName>.node.json` - Codex file with node metadata (recommended)
  - Can be modular with subdirectories for `actions/`, `methods/`, `transport/`
- `credentials/` - Contains credential definitions
  - `<NodeName>.credentials.ts` - Credential file if authentication is needed

### Required Files
- `package.json` - Must include `n8n` field specifying node paths
- Standard build configuration (created by `n8n-node new`)

## Common Commands

### Development
```bash
# Build the node (compile TypeScript, bundle assets)
npm run build
# or
n8n-node build

# Run node in local n8n instance with hot reload
npm run dev
# or  
n8n-node dev

# Run against external n8n instance (doesn't require Docker)
n8n-node dev --external-n8n --custom-user-folder <path>
# External instance must be started with: N8N_DEV_RELOAD=true
```

### Testing & Quality
```bash
# Lint the code
npm run lint
# or
n8n-node lint

# Auto-fix lint issues
npm run lint:fix
# or
n8n-node lint --fix
```

### Release
```bash
# Publish to npm (requires npm login)
npm run release
# or
n8n-node release
# This builds, lints, updates changelog, creates git tags, and publishes
```

## Development Workflow

1. **Local Testing**: The `dev` command starts n8n at `http://localhost:5678` with your node loaded
   - Changes are automatically rebuilt and reloaded
   - From n8n 3.0+, runs in Docker container by default
   - Custom nodes appear in the nodes panel under the specified node name (not package name)

2. **n8n-node-cli Environment**: 
   - Uses its own n8n user folder: `.n8n-node-cli/`
   - Default locations:
     - macOS: `/Users/<username>/.n8n-node-cli/.n8n/custom`
     - Linux: `/home/<username>/.n8n-node-cli/.n8n/custom`
     - Windows: `C:\Users\<username>\.n8n-node-cli\.n8n\custom`
   - These are hidden folders

3. **Node Implementation Patterns**:
   - **Simple nodes**: All code in one base file
   - **Complex nodes**: Modular structure with:
     - `actions/` - Resource subdirectories with operations
     - `methods/` - Dynamic parameter functions
     - `transport/` - API communication implementation
   - Reference examples: Airtable node, Microsoft Outlook node in n8n repository

## n8n Node Structure

### Base Node File
```typescript
import { INodeType, INodeTypeDescription } from 'n8n-workflow';

export class NodeName implements INodeType {
  description: INodeTypeDescription = {
    // Node metadata, properties, operations
  };
  
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    // Node execution logic
  }
}
```

### Credentials File
```typescript
import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class NodeNameApi implements ICredentialType {
  name = 'nodeNameApi';
  displayName = 'Node Name API';
  properties: INodeProperties[] = [
    // Credential fields
  ];
}
```

## Documentation Resources

- n8n Documentation: https://docs.n8n.io/connect/create-nodes
- Use n8n-docs MCP server for current documentation: `mcp__n8n-docs__searchDocumentation` or `mcp__n8n-docs__getPage`
- Community nodes guidelines: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines

## Git Configuration

- Main branch: `main`
- Git user: Michael Wittmann
- Currently untracked: `.idea/`, `.mcp.json`, `package.json`

## MCP Integration

This project has PyCharm MCP server configured at `http://127.0.0.1:64462/stream` for IDE integration during development.
