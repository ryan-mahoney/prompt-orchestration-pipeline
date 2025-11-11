# NPM Publishing Guide

A comprehensive guide for publishing packages to npm with best practices and validation steps.

## Publishing Workflow

### 1. Sync and Validate Locally

Before publishing, ensure your local repository is up-to-date and all tests pass:

```bash
# Sync with the main branch
git pull --rebase origin main

# Install dependencies (clean install)
npm ci

# Run linting
npm -s run lint

# Run tests
npm -s test

# Preview what will be published
npm publish --dry-run
```

The `--dry-run` flag allows you to preview the tarball contents and package metadata without actually publishing.

### 2. Bump the Version

Choose the appropriate version bump based on [Semantic Versioning](https://semver.org/):

**Patch Release** (bug fixes, backward compatible):

```bash
npm version patch -m "chore(release): %s"
```

**Minor Release** (new features, backward compatible):

```bash
npm version minor -m "chore(release): %s"
```

**Major Release** (breaking changes):

```bash
npm version major -m "chore(release): %s"
```

> **Note:** The `npm version` command automatically creates a git tag with the new version number.

### 3. Push Changes and Tags

Push both your version bump commit and the associated git tag:

```bash
# Push the version commit
git push

# Push the version tag
git push --tags
```

### 4. Publish to npm

Verify your authentication and publish the package:

```bash
# Verify you're logged in as the correct user
npm whoami

# Publish the package (for scoped packages)
npm publish --access public
```

**If you have 2FA enabled**, include your one-time password:

```bash
npm publish --access public --otp=123456
```

> **Note:** By default, this publishes to the `latest` dist-tag.

### 5. Verify Publication

Confirm your package was published successfully:

```bash
# Check the published version
npm view @ryanfw/prompt-orchestration-pipeline version

# List all distribution tags
npm dist-tag ls @ryanfw/prompt-orchestration-pipeline
```

## Quick Reference Checklist

- [ ] Pull latest changes from main
- [ ] Install dependencies with `npm ci`
- [ ] Run linting and tests
- [ ] Preview publish with `--dry-run`
- [ ] Bump version appropriately
- [ ] Push commit and tags
- [ ] Verify npm authentication
- [ ] Publish package
- [ ] Verify publication

## Additional Tips

- Always use `npm ci` instead of `npm install` for consistent, reproducible builds
- Review the `--dry-run` output carefully to ensure no unexpected files are included
- Consider adding a `prepublishOnly` script to automate validation steps
- Keep your npm authentication token secure and use 2FA when possible
