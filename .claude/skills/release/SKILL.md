---
name: release
description: Create a new release by tagging and pushing. Use when the user wants to release, publish, or tag a new version.
disable-model-invocation: true
---

Create a new release for Dotaz.

## Steps

1. List existing tags (`git tag --sort=-v:refname | head -5`) to determine the next version
2. Ask the user to confirm the version number (suggest the next patch bump, e.g. v0.0.X+1) and whether it should be a prerelease (beta/alpha/rc)
3. Confirm the target commit (default: current HEAD on main)
4. Create the tag: `git tag <version>`
5. Push the tag: `git push origin <version>`
6. Tell the user the release workflow is running and link to `https://github.com/contember/dotaz/actions`

## Version convention

- Stable: `v0.0.12` — triggers electrobun `stable` env, npm `latest` tag
- Prerelease: `v0.0.12-beta.1` — triggers electrobun `canary` env, npm `beta` tag

## Important

- Always confirm the version and commit with the user before creating the tag
- Never force-push tags
- The release workflow in `.github/workflows/release.yml` handles everything else (desktop builds, Docker, npm, GitHub Release)
