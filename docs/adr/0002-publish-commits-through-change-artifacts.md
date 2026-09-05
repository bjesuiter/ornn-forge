# Publish prepared commits through durable change artifacts

## Status

Superseded by [0006](./0006-start-with-direct-sandbox-github-publication.md)

Implementation jobs will prepare commits inside a credential-free sandbox. The Runner will export the commit range as a verified Git bundle, store it as an immutable change artifact, and record its base commit, head commit, provenance, and checksum. After the control plane authorizes publication, a separate publisher on the trusted Runner will import the bundle into a clean bare repository and use a short-lived, repository-scoped GitHub App installation token to push the exact head to a fresh job-owned branch without force; the control plane will then open the draft pull request. This was chosen over direct sandbox publication to keep GitHub credentials away from untrusted repository code, and over reconstructing commits through GitHub's Git Data API to preserve the prepared commits with less implementation complexity.

## Consequences

Publication adds bundle export, durable transfer, import, and verification work. Ornn will measure each phase separately, including artifact size and the elapsed time from agent completion to a verified GitHub branch. A performance optimization may remove redundant transfers or reuse a verified local artifact, but it must preserve the durable change artifact, explicit publication authorization, exact-commit verification, idempotent branch behavior, and credential isolation.
