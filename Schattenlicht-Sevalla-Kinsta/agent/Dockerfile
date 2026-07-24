# syntax=docker/dockerfile:1

# Use the official UV Python base image with Python 3.13 on Debian Bookworm
# UV is a fast Python package manager with better performance than pip.
ARG PYTHON_VERSION=3.13
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS base

# Keep Python logs unbuffered and compile source to bytecode during install.
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1

# --- Build stage ---
FROM base AS build

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    python3-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the locked project dependencies first for efficient layer caching.
COPY pyproject.toml uv.lock ./
RUN mkdir -p src
RUN uv sync --locked

# Pre-download the VAD and turn detector assets.
RUN uv run --module livekit.agents download-files

# The generated Agent Builder lock does not include the direct Deepgram plugin.
# Install the official LiveKit extra after the final uv-run sync step.
RUN uv pip install --python /app/.venv/bin/python "livekit-agents[deepgram]~=1.5"

COPY . .

# --- Production stage ---
FROM base

ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

COPY --from=build --chown=appuser:appuser /app /app

WORKDIR /app
USER appuser

# Use the launcher that routes Aura-2 directly through the Deepgram plugin.
# Calling the virtualenv interpreter directly prevents a runtime sync from
# removing the extra plugin installed above.
CMD ["/app/.venv/bin/python", "src/start_with_deepgram.py", "start"]
