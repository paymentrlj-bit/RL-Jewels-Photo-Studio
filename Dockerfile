# Runs identically on Cloud Run, a VPS, or the Lenovo at the lightbox station.
# That last option matters: a store whose internet drops should be able to run
# this locally without a second thought, and that stays possible only because
# there is no database server to stand up alongside it.

# ---- build ----
FROM node:22-bookworm-slim AS build

# better-sqlite3 ships prebuilt binaries for common platforms, but falls back
# to compiling from source. These are here so that fallback succeeds rather
# than failing the image build on a platform without a prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source-only change does not re-run npm ci.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Drops devDependencies from node_modules while keeping the compiled
# better-sqlite3 binary that npm ci already produced.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
# Everything persistent lives here, and this is the path to mount a volume at.
ENV DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# The bundled CPC seed data (read from process.cwd()/data at first boot) and
# the shipped ERP mapping presets. Both are read at runtime, so they have to
# be in the image rather than only in the build stage.
COPY --from=build /app/data ./data
COPY --from=build /app/server/export/mappings ./server/export/mappings

# Runs unprivileged. The node image already provides this user; the data
# directory is created and handed over before dropping to it.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3000

# Uses the app's own health endpoint rather than a bare TCP check, so a
# process that is up but broken is reported as unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
