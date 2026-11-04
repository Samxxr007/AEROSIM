#!/usr/bin/env bash
# Starts the AeroSim backend (port 8000) and frontend (port 5173) for local development.
set -e
cd "$(dirname "$0")"
(cd backend && python -m uvicorn app.main:app --reload --port 8000) &
BACK=$!
(cd frontend && npm run dev) &
FRONT=$!
trap "kill $BACK $FRONT" EXIT
echo "AeroSim: API http://127.0.0.1:8000/docs · UI http://127.0.0.1:5173"
wait
