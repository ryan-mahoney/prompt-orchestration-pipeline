# NPM Publishing Guide

Choose the appropriate version bump based on [Semantic Versioning](https://semver.org/):

## Patch Release (bug fixes, backward compatible):

```bash
npm version patch -m "chore(release): %s"
git push
git push --tags
npm publish --access public
```

## Minor Release (new features, backward compatible):

```bash
npm version minor -m "chore(release): %s"
git push
git push --tags
npm publish --access public
```

## Major Release (breaking changes):

```bash
npm version major -m "chore(release): %s"
git push
git push --tags
npm publish --access public
```
