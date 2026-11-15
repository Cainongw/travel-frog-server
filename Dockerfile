FROM node:24-bookworm-slim AS admin
WORKDIR /build/admin-ui
COPY admin-ui/package*.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

FROM nginx:1.28-alpine AS management
COPY deploy/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=admin /build/admin-ui/dist /usr/share/nginx/html/admin
EXPOSE 8080

FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production FROG_HOST=0.0.0.0 FROG_PORT=8080 FROG_DB=/data/travel-frog.sqlite FROG_ASSETS=/assets
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY *.js ./
COPY data/postcards.json ./data/postcards.json
RUN mkdir -p /data /assets && chown node:node /data /assets
USER node
EXPOSE 8080
CMD ["node","server.js"]
