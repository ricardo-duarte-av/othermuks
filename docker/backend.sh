#!/bin/sh
# Generates the /_gomuks/ reverse proxy from GOMUKS_BACKEND (e.g. https://webmuks.example.com or
# http://gomuks:29325). With it, othermuks and gomuks share one origin: cookie auth works and the
# client can fall back to the websocket when something in the network holds the SSE stream back.
set -eu

conf=/etc/nginx/othermuks/backend.conf
rm -f "$conf"

if [ -z "${GOMUKS_BACKEND:-}" ]; then
    echo "othermuks: GOMUKS_BACKEND not set, serving the app only (pick a backend in the UI)"
    exit 0
fi

# Accepts the forms the UI accepts too: with or without a trailing slash or /_gomuks.
backend=${GOMUKS_BACKEND%/}
backend=${backend%/_gomuks}
backend=${backend%/}

# Hostname alone, for TLS SNI (ignored when the backend is plain http): no scheme, path, userinfo or port.
backend_host=${backend#*://}
backend_host=${backend_host%%/*}
backend_host=${backend_host##*@}
case $backend_host in
    \[*\]*) backend_host=${backend_host%%\]*}\] ;;  # [::1]:29325 -> [::1]
    *:*) backend_host=${backend_host%:*} ;;
esac

# gomuks accepts a websocket upgrade only when the Host it receives matches the browser's Origin
# (coder/websocket authenticateOrigin), so the browser's own host is forwarded rather than nginx's
# default of the backend's address. Override this when the backend is a name-based vhost that routes
# by Host; gomuks' config then needs the othermuks origin in `origin_patterns` for websockets to work.
host_header=${GOMUKS_HOST_HEADER:-\$host}

echo "othermuks: proxying /_gomuks/ to $backend/_gomuks/ (Host: $host_header)"

cat > "$conf" <<EOF
location /_gomuks/ {
    proxy_pass $backend/_gomuks/;
    proxy_http_version 1.1;

    proxy_set_header Host $host_header;
    proxy_ssl_server_name on;
    proxy_ssl_name $backend_host;

    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Real-IP \$remote_addr;
    # A compressed event stream gets buffered in transit, so ask gomuks for identity encoding.
    proxy_set_header Accept-Encoding "identity";

    # The event stream stays open and must reach the browser as it is written, never buffered.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;

    # Media uploads go through here: no size cap beyond what gomuks and the homeserver enforce, and
    # the body is streamed to gomuks as it arrives rather than spooled to disk first.
    client_max_body_size 0;
    proxy_request_buffering off;
}
EOF
