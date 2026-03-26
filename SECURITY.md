# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Sniflo, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainer directly or use [GitHub Security Advisories](https://github.com/colin990909/sniflo/security/advisories/new)
3. Include a description of the vulnerability, steps to reproduce, and potential impact

We will acknowledge your report within 48 hours and work with you on a fix.

## Scope

Sniflo is a network traffic debugging tool that by design intercepts and inspects HTTP/HTTPS traffic. The following are considered expected behavior, not vulnerabilities:

- Reading plaintext HTTP traffic passing through the proxy
- Decrypting HTTPS traffic when the user has installed and trusted the MITM CA certificate
- Storing captured traffic locally in SQLite

## Security Considerations

- API keys for AI providers are stored locally in SQLite without encryption. Users should treat the local database as sensitive.
- The MITM CA certificate grants the ability to intercept all HTTPS traffic. Only install it on development machines.
