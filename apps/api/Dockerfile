# syntax=docker/dockerfile:1
# Production image for the Lumen API (spec 16). Multi-stage: the build stage installs the full
# pnpm workspace, bundles the server (esbuild, inlining @lumen/shared), and produces a prod-only
# node_modules; the runtime stage is a slim, NON-ROOT image carrying ONLY the built bundle + prod
# deps — no source, no dev deps, no tests. Config is env-only; secrets are never baked in.

# ---- build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# Install against the committed lockfile (the .dockerignore keeps host node_modules/.env out).
COPY . .
RUN pnpm install --frozen-lockfile

# Bundle the server to a single file, then emit a self-contained prod-deps folder at /app.
RUN pnpm --filter @lumen/api build:bundle
RUN pnpm --filter @lumen/api deploy --prod --legacy /app

# ---- runtime stage --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
# Unprivileged user — the API never needs root.
RUN groupadd --system lumen && useradd --system --gid lumen --home-dir /app --shell /usr/sbin/nologin lumen
WORKDIR /app

COPY --from=build --chown=lumen:lumen /app/node_modules ./node_modules
COPY --from=build --chown=lumen:lumen /repo/apps/api/dist ./dist

USER lumen
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Liveness — the VPS/Docker restarts the container if /health stops responding.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
