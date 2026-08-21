# Imanleads production deployment

Kan runs only in remote production for this installation. A push to `main` starts the `CI` workflow. The exact tested revision is then passed to `Deploy production`, which connects through a restricted SSH key and runs the remote build in `/home/ubuntu/kan`.

## Release gates

`CI` checks changed-file formatting and ESLint, compiles translations, validates the complete production TypeScript graph, runs the web, API, auth, shared, and MCP test suites, builds the web app and MCP, and checks the deployment shell scripts.

`Deploy production` runs only for a successful `CI` push event on `main`. The production environment serializes releases. The server takes a database and MinIO backup, fast-forwards to the tested SHA, builds, migrates, recreates the stack, installs Nginx and the backup timer, and verifies internal, origin, and public health.

If `main` advances while an older workflow is running, the older revision exits without deployment. A release lock prevents manual and automatic deployments from overlapping.

## GitHub production environment

The `production` environment requires these secrets:

- `KAN_PRODUCTION_HOST`
- `KAN_PRODUCTION_USER`
- `KAN_PRODUCTION_SSH_KEY`
- `KAN_PRODUCTION_KNOWN_HOSTS`

The SSH public key must be installed with a forced command pointing to `/home/ubuntu/.local/bin/kan-ci-deploy`, with PTY, forwarding, and agent access disabled. The entrypoint accepts only `deploy <full-git-sha>`.

## Manual release and rollback

```bash
ssh imanleads 'cd /home/ubuntu/kan && ./deploy/imanleads/deploy.sh'
curl --fail --show-error --silent https://work.imanleads.com/api/v1/health
```

Production rollback is a revert commit on `main`. That preserves the same CI, backup, migration, and health gates instead of bypassing the tested history with an arbitrary old checkout.

## Attachment limits and cleanup

Each attachment must be between 1 byte and 50 MiB. A card can have at most five pending upload sessions, and a user can have at most ten pending upload sessions across cards. Upload sessions are valid for one hour; confirmation claims are valid for ten minutes.

On every start, the `minio-init` service lists the private attachments bucket lifecycle rules, adds the `.uploads/` expiration rule only when it is absent, and verifies it afterward. The rule expires staging objects after one day without replacing unrelated bucket rules. Confirmed objects use `.objects/` and are not covered by that rule. No hard capacity quota is configured for the bucket, so production storage usage must be monitored at the MinIO volume level.
