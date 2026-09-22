#!/bin/sh
set -eu
# Install once with sudo from an audited local upload. Production directories stay put.
test -d /opt/lingo-scholar/data
id lingobuild >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingobuild --shell /usr/sbin/nologin lingobuild
install -d -m 755 /opt/lingo-releases /usr/local/lib/lingo-deploy
install -d -m 700 /var/lib/lingo-deploy
install -m 644 release-poller.mjs /usr/local/lib/lingo-deploy/release-poller.mjs
install -m 644 lingo-release-poller.service lingo-release-poller.timer /etc/systemd/system/
if [ ! -e /opt/lingo-current ]; then ln -s /opt/lingo-scholar /opt/lingo-current; fi
install -d -m 755 /etc/systemd/system/lingo-scholar.service.d
install -m 644 release-working-directory.conf /etc/systemd/system/lingo-scholar.service.d/release.conf
systemctl daemon-reload
systemctl enable --now lingo-release-poller.timer
systemctl start lingo-release-poller.service
