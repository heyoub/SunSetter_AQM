# TypeScript ESM Database Code Generator

A robust TypeScript ESM database code generator that converts PostgreSQL database schemas into TypeScript code, including models, repositories, and services.

## Features

- Introspection of PostgreSQL database schemas
- Generation of TypeScript models, repositories, and services
- Supports Zod and class-validator for validation
- Configurable through JSON config files
- Lightweight and easy to use

## Installation

```bash
npm install
```

## Usage

### Commands

- `generate`: Generate TypeScript code from PostgreSQL schema
- `introspect`: Introspect database schema
- `test-connection`: Test database connection

### Generate Command

```bash
node dist/index.js generate \
    --host localhost \
    --port 5432 \
    --database mydb \
    --username myuser \
    --password mypassword \
    --output ./generated-code
```

### Introspect Command

```bash
node dist/index.js introspect \
    --host localhost \
    --port 5432 \
    --database mydb \
    --username myuser \
    --password mypassword
```

## Configuration

Configurations can be adjusted by modifying `codegen.config.json`. Example:

```json
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "database": "your_database",
    "username": "your_username",
    "password": "your_password",
    "ssl": false
  },
  "generator": {
    "outputDir": "./generated",
    "generateModels": true,
    "generateRepositories": true,
    "generateServices": true,
    "generateValidators": false,
    "generateConvexSchema": false,
    "generateMigrations": false,
    "useZod": false,
    "useClassValidator": false
  }
}
```

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request for review.

## License

MIT
