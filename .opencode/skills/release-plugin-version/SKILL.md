---
name: release-plugin-version
description: Release, Version, Tag, package.json, package-lock.json. Use when creating a new release for this project or bumping the published plugin version. If the user does not specify a version, default to a bugfix release by incrementing the patch version.
---

# Release Plugin Version

Use this skill only for releases in this repository.

## Goal

Create a new release that follows the existing repository pattern:

- bump the version in `package.json`
- bump the matching version fields in `package-lock.json`
- verify with `npm test` and `npm run build`
- create a commit with message `Version x.y.z`
- create a Git tag `x.y.z`

## Version selection

- If the user explicitly gives a version, use it.
- If the user does not give a version, treat the release as a bugfix release and increment the patch part of the current version.
- Example: `1.2.3` becomes `1.2.4`.

## Repository-specific rules

- First inspect the latest release-style commit and current version before editing.
- Follow the existing release schema from prior commits such as `Version 0.1.2`.
- Keep the release change minimal. Do not edit unrelated files.
- In this repository, the release bump normally changes only:
  - `package.json`
  - `package-lock.json`

## Workflow

1. Check the worktree and recent release history.
2. Read the current version from `package.json`.
3. Determine the target version:
   - explicit user version if provided
   - otherwise patch bump from the current version
4. Update the version in:
   - `package.json`
   - top-level `version` in `package-lock.json`
   - root package entry version in `package-lock.json`
5. Verify with:
   - `npm test`
   - `npm run build`
6. Before committing, inspect:
   - `git status --short`
   - `git diff -- package.json package-lock.json`
   - `git log --oneline -10`
7. Stage only the release files.
8. Create commit message exactly as `Version x.y.z`.
9. Create tag exactly as `x.y.z`.

## Safety rules

- Never revert unrelated worktree changes.
- Stage only files that belong to the release bump.
- If the target tag already exists, stop and ask the user how to proceed.
- If verification fails, stop and report the failure instead of tagging a broken release.

## Notes

- Use `apply_patch` for the version edits.
- After creating the skill, Opencode must be restarted before it can load and use it.
