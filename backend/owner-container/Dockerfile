# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf node_modules/.bin node_modules/pg-types/test

FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 OWNER_ACCESS_ENABLED=false
COPY --from=dependencies /build/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
COPY config/outdoor-regions ./config/outdoor-regions
COPY container/healthcheck.js ./container/healthcheck.js
COPY owner-container/preflight.js ./owner-container/preflight.js
USER 65532:65532
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=2s --start-period=15s --retries=3 \
  CMD ["node", "container/healthcheck.js"]
ENTRYPOINT ["node"]
CMD ["src/ownerAccess/startOwnerService.js"]
