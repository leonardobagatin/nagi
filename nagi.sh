#!/usr/bin/env bash

# Find project root
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

# Activate venv if it exists, otherwise just run
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Start uvicorn in the background
uvicorn app.main:app --reload &
UVICORN_PID=$!

# Ensure uvicorn shuts down when the script exits
trap 'kill "$UVICORN_PID" 2>/dev/null' EXIT

# Background watcher: polls the server until it's up, then opens the browser
if [ -n "$DISPLAY" ] && command -v xdg-open &> /dev/null; then
    (
        while kill -0 "$UVICORN_PID" 2>/dev/null; do
            if curl -s "http://127.0.0.1:8000" > /dev/null 2>&1; then
                xdg-open "http://127.0.0.1:8000"
                break
            fi
            sleep 0.2
        done
    ) &
fi

# Keep the script running and attached to Uvicorn
wait "$UVICORN_PID"