# Sniflo

> Cross-platform HTTP proxy debugger built with React + Tauri v2. A modern alternative to Charles and Fiddler.

<!-- ![Sniflo Screenshot](docs/screenshot.png) -->

## Features

- **HTTP/HTTPS Interception** — capture and inspect all HTTP traffic with MITM support
- **Request/Response Viewer** — detailed headers, body, timing, and metadata inspection
- **Breakpoints** — pause and modify requests/responses in real time
- **Export** — curl, HAR, JSON export for captured sessions
- **Upstream Proxy** — chain through HTTP/SOCKS5 upstream proxies
- **AI Analysis** — built-in AI workspace with configurable providers for traffic analysis
- **i18n** — full English and Simplified Chinese localization
- **Dark Theme** — polished dark UI with custom design tokens

## Tech Stack

| Layer    | Technology                                            |
|----------|-------------------------------------------------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Zustand     |
| Backend  | Tauri v2, Rust, Tokio, rustls, SQLite                  |
| Proxy    | Custom HTTP/HTTPS proxy with MITM via rcgen + tokio-rustls |

## Repository Structure

```text
.
├── frontend/              React + Vite frontend
│   ├── src/               TypeScript source (components, stores, views)
│   └── src-tauri/         Rust backend (Tauri commands, proxy, MITM, storage)
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) stable toolchain
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install frontend dependencies
cd frontend && npm install

# Run in development mode (frontend + backend)
npm run tauri dev

# Or run frontend only (without Tauri backend)
npm run dev
```

### Build

```bash
cd frontend && npm run tauri build
```

### Testing

```bash
# Frontend tests
cd frontend && npx vitest run

# TypeScript type check
cd frontend && npx tsc --noEmit

# Rust checks
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)
