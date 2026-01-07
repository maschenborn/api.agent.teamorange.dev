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

# Write prompt to file to avoid shell escaping issues
# This is critical: prompts can contain |, $, `, etc. which would break eval
PROMPT_FILE="/tmp/agent_prompt.txt"
printf '%s' "$AGENT_PROMPT" > "$PROMPT_FILE"

# Model selection (default: opus)
MODEL="${AGENT_MODEL:-opus}"

# Auth method tracking
AUTH_METHOD="oauth"

# Function to run claude with fallback to API key
# Uses stdin for prompt to avoid shell escaping issues with special characters
run_claude_with_fallback() {
    local EXTRA_ARGS="$1"
    local OUTPUT_FILE="/tmp/claude_output.json"

    # First attempt: OAuth credentials
    echo "[AUTH] Attempting OAuth authentication..."
    set +e  # Don't exit on error
    cat "$PROMPT_FILE" | claude -p - $EXTRA_ARGS > "$OUTPUT_FILE" 2>&1
    local EXIT_CODE=$?
    set -e

    # Check if OAuth failed (exit code != 0 or auth error in output)
    if [ $EXIT_CODE -ne 0 ] || grep -qi "unauthorized\|401\|authentication\|login required\|token expired" "$OUTPUT_FILE" 2>/dev/null; then
        # Check if API key fallback is available
        if [ -n "$ANTHROPIC_API_KEY" ]; then
            echo "[AUTH] OAuth failed, falling back to API key..."
            AUTH_METHOD="api_key"

            # Remove OAuth credentials to force API key usage
            rm -f /home/agent/.claude/.credentials.json 2>/dev/null || true

            # Retry with API key (ANTHROPIC_API_KEY env var is already set)
            set +e
            cat "$PROMPT_FILE" | claude -p - $EXTRA_ARGS > "$OUTPUT_FILE" 2>&1
            EXIT_CODE=$?
            set -e
        fi
    fi

    # Output the result with auth method marker
    echo "[AUTH_METHOD:${AUTH_METHOD}]"
    cat "$OUTPUT_FILE"

    return $EXIT_CODE
}

# Build Claude Code command based on mode
# Note: prompt is passed via stdin (cat $PROMPT_FILE | claude -p -)
if [ "$ANALYSIS_MODE" = "true" ]; then
    # Analysis mode: NO --dangerously-skip-permissions, JSON output
    run_claude_with_fallback "--model $MODEL --max-turns ${MAX_TURNS:-1} --output-format json"

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
        run_claude_with_fallback "--resume $CLAUDE_SESSION_ID --model $MODEL --dangerously-skip-permissions --max-turns ${MAX_TURNS:-50} --output-format json"
    else
        # Fallback to new session if no Claude session found
        echo "Warning: Falling back to new session (no Claude session found)"
        run_claude_with_fallback "--model $MODEL --dangerously-skip-permissions --max-turns ${MAX_TURNS:-50} --output-format json"
    fi

else
    # New session / Execution mode: full autonomy, JSON output
    run_claude_with_fallback "--model $MODEL --dangerously-skip-permissions --max-turns ${MAX_TURNS:-50} --output-format json"
fi
