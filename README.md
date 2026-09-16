# othermuks

## Docker

Every push builds `ghcr.io/ricardo-duarte-av/othermuks` (tagged with the branch name, `latest` on `main`,
plus the full commit SHA) for linux/amd64 and linux/arm64.

The image is nginx serving the built app on port 80. On its own that is the same thing GitHub Pages
hosts, and you pick a gomuks backend in the UI:

```sh
docker run -p 8080:80 ghcr.io/ricardo-duarte-av/othermuks
```

Set `GOMUKS_BACKEND` and the container also reverse-proxies `/_gomuks/` to gomuks, so the app and the
backend share one origin. That is the better way to run it: auth uses gomuks' cookie instead of Basic
auth, no CORS setup is needed on the backend, and the client can fall back to gomuks' websocket when
something in the network (a company proxy, antivirus HTTPS scanning) holds the SSE stream back — a
fallback that only works same-origin.

```yaml
services:
  othermuks:
    image: ghcr.io/ricardo-duarte-av/othermuks:latest
    environment:
      GOMUKS_BACKEND: http://gomuks:29325
    ports:
      - 8080:80
    restart: unless-stopped
```

`GOMUKS_BACKEND` takes the same forms the UI accepts (`https://host`, `https://host/`,
`https://host/_gomuks`). The proxy disables response buffering and allows hour-long reads, which is what
the event stream needs.

The browser's own `Host` is forwarded to gomuks, because gomuks accepts a websocket upgrade only when
the `Host` it sees matches the page's `Origin`. If your backend is a name-based vhost that routes by
`Host`, set `GOMUKS_HOST_HEADER` to the backend's hostname — and then add the othermuks origin to
`origin_patterns` in gomuks' `config.yaml`, or the websocket will be answered with 403.

Put your own TLS terminator in front of it. If that is nginx too, it must not buffer `/_gomuks/sse`
either (`proxy_buffering off`, or let gomuks' `X-Accel-Buffering: no` through).
