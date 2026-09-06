# syntax=docker/dockerfile:1
# oven/bun:1.4.2-debian
FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS debug

WORKDIR /workspace/ornn-forge

ENV BUN_INSTALL_CACHE_DIR=/var/cache/bun

RUN mkdir -p /var/cache/bun /var/lib/ornn-runner \
  && chown -R bun:bun /var/cache/bun /var/lib/ornn-runner

USER bun

CMD ["sh", "-ceu", "bun apps/runner/src/docker-healthcheck.ts && bun install --frozen-lockfile && exec bun --watch apps/runner/src/main.ts"]
