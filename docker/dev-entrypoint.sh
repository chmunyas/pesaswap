#!/bin/sh
# Dev container entrypoint.
#
# When docker-compose.dev.yml bind-mounts the host repository over /app, the
# vendor/ directory baked into the Docker image gets shadowed by whatever the
# host has (often nothing, since vendor/ is in .gitignore). This script
# guarantees a working vendor/ on first boot by running `composer install` if
# the CodeIgniter framework bootstrap file is missing.
#
# After the first run, vendor/ exists on the host (thanks to the bind mount),
# so subsequent container restarts skip the install in <1s.

set -e

VENDOR_BOOT="/app/vendor/codeigniter4/framework/system/Boot.php"

if [ ! -f "$VENDOR_BOOT" ]; then
  echo "[dev-entrypoint] vendor/ missing or incomplete — running composer install..."
  cd /app
  composer install --no-interaction --prefer-dist --no-progress \
    || echo "[dev-entrypoint] WARNING: composer install failed, container will start but PHP requests will 500 until vendor/ is restored."
  echo "[dev-entrypoint] composer install complete."
else
  echo "[dev-entrypoint] vendor/ present — skipping composer install."
fi

# Hand off to the original Apache foreground command (or whatever was passed)
exec "$@"
