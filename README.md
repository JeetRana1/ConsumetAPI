# FluxiumLab API

<p align="center">
  <img src="./FluxiumLab.png" alt="FluxiumLab" width="150">
</p>

<p align="center">
  A self-hosted media metadata, discovery, streaming-source, manga, anime, and sports API.
</p>

<p align="center">
  <a href="https://github.com/JeetRana1/FluxiumLab/actions"><img src="https://img.shields.io/github/actions/workflow/status/JeetRana1/FluxiumLab/deploy-pi.yml?label=deployment" alt="Deployment status"></a>
  <a href="https://github.com/JeetRana1/FluxiumLab"><img src="https://img.shields.io/github/license/JeetRana1/FluxiumLab" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-5fa04e" alt="Node.js 18 or newer"></a>
</p>

<p align="center">
  <a href="https://discord.gg/ZKy2ahNtQX">
    <img src="https://img.shields.io/discord/934267446980935690?label=Discord&logo=discord&logoColor=white&color=5865F2" alt="FluxiumLab Discord">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/metadata-TMDB-7C5CFF?style=flat-square" alt="TMDB metadata">
  <img src="https://img.shields.io/badge/media-proxy-16D9D1?style=flat-square" alt="Media proxy">
  <img src="https://img.shields.io/badge/runtime-Node.js-5FA04E?style=flat-square" alt="Node.js runtime">
  <img src="https://img.shields.io/badge/API-self--hosted-101429?style=flat-square" alt="Self-hosted API">
</p>

## 🌌 Overview

FluxiumLab is the backend service used by StreamVerse. It provides a single API surface over multiple metadata and media-source providers, with support for:

- TMDB movie and TV metadata
- Movie and TV streaming sources
- Anime and manga discovery
- Sports and live-event providers
- Subtitle and media proxy utilities
- Provider-specific extraction and fallback logic

The service is designed to be self-hosted. Provider availability and response formats can change without notice, so treat upstream data as best-effort.

> [!IMPORTANT]
> <img src="https://img.shields.io/badge/IMPORTANT-7C5CFF?style=flat-square" alt="Important">
> FluxiumLab is intended to be self-hosted. Review the configuration, access controls, and provider requirements before exposing an instance publicly.

> [!CAUTION]
> <img src="https://img.shields.io/badge/CAUTION-E5484D?style=flat-square" alt="Caution">
> FluxiumLab is not affiliated with the third-party providers it accesses. You are responsible for complying with applicable laws, copyright rules, and provider terms of service. Do not use the API for unauthorized redistribution or abuse.

## 🚀 Quick Start

### 🧰 Requirements

- Node.js 18 or newer
- npm or Yarn
- A configured `.env` file when using optional providers or services

### ▶️ Install And Run

```bash
git clone https://github.com/JeetRana1/FluxiumLab.git
cd FluxiumLab
npm install
npm run build
npm start
```

The API listens on port `3000` by default. Set `PORT` in `.env` to use another port.

### 🛠️ Development

```bash
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
```

## ⚙️ Configuration

Copy `.env.example` to `.env` when available and configure only the services you need. Common settings include:

```env
PORT=3000
NODE_ENV=production
```

Provider-specific settings and secrets should remain in environment variables and should never be committed.

## 🔌 API Examples

Health check:

```text
GET http://localhost:3000/
```

TMDB metadata example:

```text
GET http://localhost:3000/meta/tmdb/movie/838209
```

The exact route parameters vary by provider. Check the route definitions under `src/routes` for the current contract.

## 🗂️ Project Layout

```text
src/
  main.ts             Application entry point
  routes/             HTTP route handlers
  providers/          Provider-specific integrations
  utils/              Proxy, extraction, and shared helpers
dist/                 Generated production JavaScript
scripts/build.mjs     esbuild production build
ecosystem.config.js   PM2 production definition
```

Do not edit generated files in `dist` by hand. Update `src`, then run `npm run build`.

## 🤖 Deployment Automation

The GitHub Actions deployment workflow builds the API and maintains the canonical `consumet-api` PM2 process. It removes legacy process names before restarting and saves the PM2 process list after deployment.

## 🛡️ Responsible Use

FluxiumLab does not host third-party media. It retrieves metadata and source information from external providers. You are responsible for complying with the laws, terms of service, and copyright rules applicable to your deployment and region.

Do not expose an instance publicly without reviewing authentication, rate limiting, logging, outbound-request controls, and provider terms.

## 💬 Support

For questions, setup help, or provider issues, contact the FluxiumLab maintainers by [email](mailto:jeetrana790@gmail.com) or [join the Discord server](https://discord.gg/ZKy2ahNtQX).

<a href="https://discord.gg/ZKy2ahNtQX">
  <img src="https://img.shields.io/discord/934267446980935690?label=Join%20the%20FluxiumLab%20Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Join the FluxiumLab Discord server">
</a>

## 🤝 Contributing

1. Create a focused branch.
2. Make changes under `src` and add or update tests where practical.
3. Run `npm run typecheck` and `npm run build`.
4. Open a pull request with a clear description of the behavior change.

## 📄 License

See [LICENSE](./LICENSE) for the repository license.
