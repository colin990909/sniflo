<p align="center">
  <img src="docs/logo.png" alt="Sniflo Logo" width="128" height="128" />
</p>

<h1 align="center">Sniflo</h1>

<p align="center">
  AI-powered cross-platform HTTP proxy debugger.<br/>
  Let AI understand every network request you make.
</p>

<p align="center">
  <a href="https://github.com/colin990909/sniflo/releases">Download</a> |
  <a href="#features">Features</a> |
  <a href="#getting-started">Getting Started</a> |
  <a href="./README_zh.md">中文文档</a>
</p>

---

![Sniflo Hero](docs/screenshots/hero.png)

## Features

- **HTTP/HTTPS Interception** — Capture and inspect all HTTP traffic with MITM support via auto-generated CA certificates
- **Request/Response Viewer** — Detailed inspection of headers, body (with syntax highlighting), timing, and metadata
- **Breakpoints** — Pause and modify requests/responses in real time before forwarding
- **JavaScript Scripting** — Embedded JS engine (Boa) for automated traffic modification with a built-in editor
- **AI Analysis Workspace** — Multi-provider AI chat (Claude, OpenAI, Claude Code CLI, Codex CLI) with session context injection and tool calling
- **Export** — Export captured sessions as cURL commands, HAR, or JSON
- **Upstream Proxy** — Chain traffic through HTTP/SOCKS5 upstream proxies
- **Certificate Management** — Generate, install, and manage CA certificates with one click
- **i18n** — Full English and Simplified Chinese localization
- **Dark / Light Theme** — Polished UI with custom design tokens

### Screenshots

| Sessions | Breakpoints |
|----------|-------------|
| ![Sessions](docs/screenshots/sessions.png) | ![Breakpoints](docs/screenshots/breakpoints.png) |

| AI Workspace | Scripts |
|-------------|---------|
| ![AI](docs/screenshots/ai-workspace.png) | ![Scripts](docs/screenshots/scripts.png) |

## Tech Stack

| Layer    | Technology                                                     |
|----------|----------------------------------------------------------------|
| Frontend | React 19, TypeScript, Vite 5, Tailwind CSS, Zustand, Radix UI |
| Backend  | Tauri v2, Rust, Tokio, rustls, SQLite (rusqlite)               |
| Proxy    | Custom HTTP/HTTPS MITM proxy via rcgen + tokio-rustls          |
| AI       | Anthropic API, OpenAI API, Claude Code CLI, Codex CLI          |
| Scripting| Boa (embedded ECMAScript engine)                               |

## Repository Structure

```text
.
├── frontend/
│   ├── src/                  # React frontend
│   │   ├── components/       # Reusable UI components (Radix-based)
│   │   ├── views/            # Page-level components
│   │   ├── stores/           # Zustand state management
│   │   ├── hooks/            # Custom React hooks
│   │   ├── i18n/             # Localization (en, zh-Hans)
│   │   └── lib/              # Utilities
│   └── src-tauri/
│       └── src/
│           ├── commands/      # Tauri command handlers
│           ├── proxy_core/    # HTTP/HTTPS proxy + MITM
│           ├── ai/            # AI subsystem (agents, providers, tools)
│           ├── scripting/     # Boa JS engine integration
│           └── storage/       # SQLite persistence layer
├── .github/workflows/         # CI + release builds
└── docs/                      # Documentation & screenshots
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) stable toolchain
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
cd frontend && npm install

# Run full app (frontend + backend)
npm run tauri dev

# Or frontend only
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

## Download

Pre-built binaries are available on the [Releases](https://github.com/colin990909/sniflo/releases) page for:

- macOS (Apple Silicon / Intel)
- Windows
- Linux

## Star History

<a href="https://www.star-history.com/?repos=colin990909%2Fsniflo&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=colin990909/sniflo&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=colin990909/sniflo&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=colin990909/sniflo&type=date&legend=top-left" />
 </picture>
</a>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE) - Copyright 2026 Colin
