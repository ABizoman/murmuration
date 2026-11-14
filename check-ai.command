#!/bin/bash
# Double-click to test the API keys in .env against Jev and Gemini. Results also go to ai-check.log.
cd "$(dirname "$0")"
node tools/check-ai.mjs
