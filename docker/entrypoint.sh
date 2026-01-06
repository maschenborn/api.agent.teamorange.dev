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
    # Credentials are managed by session manager (copied with correct UID 1001)
    if [ ! -f "/home/agent/.claude/.credentials.json" ]; then
        echo "Warning: No credentials found in session directory"
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

# Model selection (default: opus)
MODEL="${AGENT_MODEL:-opus}"

# Build Claude Code command based on mode
if [ "$ANALYSIS_MODE" = "true" ]; then
    # Analysis mode: NO --dangerously-skip-permissions, JSON output
    exec claude -p "$AGENT_PROMPT" \
        --model "$MODEL" \
        --max-turns "${MAX_TURNS:-1}" \
        --output-format json

elif [ "$USE_RESUME" = "true" ]; then
    # Resume mode: continue existing session
    echo "Resuming previous session..."

    # Find Claude session ID from projects directory
    # Sessions are stored as ~/.claude/projects/<project-hash>/<session-id>.jsonl
    CLAUDE_SESSION_ID=""

    if [ -d "/home/agent/.claude/projects" ]; then
        # Find the most recent .jsonl file and extract session ID (filename without extension)
        LATEST_SESSION=$(find /home/agent/.claude/projects -name "*.jsonl" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)

        if [ -n "$LATEST_SESSION" ]; then
            # Extract session ID from filename (remove path and .jsonl extension)
            CLAUDE_SESSION_ID=$(basename "$LATEST_SESSION" .jsonl)
            echo "Found Claude session: $CLAUDE_SESSION_ID"
        else
            echo "Warning: No Claude session files found in projects directory"
        fi
    fi

    if [ -n "$CLAUDE_SESSION_ID" ]; then
        exec claude --resume "$CLAUDE_SESSION_ID" -p "$AGENT_PROMPT" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --max-turns "${MAX_TURNS:-50}" \
            --output-format json
    else
        # Fallback to new session if no Claude session found
        echo "Warning: Falling back to new session (no Claude session found)"
        exec claude -p "$AGENT_PROMPT" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --max-turns "${MAX_TURNS:-50}" \
            --output-format json
    fi

else
    # New session / Execution mode: full autonomy, JSON output
    exec claude -p "$AGENT_PROMPT" \
        --model "$MODEL" \
        --dangerously-skip-permissions \
        --max-turns "${MAX_TURNS:-50}" \
        --output-format json
fi
