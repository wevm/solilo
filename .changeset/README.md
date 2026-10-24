# Changesets

For a user-visible change, run `npm run changeset` and commit the generated
Markdown file with the implementation. Choose a patch for fixes, a minor for new
features, and explicitly describe breaking changes while solilo is experimental.
For docs-only or development-tooling changes, use `npm run changeset -- --empty`
to record that no package release is needed.

`npm run changeset:status` previews pending releases. After verification on `main`,
GitHub Actions opens or updates a version PR containing the version bump,
`CHANGELOG.md`, and synchronized npm lockfile. The current version stays at 0.1.0
until a version PR is merged; this setup's empty changeset does not bump it.

For manual release preparation, `npm run changeset:version` consumes pending
changesets locally. GitHub-linked changelogs use `GITHUB_TOKEN` to look up commits
and pull requests. Prefer the workflow rather than storing a token in a file.

The repository must allow GitHub Actions to create pull requests under
**Settings → Actions → General → Workflow permissions**. This option may require
organization-admin approval. PRs created using `GITHUB_TOKEN` do not automatically
trigger other Actions workflows; close and reopen the version PR as a maintainer
to trigger its verification before merging.

There is deliberately no publishing step, npm token, trusted-publishing grant,
tag creation, or GitHub release creation. Merging the version PR only prepares
the package. Publishing needs a separately approved setup.
