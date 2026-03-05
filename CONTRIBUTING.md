# Contributing to figma-icon-mcp

Thank you for your interest in contributing! We welcome contributions from everyone. This document provides guidelines and instructions for contributing to this project.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:

- A clear description of the bug
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (Node version, OS, etc.)

### Suggesting Features

We'd love to hear your feature ideas! Please open an issue with:

- A clear description of the feature
- Why you think it would be useful
- Any relevant examples or references

### Submitting Code Changes

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:

   ```bash
   git clone https://github.com/your-username/figma-fetch-svgs-mcp.git
   cd figma-fetch-svgs-mcp
   ```

3. **Create a branch** for your changes:

   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Install dependencies**:

   ```bash
   npm install
   ```

5. **Make your changes**:
   - Follow the existing code style
   - Write clear, descriptive commit messages
   - Test your changes locally

6. **Build and test**:

   ```bash
   npm run build
   npm run dev
   ```

7. **Commit your changes**:

   ```bash
   git commit -m "Description of your changes"
   ```

8. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

9. **Open a Pull Request** against the main repository with:
   - A clear title describing the changes
   - A detailed description of what changed and why
   - References to any related issues

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Code Style

- Use TypeScript for all code
- Follow the existing code structure and patterns
- Use meaningful variable and function names
- Add comments for complex logic

## Pull Request Process

1. Ensure your code builds without errors (`npm run build`)
2. Test your changes thoroughly
3. Update documentation if needed
4. Keep commits focused and logically separated
5. Respond to any review feedback

## Project Structure

```
src/
├── figma.ts          # Figma API interactions
├── icon-matcher.ts   # Icon detection and matching logic
├── svg-utils.ts      # SVG processing utilities
└── index.ts          # MCP server entry point
```

## Questions?

Feel free to open an issue to ask questions or discuss ideas. We're here to help!

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License (see LICENSE file).
