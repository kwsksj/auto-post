#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKFLOWS_DIR="${REPO_DIR}/.github/workflows"
ENV_FILE="${1:-${REPO_DIR}/.env}"

if [[ ! -d "${WORKFLOWS_DIR}" ]]; then
  echo "ERROR: workflows directory not found: ${WORKFLOWS_DIR}" >&2
  exit 1
fi

secrets="$(
  rg -No 'secrets\.([A-Z0-9_]+)' "${WORKFLOWS_DIR}" \
    | sed -E 's/.*secrets\.([A-Z0-9_]+).*/\1/' \
    | sort -u
)"

count="$(printf "%s\n" "${secrets}" | sed '/^$/d' | wc -l | tr -d ' ')"
echo "Required GitHub Actions secrets (${count}):"
printf "%s\n" "${secrets}" | sed '/^$/d' | while IFS= read -r name; do
  echo "  - ${name}"
done

if [[ -f "${ENV_FILE}" ]]; then
  echo
  echo "Checking local env file: ${ENV_FILE}"
  printf "%s\n" "${secrets}" | sed '/^$/d' | while IFS= read -r name; do
    if ! rg -q "^${name}=" "${ENV_FILE}"; then
      echo "  missing in .env: ${name}"
    fi
  done
  # missing is inside a pipe subshell in bash3, recompute safely.
  missing_count="$(
    printf "%s\n" "${secrets}" | sed '/^$/d' | while IFS= read -r name; do
      if ! rg -q "^${name}=" "${ENV_FILE}"; then
        echo "${name}"
      fi
    done | wc -l | tr -d ' '
  )"
  if [[ "${missing_count}" -eq 0 ]]; then
    echo "  all required secret keys are present in .env (key presence only)."
  fi
else
  echo
  echo "Env file not found: ${ENV_FILE}"
fi
