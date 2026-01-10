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

## Ausfuehrung

### Flow

```
Email → Webhook → Guardrail → Docker Container → SDK → Response Email
                     ↓
              Ablehnung bei
              Sicherheitsrisiko
```

### Docker Container

Jede Ausfuehrung laeuft isoliert in einem Docker Container:
- Image: `claude-agent-sdk:latest`
- Timeout: 5 Minuten (konfigurierbar)
- Memory: 2 GB
- CPU: 2 Cores

### Session Persistenz

Sessions werden in `/opt/claude-sessions/` gespeichert.
Bei Email-Antworten (gleicher Thread) wird die Session fortgesetzt.

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
