#!/bin/sh
# Run with sudo after uploading runtime code/build and privately licensed content.
set -eu
cd /opt/lingo-scholar
if ! id lingo >/dev/null 2>&1; then useradd --system --home /opt/lingo-scholar --shell /usr/sbin/nologin lingo; fi
install -d -m 700 -o lingo -g lingo data LingoScholar
if [ ! -e /etc/lingo-scholar.env ]; then install -m 600 deploy/production.env.example /etc/lingo-scholar.env; fi
install -m 644 deploy/lingo-scholar.service deploy/lingo-backup.service deploy/lingo-backup.timer deploy/lingo-cert-renew.service deploy/lingo-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lingo-cert-renew.timer lingo-backup.timer
systemctl enable --now lingo-scholar.service
systemctl is-active lingo-scholar
