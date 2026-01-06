# api.agent.teamorange.dev - Webhook API

Webhook Server für den team:orange Agent. Empfängt Emails via Resend Webhook und führt Aufgaben mit Claude Code aus.

## Übergeordnete Dokumentation

| Dokument | Pfad |
|----------|------|
| **Projekt-Übersicht** | `../CLAUDE.md` |
| **Tech Stack** | `../.claude/techstack.md` |
| **Funktionsweise** | `../.claude/function.md` |

## Server-Infrastruktur

| Komponente | Details |
|------------|---------|
| **Host-Server** | Yakutsk (`157.90.19.138`) |
| **SSH-Zugang** | `ssh root@157.90.19.138` (Key in 1Password) |
| **Coolify** | Läuft auf gleichem Server, verwaltet Docker-Container |
| **Claude Credentials** | `/opt/claude/.credentials.json` |
| **Sessions** | `/opt/claude-sessions/` |

> **WICHTIG:** Coolify und Host-Server sind unterschiedliche Konzepte!
> - Coolify = Deployment-Tool (wie Vercel)
> - Host-Server = Die Maschine auf der alles läuft

## Authentifizierung (Hybrid-Modus)

Der Agent verwendet einen **Hybrid-Auth-Mechanismus**:

| Methode | Priorität | Kosten | Gültigkeit |
|---------|-----------|--------|------------|
| **OAuth** (Subscription) | 1. Versuch | Inklusive | 8 Stunden |
| **API Key** (Fallback) | Bei OAuth-Fehler | Pay-as-you-go | Unbegrenzt |

**So funktioniert es:**
1. Agent versucht OAuth-Credentials (`/opt/claude/.credentials.json`)
2. Bei 401/Auth-Fehler: Automatischer Fallback auf `ANTHROPIC_API_KEY`
3. In der Antwort-Email wird angezeigt, welche Methode verwendet wurde

### OAuth-Credentials manuell aktualisieren

Claude Code speichert Credentials ab Version 2.0+ im **macOS Keychain** (lokal).
Bei Token-Ablauf (alle 8 Stunden) kann manuell aktualisiert werden:

```bash
# 1. Lokal in Claude Code einloggen
claude
/login

# 2. Credentials aus Keychain extrahieren und auf Server übertragen
security find-generic-password -s "Claude Code-credentials" -a maschenborn -w | \
  ssh root@157.90.19.138 "cat > /opt/claude/.credentials.json"

# 3. Verifizieren
ssh root@157.90.19.138 "cat /opt/claude/.credentials.json | jq '.claudeAiOauth.expiresAt' | xargs -I {} node -e \"console.log('Expires:', new Date({}).toISOString())\""
```

### API Key (für dauerhaften Betrieb)

Der `ANTHROPIC_API_KEY` muss in Coolify gesetzt sein:
- **Coolify Dashboard** > claude-agent > Environment Variables
- Variable: `ANTHROPIC_API_KEY=sk-ant-api03-xxxxx`
- Key erstellen: https://console.anthropic.com/settings/keys

## URL

`https://api.agent.teamorange.dev`

## Projektstruktur

```
src/
├── index.ts              # Entry Point
├── config/               # Zod-validierte Config
├── webhook/              # Express Server + Routes
├── email/                # Resend Client + Templates
├── execution/            # Unified Executor, MCP Injection
├── guardrail/            # Sicherheits-Analyse (Pattern + AI)
├── session/              # Session-Persistenz
├── agents/               # Agent-Registry
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

## Deployment-Status

**Produktiv seit:** Januar 2026

| Komponente | Status |
|------------|--------|
| Coolify Docker Compose | ✅ Läuft |
| Domain + SSL | ✅ Konfiguriert |
| Resend Webhook | ✅ Aktiv |
| Agent Sandbox Image | ✅ Gebaut |
| Guardrail (Pattern + AI) | ✅ Aktiv |

### Bei Problemen

1. **Token abgelaufen:** Siehe "Claude Credentials aktualisieren" oben
2. **Container-Logs:** `ssh root@157.90.19.138 "docker logs claude-agent-api-1"`
3. **Coolify Dashboard:** https://coolify.teamorange.dev
