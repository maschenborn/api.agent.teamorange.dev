# Claude Agent SDK Container
# Führt Agents mit dem offiziellen Claude Agent SDK aus

FROM node:20-slim

# System-Dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI installieren (SDK Runtime)
RUN npm install -g @anthropic-ai/claude-code

# Arbeitsverzeichnis
WORKDIR /app

# Dependencies zuerst (für Layer-Caching)
COPY package.json package-lock.json* ./
RUN npm install

# TypeScript Config
COPY tsconfig.json ./

# Source Code
COPY src/ ./src/

# Build
RUN npm run build

# Non-root User für Sicherheit
RUN useradd -m -u 1001 agent
USER agent

# Workspace für Agent-Operationen
WORKDIR /workspace

# Entry Point
CMD ["node", "/app/dist/agent-runner.js"]
