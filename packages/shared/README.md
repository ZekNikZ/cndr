# @cndr/shared

Shared types and utilities for the cndr monorepo.

## Installation

```bash
pnpm add @cndr/shared
```

## Usage

```typescript
import type { User, ApiResponse } from '@cndr/shared';

const user: User = {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date(),
};

const response: ApiResponse<User> = {
  success: true,
  data: user,
};
```

## Available Types

- `User` - User entity type
- `ApiResponse<T>` - Generic API response wrapper
- `PaginationParams` - Pagination parameters
- `PaginatedResponse<T>` - Paginated API response

## Development

```bash
# Build the package
pnpm build

# Watch mode
pnpm dev

# Clean build artifacts
pnpm clean
```

For more information, see the [main README](../../README.md).
