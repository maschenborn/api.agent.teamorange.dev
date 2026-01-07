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

## Deployment

### Coolify-Referenzen

| Resource | Identifier |
|----------|------------|
| **Application UUID** | `rocg4g48sgog0o8kgc8gsk80` |
| **Coolify Dashboard** | https://coolify.teamorange.dev |
| **Container Name** | `webhook-server-rocg4g48sgog0o8kgc8gsk80-*` |

### Standard-Deployment (Code-Aenderungen)

```bash
# 1. Commits pushen
git push

# 2. Coolify Redeploy triggern (MCP-Tool oder Dashboard)
# Via MCP:
mcp__coolify__restart_application uuid=rocg4g48sgog0o8kgc8gsk80

# Via CLI (Alternative):
curl -X POST "https://coolify.teamorange.dev/api/v1/applications/rocg4g48sgog0o8kgc8gsk80/restart" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
```

### Agent Sandbox Rebuild (bei entrypoint.sh Aenderungen)

Wenn `docker/entrypoint.sh` oder `docker/Dockerfile` geaendert wird:

```bash
# 1. Repo auf Server clonen/updaten
ssh root@157.90.19.138 "cd /tmp && rm -rf api.agent.teamorange.dev && \
  git clone https://github.com/maschenborn/api.agent.teamorange.dev.git"

# 2. Sandbox-Image neu bauen
ssh root@157.90.19.138 "cd /tmp/api.agent.teamorange.dev && \
  docker build -t claude-agent-sandbox:latest -f docker/Dockerfile docker/"

# 3. Aufraumen
ssh root@157.90.19.138 "rm -rf /tmp/api.agent.teamorange.dev"
```

### Environment Variables

Siehe `.env.local` - alle mit `XXXXXX` markierten Werte muessen ersetzt werden.

**In Coolify setzen:**
- Coolify Dashboard > api-agent-teamorange > Environment Variables
- Wichtig: `ANTHROPIC_API_KEY` fuer Hybrid-Auth Fallback

## Konventionen

- Brand-Farbe: `#fa5f46`
- Alle Inhalte auf Deutsch
- Keine Emojis in E-Mails (Encoding-Probleme)

## Deployment-Status

**Produktiv seit:** Januar 2026

| Komponente | Status |
|------------|--------|
| Coolify Docker Compose | Laeuft |
| Domain + SSL | Konfiguriert |
| Resend Webhook | Aktiv |
| Agent Sandbox Image | Gebaut |
| Guardrail (Pattern + AI) | Aktiv |
| Hybrid-Auth | Aktiv |

### Bei Problemen

```bash
# Container-Status
ssh root@157.90.19.138 "docker ps | grep webhook"

# Container-Logs
ssh root@157.90.19.138 "docker logs webhook-server-rocg4g48sgog0o8kgc8gsk80-* --tail 100"

# Health-Check
curl https://api.agent.teamorange.dev/health
```

1. **Token abgelaufen:** Siehe "OAuth-Credentials manuell aktualisieren" oben
2. **API-Key Fallback testen:** Email senden, Auth-Methode in Antwort pruefen

---

## Learnings / Bekannte Fallstricke

### Shell-Escaping bei Prompts (Jan 2026)

**Problem:** Prompts die Shell-Metazeichen enthalten (`|`, `$`, `` ` ``, etc.) fuehren zu Fehlern wie:
```
/home/agent/entrypoint.sh: line 84: teamorange: command not found
```

**Ursache:** `eval "claude -p \"$PROMPT\""` interpretiert Metazeichen als Shell-Befehle.

**Loesung:** Prompt in Datei schreiben und via stdin uebergeben:
```bash
printf '%s' "$AGENT_PROMPT" > /tmp/prompt.txt
cat /tmp/prompt.txt | claude -p - --model opus
```

### API-Token Halluzination (Jan 2026)

**Problem:** Claude im Container erfindet random API-Tokens statt die aus dem Prompt zu verwenden.

**Ursache:** Prompt-Injection via `{{PLACEHOLDER}}` wird korrekt ersetzt, aber Claude "korrigiert" die Werte.

**Loesung:** API-Keys als Environment-Variable (`$MOCO_API_KEY`) statt als Plaintext im Prompt uebergeben. Claude liest den Wert dann via `echo $MOCO_API_KEY` oder `printenv`.
