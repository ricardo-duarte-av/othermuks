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

echo "othermuks: proxying /_gomuks/ to $backend/_gomuks/"

cat > "$conf" <<EOF
location /_gomuks/ {
    proxy_pass $backend/_gomuks/;
    proxy_http_version 1.1;

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
}
EOF
