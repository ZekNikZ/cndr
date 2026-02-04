# Changesets

This directory contains changesets for managing package versions and changelogs.

## Creating a changeset

When you make changes that should be published, run:

```bash
pnpm changeset
```

Follow the prompts to describe your changes.

## Versioning packages

To version packages and update changelogs:

```bash
pnpm changeset version
```

## Publishing packages

To publish versioned packages to npm:

```bash
pnpm build
pnpm changeset publish
```

For more information, see the [changesets documentation](https://github.com/changesets/changesets).
