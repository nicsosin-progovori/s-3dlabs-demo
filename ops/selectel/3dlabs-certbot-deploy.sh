#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/3dlabs-progovori ]; then
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
fi
