# Monorepo Integration Note

## Recommendation

Use this repository (`media-platform`) as the monorepo canonical target and import `gallery` into it.

Reason:
- scheduled GitHub Actions are already configured here
- repository secrets are already configured here

## Why Not Move Away First

GitHub Actions secret values cannot be exported by API/CLI.

That means:
- you can list secret names
- you cannot retrieve existing secret values from GitHub

If you switch canonical repo away from here first, you must re-enter all secret values manually in the new repo.

## Safe Integration Path

Run in `<repo-root>`:

```bash
git checkout -b codex/monorepo-bootstrap
git remote add gallery-local /Users/kawasakiseiji/development/gallery
git fetch gallery-local
git subtree add --prefix apps/gallery gallery-local main
```

If `git subtree` is unavailable, use no-history copy:

```bash
mkdir -p apps/gallery
rsync -a --exclude .git /Users/kawasakiseiji/development/gallery/ apps/gallery/
git add apps/gallery
git commit -m "Import gallery into apps/gallery (no history)"
```

## Secrets Handling Rules

- Never print secret values to terminal or logs.
- Never commit `.env` or credentials files.
- Prefer keeping current canonical repo to avoid secret re-entry work.
- If migration to another GitHub repo is eventually required, set secrets from local source of truth (`.env`, password manager, provider dashboards), not from GitHub.

## Secret Migration Feasibility

Possible:
- migrate secret names
- re-set secrets to another repo if you already have values locally

Not possible:
- extract existing secret values from this repo via GitHub API/CLI

## Helper Scripts

```bash
# show required secret names from workflows
scripts/list-required-gh-secrets.sh

# if you already have values locally, push them to another repo
scripts/push-gh-secrets-from-env.sh <owner/repo>

# preview only
scripts/push-gh-secrets-from-env.sh --dry-run <owner/repo>
```

## Post-Integration Validation

統合後、以下のコマンドで動作確認:

```bash
# auto-post CLI dry-run
auto-post post --dry-run --date $(date +%Y-%m-%d)

# gallery export dry-run (no R2 upload)
auto-post export-gallery-json --no-upload --no-thumbs --no-light

# workflow パス確認（pip install -e . が正しく参照されているか）
grep -r "pip install -e" .github/workflows/

# gallery worker deploy dry-run
cd apps/gallery && npx wrangler deploy --dry-run
```

詳細な検証手順は `apps/gallery/docs/monorepo-migration-plan.md` を参照。
