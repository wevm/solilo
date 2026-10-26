# Changesets

For a user-visible change, run `pnpm run changeset` and commit the generated
Markdown file with the implementation. Choose a patch for fixes, a minor for new
features, and explicitly describe breaking changes while solilo is experimental.
Use past-tense release notes; the requested initial release note is exactly
`Initial release`. For docs-only or development-tooling changes, use
`pnpm run changeset --empty`
to record that no package release is needed.

`pnpm run changeset:status` previews pending releases. After verification on `main`,
GitHub Actions opens or updates a version PR containing the version bump,
`CHANGELOG.md`, and synchronized pnpm lockfile. The initial baseline is 0.0.0;
`.changeset/initial-release.md` requests a normal patch release to 0.0.1.
There is no prerelease mode. The older empty tooling changeset does not bump it.

For manual release preparation, `pnpm run changeset:version` consumes pending
changesets locally. GitHub-linked changelogs use `GITHUB_TOKEN` to look up commits
and pull requests. Prefer the workflow rather than storing a token in a file.

The repository must allow GitHub Actions to create pull requests under
**Settings → Actions → General → Workflow permissions**. This option may require
organization-admin approval. PRs created using `GITHUB_TOKEN` do not automatically
trigger other Actions workflows; close and reopen the version PR as a maintainer
to trigger its verification before merging.

Merging the version PR only prepares the package. Publishing is a separate,
deliberate manual run of `.github/workflows/publish.yml` on `main`, with the exact
version as its input. It verifies the code, rejects unversioned changesets, builds
and validates a tarball without restored caches, and publishes with npm OIDC to
the `latest` dist-tag. It does not create Git tags or GitHub releases.

Configure the npm trusted publisher for GitHub owner `wevm`, repository `solilo`,
workflow filename `publish.yml`, and a blank environment. Allow **npm publish**
(new trusted publishers default to stage-only). The workflow uses GitHub-hosted
Ubuntu, `id-token: write`, Node 24.22.1, and npm 12.2.1; no npm token is needed.
The official minimum is npm 11.5.1 and Node 22.14.0, but solilo's Node floor is
24.22.1. A new trusted publisher expires unless first used successfully within
two days. See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers).

The workflow must be pushed before it can run. A dry-run validates packaging,
not npm ownership or OIDC authorization. Publishing requires separate approval.
