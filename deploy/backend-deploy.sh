#!/usr/bin/env bash

set -eu

artifact_dir=${1:?artifact directory is required}
release_id=${2:?release id is required}
app_root=${3:-/apps/stock}
service_name=wx-app-stock-backend
service_file="${artifact_dir}/wx-app-stock-backend.service"
release_root="${app_root}/releases"
release_dir="${release_root}/${release_id}"

case "${release_id}" in
  (*[!A-Za-z0-9._-]*)
    echo "invalid release id: ${release_id}" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64)
    package="wx-app-stock-backend-linux-amd64.tar.gz"
    ;;
  aarch64|arm64)
    package="wx-app-stock-backend-linux-arm64.tar.gz"
    ;;
  *)
    echo "unsupported server architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

healthcheck() {
  url="http://127.0.0.1:18487/api/v1/stock/search?keyword=test"

  for _ in $(seq 1 30); do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    if command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "$url"; then
      return 0
    fi
    sleep 2
  done

  return 1
}

if [ ! -d "${artifact_dir}" ]; then
  echo "artifact directory does not exist: ${artifact_dir}" >&2
  exit 1
fi
if [ ! -f "${artifact_dir}/${package}" ]; then
  echo "release package does not exist: ${artifact_dir}/${package}" >&2
  exit 1
fi
if [ ! -f "${artifact_dir}/SHA256SUMS" ]; then
  echo "checksum file does not exist: ${artifact_dir}/SHA256SUMS" >&2
  exit 1
fi
if [ ! -f "${app_root}/backend/config.yaml" ]; then
  echo "server config does not exist: ${app_root}/backend/config.yaml" >&2
  exit 1
fi

(
  cd "${artifact_dir}"
  sha256sum -c SHA256SUMS
)

mkdir -p "${release_root}"
rm -rf "${release_dir}"
mkdir -p "${release_dir}"
tar -xzf "${artifact_dir}/${package}" -C "${release_dir}"
test -x "${release_dir}/server"

previous_target="$(readlink "${app_root}/current" 2>/dev/null || true)"
old_docker_backend=false

rendered_service="$(mktemp)"
sed "s#@APP_ROOT@#${app_root}#g" "${service_file}" > "${rendered_service}"
as_root install -m 0644 "${rendered_service}" "/etc/systemd/system/${service_name}.service"
rm -f "${rendered_service}"

rm -f "${app_root}/current.next"
ln -s "${release_dir}" "${app_root}/current.next"
mv -Tf "${app_root}/current.next" "${app_root}/current"

# The first binary deployment must release port 18487 from the old Compose service.
if command -v docker >/dev/null 2>&1 && [ -f "${app_root}/docker-compose.yml" ]; then
  if as_root docker compose -f "${app_root}/docker-compose.yml" ps -q backend | grep -q .; then
    old_docker_backend=true
  fi
  as_root docker compose -f "${app_root}/docker-compose.yml" stop backend >/dev/null 2>&1 || true
  as_root docker compose -f "${app_root}/docker-compose.yml" rm -f backend >/dev/null 2>&1 || true
fi

as_root systemctl daemon-reload
as_root systemctl enable "${service_name}.service" >/dev/null
as_root systemctl restart "${service_name}.service"

if ! healthcheck; then
  echo "backend health check failed after deployment" >&2
  as_root journalctl -u "${service_name}.service" --no-pager -n 80 >&2 || true

  if [ -n "${previous_target}" ] && [ -d "${previous_target}" ]; then
    rm -f "${app_root}/current.rollback"
    ln -s "${previous_target}" "${app_root}/current.rollback"
    mv -Tf "${app_root}/current.rollback" "${app_root}/current"
    as_root systemctl restart "${service_name}.service" || true
  elif [ "${old_docker_backend}" = true ]; then
    as_root docker compose -f "${app_root}/docker-compose.yml" up -d backend || true
  fi

  exit 1
fi

# Keep the current release and the two newest previous releases.
find "${release_root}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +4 \
  | cut -d' ' -f2- \
  | while IFS= read -r old_release; do
      [ -n "${old_release}" ] && rm -rf -- "${old_release}"
    done

echo "deployed ${release_id} (${package})"
