# api.agent.teamorange.dev - Webhook API

Webhook Server für den team:orange Agent. Empfängt Emails via Resend Webhook und führt Aufgaben mit Claude Code aus.

## Übergeordnete Dokumentation

| Dokument | Pfad |
|----------|------|
| **Projekt-Übersicht** | `../CLAUDE.md` |
| **Tech Stack** | `../.claude/techstack.md` |
| **Funktionsweise** | `../.claude/function.md` |

## Referenz-Implementierung

> **Demo-Projekt:** `/Users/maschenborn/Sandkasten/claude-remote-agent`
>
> Funktionierende lokale Demo mit ngrok. Bei Implementierungsfragen dort nachschlagen.

## URL

`https://api.agent.teamorange.dev`

## Projektstruktur

```
src/
├── index.ts              # Entry Point
├── config/               # Zod-validierte Config
├── webhook/              # Express Server + Routes
├── email/                # Resend Client + Templates
├── agent/                # Docker Executor + Safety Analyzer
└── utils/                # Logger, Errors
```

## Befehle

```bash
# Development
npm run dev

# Build
npm run build

# Production
npm start

# Type Check
npm run typecheck
```

## Deployment (Coolify)

```bash
# Docker Image bauen
docker build -t claude-remote-agent:latest .

# Agent Sandbox bauen
docker build -t claude-agent-sandbox:latest -f docker/Dockerfile docker/
```

## Environment Variables

Siehe `.env.local` - alle mit `XXXXXX` markierten Werte müssen ersetzt werden.

**Wichtig für Coolify:**
- Alle Env-Vars in Coolify unter "Environment Variables" eintragen
- `CLAUDE_SESSION_PATH` muss auf gemountete Credentials zeigen

## Konventionen

- Brand-Farbe: `#fa5f46`
- Alle Inhalte auf Deutsch
- Keine Emojis in E-Mails (Encoding-Probleme)

## Nächste Schritte (Coolify Deployment)

1. Git-Repo erstellen und pushen
2. In Coolify: Docker Compose Service anlegen
3. Domain `api.agent.teamorange.dev` konfigurieren
4. Environment Variables setzen
5. Agent Sandbox Image auf Server bauen
6. Claude Credentials auf Server ablegen (`/opt/claude/`)
7. Resend Webhook konfigurieren
