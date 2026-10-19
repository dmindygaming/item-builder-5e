# Item Builder 5e

Build D&D5e magic items, weapons, armor, spellcasting foci and feats in Foundry VTT without hand-editing item data. Item Builder writes every rule it can into the item itself (activities, Active Effects, D&D5e advancement), so items keep working for players and in other worlds. Items can be exported and imported between worlds.

**Supports:** Foundry VTT 13 and 14 · D&D5e 5.3 and 6.0.6+

## Installation

In Foundry, open **Add-on Modules → Install Module** and paste this into **Manifest URL**:

```
https://github.com/dmindygaming/item-builder-5e/releases/latest/download/module.json
```

Foundry will then offer updates automatically whenever a new version is released.

## Releasing an update (maintainers)

1. Commit the changes to `main` and add a section to `CHANGELOG.md`.
2. On GitHub, go to **Releases → Draft a new release**, create a tag such as `v0.8.1` and publish.
3. The **Release** workflow stamps the version into `module.json`, builds `item-builder-5e.zip` and attaches both to the release. Worlds using the manifest URL above will see the update.

See [CHANGELOG.md](CHANGELOG.md) for the version history.
