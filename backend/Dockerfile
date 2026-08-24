# syntax=docker/dockerfile:1.7

FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf node_modules/.bin node_modules/pg-types/test

FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime
WORKDIR /app

# The final filesystem retains Node only. Package managers and their launchers
# are removed so the runtime cannot install or build dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    ROUTE_PROVIDER_ENABLED=false \
    INTENT_PROVIDER_ENABLED=false \
    OUTDOOR_EVIDENCE_PROVIDER_ENABLED=false \
    OUTDOOR_RESEARCH_PLANNING_ENABLED=false \
    OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED=false \
    ROUTE_ALLOW_INSECURE_LOCAL_ROUTING=false \
    INTENT_ALLOW_INSECURE_LOCAL_PARSING=false \
    INTENT_ALLOW_DETERMINISTIC_MOCK=false \
    OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL=false \
    APP_ATTEST_ALLOW_IN_MEMORY=false

COPY --from=dependencies /build/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
COPY config/outdoor-regions ./config/outdoor-regions
COPY container/healthcheck.js container/stagingAdmission.js container/start.js ./container/

USER 65532:65532
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=2s --start-period=15s --retries=3 \
  CMD ["node", "container/healthcheck.js"]

ENTRYPOINT ["node"]
CMD ["container/start.js"]
