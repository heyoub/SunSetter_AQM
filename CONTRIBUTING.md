# Contributing to db.aqm

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/typescript-esm-package.git`
3. Install dependencies: `npm install`
4. Create a new branch: `git checkout -b feature/your-feature-name`

## Development Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev

# Lint code
npm run lint

# Format code
npm run format
```

## Project Structure

```
src/
├── cli/          # CLI command implementations
├── config/       # Configuration management
├── generator/    # Code generation logic
├── introspector/ # Database schema introspection
├── mapper/       # Type mapping utilities
└── utils/        # Utility functions

tests/            # Test files
```

## Coding Standards

- Use TypeScript for all new code
- Follow ESLint and Prettier configurations
- Write tests for new features
- Use meaningful commit messages
- Follow conventional commit format

## Testing

- Write unit tests for new functionality
- Ensure all tests pass before submitting
- Add integration tests for CLI commands
- Test with different PostgreSQL versions

## Submitting Changes

1. Ensure your code follows the established patterns
2. Add/update tests as needed
3. Update documentation if necessary
4. Create a pull request with a clear description
5. Wait for code review and address feedback

## Bug Reports

When reporting bugs, please include:

- PostgreSQL version
- Node.js version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

## Feature Requests

For new features:

- Open an issue first to discuss the feature
- Provide use cases and examples
- Consider backward compatibility
- Be willing to implement the feature yourself

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Celebrate contributions of all sizes

Thank you for contributing!
