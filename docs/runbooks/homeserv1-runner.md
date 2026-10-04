# Homeserv1 Remote Runner

The Remote Runner runs as `ornn-forge-runner.service`. Its transport credential is a systemd encrypted credential, not an environment variable.

## GitHub App prerequisite

The Ornn GitHub App installation must include `bjesuiter/ornn-forge` and
`bjesuiter/bgf-wlan-translation-v5`, with **Repository contents: Read-only**
and **Issues: Read and write**. If the installation uses selected repositories,
add the private repo there and accept any permission update. Ornn authorizes
each repository by both numeric ID and full name. It mints a separate,
repository-scoped read token for each Job checkout and an issues-write token
for its GitHub message. A personal `gh` login does not prove App access.

## Install or replace the unit

Copy [`ornn-forge-runner.service`](../../deploy/systemd/ornn-forge-runner.service) to `/etc/systemd/system/ornn-forge-runner.service`. Keep the non-secret settings in `/etc/ornn-forge/runner.env`: `ORNN_CONTROL_PLANE_URL`, `ORNN_RUNNER_ID`, and `ORNN_RUNNER_EXECUTOR`.

Encrypt the current transport credential without printing it:

```sh
sudo systemd-creds encrypt --name=ornn-runner.transport-credential - \
  /etc/credstore.encrypted/ornn-runner.transport-credential
```

Paste the credential at the prompt. Remove `ORNN_RUNNER_CREDENTIAL` from `runner.env` after the encrypted credential exists.

Then load and start the unit:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now ornn-forge-runner
```

## Verify a restart

```sh
sudo systemctl restart ornn-forge-runner
sudo systemctl status ornn-forge-runner
sudo test -s /var/lib/ornn-runner/control-connection.ready
```

The ready marker proves authenticated control synchronization, not model readiness or Job completion.
