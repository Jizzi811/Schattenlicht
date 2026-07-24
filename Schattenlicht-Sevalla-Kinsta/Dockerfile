# syntax=docker/dockerfile:1

# One image for both Sevalla processes:
#   web   -> Node/Express website and LiveKit token endpoint
#   voice -> self-hosted Python LiveKit worker
FROM node:22-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    python3 \
    python3-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Website dependencies. This repository intentionally has no package-lock.json.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Voice-agent dependencies. The Builder export has no uv.lock, so dependencies
# are resolved during the image build and the provider plugins are then added
# to the same virtual environment.
COPY agent/pyproject.toml ./agent/
RUN mkdir -p agent/src \
  && cd agent \
  && uv sync --no-dev \
  && uv run --module livekit.agents download-files \
  && uv pip install --python /app/agent/.venv/bin/python \
       "livekit-agents[deepgram,openai]~=1.5"

COPY . .

EXPOSE 3000

# Sevalla's web process uses this command. Add a background worker with
# `npm run voice` for the continuously running LiveKit agent.
CMD ["npm", "start"]
