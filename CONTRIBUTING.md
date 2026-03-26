# Contributing to Sniflo

Thanks for your interest in contributing!

## Development Setup

```bash
# Prerequisites: Node.js >= 18, Rust stable, Tauri v2 prerequisites
cd frontend && npm install
npm run tauri dev
```

## Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Run all checks before submitting:

```bash
# Frontend
cd frontend && npx tsc --noEmit && npx vitest run

# Rust
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

4. Open a pull request against `main`

## Code Style

- Follow existing patterns in the codebase
- Rust: `cargo fmt` formatting, no clippy warnings
- TypeScript: strict mode, no `any` types

## Reporting Issues

Use [GitHub Issues](https://github.com/colin990909/sniflo/issues). Include steps to reproduce, expected vs actual behavior, and your OS/version.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
