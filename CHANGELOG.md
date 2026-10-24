# Changelog

All notable changes to Item Builder 5e.

## v0.9.0 Reactions, and clearer rule cards

### Reactions
A new **Reaction** component adds something the item's user can do with their reaction. Each reaction is written into the item as a D&D5e activity with Reaction activation, so it shows on the character sheet and works with or without Item Builder or Midi-QOL.

- **Trigger:** pick a common one (hit by an attack, targeted, taking damage, making a save, an ally being attacked, a creature leaving your reach) or type your own. It shows as the activity's trigger.
- **What happens:**
  - Bonus to AC, resistance, or a saving throw bonus until the start of your next turn (applied as an effect when used).
  - Reduce the triggering damage: a fixed amount such as 5 or @prof is applied automatically; a rolled amount is rolled on the card.
  - Deal damage to the attacker, or have the attacker make a saving throw.
  - Regain hit points or gain temporary hit points.
  - Something else, as rules text.
- Optional limited uses with short rest, long rest, dawn or day recovery.
- Reactions follow tiers: they appear when their tier is reached and are removed if the tier drops. Spent uses are kept when the item is edited.

### Clearer rule cards
- **Effect first.** The effect and its settings are at the top. The creature and name filters are grouped under **Only when… (optional)**, which explains that leaving them blank makes the effect always apply.
- **"Activity Name Contains"** is now **"Attacker's Attack or Ability Named"** on defensive effects (and "Attack or Ability Named" elsewhere), with "Any attack or ability" shown when blank.
- Filters for the side that is always the item's user (for example "Defender / Item User" on a defensive effect) are hidden, since only the other creature can usefully be filtered. Rules that already use them still show them.
- Every rule card ends with a plain-English sentence of what it does, updated as you edit, e.g. "Resistance to poison damage when you are struck by an attack, only when the attack or ability is named “Bite”."

## v0.8.1 Clean item descriptions

- Item descriptions, and the chat cards made from them, now contain only the description you write. Item Builder no longer adds an "Item Builder Features" list. The builder's preview still shows what each feature does.
- Feat prerequisites go in D&D5e's own **Requirements** field instead of the description.
- Existing items are cleaned up once, the next time the GM logs in. Imported items are cleaned on import. Only the generated list and prerequisite line are removed; anything you wrote stays.

## v0.8.0 Built into the item first

Every rule that D&D5e can represent in its own data is now written into the item itself, with no toggles and no extra activities. Those rules work the same with or without Midi-QOL, AC5e or other roll modules, and keep working if Item Builder is disabled.

### Built into the item (no Item Builder code needed)

| Rule | Where it goes |
|---|---|
| Extra damage on a weapon or spell | An extra damage part on the item's own attack / damage / save activities, typed (e.g. 1d6 fire) |
| Attack bonus on a weapon | Added to the attack activity's to-hit bonus |
| Bonus healing on a healing spell or item | Added to the heal activity's healing bonus |
| Extra damage / attack bonus from a ring, cloak, etc. | Actor bonus (D&D5e 6: damage rule with typed formula and `system.rolls.attack.bonus`; 5.3: `system.bonuses.*`) |
| Bonus healing from a worn item (D&D5e 6) | D&D5e healing bonus rule |
| Advantage / disadvantage on attacks (D&D5e 6) | D&D5e advantage rule; on a weapon it applies only to that weapon's attacks |
| Extra damage of the same type (D&D5e 6) | D&D5e damage rule limited to that damage type |
| Resistance, immunity, vulnerability, incl. "any" | Damage traits (`ALL` for any) |
| AC, save, check, skill, speed bonuses and advantage | Active Effects |
| 2024 Half-ASI on a feat | D&D5e **Ability Score Improvement advancement**: D&D5e asks for (or applies) the +1 when the feat is dropped on a character |

The builder shows **Built into item** on each of these.

### Still needs Item Builder (or Midi-QOL)

D&D5e's own data has no way to say "only against fiends", "only when a spell targets me" or "only when the attacker is undead", so rules with a creature, activity, spell or magic condition still run from Item Builder's code. For advantage/disadvantage the item also carries Midi-QOL conditions, so Midi applies them itself. The same goes for cover, ignoring resistance, healing received, temporary HP and Hit Die recovery bonuses, which have no D&D5e field. The builder marks these **Automated**.

### Details
- Rebuilds are clean. Item Builder records what it added to each activity, removes it before re-applying, and removes it when the tier drops. If you hand-edit an attack or healing bonus, your value becomes the new base.
- Half-ASI on a tier above 1 stays an Active Effect, because advancement cannot wait for a tier. The same applies when a feat reaches a character without D&D5e's advancement flow (for example, created by a script); Item Builder then prompts or applies the +1 as before.
- Existing items are upgraded once when the GM logs in: rules are rebuilt and unowned feats get native advancement. Imported items are always rebuilt for the importing world's D&D5e version.

## v0.7.3 Every save window shows Item Builder's advantage

With several automation modules installed, one save can open more than one window. In a world running Midi-QOL and Ugmul's 5.5e Automation, Ugmul's save prompt is drawn with Midi's dialog. Midi pre-fills that window's advantage choice, mode and default button from its own calculation **before** dnd5e's roll hooks run. That calculation has no caster information, so the window opened on Normal even though Item Builder had granted advantage.

Item Builder now updates those pre-filled window options too:
- the per-ability advantage choice, crediting Item Builder in the tracker, flags and default button;
- the window's advantage mode;
- the window's default button.

This applies to saving throws, attack rolls and ability/skill checks. Like the rest of the roll handling it works by shape, not by module, so real disadvantage still cancels and vanilla dnd5e windows are unaffected.

**Verified live on Player2's client** (Foundry 14.369, dnd5e 6.0.6, Midi-QOL 14.6.2, AC5e, Ugmul's 5.5e Automation): both save windows for Sea Fury's Fear showed `1d20adv + 2` with Advantage selected.

## v0.7.2 Saves requested from another client

When a GM's client asks a player's client to roll a save, the request often arrives without a chat card or click event. Roll-automation modules attach their own request data instead. Item Builder now reads that data, recognised by shape rather than by module:

- a workflow object;
- save item, save activity or originating-card UUIDs;
- an "is magic save" hint.

This lets it identify the caster and spell on any client. Without this, a conditional rule such as "advantage against fey and fiends" could not see the caster on the player's side.

The roll-automation conditions stored in items now also work on clients that don't have the module's workflow. In that case the condition data is built from the save item, so the caster's type, a spell's school, and an item's Magical property are read from there. Unknown context still fails closed.

**New diagnostics:** turn on **Item Builder rule diagnostics** in the module settings, and every saving throw logs one console line on the client that rolls it. The line shows the creature saving, the ability, the caster and its type (or UNKNOWN), the source item, whether it counts as a spell or magical, and why each Item Builder rule applied or was skipped.

Tests: 104 condition checks are evaluated in a replica of Midi-QOL's sandbox, covering both the GM (workflow) and player (no workflow) shapes. Further tests cover saves that arrive with only request data.

## v0.7.1 Midi-QOL automation conditions fixed

The automation-conditions effects added in 0.7.0 were rejected by Midi-QOL, so its save dialog still showed **Normal**. Midi evaluates conditions in a sandbox where only the condition data and `Math` are in scope, so JavaScript globals such as `String` don't exist. Item Builder's conditions used `String(...)`, which made Midi treat every one as an error.

Conditions are now written using only literals, operators and methods on values. Verified live in Foundry 14.369 / dnd5e 6.0.6 / Midi-QOL 14.6.2:

- **Fey caster** (Sea Fury's Fear) → advantage.
- **Undead caster** → no advantage.
- **No caster** (rolled from the sheet) → no advantage.

The automated tests now evaluate every generated condition in an exact replica of Midi's sandbox, and that replica rejects the 0.7.0 format.

Items are rebuilt automatically on the GM's next load (item data version 8). Imports from older files are rebuilt when imported.

## v0.7.0 Rules built into items, saves against magic, and roll-automation modules

### Saves against magical effects
Saving Throw Bonus and Saving Throw Advantage now offer three triggers:
- **Any Saving Throw**
- **Only Saves Against Spells and Magical Effects** (new): spells, spells cast from items, and any item or feature marked **Magical**, such as magic items, wands, or a monster's magical abilities.
- **Only Saves Against Spells**

### Built into the item, not dependent on Item Builder's code
Each rule is stored in the most self-contained form the game supports:

| Kind of rule | Stored as | Works with Item Builder disabled? |
|---|---|---|
| Unconditional rules: AC, save and skill advantage, resistances, speed, conditions, Apply Active Effect | Native dnd5e Active Effects on the item | Yes, in every setup. Midi-QOL and similar modules read these too, including in their own roll dialogs. |
| **Conditional advantage / disadvantage** (for example "against fey and fiends", "against magic", "only with this weapon") | Item Builder's rule, **plus** an *automation conditions* Active Effect on the item, written in Midi-QOL's own condition format | With Midi-QOL installed: yes, because Midi evaluates the conditions itself, before any roll hook and in the player's dialog. Without Midi-QOL: needs Item Builder enabled. |
| Other conditional rules: extra damage, bonuses, conditional resistance, healing, ignoring cover | Item Builder's rule | Needs Item Builder enabled |

Neither dnd5e 5.3 nor dnd5e 6.0 passes the caster, spell, or source of a saving throw to its own rules engine. So "against fey", "against spells", and "against magic" cannot be stored as pure dnd5e data in either version. The automation-conditions effect covers that gap for Midi-QOL, and Item Builder's runtime covers it everywhere else.

### Why Midi-QOL's player dialog showed Normal
Midi-QOL works out a save's advantage **before** dnd5e starts the roll, and builds the player's dialog from that. It reads only native roll data and its own condition flags, so an Item Builder rule applied during the roll arrived too late. The new automation-conditions effect puts the rule where Midi looks first. Item Builder still applies the same rule during the roll, which is harmless because advantage doesn't stack.

### Damage applied by another client
Midi-QOL often applies damage on the GM's client and passes no chat card (its `sourceActorUuid` option is actually the target). Conditional Ignore Resistance / Immunity, Cause Vulnerability, Healing Received and Temporary HP now find the attacker or healer from the most recent damage or healing card that targeted the creature. Chat is shared by every client, so this works whichever client applies the damage, with or without any module.

### Other fixes
- **Midi condition expressions** are quoted and parenthesised safely. The test matrix caught a precedence error that would have broken subtype filters.
- **Existing items** are rebuilt automatically on the GM's first load (item data version 7). Items imported from older export files are rebuilt when they are imported.

### Tested combinations
- **Live, in a Foundry 14.369 / dnd5e 6.0.6 world with Midi-QOL 14.6.2 and AC5e 14.606.3 (GM client):** Item Builder's advantage now survives both of Midi's save passes and AC5e. The save rolled `2d20kh + 2`.
- **Automated test matrix (75 checks):**
  - Each save trigger (any / spells / spells and magic) against fey, fiend and undead casters, using a spell, a magical feature, a mundane feature and a wand.
  - Subtype and activity-name filters.
  - Attack scoping for weapons versus passive items.
  - Checks and skills.
  - Effect storage on Foundry 13 and 14.
  - Roll-mode handling for vanilla dnd5e, an automation module's first and second passes, and real disadvantage.
  - The damage-card fallback.
- **Not yet verified live:** Midi-QOL's player-dialog path with the new automation-conditions effect. Please test it as the player.

## v0.6.1 Advantage now holds up alongside roll-automation modules

**What went wrong:** a fey's Fear spell targeted a character wearing a talisman that grants advantage on saves against fey and fiends. Item Builder applied the advantage, but the save still rolled normally. In a world running Midi-QOL and Automated Conditions 5e, Midi had already settled the save's mode as "normal" before Item Builder's rule ran, and AC5e then wrote that "normal" back over the advantage.

**The fix works with any combination of modules, including none.** When Item Builder grants advantage or disadvantage it now records it in three places:

1. **dnd5e's own advantage flags.** This is all vanilla dnd5e needs, and unchanged from before.
2. **The roll's resolved advantage mode and default dialog button.** These are standard dnd5e fields that automation modules read when they decide the mode early.
3. **Any per-ability advantage map attached to the roll.** Item Builder recognises these by their shape, not by module name. Where the map supports it, Item Builder is credited by rule name (Midi shows this in its tooltip).

Advantage and disadvantage from all sources still cancel each other as the rules say. This applies to saving throws, attack rolls, ability checks and skill checks. It was verified live on Foundry 14.369, D&D5e 6.0.6, Midi-QOL 14.6.2 and AC5e 14.606.3: the save rolled `2d20kh + 2`.

**Clearer builder labels:**
- **Saving throw rules:** the trigger is now **Any Saving Throw (spells and other effects)** or **Only Saves Against Spells**. Previously it showed damage-oriented choices like "When You Take Damage".
- **AC Bonus:** the trigger is now Any / Melee / Ranged / Spell Attacks.
- **Creature-type columns:** these are labelled by role. Saves show **Creature Causing the Save** and **Item User (Making the Save)**, and Advantage/Disadvantage columns change with the roll they apply to.

## v0.6.0 Every rule effect now does something

Before 0.6.0, many Offensive, Defensive, Healing and Utility effects were saved and listed in the item description but never applied in play. Each rule card now has a colored banner that shows how it is applied:

- **Green: Active Effect on the item.** Rules with no creature or activity conditions become normal Active Effects that you can see on the item's Effects tab. They work like any hand-made effect, even without this module's code running.
- **Blue: Automated by Item Builder.** Conditional rules, and rules D&D5e has no field for, are applied by the module at the moment they matter.
- **Amber: Reference only.** These are shown in the description, for example Increase Reach on an item that isn't a weapon.

| Effect | How it is applied |
|---|---|
| Extra / Same-Type Damage | Added to the damage card |
| Attack Bonus, Attack Advantage | Added to the attack roll |
| Ignore Half / Three-Quarters / All Cover | Cancels the target's cover bonus on the attack roll. Total cover still blocks targeting. |
| Ignore Resistance / Immunity, Cause Vulnerability | Applied when damage is applied |
| Increase Reach | Changes the weapon's reach, and follows tiers. Reference only on items that aren't weapons. |
| Resistance / Immunity / Vulnerability | Active Effect on damage traits when there are no conditions and the type is specific. Otherwise automated, and only affects the matching damage type. |
| AC Bonus | Active Effect on AC when there are no conditions. A conditional AC bonus (for example only against undead) is applied as a penalty to matching attackers' rolls. |
| Saving Throw Bonus / Advantage | Active Effect when there are no conditions. Otherwise automated, including "When Making a Save Against a Spell". |
| Bonus Healing | Added to healing rolls |
| Healing Received Modifier | Applied when healing is applied to the item user. Dice are rolled once per card, so the preview matches the result. |
| Temporary HP | The creature the item user heals also gains this many temporary HP |
| Recovery Roll Bonus | Added to each Hit Die rolled |
| Movement / Control | Active Effect on the item user's speed. Negative values reduce it. |
| Status / Condition | **New "Who Gets It" choice.** The item user has the condition while the item is active, or the target gets an Apply Effect button on the item's attack, save and damage cards. |
| Advantage / Disadvantage | **New "Applies To Roll" choice:** attack rolls, saving throws, ability checks, skill checks (any or one skill), initiative, or concentration. |
| Apply Active Effect | Written to the item as an Active Effect |

**Items with no attacks of their own.** Offensive and healing rules on a ring, cloak or feat apply to all of the wearer's attacks or healing. On a weapon or spell, they apply only to that item.

**Equipped and attuned items.** Automated rules on carried items respect equipped and attunement the same way D&D5e's own item effects do.

**Existing items.** Items saved with older versions are rebuilt automatically the first time the GM loads the world. Items imported from older export files are rebuilt when they are imported. Effects keep following progression tiers.

**Exports between versions.** Exports convert the new save-bonus effect keys between D&D5e 5.3 and 6.0.

**Other fixes in this release:**
- **Damage type filters:** conditional resistance, immunity and vulnerability used to change every damage type on a hit. They now affect only the selected type.
- **Notification spam:** damage-tray previews no longer post notifications.
- **Melee / ranged / spell triggers:** defensive triggers now detect the attack type correctly, so these triggers work.
- **Duplicate save bonuses:** saving-throw rules could be applied twice. Fixed.

## v0.5.0 Foundry 14 / D&D5e 6.0 support and item export / import

### Supported versions
One build runs on all of these:

| Foundry VTT | D&D5e |
|---|---|
| 13 | 5.3.x |
| 14 | 5.3.x |
| 14 | 6.0.x (verified 6.0.6) |

The module detects the running versions and writes data in the format each one expects. Active Effects use Foundry 13's numeric `mode` or Foundry 14's `system.changes` with string `type`. Movement uses `movement.<type>` on 5.3 or `movement.speeds.<type>` on 6.0. Rarity uses `rarity` on 5.3 or `rarities` on 6.0.

### Export items to another world
- **Items sidebar →** the new export icon next to **Item Builder** opens a picker. Filter by name, tick items or whole folders, and click **Export**.
- **Item sheet →** the export icon in the header (GM only) downloads that one item.
- **Item Builder window →** **Export This Item** (while editing) or **Export Items**.

The `.ib5e.json` file contains the full item: native D&D5e data, activities, Active Effects, Item Builder components, tiers, and rules. It also records the folder each item was in, and includes a copy of every spell the items grant, so they still work in worlds that don't have the same compendiums.

### Import items
**Items sidebar →** import icon (or **Import Items** in the builder). Choose the file, review the item list and version notes, then pick:
- **Destination:** the Items directory or any unlocked Item compendium.
- **Folders:** recreate the exported folders, put everything in one folder, or use no folders.
- **Duplicates:** import a new copy, skip, or replace an item with the same name and type. Replacing keeps the original item ID.
- **Granted spells:** link to this world's matching spell (same compendium UUID first, then by name, preferring official 2024 packs), importing the bundled copy only when nothing matches. Or always import the bundled copies.

Imports convert between versions in both directions, for example a 5.3 / Foundry 13 export imported into a 6.0 / Foundry 14 world. Plain Foundry **Export Data** item JSON files can be imported too.

Macro API: `game.modules.get("item-builder-5e").api.exportItems([...items])`, `.openExport()`, `.openImport()`.

### Fixes
- **API never loaded:** the module API failed to register because of an undefined reference in the `ready` hook. Fixed.
- **Attunement:** D&D5e stores attunement as `""`, `"required"` or `"optional"`. The builder used `0`, `1` and `2`, so saving an edited item cleared its attunement. The control now offers Not Required, Required and Optional.
- **Rarity on 6.0:** rarity was silently dropped on 6.0. It is now saved correctly.
- **Status / Condition on 6.0:** this dropdown crashed the Components tab on 6.0, where `CONFIG.statusEffects` is a keyed object. Fixed.
- **Senses:** Senses components now use `senses.ranges.*`. The old key was deprecated in 5.3.
- **"Can This Damage Crit?" on 6.0:** turning it off didn't stop crits on 6.0. D&D5e 6.0 applies critical scaling once, so non-crit extra damage is now rebuilt as a normal roll. The same code path works on 5.3.
- **Defensive damage rules:** these now read the attacker from the damage card being applied, with the short-lived cache only as a fallback. This makes them more reliable.
- **Save advantage vs. spells:** this rule never fired on 5.3, because saves rolled from a chat card carry no origin. It now resolves the spell from the clicked card on both versions.
- **Granted spells:** Casting Ability, Casting Level and Show in Item Spells are now applied to the Cast activity. Uses and Recovery now create real activity uses.
- **Spell and base-item selection:** a spell or base item that de-duplication hid (another pack, a world copy, or an imported spell) stays selected, so saving no longer clears it.
- **Half-ASI cap on 6.0:** uses D&D5e 6.0's documented `1 <= 20` capped-add syntax.
- **Weapon damage:** when Weapon is chosen, Basics now has Damage Dice and Damage Type, plus Versatile Dice for versatile weapons. They are pre-filled from the base weapon and saved to its native damage data.
- **Effect migration:** existing Item Builder effects are migrated to the current movement and sense paths once per world, by the active GM.
- **Deprecation warnings:** removed uses of `CONST.ACTIVE_EFFECT_MODES`, which is deprecated in Foundry 14.

## v0.4.2 single-card extra damage

- Extra Damage and Additional Same-Type Damage are inserted into D&D5e 5.3's native damage-roll configuration before rolling.
- Base and extra damage now appear on the same damage card and are applied together, eliminating the second chat roll and its delay.
- Extra parts inherit critical damage only when Can This Damage Crit? is enabled.
- Target conditions remain fail-closed. With multiple selected targets, conditional extra damage is included only when every selected target satisfies the rule, preventing the shared card from damaging an invalid target.
- Updated compatibility metadata for D&D5e 5.3.0–5.3.3 and Foundry VTT 13–14.

## v0.4.1 critical extra damage

- Extra Damage and Additional Same-Type Damage now include a Can This Damage Crit? checkbox.
- When enabled, the extra roll inherits the triggering attack's critical state and is created as a D&D5e critical-capable DamageRoll, allowing the system's configured critical-damage rules to apply.
- When disabled, extra damage remains normal even if the triggering attack was critical.

## v0.4.0

- Promoted the reliable-saving and item-translation build to the 0.4 release line.

## v0.3.31 reliable saving and item translation

- Saving from Basics, Progression, or Description no longer clears checkbox and toggle values that only exist on the Components tab.
- Creature-type restrictions, Half-ASI choices, and Show in Item Spells now survive tab changes and saves.
- Every component is translated into a readable Item Builder Features section on the resulting item's description, in addition to its native Active Effect, activity, flag, or runtime automation where supported.
- Editing rebuilds that feature section from the current component definitions, so removed and changed rules do not leave stale text behind.

## v0.3.30 clearer rule participants

- Replaced the generic Source and Target labels with category-specific table language: Attacker / Item User, Defender / Item User, Healer / Item User, Creature Being Healed, Effect User, and Affected Creature.
- Internal rule and flag names remain unchanged for compatibility with existing items.

## v0.3.29 source and target subtypes

- Conditional rules now have separate Source Subtype and Target Subtype dropdowns.
- Target subtype checks use the target actor's subtype, custom creature type, or actor-name fallback when metadata is blank.
- Extra-damage application repeats the target-subtype check as a strict safety gate.

## v0.3.28 additional same-type damage

- Offensive Effects now include Additional Same-Type Damage.
- Choose a triggering damage type and an extra-damage formula. When the item deals that type, the user may confirm the additional roll, which automatically uses the same damage type.

## v0.3.27 subtype fallback

- Conditional source subtype matching still uses the actor's configured subtype first.
- When subtype metadata is blank, it can match the actor's custom creature type or name, so actors such as Vampire and Vampire Spawn work without manually populated subtype metadata.

## v0.3.26 feat types and senses

- Feats can be classified as Origin, General, Fighting Style, or Epic Boon.
- Items and feats can grant or increase Darkvision, Blindsight, Tremorsense, and Truesight ranges.

## v0.3.25 reach, cover, rules text, and feat prerequisites

- Offensive Effects include increased reach and ignoring half, three-quarters, or all cover.
- Rules Text components record non-automated mechanics and add them to the native item description.
- Feats support an optional minimum ability-score prerequisite in addition to required level.

## v0.3.24 2024 feat Half-ASIs

Feat components now include a dedicated 2024 Half-ASI. The GM can assign a fixed +1 ability or allow the player to choose from a GM-defined set. Scores already at 20 are unavailable, and the resulting increase is capped at 20.

## v0.3.23 shield consolidation

Shield is now available only through Armor → Armor Type: Shield. The duplicate top-level Shield category has been removed, and older Item Builder shield items migrate to the consolidated selection when edited.

## v0.3.22 currency dropdown contrast

The integrated currency selector now requests a dark native popup and explicitly styles its options with contrasting text, preventing Windows from displaying light text on a white dropdown background.

## v0.3.21 catalog and category cleanup

- Armor now requires native light, medium, or heavy armor data; clothing and focuses are excluded.
- Other Equipment excludes armor, shields, and spellcasting focuses.
- Spellcasting Focus now supports Artificer, Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock, and Wizard, including compatible tools and instruments where available.
- Feats show Required Level and no longer show rarity, attunement, or value controls.

## v0.3.20 unified value control

The amount and currency selector now render as one full-width Value control with a shared border and an integrated currency segment, matching the shape and alignment of neighboring Basics fields.

## v0.3.19 Basics row baselines

Basics fields now align by their bottom edge instead of the top of each label block. Exact control heights are enforced over theme defaults, keeping composite Value controls level with Attunement and all other neighboring fields.

## v0.3.18 form alignment

Text inputs, number inputs, and dropdowns in two-column form rows now use the same explicit height and box sizing. This fixes the visible misalignment in Basics and keeps the value amount/currency pair level with Attunement.

## v0.3.17 defensive spell saves and value layout

Defensive effects can now grant saving-throw advantage when making a save against a spell, optionally limited to one ability. The item-value amount and currency controls now share a consistent height and alignment with neighboring Basics fields.

## v0.3.16 subtype and defensive triggers

Creature subtype is now a dropdown combining common D&D subtypes with subtype values already present on actors in the world. Defensive effects now include incoming-event triggers for taking damage, being struck by any/melee/ranged attacks, spell attacks, and save-based damage.

## v0.3.15 item value

Item Basics now includes a value amount and currency dropdown. The selection is saved to D&D5e's native item price data and restored when editing an existing item.

## v0.3.14 offensive damage overrides

Offensive effects can now ignore damage resistance, ignore damage immunity, ignore both, or cause vulnerability. Each can affect all resulting damage or one selected damage type, and participates in the same strict conditional matching as other rules.

## v0.3.13 condition selection

Utility / Control status effects now use a dropdown populated from Foundry's available conditions instead of a free-text field.

## v0.3.12 rule categories

The generic **Conditional Rule** component has been replaced by four GM-facing choices: **Offensive Effect**, **Defensive Effect**, **Healing / Recovery Effect**, and **Utility / Control Effect**. Each category offers its own effect list and only displays fields relevant to the selected effect.

Existing v0.3.11 items remain editable. Their stored conditional-rule components are categorized automatically, while the compatible underlying rule flags and strict creature-type matching remain intact.

## Usability changes

- Spells are now selected by name from a dropdown populated from accessible D&D5e Item compendiums. No UUID entry is exposed to the GM.
- Weapon is a first-class item category with an explicit Weapon Type and native Base Item dropdown.
- Armor is a first-class item category with an explicit Armor Type and native Base Item dropdown.
- Shield is a separate first-class category.
- Spellcasting Focus is a separate first-class category with Arcane Focus, Druidic Focus, Holy Symbol, Component Pouch, and Other Focus families.
- Base items are copied from actual D&D5e compendium Items before Item Builder components are layered on top.
- Weapon / Armor / Shield / Focus creation requires a base item instead of silently creating an incomplete blank document.
- The Progression tab now includes step-by-step manual progression instructions.
- The item sheet tier button is labeled `Item Builder Tier: <current tier>` so it is discoverable.

## Manual progression

1. Create the item.
2. Open the created item's sheet.
3. Click `Item Builder Tier: <current tier>` at the top.
4. Pick a new tier.
5. Click Apply.
6. Movement/ability effects, conditional rules, and spell unlocks for the newly reached tier activate.

## Existing functionality retained

- Movement speed increases and granted/set movement types
- Ability score increases and set-score effects
- Granted spells via native D&D5e Cast activities
- Conditional extra damage
- Conditional resistance / immunity / vulnerability
- Source creature type / subtype / activity matching
- Tier-based growing items


## v0.3.4 — dropdown de-duplication

The base-item and spell catalogs no longer show every copy from every installed Item compendium.

The loader now:
- de-duplicates entries by normalized item name and document type;
- prefers official `dnd5e` system compendiums over module-provided duplicates;
- prefers 2024 packs when both 2014/SRD and 2024 copies exist;
- ranks recognizable `spells24`, `items24`, and `equipment24` packs ahead of legacy/SRD copies.

The result is one Fireball, one Longsword, one Shield, etc. in normal cases instead of one entry per installed source pack.


## v0.3.5 — base-item cleanup

Base Item dropdowns now intentionally contain mundane/native base equipment rather than every weapon or armor document found in compendiums.

Changes:
- `Greataxe +1`, `Greataxe +2`, `Greataxe +3`, `Greataxe of Warning`, and similar magic variants are filtered out of the base selector.
- When D&D5e supplies `system.baseItem`, entries are de-duplicated by that canonical base key.
- Name-based fallback de-duplication now ignores punctuation differences such as `Greataxe +1` vs `Greataxe, +1`.
- The official D&D5e 2024/system copy remains preferred over module/SRD/legacy copies.
- Spell dropdown de-duplication remains name-based; spells are not filtered as mundane equipment.


## v0.3.6 — +1 / +2 / +3 enhancement variants

Base Item remains mundane-only. Weapons, armor, and shields now have a separate Enhancement Bonus selector:
- None
- +1
- +2
- +3

Native D&D5e fields are used:
- Weapons: `system.magicalBonus`
- Armor/Shields: `system.armor.magicalBonus`
- Magical property: `mgc`


## v0.3.7 — CSS isolation fix

Previous builds used generic selectors such as `.tabs`, `.body`, `.component`, `.meta`, and `footer`, which could match native D&D5e sheet elements.

All Item Builder application CSS is now scoped below `.item-builder-5e .ib33-root`.

The only selectors outside that scope are `.ib33-directory-button` and `.ib33-tier-button`, which are unique to this module.


## v0.3.8

### Strict target creature matching
A selected Target Creature Type is now a hard requirement. Blank or missing target creature metadata no longer counts as a match.

Optional world setting **Item Builder rule diagnostics** logs the actual source and target creature type/subtype plus the match result to the browser console.

### Editing existing Item Builder items
Items created by Item Builder now get an **Edit in Item Builder** button on their item sheet.

Opening it reloads:
- name, rarity, attunement;
- base item and enhancement;
- progression tiers/current tier;
- movement and ability components;
- spell components;
- conditional rules.

Click **Save Changes** to update the same Item instead of creating another copy.


## v0.3.9 — existing item editing / V2 sheet fix

The edit button now uses Foundry v13 ApplicationV2 render hooks instead of relying only on the legacy `renderItemSheet` hook.

A GM should now see **Edit in Item Builder** in the window header of any D&D5e Item sheet, including items not originally created by Item Builder.

Editing an existing item starts from that item's current native document data. Item Builder preserves existing D&D5e activities, properties, damage configuration, armor data, uses, and other native fields while adding/updating Item Builder components and flags.

Builder-created progression items also retain the **Item Builder Tier** control.


## v0.3.10 — compact GM-only sheet controls

- `Edit in Item Builder` is now a small pencil icon in the item sheet header.
- The progression control is now a small trend/arrow icon with a tiny numeric tier badge.
- Hover text shows the full action and current tier name.
- Both controls are GM-only.
- If a non-GM sheet render encounters stale Item Builder controls, they are explicitly removed.


## v0.3.11

### Conditional rules
- Source/Target Creature Type selectors are now checkbox lists instead of Ctrl/Cmd multi-select boxes.
- Checked target creature types are hard, fail-closed requirements.
- Extra damage checks selected target types before it is inserted into the shared D&D5e damage card. With multiple targets, every selected target must match.
- Resistance, Immunity, and Vulnerability no longer show a Formula field.
- Defensive rules now use **Affected Damage Type** with **Any Resulting Damage** or one standard D&D damage type.

### Skill components
New **Skill** component:
- Grant Proficiency
- Grant Expertise
- Override the skill's ability (for example, make Intimidation use Strength)

Active Effect paths:
- `system.skills.<skill>.value`
- `system.skills.<skill>.ability`
