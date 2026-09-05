# Publishing

How a verified change becomes an installable artifact for operators (including OVHC).

## Artifacts and destinations

| Artifact | Destination | Versioned by | Owner |
|---|---|---|---|
| Source archive | GitHub `main` (and later git tags) | Commit SHA / tag | Maintainers |
| Installer script | [`scripts/install.sh`](../../scripts/install.sh) via raw GitHub URL | Same as branch/tag | Maintainers |
| Local app tree | `~/.t3-coordinator/app` on the host | `install.json` records repo/ref/time | Operator |

There is no npm registry publish yet (`private: true`). Installers download `https://github.com/DecisionNerd/t3-coordinator/archive/refs/heads/<ref>.tar.gz` (or `refs/tags/<ref>.tar.gz` when `T3_COORDINATOR_REF` looks like a version tag).

## Install command (users)

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
```

Optional env: `T3_COORDINATOR_REF`, `T3_COORDINATOR_INSTALL_DIR`, `T3_COORDINATOR_BIN_DIR`, `T3_COORDINATOR_REPO`.

Requires Node 20+, `curl`, `tar`, `npm`. Temporal CLI is separate ([docs](https://docs.temporal.io/cli#install)).

## Suggested versioning

- Prefer **Semantic Versioning** tags (`v0.1.0`) once the [v0 gate](TESTING.md) is green and we cut releases.
- Until then, `main` is the default install ref.
- Conventional Commits are welcome; not enforced.

## Build and continuous delivery

Installer path on the target host:

```sh
# (what install.sh runs)
npm install
npm run build
npm prune --omit=dev
# wrapper: ~/.local/bin/t3-coordinator → node ~/.t3-coordinator/app/lib/cli.js
```

From a checkout (developers):

```sh
npm install
npm test
npm run build
```

Promotion gate: [TESTING.md](TESTING.md) must be green before tagging a release people should pin with `T3_COORDINATOR_REF=vX.Y.Z`.

## Environments and promotion

| From | To | Required evidence / approval |
|---|---|---|
| Local / PR | `main` | Review + tests |
| `main` | Tagged release (`v*`) | Full v0 gate on paired [TESTBED](../experience/TESTBED.md) |
| Tag / `main` | Operator hosts (OVHC) | Re-run `install.sh` (overwrites `~/.t3-coordinator/app`) |

## Deployment verification

On the host after install:

```bash
t3-coordinator version
t3-coordinator doctor
```

Expected: version prints; doctor shows credentials/binding/snapshot status (snapshot may fail until T3 + `auth-issue`).

## Rollback and recovery

Re-run the installer with a known-good ref:

```bash
T3_COORDINATOR_REF=<previous-sha-or-tag> curl -fsSL \
  https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
```

Bindings and credentials live under `~/.t3-coordinator/` outside the app tree and survive reinstalls. Delete `~/.t3-coordinator/app` only if you intend a clean app install; do not wipe credentials unless rotating auth.

## Official references

- [Semantic Versioning 2.0.0](https://semver.org/)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Temporal CLI install](https://docs.temporal.io/cli#install)
- [GitHub archive downloads](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)
