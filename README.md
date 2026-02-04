# cndr

A TypeScript monorepo with shared types, client library, and Express server.

## Prerequisites

- Node.js >= 20.0.0 (24.13.0 recommended)
- pnpm 10.28.2

## Getting Started

### Installation

```bash
pnpm install
```

### Build All Packages

```bash
pnpm build:all
```

### Development

Start the server in development mode:

```bash
pnpm dev
```

The server will be available at `http://localhost:3000`.

## Monorepo Structure

This monorepo contains three packages:

- **[@cndr/shared](./packages/shared/README.md)** - Shared types and utilities
- **[@cndr/client](./packages/client/README.md)** - Client library for API interaction
- **[@cndr/server](./packages/server/README.md)** - Express server application

## Package Architecture

```
cndr/
├── packages/
│   ├── shared/          # Common types (@cndr/shared)
│   ├── client/          # Client library (@cndr/client)
│   └── server/          # Express app (@cndr/server)
├── .github/workflows/   # CI/CD pipelines
└── ...                  # Configuration files
```

### Package Dependencies

```
@cndr/shared (base package)
    ↑
    │
@cndr/client
    ↑
    │
@cndr/server
```

## Available Scripts

### Root Scripts

- `pnpm build` - Build publishable packages (shared, client)
- `pnpm build:all` - Build all packages including server
- `pnpm dev` - Start server in development mode
- `pnpm clean` - Clean all build artifacts and node_modules
- `pnpm lint` - Run Biome linter
- `pnpm lint:fix` - Fix linting issues
- `pnpm format` - Format code with Biome
- `pnpm type-check` - Run TypeScript type checking
- `pnpm test` - Run tests across all packages

### Package-Specific Scripts

Each package has its own scripts:

```bash
# Build a specific package
pnpm --filter @cndr/shared build

# Run dev mode for a specific package
pnpm --filter @cndr/server dev

# Clean a specific package
pnpm --filter @cndr/client clean
```

## Development Workflow

### 1. Make Changes

Edit files in any package. The TypeScript project references ensure proper type checking across packages.

### 2. Type Check

```bash
pnpm type-check
```

### 3. Lint and Format

```bash
pnpm lint:fix
pnpm format
```

### 4. Build

```bash
pnpm build:all
```

### 5. Test

```bash
pnpm test
```

## Testing

Tests use Vitest. Create test files with `.test.ts` or `.spec.ts` extensions.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @cndr/shared test
```

## Publishing Workflow

The `@cndr/shared` and `@cndr/client` packages are publishable to npm. The server package is private.

### Using Changesets

1. Make your changes
2. Create a changeset:
   ```bash
   pnpm changeset
   ```
3. Commit the changeset file
4. When ready to release:
   ```bash
   pnpm changeset version
   pnpm build
   pnpm changeset publish
   ```

## Git Hooks

This project uses Husky for git hooks:

- **pre-commit**: Runs lint-staged (Biome check) and type-check

To set up hooks after cloning:

```bash
pnpm install
```

## Technology Stack

### Build Tools
- **TypeScript 5.7.3** - Type-safe JavaScript
- **pnpm** - Fast, disk space efficient package manager
- **tsx** - TypeScript execution for Node.js

### Code Quality
- **Biome 1.9.4** - Fast linter and formatter
- **Vitest** - Fast unit testing framework
- **Husky + lint-staged** - Git hooks

### Server Dependencies
- **Express 4.21.2** - Web framework
- **Helmet** - Security headers
- **CORS** - Cross-origin resource sharing
- **Compression** - Response compression
- **Pino** - Structured logging
- **Zod** - Schema validation

### Module System
- **ESM only** - All packages use ES modules
- **NodeNext resolution** - Modern TypeScript module resolution
- **Explicit .js extensions** - Required for ESM imports

## Configuration Files

- `pnpm-workspace.yaml` - Workspace configuration
- `tsconfig.base.json` - Base TypeScript configuration
- `biome.json` - Linter and formatter settings
- `vitest.config.ts` - Test configuration
- `.nvmrc` - Node.js version specification
- `.npmrc` - pnpm configuration

## Project References

This monorepo uses TypeScript project references for:
- Faster incremental builds
- Better editor performance
- Enforced dependency boundaries

Each package's `tsconfig.json` defines its references to dependencies.

## Environment Variables

The server package uses environment variables. See [packages/server/README.md](./packages/server/README.md) for details.

## CI/CD

GitHub Actions workflow runs on:
- Push to main
- Pull requests

CI pipeline:
1. Install dependencies
2. Lint
3. Type check
4. Build
5. Test

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm lint:fix && pnpm type-check && pnpm build:all && pnpm test`
5. Commit with a descriptive message
6. Create a pull request

## License

ISC
