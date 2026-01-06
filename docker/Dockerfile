# Claude Code Sandbox Container
# Runs autonomous Claude Code with --dangerously-skip-permissions

FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    gnupg \
    ripgrep \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest

# Create non-root user for security
# UID 1001 matches the webhook server's nodejs user for consistent file permissions
RUN useradd -m -s /bin/bash -u 1001 agent

# Create workspace directory
RUN mkdir -p /workspace && chown agent:agent /workspace

# Switch to non-root user
USER agent
WORKDIR /workspace

# Copy entrypoint script
COPY --chown=agent:agent entrypoint.sh /home/agent/entrypoint.sh
RUN chmod +x /home/agent/entrypoint.sh

# Default environment
ENV MAX_TURNS=50

ENTRYPOINT ["/home/agent/entrypoint.sh"]
