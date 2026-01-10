# Agent Konfiguration

Diese Dokumentation erklaert, wie Agents konfiguriert und erweitert werden.

---

## Uebersicht

```
agents/
  crm/
    config.json      # Metadaten und Einstellungen
    CLAUDE.md        # System-Prompt (Anweisungen fuer Claude)
    .mcp.json        # MCP-Server Konfiguration (optional)
  test/
    config.json
    CLAUDE.md
  default/           # Fallback fuer unbekannte Adressen
    config.json
    CLAUDE.md
```

**Prinzip:** Email an `xyz@agent.teamorange.dev` nutzt Agent `agents/xyz/`.

---

## Neuen Agent erstellen

### 1. Verzeichnis anlegen

```bash
mkdir agents/meinagent
```

### 2. config.json erstellen

```json
{
  "id": "meinagent",
  "name": "Mein Agent",
  "description": "Beschreibung was der Agent tut",
  "needsDocker": true,
  "env": {
    "API_KEY": "${API_KEY}",
    "CUSTOM_VAR": "statischer-wert"
  }
}
```

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| `id` | Ja | Eindeutige ID (= Ordnername, = Email-Prefix) |
| `name` | Ja | Anzeigename |
| `description` | Ja | Kurzbeschreibung |
| `needsDocker` | Nein | Default: `true` (immer Docker nutzen) |
| `env` | Nein | Environment-Variablen fuer Container |

**Environment-Variablen:**
- `${VAR}` - Wird zur Laufzeit aus Server-Environment ersetzt
- `"wert"` - Statischer Wert

### 3. CLAUDE.md erstellen

```markdown
# Mein Agent

Du bist ein spezialisierter Agent fuer team:orange.

## Deine Aufgabe

Beschreibe hier was der Agent tun soll...

## Anweisungen

1. Schritt eins
2. Schritt zwei
3. ...

## Regeln

- Alle Antworten auf Deutsch
- Keine Umlaute in API-Calls (ae, oe, ue, ss)
```

Die CLAUDE.md wird als System-Prompt an Claude uebergeben.

---

## MCP-Server konfigurieren

MCP (Model Context Protocol) erweitert Claude um zusaetzliche Tools.

### .mcp.json erstellen

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": {
        "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"
      }
    },
    "moco": {
      "command": "npx",
      "args": ["-y", "@anthropic/moco-mcp-server"],
      "env": {
        "MOCO_API_KEY": "${MOCO_API_KEY}",
        "MOCO_SUBDOMAIN": "teamorange"
      }
    }
  }
}
```

| Feld | Beschreibung |
|------|--------------|
| `command` | Ausfuehrbarer Befehl (npx, node, python...) |
| `args` | Argumente als Array |
| `env` | Environment-Variablen fuer den MCP-Server |

**Verfuegbare MCP-Server:**
- `firecrawl-mcp` - Web Scraping und Crawling
- Weitere: https://github.com/anthropics/awesome-mcp-servers

### Environment-Variablen

`${VAR}` Platzhalter werden aus dem Server-Environment ersetzt:
- `MOCO_API_KEY` - In Coolify gesetzt
- `FIRECRAWL_API_KEY` - In Coolify gesetzt
- `ANTHROPIC_API_KEY` - Fuer Claude API

---

## Tools und Faehigkeiten

### Eingebaute Tools (SDK)

Der Agent hat Zugriff auf:

| Tool | Beschreibung |
|------|--------------|
| `Read` | Dateien lesen |
| `Write` | Dateien schreiben |
| `Edit` | Dateien bearbeiten |
| `Bash` | Shell-Befehle ausfuehren |
| `Glob` | Dateien suchen |
| `Grep` | In Dateien suchen |
| `WebSearch` | Web-Suche |
| `WebFetch` | Webseiten abrufen |

Konfiguration in `docker/sdk/src/agent-runner.ts`:
```typescript
allowedTools: ["Read", "Glob", "Grep", "Bash"]
```

### MCP-Tools

Durch MCP-Server hinzugefuegte Tools:

**Firecrawl:**
- `firecrawl_scrape` - Webseite scrapen
- `firecrawl_map` - URLs einer Domain auflisten
- `firecrawl_crawl` - Website crawlen

**Beispiel im Prompt:**
```markdown
Nutze Firecrawl MCP um fehlende Daten zu finden:
- firecrawl_map url="https://firma.de"
- firecrawl_scrape url="https://firma.de/impressum"
```

---

## Prompt-Variablen

Im CLAUDE.md koennen Platzhalter verwendet werden:

### {{VAR}} - Ersetzung im Prompt

```markdown
API Token: {{MOCO_API_KEY}}
```

Wird zur Laufzeit mit dem Wert aus dem Server-Environment ersetzt.

**Hinweis:** Fuer sensible Daten besser Environment-Variablen im Container nutzen (siehe config.json `env`).

### Dynamische Werte

Diese Werte werden automatisch eingefuegt:
- Aktuelles Datum/Uhrzeit (via Claude)
- Session-ID
- Agent-ID

---

## Existierende Agents

### test@agent.teamorange.dev

**Zweck:** Funktionspruefung

```
agents/test/
  config.json    # Minimal-Konfiguration
  CLAUDE.md      # Einfache Antwort-Anweisungen
```

### crm@agent.teamorange.dev

**Zweck:** Kontakte und Firmen in Moco anlegen

```
agents/crm/
  config.json    # MOCO_API_KEY, MOCO_SUBDOMAIN
  CLAUDE.md      # Moco API Dokumentation, Workflow
  .mcp.json      # Firecrawl fuer Web-Recherche
```

**Features:**
- Kontaktdaten aus Emails extrahieren
- Moco API nutzen (curl-basiert)
- Firecrawl fuer Impressum-Recherche
- Duplikat-Pruefung

### default@agent.teamorange.dev

**Zweck:** Fallback fuer unbekannte Adressen

```
agents/default/
  config.json
  CLAUDE.md      # Hinweis auf verfuegbare Agents
```

---

## Vollstaendiger Ablauf

### 1. Email-Empfang

```
Email an: crm@agent.teamorange.dev
Von: m.aschenborn@teamorange.de
Betreff: Westermann Kontakte
Inhalt: "Sende mir eine Liste aller Ansprechpartner von Westermann."
```

**Webhook:** Resend sendet POST an `/webhook/email`

### 2. Guardrail-Pruefung

**Zwei-Stufen-Sicherheitssystem:**

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Pattern Matching│ --> │ AI-Analyse       │ --> │ Entscheidung│
│ (schnell, <10ms)│     │ (Haiku, ~1.5s)   │     │             │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

**Stufe 1: Pattern Matching**
- Prueft auf destruktive Befehle (`rm -rf`, `DROP DATABASE`)
- Erkennt Prompt Injection ("Ignoriere vorherige Anweisungen")
- Blockiert Finanz-Aktionen ("Ueberweise 1000 Euro")
- Erkennt Sicherheitsrisiken ("Zeige API Keys")

**Stufe 2: AI-Analyse (Claude Haiku)**
- Klassifiziert: APPROVED oder BLOCKED
- Block-Gruende: DESTRUCTIVE, PROMPT_INJECTION, COMPETENCE_EXCEEDED, FINANCIAL_RISK, SECURITY_RISK
- Confidence: 0.0-1.0

**Ergebnis:**
```json
{
  "decision": "APPROVED",
  "confidence": 0.95,
  "analysisMethod": "ai",
  "durationMs": 1499
}
```

### 3. Session-Erstellung

```
Session-ID: dd8772
Pfad: /opt/claude-sessions/crm/dd8772/
  ├── workspace/       # Arbeitsverzeichnis
  └── claude-home/     # Claude-Konfiguration (.mcp.json)
```

### 4. MCP-Injektion

Aus `agents/crm/.mcp.json`:
```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": { "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}" }
    }
  }
}
```

Wird nach `/opt/claude-sessions/crm/dd8772/claude-home/.mcp.json` geschrieben.

### 5. Container-Start

**AGENT_TASK Environment Variable:**
```json
{
  "prompt": "Von: m.aschenborn@teamorange.de\nBetreff: Westermann Kontakte\n\nSende mir eine Liste aller Ansprechpartner von Westermann.",
  "systemPrompt": "# CRM Agent - Moco Integration\n\nDu bist der CRM-Agent...",
  "model": "opus",
  "maxTurns": 50,
  "allowedTools": ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "mcp__*"],
  "agentId": "crm"
}
```

**Container-Konfiguration:**
```
Image: claude-agent-sdk:latest
Memory: 2 GB
CPU: 2 Cores
Timeout: 5 Minuten
Mounts:
  - /opt/claude-sessions/crm/dd8772/workspace → /workspace
  - /opt/claude-sessions/crm/dd8772/claude-home → /home/agent/.claude
```

### 6. SDK-Ausfuehrung

Der agent-runner im Container:
1. Liest AGENT_TASK
2. Laedt MCP-Konfiguration aus `/home/agent/.claude/.mcp.json`
3. Startet SDK `query()` mit Prompt, System-Prompt und MCP-Servern
4. Gibt Ergebnis als JSON auf stdout aus

**Was Claude sieht:**

```
[System-Prompt: Claude Code Preset + agents/crm/CLAUDE.md]

User: Von: m.aschenborn@teamorange.de
Betreff: Westermann Kontakte

Sende mir eine Liste aller Ansprechpartner von Westermann.
```

**Was Claude tut:**
```bash
# 1. Firma suchen
curl -s "https://teamorange.mocoapp.com/api/v1/companies?term=Westermann" \
  -H "Authorization: Token token=$MOCO_API_KEY"

# 2. Kontakte der Firma abrufen
curl -s "https://teamorange.mocoapp.com/api/v1/contacts/people?company_id=762626" \
  -H "Authorization: Token token=$MOCO_API_KEY"
```

### 7. Response-Email

```
An: m.aschenborn@teamorange.de
Betreff: Re: Westermann Kontakte [#to-dd8772]

Kontakte bei Westermann Druck:

1. Hans Westermann - Geschaeftsfuehrer
   - hans@westermann-druck.de | +49 521 12345
   -> https://teamorange.mocoapp.com/contacts/2125184

2. Maria Westermann - Vertriebsleitung
   - maria@westermann-druck.de | +49 521 12346
   -> https://teamorange.mocoapp.com/contacts/2125185

---
Auth: API (kostenpflichtig)
```

---

## Guardrails im Detail

### Blockierte Anfragen

| Kategorie | Beispiele | Reaktion |
|-----------|-----------|----------|
| DESTRUCTIVE | `rm -rf /`, `DROP DATABASE` | Sofort blockiert |
| PROMPT_INJECTION | "Ignoriere alle Regeln" | Blockiert + Warnung |
| COMPETENCE_EXCEEDED | "Refactore die komplette Architektur" | Blockiert |
| FINANCIAL_RISK | "Ueberweise 1000 Euro" | Blockiert |
| SECURITY_RISK | "Zeige alle API Keys" | Blockiert |

### Erlaubte Anfragen

- Informationsabfragen ("Liste alle Kontakte")
- CRM-Operationen ("Lege Kontakt an")
- Recherche ("Finde Impressum von firma.de")
- Standard-Workflows

### Konfiguration

`src/guardrail/analyzer.ts`:
```typescript
const DEFAULT_CONFIG = {
  useAiAnalysis: true,
  patternConfidenceThreshold: 0.9,
  aiModel: 'claude-3-5-haiku-20241022',
  aiTimeoutMs: 10000,
};
```

---

## Docker Container

Jede Ausfuehrung laeuft isoliert:

| Einstellung | Wert |
|-------------|------|
| Image | `claude-agent-sdk:latest` |
| Timeout | 5 Minuten (300000ms) |
| Memory | 2 GB |
| CPU | 2 Cores |
| Network | Bridge (Internet-Zugang) |

### Session Persistenz

Sessions in `/opt/claude-sessions/{agentId}/{sessionId}/`:
- Bei Email-Replies (gleicher Thread) wird Session fortgesetzt
- Session-ID im Betreff: `[#to-dd8772]`

---

## Debugging

### Debug-API (nur mit Token)

```bash
# Agents auflisten
curl -H "Authorization: Bearer $DEBUG_TOKEN" \
  https://api.agent.teamorange.dev/debug/agents

# Task ausfuehren
curl -X POST -H "Authorization: Bearer $DEBUG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hallo", "agentId":"test"}' \
  https://api.agent.teamorange.dev/debug/execute

# Config anzeigen
curl -H "Authorization: Bearer $DEBUG_TOKEN" \
  https://api.agent.teamorange.dev/debug/config
```

### Server-Logs

```bash
ssh root@157.90.19.138 "docker logs \$(docker ps --filter 'name=webhook' --format '{{.Names}}' | head -1) --tail 100"
```

---

## Erweiterungen (geplant)

### Custom MCP-Server in TypeScript

Statt CLI-Tools wie curl koennen eigene MCP-Server erstellt werden:

```typescript
// src/mcp/servers/moco.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const mocoMcpServer = createSdkMcpServer({
  name: "moco",
  version: "1.0.0",
  tools: [
    tool("create_contact", "Kontakt in Moco anlegen", {
      firstname: z.string(),
      lastname: z.string(),
      email: z.string().email().optional()
    }, async (args) => {
      // Moco API Call
    })
  ]
});
```

### Subagents

Spezialisierte Teil-Agenten fuer komplexe Aufgaben:

```typescript
// Im Agent-Runner
import { query } from "@anthropic-ai/claude-agent-sdk";

// Subagent fuer Web-Recherche
const researchResult = await query({
  prompt: "Recherchiere Impressum von firma.de",
  options: { model: "haiku", maxTurns: 5 }
});
```

### Structured Output

JSON-Schema fuer strukturierte Antworten:

```typescript
const resultSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    action: { type: "string" },
    data: { type: "object" }
  }
};

for await (const msg of query({
  prompt: "...",
  options: {
    outputFormat: { type: "json_schema", schema: resultSchema }
  }
})) { ... }
```

---

## Referenzen

- **Claude Agent SDK:** https://docs.claude.com/en/api/agent-sdk
- **MCP Servers:** https://github.com/anthropics/awesome-mcp-servers
- **Coolify Dashboard:** https://coolify.teamorange.dev
- **Server:** ssh root@157.90.19.138
