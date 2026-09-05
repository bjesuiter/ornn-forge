# GitHub App token scope and branch restrictions

Checked on 2026-09-05 against GitHub's current documentation.

## Conclusion

A GitHub App installation access token can be narrowed to one repository and a subset of the app's permissions. It **cannot be narrowed to a branch, tag, or ref namespace** when minted. The token endpoint accepts `repositories` or `repository_ids` and `permissions`; it has no branch or ref constraint. Installation tokens expire after one hour. [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

Giving an untrusted sandbox a one-repository token with `Contents: write` therefore gives it repository-wide content and Git authority for the token's lifetime, subject to GitHub's active branch protections and rulesets. Those protections are repository policy, not properties of the token.

For a hard per-job rule such as "publish only `refs/heads/ornn/job-123`," the strong design is to keep the token in a trusted broker. The sandbox hands the broker a commit, bundle, or patch; the broker validates the repository, base commit, target ref, and proposed objects before using the token. This is an architectural inference from GitHub's token and permission model.

## What GitHub can scope on the token

When the app creates an installation token, it can select up to 500 repositories and request a permission subset no greater than the installation's permissions. Omitting those fields grants every repository and permission available to the installation. GitHub returns the resolved repositories, permissions, and expiry with the token. [Create an installation access token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)

This supports a useful minimum:

```json
{
  "repository_ids": [123456],
  "permissions": {
    "contents": "write"
  }
}
```

It does not support an additional field such as `branches`, `refs`, `ref_pattern`, or `allowed_push_ref`. The lack of such a field in the token endpoint is the basis for the no-ref-scope conclusion.

GitHub permits installation tokens with the `Contents` permission to authenticate HTTP Git operations. The token is the HTTP password. Once the raw token is in a sandbox, ordinary `git` can fetch and push every ref that GitHub's repository-side rules allow. [Choosing GitHub App permissions for Git access](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-git-access)

## What `Contents: write` permits through `gh api`

`gh api` makes an authenticated REST or GraphQL request with the token selected through `GH_TOKEN` or the CLI credential store. It is not a reduced publishing interface. [GitHub CLI `gh api`](https://cli.github.com/manual/gh_api), [GitHub CLI environment variables](https://cli.github.com/manual/gh_help_environment)

GitHub's permission table assigns many consequential endpoints to `Contents: write`, including:

- Creating, replacing, and deleting repository files, with a caller-selected target branch.
- Creating Git blobs, trees, commits, annotated tags, and refs.
- Updating or deleting refs. This includes branch and tag refs unless repository rules block the operation.
- Renaming non-default, unprotected branches.
- Merging one branch into another.
- Merging an existing pull request, including the asynchronous merge endpoint.
- Creating, updating, and deleting releases and release assets.
- Sending a `repository_dispatch` event, which can trigger an existing Actions workflow configured for that event.

See GitHub's complete [REST endpoint table for the Contents permission](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-contents), the [Git refs endpoints](https://docs.github.com/en/rest/git/refs), the [repository contents endpoints](https://docs.github.com/en/rest/repos/contents), the [merge-a-pull-request endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request), and the [repository-dispatch endpoint](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event).

Editing `.github/workflows` requires the separate `Workflows: write` permission in addition to `Contents: write`. Omitting it is still worthwhile, but it does not prevent pushes from triggering workflows that already exist. [Choosing permissions for Git access](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-git-access)

`Contents: write` does not grant `Administration: write`. The latter is required to edit branch protection or repository rulesets, so a token minted with only Contents permission cannot simply remove those server-side protections. [Protected branches API](https://docs.github.com/en/rest/branches/branch-protection), [Repository rulesets API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)

## Rulesets and bypass are separate controls

Branch and tag rulesets target ref-name patterns. They can restrict ref creation, updates, deletions, force pushes, and other properties. A static repository policy can therefore approximate an app-specific ref allow-list by blocking the app on every branch and tag outside an approved namespace while allowing trusted maintainers to bypass. That is still a repository configuration, not a scoped credential, and branches and tags need deliberate coverage. [Creating repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

GitHub Apps can appear on a ruleset bypass list. If the publishing app has "always allow" bypass, the installation token can bypass the ruleset. GitHub also supports a pull-request-only bypass mode. A sandbox-facing app should not receive bypass if the ruleset is meant to contain it. [Ruleset bypass permissions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset)

Rulesets only constrain the operations they cover. A branch ruleset does not stop the same `Contents: write` token from creating a release, dispatching an event, or operating on an uncovered tag or branch. This is why rulesets improve defense in depth but do not turn a broad bearer token into a narrow publishing capability.

## Comparing the enforcement choices

| Control | Enforced by | What it actually limits |
| --- | --- | --- |
| Installation-token repository selection | GitHub authentication | Which repositories the bearer token can access |
| Installation-token permission subset | GitHub authentication | Which API and Git operation families the token can invoke |
| Branch, tag, and push rulesets | GitHub repository policy | Which matching ref or push operations GitHub accepts for the app identity |
| Command wrapper inside the sandbox | Sandbox process | Only cooperative callers; raw-token holders can bypass it with `git`, `curl`, or `gh api` |
| Trusted publishing broker | Trusted Ornn process | The exact repository, ref, base commit, object set, and operation that Ornn chooses to expose |

## Implication for Ornn

If the sandbox only needs to prepare commits and branches locally, do not put an installation token inside it. Let it emit a Git bundle or equivalent artifact. A trusted Ornn publisher can mint a one-repository, minimal-permission installation token, inspect the artifact, update the one authorized ref, and revoke the token afterward.

If Ornn instead hands `Contents: write` to the sandbox so the agent can use unrestricted `git` and `gh`, the honest security statement is narrower: GitHub confines the token to one repository, one permission set, one hour, and the repository's active rules. GitHub does not confine it to the intended job branch, and `Contents: write` permits more than pushing that branch.
