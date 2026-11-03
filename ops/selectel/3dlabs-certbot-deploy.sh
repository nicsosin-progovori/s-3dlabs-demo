#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /var/lib/3dlabs/letsencrypt/live/3dlabs-progovori ]; then
    /usr/sbin/nginx -t
    /usr/sbin/nginx -s reload
fi
