#!/bin/bash
set -e

# Setup Claude Code credentials
# In session mode: credentials are already in mounted .claude directory
# In legacy mode: copy from host-claude mount
if [ "$SKIP_CREDENTIAL_SETUP" != "true" ]; then
    if [ -d "/host-claude" ]; then
        echo "Setting up Claude Code credentials..."
        mkdir -p /home/agent/.claude
        if [ -f "/host-claude/.credentials.json" ]; then
            cp /host-claude/.credentials.json /home/agent/.claude/
            echo "Credentials copied"
        else
            echo "Warning: No credentials found at /host-claude/.credentials.json"
        fi
    fi
else
    echo "Session mode: using pre-configured credentials"
    # Ensure credentials symlink exists (created by session manager)
    if [ ! -f "/home/agent/.claude/.credentials.json" ]; then
        echo "Warning: No credentials in session, copying from host..."
        if [ -f "/host-claude/.credentials.json" ]; then
            cp /host-claude/.credentials.json /home/agent/.claude/
        fi
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

# Clone the repository if REPO_URL is provided and workspace is empty
# In session mode, repo may already exist from previous run
if [ -n "$REPO_URL" ] && [ "$ANALYSIS_MODE" != "true" ]; then
    if [ -d ".git" ]; then
        echo "Repository already exists in workspace, pulling latest..."
        git pull --rebase || echo "Warning: git pull failed, continuing with existing state"
    else
        echo "Cloning repository: $REPO_URL"
        git clone "$REPO_URL" .
    fi
fi

# Check if prompt is provided
if [ -z "$AGENT_PROMPT" ]; then
    echo "Error: AGENT_PROMPT environment variable is required"
    exit 1
fi

# Build Claude Code command based on mode
if [ "$ANALYSIS_MODE" = "true" ]; then
    # Analysis mode: NO --dangerously-skip-permissions, JSON output
    exec claude -p "$AGENT_PROMPT" \
        --max-turns "${MAX_TURNS:-1}" \
        --output-format json

elif [ "$USE_RESUME" = "true" ]; then
    # Resume mode: continue existing session
    echo "Resuming previous session..."
    exec claude --resume -p "$AGENT_PROMPT" \
        --dangerously-skip-permissions \
        --max-turns "${MAX_TURNS:-50}" \
        --output-format json

else
    # New session / Execution mode: full autonomy, JSON output
    exec claude -p "$AGENT_PROMPT" \
        --dangerously-skip-permissions \
        --max-turns "${MAX_TURNS:-50}" \
        --output-format json
fi
