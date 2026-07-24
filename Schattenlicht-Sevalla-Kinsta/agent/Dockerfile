# syntax=docker/dockerfile:1

# Use the official UV Python base image with Python 3.13 on Debian Bookworm.
ARG PYTHON_VERSION=3.13
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS base

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

# Install the locked Builder-export dependencies first.
COPY pyproject.toml uv.lock ./
RUN mkdir -p src
RUN uv sync --locked

# Download local VAD and turn-detector assets before copying application code.
RUN uv run --module livekit.agents download-files

# Add the provider plugins used by the self-hosted compatibility launcher.
RUN uv pip install --python /app/.venv/bin/python \
    "livekit-agents[deepgram,openai]~=1.5"

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

# Connect as an external LiveKit worker. STT/TTS use Deepgram directly and
# the LLM uses NVIDIA's OpenAI-compatible API.
CMD ["/app/.venv/bin/python", "src/start_self_hosted.py", "start"]
