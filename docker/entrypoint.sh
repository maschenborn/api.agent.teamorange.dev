#!/bin/bash
set -e

# Setup Claude Code credentials from mounted host session
if [ -d "/host-claude" ]; then
    echo "🔑 Setting up Claude Code credentials..."
    mkdir -p /home/agent/.claude
    # Copy only the credentials file (not the whole directory)
    if [ -f "/host-claude/.credentials.json" ]; then
        cp /host-claude/.credentials.json /home/agent/.claude/
        echo "✅ Credentials copied"
    else
        echo "⚠️ No credentials found at /host-claude/.credentials.json"
    fi
fi

# Configure git
git config --global user.email "${GIT_EMAIL:-agent@claude-remote.local}"
git config --global user.name "${GIT_NAME:-Claude Remote Agent}"

# Setup git credentials for GitHub
if [ -n "$GITHUB_TOKEN" ]; then
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
    git config --global credential.helper store
fi

# Clone the repository if REPO_URL is provided (skip in analysis mode)
if [ -n "$REPO_URL" ] && [ "$ANALYSIS_MODE" != "true" ]; then
    echo "Cloning repository: $REPO_URL"
    git clone "$REPO_URL" .
fi

# Check if prompt is provided
if [ -z "$AGENT_PROMPT" ]; then
    echo "Error: AGENT_PROMPT environment variable is required"
    exit 1
fi

# Build Claude Code command based on mode
if [ "$ANALYSIS_MODE" = "true" ]; then
    echo "Starting Claude Code in ANALYSIS mode (read-only)..."
    echo "Task: ${AGENT_PROMPT:0:100}..."
    # Analysis mode: NO --dangerously-skip-permissions
    exec claude -p "$AGENT_PROMPT" \
        --max-turns "${MAX_TURNS:-1}"
else
    echo "Starting Claude Code in EXECUTION mode..."
    echo "Task: ${AGENT_PROMPT:0:100}..."
    # Execution mode: full autonomy
    exec claude -p "$AGENT_PROMPT" \
        --dangerously-skip-permissions \
        --max-turns "${MAX_TURNS:-50}"
fi
