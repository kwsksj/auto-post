#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 [--dry-run] <owner/repo> [env-file]" >&2
  exit 1
fi

TARGET_REPO="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKFLOWS_DIR="${REPO_DIR}/.github/workflows"
ENV_FILE="${2:-${REPO_DIR}/.env}"

if [[ ! -d "${WORKFLOWS_DIR}" ]]; then
  echo "ERROR: workflows directory not found: ${WORKFLOWS_DIR}" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh auth is not configured. Run: gh auth login" >&2
  exit 1
fi

required_secrets="$(
  rg -No 'secrets\.([A-Z0-9_]+)' "${WORKFLOWS_DIR}" \
    | sed -E 's/.*secrets\.([A-Z0-9_]+).*/\1/' \
    | sort -u
)"

get_env_value() {
  local key="$1"
  local line value
  line="$(grep -m1 "^${key}=" "${ENV_FILE}" || true)"
  if [[ -z "${line}" ]]; then
    return 1
  fi
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf "%s" "${value}"
}

echo "Target repo: ${TARGET_REPO}"
echo "Env file:    ${ENV_FILE}"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Mode:        dry-run (no secret updates)"
fi
echo

printf "%s\n" "${required_secrets}" | sed '/^$/d' | while IFS= read -r key; do
  if value="$(get_env_value "${key}")"; then
    if [[ -z "${value}" ]]; then
      echo "Skip ${key}: empty value in env"
      continue
    fi
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      echo "Would set ${key}"
    else
      # Value is passed via stdin to avoid exposing it in args/history.
      printf "%s" "${value}" | gh secret set "${key}" -R "${TARGET_REPO}" >/dev/null
      echo "Set ${key}"
    fi
  else
    echo "Skip ${key}: not found in env"
  fi
done

# updated/skipped are in subshell when piped in bash3; recompute for summary.
updated_count="$(
  printf "%s\n" "${required_secrets}" | sed '/^$/d' | while IFS= read -r key; do
    if value="$(get_env_value "${key}")" && [[ -n "${value}" ]]; then
      echo "${key}"
    fi
  done | wc -l | tr -d ' '
)"
total_count="$(printf "%s\n" "${required_secrets}" | sed '/^$/d' | wc -l | tr -d ' ')"
skipped_count="$((total_count - updated_count))"

echo
echo "Done. Updated: ${updated_count}, Skipped: ${skipped_count}, Total required: ${total_count}"
