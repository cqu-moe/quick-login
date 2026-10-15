#!/bin/sh
set -eu
unset DISPLAY
exec /opt/chrome/chrome-linux64/chrome --headless=new --password-store=basic --use-mock-keychain --ignore-certificate-errors-spki-list="$(cat /fixture/spki)" "$@"
