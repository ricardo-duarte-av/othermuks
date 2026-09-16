# The app is static files, so the build stage always runs on the builder's own architecture even when
# the image is built for another one: no QEMU emulation for the slow part.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/backend.sh /docker-entrypoint.d/30-othermuks-backend.sh

# The entrypoint script fills this directory in when GOMUKS_BACKEND is set; nginx includes it either way.
RUN mkdir -p /etc/nginx/othermuks && chmod +x /docker-entrypoint.d/30-othermuks-backend.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO /dev/null http://localhost/index.html || exit 1
