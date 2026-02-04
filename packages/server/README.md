# @cndr/server

Express server application for cndr.

## Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Configure your environment variables in `.env`

## Development

```bash
# Start the server in development mode with hot reload
pnpm dev

# Build the server
pnpm build

# Start the production server
pnpm start

# Clean build artifacts
pnpm clean
```

The server will start at `http://localhost:3000` by default.

## Environment Variables

- `NODE_ENV`: Environment mode (development, production, test)
- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: localhost)
- `LOG_LEVEL`: Logging level (fatal, error, warn, info, debug, trace)
- `CORS_ORIGIN`: CORS allowed origin (default: *)

## API Endpoints

### Health Check

```
GET /health
```

Returns server health status.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Get User

```
GET /users/:id
```

Get a user by ID (example endpoint).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "name": "Example User",
    "email": "user@example.com"
  }
}
```

## Middleware

The server includes the following middleware:

- **helmet**: Security headers
- **cors**: Cross-origin resource sharing
- **compression**: Response compression
- **express.json**: JSON body parsing
- **pino**: Structured logging

## Development Features

- Hot reload with tsx watch
- Pretty logging in development
- Type-safe environment variables with Zod
- Automatic error handling
- Request logging

For more information, see the [main README](../../README.md).
