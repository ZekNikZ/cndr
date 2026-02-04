# @cndr/client

Client library for interacting with the cndr API.

## Installation

```bash
pnpm add @cndr/client
```

## Usage

```typescript
import { CndrClient } from '@cndr/client';

const client = new CndrClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  timeout: 30000, // optional, defaults to 30s
});

// Get a user by ID
const userResponse = await client.getUser('123');
if (userResponse.success) {
  console.log(userResponse.data);
}

// List users with pagination
const usersResponse = await client.listUsers(1, 10);
if (usersResponse.success) {
  console.log(usersResponse.data?.items);
}

// Create a new user
const newUserResponse = await client.createUser({
  name: 'John Doe',
  email: 'john@example.com',
});
```

## API

### `CndrClient`

Main client class for interacting with the API.

#### Constructor

```typescript
new CndrClient(config: ClientConfig)
```

- `baseUrl` (required): Base URL of the API
- `apiKey` (optional): API key for authentication
- `timeout` (optional): Request timeout in milliseconds (default: 30000)

#### Methods

- `getUser(id: string)`: Get a user by ID
- `listUsers(page?: number, limit?: number)`: List users with pagination
- `createUser(user: Omit<User, 'id' | 'createdAt'>)`: Create a new user

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
