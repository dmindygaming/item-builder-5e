/**
 * Item Builder 5e — rule effects.
 *
 * Every Offensive / Defensive / Healing / Utility rule is handled one of three ways:
 *
 *   native     An ordinary Active Effect (or native item data) is written to the item, so the
 *              effect is visible on the item's Effects tab and works without this module's code.
 *              Used whenever the rule has no creature / activity conditions and D&D5e has a field
 *              for it.
 *   runtime    The module applies the rule at the moment it matters (attack roll, damage roll,
 *              damage application, saving throw, ability check, hit die).
 *   reference  Shown in the item description only (no matching D&D5e mechanic).
 *
 * Works on D&D5e 5.3 and 6.0 under Foundry 13 and 14.
 */

import {
  MODE_TO_TYPE, MODULE_ID, isDnd5e6, movementKey, resolveUuidSync, rollModeKeys, saveBonusKey, statusEffectList,
  withEffectChanges
} from "./compat.mjs";

/* -------------------------------------------- */
/*  Metadata                                    */
/* -------------------------------------------- */

export const RULE_CATEGORIES = {
  offensive: { label: "Offensive Effect", icon: "fa-burst", effects: { extraDamage: "Extra Damage", sameTypeDamage: "Additional Same-Type Damage", attackBonus: "Attack Bonus", attackAdvantage: "Attack Advantage", reachBonus: "Increase Reach", ignoreHalfCover: "Ignore Half Cover", ignoreThreeQuartersCover: "Ignore Three-Quarters Cover", ignoreAllCover: "Ignore All Cover", ignoreResistance: "Ignore Damage Resistance", ignoreImmunity: "Ignore Damage Immunity", ignoreResistanceImmunity: "Ignore Resistance & Immunity", causeVulnerability: "Cause Damage Vulnerability" } },
  defensive: { label: "Defensive Effect", icon: "fa-shield-halved", effects: { resistance: "Resistance", immunity: "Immunity", vulnerability: "Vulnerability", acBonus: "AC Bonus", saveBonus: "Saving Throw Bonus", saveAdvantage: "Saving Throw Advantage" } },
  healing: { label: "Healing / Recovery Effect", icon: "fa-heart-pulse", effects: { bonusHealing: "Bonus Healing", healingReceived: "Healing Received Modifier", temporaryHp: "Temporary HP", recoveryBonus: "Recovery Roll Bonus" } },
  utility: { label: "Utility / Control Effect", icon: "fa-wand-magic-sparkles", effects: { movementControl: "Movement / Control", sizeChange: "Change Size", statusEffect: "Status / Condition", advantage: "Advantage", disadvantage: "Disadvantage", activeEffect: "Apply Active Effect" } }
};
export const FORMULA_RULES = new Set(["extraDamage", "sameTypeDamage", "attackBonus", "reachBonus", "acBonus", "saveBonus", "bonusHealing", "healingReceived", "temporaryHp", "recoveryBonus", "movementControl"]);
export const DAMAGE_RULES = new Set(["extraDamage", "sameTypeDamage", "resistance", "immunity", "vulnerability", "ignoreResistance", "ignoreImmunity", "ignoreResistanceImmunity", "causeVulnerability"]);
export const OFFENSIVE_DAMAGE_RULES = new Set(["ignoreResistance", "ignoreImmunity", "ignoreResistanceImmunity", "causeVulnerability"]);
export const DEFENSIVE_DAMAGE_RULES = new Set(["resistance", "immunity", "vulnerability"]);
export const COVER_RULES = { ignoreHalfCover: "half", ignoreThreeQuartersCover: "threeQuarters", ignoreAllCover: "all" };
export const DEFENSIVE_TRIGGERS = { damage: "When You Take Damage", struck: "When You Are Struck by an Attack", melee: "When Struck by a Melee Attack", ranged: "When Struck by a Ranged Attack", spell: "When Damaged by a Spell Attack", save: "When Damaged after a Saving Throw", saveAgainstSpell: "When Making a Save Against a Spell", saveAgainstMagic: "When Making a Save Against a Spell or Magical Effect", saveAgainstCondition: "When Making a Save Against a Condition" };
/** Save triggers that restrict which saves a rule applies to. */
export const SAVE_SOURCE_TRIGGERS = new Set(["saveAgainstSpell", "saveAgainstMagic", "saveAgainstCondition"]);
/** Creature sizes, smallest first. */
export function sizeKeys() {
  const sizes = globalThis.CONFIG?.DND5E?.actorSizes ?? {};
  const keys = Object.keys(sizes).filter(k => typeof sizes[k] === "object");
  if ( !keys.length ) return ["tiny", "sm", "med", "lg", "huge", "grg"];
  return keys.sort((a, b) => (sizes[a].numerical ?? keys.indexOf(a)) - (sizes[b].numerical ?? keys.indexOf(b)));
}
/** The size `steps` larger (or smaller, when negative) than `base`, clamped to Tiny..Gargantuan. */
export function sizeAfter(base, steps) {
  const keys = sizeKeys();
  const i = Math.max(0, keys.indexOf(base || "med"));
  return keys[Math.min(keys.length - 1, Math.max(0, i + (Number(steps) || 0)))];
}
export const ROLL_TARGETS = { attack: "Attack Rolls", save: "Saving Throws", check: "Ability Checks", skill: "Skill Checks", initiative: "Initiative", concentration: "Concentration Saves" };
export const STATUS_TARGETS = { self: "The item user, while the item is active", target: "The target (apply from the chat card)" };
export const RULE_PARTICIPANT_LABELS = {
  offensive: { source: "Attacker / Item User", target: "Target" },
  defensive: { source: "Attacker / Threat", target: "Defender / Item User" },
  healing: { source: "Healer / Item User", target: "Creature Being Healed" },
  utility: { source: "Effect User", target: "Affected Creature" }
};

/** Plain-language names for the two creatures a rule compares, per effect. */
export function participantLabels(c) {
  const effect = c.effect;
  if ( ["saveBonus", "saveAdvantage"].includes(effect) ) return { source: "Creature Causing the Save", target: "Item User (Making the Save)" };
  if ( effect === "acBonus" ) return { source: "Attacker", target: "Item User (Defender)" };
  if ( ["advantage", "disadvantage"].includes(effect) ) {
    const rt = c.rollTarget || "attack";
    if ( rt === "attack" ) return { source: "Item User (Attacker)", target: "Target" };
    if ( rt === "save" ) return { source: "Item User (Making the Save)", target: "Creature Causing the Save" };
    return { source: "Item User", target: "Other Creature (unused for checks)" };
  }
  return RULE_PARTICIPANT_LABELS[c.ruleCategory] ?? RULE_PARTICIPANT_LABELS.utility;
}

/** Trigger choices that make sense for a defensive effect. */
export function triggerOptions(effect) {
  if ( ["saveBonus", "saveAdvantage"].includes(effect) ) {
    return {
      damage: "Any Saving Throw",
      saveAgainstMagic: "Only Saves Against Spells and Magical Effects",
      saveAgainstSpell: "Only Saves Against Spells",
      saveAgainstCondition: "Only Saves Against a Condition (such as Charmed)"
    };
  }
  if ( effect === "acBonus" ) return { struck: "Any Attack", melee: "Melee Attacks Only", ranged: "Ranged Attacks Only", spell: "Spell Attacks Only" };
  const { saveAgainstSpell, saveAgainstMagic, saveAgainstCondition, ...rest } = DEFENSIVE_TRIGGERS;
  return rest;
}

const ATTACK_ACTIVITY_TYPES = new Set(["attack", "damage", "save", "heal"]);
const debug = () => { try { return game.settings.get(MODULE_ID, "debugRules"); } catch { return false; } };
const log = (...args) => { if ( debug() ) console.log(`${MODULE_ID} |`, ...args); };

/* -------------------------------------------- */
/*  Classification                              */
/* -------------------------------------------- */

/** Does the rule use any creature / activity filter? */
export function hasConditions(c) {
  return !!((c.sourceTypes?.length) || (c.targetTypes?.length) || c.sourceSubtype || c.targetSubtype
    || String(c.activityName ?? "").trim());
}

/**
 * How a rule component is applied.
 * @param {object} c          Rule component (or stored rule).
 * @param {string} itemType   Native item type ("weapon", "equipment", …).
 * @returns {{mode:"native"|"runtime"|"reference", note:string, ignoresConditions?:boolean}}
 */
export function ruleHandling(c, itemType="", { ownUse=defaultOwnUse(itemType) }={}) {
  const effect = c.effect;
  const conditional = hasConditions(c);
  const trigger = String(c.trigger ?? "damage");
  const d6 = isDnd5e6();
  const scope = ownUse ? "this item's" : "the wearer's";
  const auto = "Applied automatically by Item Builder, because it depends on the other creature or the source of the roll, which dnd5e's own effects cannot see.";
  const noCrit = "Applied automatically by Item Builder: damage built into an item always doubles on a critical hit, so damage that must not crit is added at roll time.";
  switch ( effect ) {
    case "extraDamage":
      if ( !conditional && c.canCrit ) return { mode: "native", note: ownUse
        ? "Built into this item's attack, damage and save activities as an extra damage part."
        : "Built in as a damage bonus on all of the wearer's attacks." };
      return { mode: "runtime", note: conditional ? auto : noCrit };
    case "sameTypeDamage":
      if ( !conditional && c.canCrit && !ownUse && d6 ) return { mode: "native", note: "Built in as a dnd5e damage rule that adds this damage whenever the wearer deals the chosen type." };
      return { mode: "runtime", note: conditional ? auto : "Applied automatically by Item Builder whenever the damage being rolled includes the chosen type." };
    case "attackBonus":
      if ( !conditional ) return { mode: "native", note: ownUse ? "Built into this item's attack activities." : "Built in as a bonus to all of the wearer's attack rolls." };
      return { mode: "runtime", note: auto };
    case "attackAdvantage":
      if ( !conditional && d6 ) return { mode: "native", note: `Built in as a dnd5e advantage rule on ${scope} attack rolls.` };
      return { mode: "runtime", note: conditional ? auto : "Applied automatically by Item Builder (dnd5e 5.3 has no built-in attack advantage)." };
    case "ignoreHalfCover":
    case "ignoreThreeQuartersCover":
    case "ignoreAllCover":
      return { mode: "runtime", note: "Applied automatically by Item Builder: cancels the target's cover AC bonus on the attack roll. Total cover still blocks targeting." };
    case "ignoreResistance":
    case "ignoreImmunity":
    case "ignoreResistanceImmunity":
    case "causeVulnerability":
      return { mode: "runtime", note: "Applied automatically by Item Builder when the damage is applied to the target (dnd5e has no built-in way for an attacker to bypass resistances)." };
    case "reachBonus":
      return itemType === "weapon"
        ? { mode: "native", note: "Built into this weapon's reach.", ignoresConditions: conditional }
        : { mode: "reference", note: "Reach can only be changed on a weapon. Shown in the description." };
    case "resistance":
    case "immunity":
    case "vulnerability":
      if ( !conditional && c.damageType && trigger === "damage" ) {
        return { mode: "native", note: `Built in as a damage ${effect === "resistance" ? "resistance" : effect === "immunity" ? "immunity" : "vulnerability"}${c.damageType === "any" ? " to all damage" : ""}.` };
      }
      return { mode: "runtime", note: auto };
    case "acBonus":
      if ( !conditional && ["", "damage", "struck"].includes(trigger) ) return { mode: "native", note: "Built in as a bonus to the item user's AC." };
      return { mode: "runtime", note: `${auto} It is applied to matching attackers' rolls, which works the same as raising AC.` };
    case "saveBonus":
    case "saveAdvantage":
      if ( !conditional && !SAVE_SOURCE_TRIGGERS.has(trigger) ) return { mode: "native", note: effect === "saveBonus" ? "Built in as a bonus to the item user's saving throws." : "Built in as advantage on the item user's saving throws." };
      return { mode: "runtime", note: auto };
    case "bonusHealing":
      if ( !conditional && (ownUse || d6) ) return { mode: "native", note: ownUse ? "Built into this item's healing activities." : "Built in as a dnd5e healing rule on all of the wearer's healing." };
      return { mode: "runtime", note: conditional ? auto : "Applied automatically by Item Builder (dnd5e 5.3 has no built-in healing bonus)." };
    case "healingReceived":
      return { mode: "runtime", note: "Applied automatically by Item Builder when healing is applied to the item user (dnd5e has no built-in field for healing received)." };
    case "temporaryHp":
      return { mode: "runtime", note: "Applied automatically by Item Builder when the item user's healing is applied (dnd5e has no built-in way to add temporary HP to healing)." };
    case "recoveryBonus":
      return { mode: "runtime", note: "Applied automatically by Item Builder to each Hit Die rolled (dnd5e has no built-in Hit Die bonus)." };
    case "sizeChange":
      return { mode: "native", note: c.sizeMode === "set"
        ? "Built in: the item user's size is set while the item is active. Tokens on the map are resized by Item Builder."
        : "Built in: the item user grows (or shrinks) while the item is active. Tokens on the map are resized by Item Builder.", ignoresConditions: conditional };
    case "movementControl":
      return { mode: "native", note: "Built in as a change to the item user's speed (use a negative number to reduce it).", ignoresConditions: conditional };
    case "statusEffect":
      return c.appliesTo === "target"
        ? { mode: "native", note: "Built in as an Apply Effect button on the item's attack, save and damage cards.", ignoresConditions: conditional }
        : { mode: "native", note: "Built in: the item user has this condition while the item is active.", ignoresConditions: conditional };
    case "advantage":
    case "disadvantage": {
      const target = c.rollTarget || "attack";
      if ( target === "attack" ) {
        if ( !conditional && d6 ) return { mode: "native", note: `Built in as a dnd5e ${effect} rule on ${scope} attack rolls.` };
        return { mode: "runtime", note: conditional ? auto : `Applied automatically by Item Builder (dnd5e 5.3 has no built-in attack ${effect}).` };
      }
      if ( ["initiative", "concentration"].includes(target) ) return { mode: "native", note: `Built in on the item user's ${ROLL_TARGETS[target].toLowerCase()} rolls.`, ignoresConditions: conditional };
      if ( !conditional ) return { mode: "native", note: `Built in on the item user's ${ROLL_TARGETS[target].toLowerCase()}.` };
      return { mode: "runtime", note: auto };
    }
    case "activeEffect":
      return c.activeEffectKey
        ? { mode: "native", note: "Built in as an Active Effect.", ignoresConditions: conditional }
        : { mode: "reference", note: "Enter an Active Effect key to automate this." };
    default:
      return { mode: "reference", note: "Shown in the description." };
  }
}

/** Without a real item, assume weapons and spells make their own attacks. */
function defaultOwnUse(itemType) {
  return ["weapon", "spell"].includes(itemType);
}

/** Short label used in previews and the item description. */
export function handlingLabel(c, itemType, options={}) {
  const { mode } = ruleHandling(c, itemType, options);
  return mode === "native" ? "Built into item" : mode === "runtime" ? "Automated" : "Reference only";
}

/* -------------------------------------------- */
/*  Stored rules                                */
/* -------------------------------------------- */

/** Convert a rule component into the rule stored in the item's flags. */
export function ruleFromComponent(c, itemType="", options={}) {
  const handling = ruleHandling(c, itemType, options);
  return {
    id: c.id,
    name: c.name,
    enabled: true,
    sourceTypes: [...(c.sourceTypes ?? [])].map(x => String(x).toLowerCase()),
    sourceSubtype: c.sourceSubtype ?? "",
    targetSubtype: c.targetSubtype ?? "",
    activityName: c.activityName ?? "",
    targetTypes: [...(c.targetTypes ?? [])].map(x => String(x).toLowerCase()),
    damageTypes: (DEFENSIVE_DAMAGE_RULES.has(c.effect) || OFFENSIVE_DAMAGE_RULES.has(c.effect) || c.effect === "sameTypeDamage")
      && c.damageType && c.damageType !== "any" ? [String(c.damageType).toLowerCase()] : [],
    category: c.ruleCategory || undefined,
    effect: c.effect,
    formula: FORMULA_RULES.has(c.effect) ? (c.formula ?? "") : "",
    extraType: c.effect === "extraDamage" ? c.damageType : c.effect === "sameTypeDamage" ? "same" : "",
    canCrit: !!c.canCrit,
    ability: c.ability || "",
    skill: c.skill || "",
    rollTarget: c.rollTarget || "attack",
    appliesTo: c.appliesTo || "self",
    status: c.status || "",
    activeEffectKey: c.activeEffectKey || "",
    activeEffectMode: c.activeEffectMode || "2",
    activeEffectValue: c.activeEffectValue || "",
    trigger: c.ruleCategory === "defensive" ? (c.trigger || "damage") : "",
    minTier: Number(c.tier) || 1,
    handling: handling.mode,
    // Native rules are carried by Active Effects / item data; the runtime skips them.
    native: handling.mode !== "runtime"
  };
}

/* -------------------------------------------- */
/*  Native effects                              */
/* -------------------------------------------- */

/**
 * Give every term of a damage formula a damage-type flavor, so dnd5e (5.3 and 6.0) applies the
 * bonus as that type even when it is added to a roll of a different type.
 * "1d6 + 2" + "fire" -> "1d6[fire] + 2[fire]". Terms that already have a flavor are left alone.
 */
export function flavorFormula(formula, type) {
  const f = String(formula ?? "").trim();
  if ( !f || !type || type === "any" ) return f;
  return f.split(/(\s*[+-]\s*)/).map(part => {
    if ( !part.trim() || /^\s*[+-]\s*$/.test(part) ) return part;
    return /\[[^\]]*\]\s*$/.test(part) ? part : `${part.trim()}[${type}]`;
  }).join("");
}

const ATTACK_TYPES = ["mwak", "rwak", "msak", "rsak"];

/**
 * Canonical actor-level Active Effect changes for a natively handled rule, or null.
 * Rules built into the item's own activities (own-use items) are handled by activity patches.
 */
export function nativeChanges(c, itemType="", { ownUse=defaultOwnUse(itemType), itemName="", baseSize="med" }={}) {
  if ( ruleHandling(c, itemType, { ownUse }).mode !== "native" ) return null;
  const formula = String(c.formula ?? "").trim();
  const d6 = isDnd5e6();
  const ruleOnThisItem = ownUse && itemName ? js([{ k: "item.name", v: itemName }]) : undefined;
  switch ( c.effect ) {
    case "extraDamage": {
      if ( ownUse || !formula ) return [];
      const value = flavorFormula(formula, c.damageType);
      return d6 ? [{ key: "damage", type: "dnd5e.bonus", value, priority: 20 }]
        : ATTACK_TYPES.map(t => ({ key: `system.bonuses.${t}.damage`, type: "add", value, priority: 20 }));
    }
    case "sameTypeDamage":
      return formula ? [{ key: "damage", type: "dnd5e.bonus", value: flavorFormula(formula, c.damageType), priority: 20,
        conditions: js([{ k: "roll.damageType", v: c.damageType }]) }] : [];
    case "attackBonus":
      if ( ownUse || !formula ) return [];
      return d6 ? [{ key: "system.rolls.attack.bonus", type: "add", value: formula, priority: 20 }]
        : ATTACK_TYPES.map(t => ({ key: `system.bonuses.${t}.attack`, type: "add", value: formula, priority: 20 }));
    case "attackAdvantage":
      return [{ key: "attack", type: "dnd5e.advantage", value: "1", priority: 20, ...(ruleOnThisItem ? { conditions: ruleOnThisItem } : {}) }];
    case "resistance":
    case "immunity":
    case "vulnerability": {
      const trait = { resistance: "dr", immunity: "di", vulnerability: "dv" }[c.effect];
      return [{ key: `system.traits.${trait}.value`, type: "add", value: c.damageType === "any" ? "ALL" : c.damageType, priority: 20 }];
    }
    case "acBonus":
      return formula ? [{ key: "system.attributes.ac.bonus", type: "add", value: formula, priority: 20 }] : [];
    case "saveBonus":
      return formula ? [{ key: saveBonusKey(c.ability), type: "add", value: formula, priority: 20 }] : [];
    case "saveAdvantage":
      return rollModeKeys("save", { ability: c.ability }).map(key => ({ key, type: "add", value: "1", priority: 20 }));
    case "bonusHealing":
      if ( ownUse || !formula ) return [];
      return [{ key: "healing", type: "dnd5e.bonus", value: formula, priority: 20 }];
    case "advantage":
    case "disadvantage": {
      const value = c.effect === "advantage" ? "1" : "-1";
      if ( (c.rollTarget || "attack") === "attack" ) {
        return [{ key: "attack", type: "dnd5e.advantage", value, priority: 20, ...(ruleOnThisItem ? { conditions: ruleOnThisItem } : {}) }];
      }
      return rollModeKeys(c.rollTarget, { ability: c.ability, skill: c.skill }).map(key => ({ key, type: "add", value, priority: 20 }));
    }
    case "sizeChange": {
      if ( c.sizeMode === "set" ) return c.size ? [{ key: "system.traits.size", type: "override", value: c.size, priority: 30 }] : [];
      const steps = Number(c.sizeSteps ?? 1) || 0;
      if ( !steps ) return [];
      // dnd5e 6 steps sizes natively ("add 1" = one size larger); 5.3 needs the resulting size.
      return d6 ? [{ key: "system.traits.size", type: "add", value: String(steps), priority: 30 }]
        : [{ key: "system.traits.size", type: "override", value: sizeAfter(baseSize, steps), priority: 30 }];
    }
    case "movementControl":
      return formula ? [{ key: movementKey(c.ability || "walk"), type: "add", value: formula, priority: 20 }] : [];
    case "activeEffect":
      return c.activeEffectKey ? [{
        key: String(c.activeEffectKey).trim(),
        type: MODE_TO_TYPE[Number(c.activeEffectMode ?? 2)] ?? "add",
        value: String(c.activeEffectValue ?? ""),
        priority: 20
      }] : [];
    default:
      return [];
  }
}

/**
 * Changes built directly into an own-use item's activities for a native rule, or [].
 * @returns {{kind: "damagePart"|"attackBonus"|"healingBonus", formula: string, type?: string}[]}
 */
export function nativeActivityPatches(c, itemType="", { ownUse=defaultOwnUse(itemType) }={}) {
  if ( !ownUse ) return [];
  if ( ruleHandling(c, itemType, { ownUse }).mode !== "native" ) return [];
  const formula = String(c.formula ?? "").trim();
  if ( !formula ) return [];
  switch ( c.effect ) {
    case "extraDamage": return [{ kind: "damagePart", formula, type: c.damageType }];
    case "attackBonus": return [{ kind: "attackBonus", formula }];
    case "bonusHealing": return [{ kind: "healingBonus", formula }];
    default: return [];
  }
}

function statusInfo(id) {
  const s = statusEffectList().find(e => e.id === id);
  return { name: s ? game.i18n.localize(s.name ?? s.label ?? id) : id, img: s?.img ?? s?.icon ?? "icons/svg/aura.svg" };
}

/**
 * Active Effect data for a native rule component, or null.
 * @param {object} c
 * @param {object} context
 * @param {string} context.itemName
 * @param {string} context.itemType
 * @param {number} context.activeTier
 */
export function ruleEffectData(c, { itemName, itemType, activeTier, ownUse=defaultOwnUse(itemType), baseSize="med" }) {
  if ( c.type !== "conditional" ) return null;
  if ( ruleHandling(c, itemType, { ownUse }).mode !== "native" ) return null;
  const minTier = Number(c.tier) || 1;
  const flags = { [MODULE_ID]: { componentId: c.id, minTier, activation: c.activation ?? "equipped", managed: true, ruleEffect: true } };

  if ( c.effect === "statusEffect" ) {
    if ( !c.status ) return null;
    const info = statusInfo(c.status);
    if ( c.appliesTo === "target" ) {
      flags[MODULE_ID].statusTarget = true;
      return withEffectChanges({ name: `${c.name || info.name}`, img: info.img, transfer: false, disabled: false, statuses: [c.status], flags }, []);
    }
    return withEffectChanges({ name: `${itemName}: ${c.name || info.name}`, img: info.img, transfer: true, disabled: minTier > activeTier, statuses: [c.status], flags }, []);
  }

  const changes = nativeChanges(c, itemType, { ownUse, itemName, baseSize });
  if ( !changes?.length ) return null;
  return withEffectChanges({
    name: `${itemName}: ${c.name || RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect] || c.effect}`,
    img: "icons/svg/aura.svg",
    transfer: true,
    disabled: minTier > activeTier,
    flags
  }, changes);
}

/* -------------------------------------------- */
/*  Roll-automation integration (item data)     */
/* -------------------------------------------- */

const js = value => JSON.stringify(value);
// Midi-QOL evaluates conditions inside a sandbox where only the condition data and Math
// are in scope: JavaScript globals such as String, JSON or Array do not exist there.
// Every expression below uses literals, operators and methods on values only.
const lower = expr => `("" + ((${expr}) || "")).toLowerCase()`;
const typeIn = (types, expr) => `${js(types.map(t => String(t).toLowerCase()))}.includes(${lower(expr)})`;
const subtypeHas = (wanted, root) => `${lower(`${root}?.details?.type?.subtype || ${root}?.details?.type?.custom || ${root}?.name`)}.includes(${js(String(wanted).toLowerCase())})`;
// With a workflow, the caster is `raceOrType` / `target`. On clients without the workflow
// (a player answering a roll request) Midi builds the data from the save item's roll data,
// whose top level is the caster's data and whose `item` is the save item's system data.
const CASTER_TYPE = `(workflow ? raceOrType : (item ? details?.type?.value : ""))`;
const CASTER_ROOT = `(workflow ? target : (item ? ({ details: details, name: name }) : undefined))`;
const SPELL_EXPR = `(workflow ? (workflow?.item?.type === "spell" || workflow?.activity?.type === "cast") : !!(item?.school))`;
const ITEM_MAGIC = `!!(item?.properties?.has?.("mgc") || item?.properties?.includes?.("mgc"))`;
const MAGIC_EXPR = `(${SPELL_EXPR} || (workflow ? !!workflow?.item?.system?.properties?.has?.("mgc") : ${ITEM_MAGIC}))`;

/**
 * Which roll an advantage-type rule affects, and the creature roles for its filters.
 * Returns null for rules that are not advantage / disadvantage.
 */
function advantageRuleShape(c) {
  const kind = ["saveAdvantage", "attackAdvantage", "advantage"].includes(c.effect) ? "advantage"
    : c.effect === "disadvantage" ? "disadvantage" : null;
  if ( !kind ) return null;
  if ( c.effect === "saveAdvantage" ) {
    // Defensive: source = creature causing the save, target = item user.
    return { kind, roll: "save", ability: c.ability || "", other: { types: c.sourceTypes, subtype: c.sourceSubtype },
      user: { types: c.targetTypes, subtype: c.targetSubtype }, trigger: c.trigger };
  }
  if ( c.effect === "attackAdvantage" ) {
    return { kind, roll: "attack", user: { types: c.sourceTypes, subtype: c.sourceSubtype },
      other: { types: c.targetTypes, subtype: c.targetSubtype } };
  }
  const roll = c.rollTarget || "attack";
  // Utility: source = item user, target = the other creature.
  return { kind, roll, ability: c.ability || "", skill: c.skill || "",
    user: { types: c.sourceTypes, subtype: c.sourceSubtype }, other: { types: c.targetTypes, subtype: c.targetSubtype } };
}

/**
 * Midi-QOL condition expression equivalent to a rule's filters. Midi evaluates these with
 * `raceOrType` / `target` = the other creature (the caster for saves, the target for attacks),
 * `actor` = the item user and `workflow` = the activity being used. Unknown context fails closed,
 * exactly like Item Builder's own matching.
 */
export function midiCondition(c, { itemName="", ownUse=false }={}) {
  const shape = advantageRuleShape(c);
  if ( !shape ) return null;
  const parts = [];
  const user = shape.user ?? {}, other = shape.other ?? {};
  if ( user.types?.length ) parts.push(typeIn(user.types, "actor?.details?.type?.value"));
  if ( user.subtype ) parts.push(subtypeHas(user.subtype, "actor"));
  if ( ["check", "skill", "initiative", "concentration"].includes(shape.roll) ) {
    if ( other.types?.length || other.subtype ) return "false"; // No other creature on a check.
  } else if ( shape.roll === "save" ) {
    if ( other.types?.length ) parts.push(typeIn(other.types, CASTER_TYPE));
    if ( other.subtype ) parts.push(subtypeHas(other.subtype, CASTER_ROOT));
  } else {
    if ( other.types?.length ) parts.push(typeIn(other.types, "raceOrType"));
    if ( other.subtype ) parts.push(subtypeHas(other.subtype, "target"));
  }
  const activity = String(c.activityName ?? "").trim();
  if ( activity ) parts.push(`${lower("workflow?.activity?.name || workflow?.item?.name")}.includes(${js(activity.toLowerCase())})`);
  if ( shape.roll === "save" ) {
    if ( shape.trigger === "saveAgainstSpell" ) parts.push(SPELL_EXPR);
    else if ( shape.trigger === "saveAgainstMagic" ) parts.push(MAGIC_EXPR);
  }
  if ( shape.roll === "attack" && ownUse && itemName ) parts.push(`workflow?.item?.name === ${js(itemName)}`);
  return parts.length ? parts.join(" && ") : "true";
}

/** Midi-QOL flag keys for an advantage-type rule. */
function midiFlagKeys(c) {
  const shape = advantageRuleShape(c);
  if ( !shape ) return [];
  const base = `flags.midi-qol.${shape.kind}`;
  switch ( shape.roll ) {
    case "save": return [`${base}.ability.save.${shape.ability || "all"}`];
    case "check": return [`${base}.ability.check.${shape.ability || "all"}`];
    case "skill": return [`${base}.skill.${shape.skill || "all"}`];
    case "attack": return [`${base}.attack.all`];
    default: return []; // Initiative / concentration are native Active Effects already.
  }
}

/** Will this rule also be written into the item as roll-automation conditions? */
export function hasAutomationEffect(c, itemType="", options={}) {
  if ( ruleHandling(c, itemType, options).mode !== "runtime" ) return false;
  const cond = midiCondition(c, {});
  return midiFlagKeys(c).length > 0 && !!cond && cond !== "false";
}

/**
 * An Active Effect that carries a conditional advantage / disadvantage rule in the item's own data
 * for roll-automation modules that decide advantage before any dnd5e roll hook runs (Midi-QOL builds
 * its save and attack dialogs this way). It sets only that module's flags: other systems ignore them,
 * and Item Builder's own runtime still applies the rule everywhere else.
 */
export function automationEffectData(c, { itemName, itemType, activeTier, ownUse=false }) {
  if ( c.type !== "conditional" ) return null;
  if ( ruleHandling(c, itemType, { ownUse }).mode !== "runtime" ) return null;
  const keys = midiFlagKeys(c);
  const condition = midiCondition(c, { itemName, ownUse });
  if ( !keys.length || !condition || condition === "false" ) return null;
  const minTier = Number(c.tier) || 1;
  return withEffectChanges({
    name: `${itemName}: ${c.name || RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect] || c.effect} (automation conditions)`,
    img: "icons/svg/dice-target.svg",
    transfer: true,
    disabled: minTier > activeTier,
    flags: { [MODULE_ID]: { componentId: c.id, minTier, managed: true, ruleEffect: true, integration: "midi-qol" } }
  }, keys.map(key => ({ key, type: "override", value: condition, priority: 20 })), { remapKeys: false });
}

/**
 * Rebuild everything an item's rule components produce natively:
 * stored rules, rule Active Effects, Apply Effect links on activities, and weapon reach.
 * Safe to call repeatedly; it is the single source of truth after a save or tier change.
 * @param {Item} item
 */
export async function syncRuleEffects(item) {
  if ( !item?.flags?.[MODULE_ID] ) return;
  const comps = foundry.utils.deepClone(item.getFlag(MODULE_ID, "components") ?? []).filter(c => c.type === "conditional");
  const tier = Number(item.getFlag(MODULE_ID, "currentTier") ?? 1) || 1;

  const ownUse = hasOwnUse(item);

  // Stored rules (runtime reads these).
  await item.update({ [`flags.${MODULE_ID}.rules`]: comps.map(c => ruleFromComponent(c, item.type, { ownUse })) });

  // Replace rule effects.
  const old = item.effects.filter(e => e.getFlag(MODULE_ID, "ruleEffect")).map(e => e.id);
  const oldSet = new Set(old);
  if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
  const data = comps.flatMap(c => [
    ruleEffectData(c, { itemName: item.name, itemType: item.type, activeTier: tier, ownUse,
      baseSize: item.parent?._source?.system?.traits?.size || "med" }),
    automationEffectData(c, { itemName: item.name, itemType: item.type, activeTier: tier, ownUse })
  ]).filter(Boolean);
  const created = data.length ? await item.createEmbeddedDocuments("ActiveEffect", data) : [];

  const updates = {};

  // Link "apply to target" condition effects to the item's attack / save / damage activities.
  const targetIds = created
    .filter(e => e.getFlag(MODULE_ID, "statusTarget") && (Number(e.getFlag(MODULE_ID, "minTier")) || 1) <= tier)
    .map(e => e.id);
  const existingIds = new Set([...(item.effects ?? [])].map(e => e.id));
  for ( const activity of item.system.activities ?? [] ) {
    if ( !["attack", "save", "damage", "utility"].includes(activity.type) ) continue;
    const current = (activity.toObject?.().effects ?? []).filter(e => e?._id);
    const kept = current.filter(e => !oldSet.has(e._id) && existingIds.has(e._id));
    const next = kept.concat(targetIds.map(_id => ({ _id })));
    const same = next.length === current.length && next.every((e, i) => e._id === current[i]._id);
    if ( !same ) updates[`system.activities.${activity.id}.effects`] = next;
  }
  if ( targetIds.length && !(item.system.activities?.size ?? [...(item.system.activities ?? [])].length) ) {
    log(`"${item.name}" has a target condition but no activities to attach it to.`);
  }

  // Rules built directly into this item's own activities (bonus damage, attack bonus, healing bonus).
  const patches = comps.filter(c => (Number(c.tier) || 1) <= tier)
    .flatMap(c => nativeActivityPatches(c, item.type, { ownUse }));
  syncActivityPatches(item, patches, updates);

  // Weapon reach.
  if ( item.type === "weapon" ) {
    const reachComps = comps.filter(c => c.effect === "reachBonus");
    let base = item.getFlag(MODULE_ID, "baseReach");
    if ( reachComps.length || base !== undefined ) {
      const sourceReach = item.system._source?.range?.reach ?? null;
      if ( base === undefined ) {
        base = sourceReach;
        updates[`flags.${MODULE_ID}.baseReach`] = base;
      }
      const bonus = reachComps.filter(c => (Number(c.tier) || 1) <= tier).reduce((sum, c) => sum + (Number(c.formula) || 0), 0);
      const props = item.system.properties;
      const fallback = (props?.has?.("rch") || (Array.isArray(props) && props.includes("rch"))) ? 10 : 5;
      const wanted = bonus ? Math.max(0, (base ?? fallback) + bonus) : base;
      if ( wanted !== sourceReach ) updates["system.range.reach"] = wanted;
    }
  }

  if ( !foundry.utils.isEmpty(updates) ) await item.update(updates);
}

/** Comparable identity of a damage part Item Builder added. */
const partKey = p => js({ f: String(p?.custom?.formula ?? ""), t: [...(p?.types ?? [])].map(String).sort() });

const joinFormula = (base, extra) => {
  const a = String(base ?? "").trim();
  return a ? `${a} + ${extra}` : String(extra);
};

/**
 * Write native activity patches into `updates`, first undoing the patches recorded on the
 * previous rebuild. Original values are kept in `flags.item-builder-5e.nativePatches`, so the
 * item's own activities return exactly to how they were when a rule is removed or its tier
 * is not reached. Activities the GM edited by hand afterwards are left alone.
 */
export function syncActivityPatches(item, patches, updates) {
  // Stored as a JSON string so each rebuild replaces it whole (object updates would merge stale keys).
  let record = {};
  try {
    const raw = item.getFlag?.(MODULE_ID, "nativePatches");
    record = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : {});
  } catch { record = {}; }
  const next = {};
  for ( const activity of item.system?.activities ?? [] ) {
    const id = activity.id;
    const src = activity.toObject?.() ?? {};
    const rec = record[id] ?? {};
    const isAttack = activity.type === "attack" && src.attack;
    const hasDamage = ["attack", "damage", "save"].includes(activity.type) && src.damage;
    const isHeal = activity.type === "heal" && src.healing;

    // Undo the previous rebuild.
    // A bonus someone edited by hand since the last rebuild becomes the new original.
    const unchanged = (now, patched) => (patched === undefined) || ((now ?? "") === patched);
    const origAttack = (rec.attackBonus !== undefined) && unchanged(src.attack?.bonus, rec.attackPatched)
      ? rec.attackBonus : (src.attack?.bonus ?? "");
    const origHeal = (rec.healingBonus !== undefined) && unchanged(src.healing?.bonus, rec.healingPatched)
      ? rec.healingBonus : (src.healing?.bonus ?? "");
    let parts = foundry.utils.deepClone(src.damage?.parts ?? []);
    const added = rec.parts ?? [];
    if ( added.length && parts.length >= added.length ) {
      const tail = parts.slice(parts.length - added.length).map(partKey);
      if ( tail.every((k, i) => k === added[i]) ) parts = parts.slice(0, parts.length - added.length);
    }
    const baseParts = foundry.utils.deepClone(parts);

    // Apply the current rules.
    let attackBonus = origAttack, healingBonus = origHeal;
    const newParts = [];
    for ( const p of patches ) {
      if ( p.kind === "attackBonus" && isAttack ) attackBonus = joinFormula(attackBonus, p.formula);
      if ( p.kind === "healingBonus" && isHeal ) healingBonus = joinFormula(healingBonus, p.formula);
      if ( p.kind === "damagePart" && hasDamage ) {
        newParts.push({ number: null, denomination: null, bonus: "", types: p.type ? [p.type] : [],
          custom: { enabled: true, formula: p.formula }, scaling: { mode: "", number: 1, formula: "" } });
      }
    }
    parts = baseParts.concat(newParts);

    const entry = {};
    if ( isAttack ) {
      if ( attackBonus !== (src.attack.bonus ?? "") ) updates[`system.activities.${id}.attack.bonus`] = attackBonus;
      if ( attackBonus !== origAttack ) Object.assign(entry, { attackBonus: origAttack, attackPatched: attackBonus });
    }
    if ( isHeal ) {
      if ( healingBonus !== (src.healing.bonus ?? "") ) updates[`system.activities.${id}.healing.bonus`] = healingBonus;
      if ( healingBonus !== origHeal ) Object.assign(entry, { healingBonus: origHeal, healingPatched: healingBonus });
    }
    if ( hasDamage ) {
      if ( js(parts.map(partKey)) !== js((src.damage.parts ?? []).map(partKey)) ) updates[`system.activities.${id}.damage.parts`] = parts;
      if ( newParts.length ) entry.parts = newParts.map(partKey);
    }
    if ( Object.keys(entry).length ) next[id] = entry;
  }
  if ( js(next) !== js(record) ) updates[`flags.${MODULE_ID}.nativePatches`] = js(next);
  return updates;
}

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

function actorType(actor) {
  const t = actor?.system?.details?.type ?? {};
  return {
    value: String(t.value ?? "").trim().toLowerCase(),
    subtype: String(t.subtype ?? "").trim().toLowerCase(),
    custom: String(t.custom ?? "").trim().toLowerCase(),
    name: String(actor?.name ?? "").trim().toLowerCase()
  };
}

function actorMatchesSubtype(actor, wanted) {
  const type = actorType(actor);
  const needle = String(wanted ?? "").trim().toLowerCase();
  if ( !needle ) return true;
  if ( type.subtype ) return type.subtype.includes(needle);
  if ( type.custom ) return type.custom.includes(needle);
  // Many official and imported NPCs leave subtype blank; fall back to the actor name.
  return type.name.includes(needle);
}

/**
 * Does a stored rule match a situation? All populated conditions must match, and
 * creature-type filters fail closed when the actor or its metadata is missing.
 */
export function match(rule, { sourceActor, targetActor, activityName="", activityType="", actionType="", damageTypes=[] }={}) {
  if ( !rule?.enabled ) return false;
  const s = actorType(sourceActor);
  const t = actorType(targetActor);
  const a = String(activityName ?? "").trim().toLowerCase();
  const d = (damageTypes ?? []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const sourceTypes = (rule.sourceTypes ?? []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const targetTypes = (rule.targetTypes ?? []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const relevantDamage = (rule.damageTypes ?? []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const activityKind = String(activityType ?? "").trim().toLowerCase();
  const actionKind = String(actionType ?? "").trim().toLowerCase();

  const trigger = String(rule.trigger ?? "").trim().toLowerCase();
  if ( trigger === "struck" && !(activityKind === "attack" || ["mwak", "rwak", "msak", "rsak"].includes(actionKind)) ) return false;
  if ( trigger === "melee" && !["mwak", "msak"].includes(actionKind) ) return false;
  if ( trigger === "ranged" && !["rwak", "rsak"].includes(actionKind) ) return false;
  if ( trigger === "spell" && !["msak", "rsak"].includes(actionKind) ) return false;
  if ( trigger === "save" && !(activityKind === "save" || actionKind === "save") ) return false;
  if ( trigger === "saveagainstspell" || trigger === "saveagainstmagic" ) return false; // Evaluated by the saving-throw hook.

  if ( sourceTypes.length && (!sourceActor || !s.value || !sourceTypes.includes(s.value)) ) return false;
  const sourceSubtype = String(rule.sourceSubtype ?? "").trim().toLowerCase();
  if ( sourceSubtype && (!sourceActor || !actorMatchesSubtype(sourceActor, sourceSubtype)) ) return false;
  const wantedActivity = String(rule.activityName ?? "").trim().toLowerCase();
  if ( wantedActivity && !a.includes(wantedActivity) ) return false;
  if ( targetTypes.length && (!targetActor || !t.value || !targetTypes.includes(t.value)) ) return false;
  const targetSubtype = String(rule.targetSubtype ?? "").trim().toLowerCase();
  if ( targetSubtype && (!targetActor || !actorMatchesSubtype(targetActor, targetSubtype)) ) return false;
  if ( relevantDamage.length && (!d.length || !relevantDamage.some(x => d.includes(x))) ) return false;
  return true;
}

export function ruleDiagnostic(rule, { sourceActor, targetActor, activityName="", damageTypes=[] }={}) {
  const s = actorType(sourceActor), t = actorType(targetActor);
  return {
    matched: match(rule, { sourceActor, targetActor, activityName, damageTypes }),
    handling: rule?.handling ?? (rule?.native ? "native" : "runtime"),
    source: { name: sourceActor?.name ?? "(none)", type: s.value || "(blank)", subtype: s.subtype || s.custom || `name fallback: ${s.name || "(blank)"}` },
    target: { name: targetActor?.name ?? "(none)", type: t.value || "(blank)", subtype: t.subtype || t.custom || `name fallback: ${t.name || "(blank)"}` },
    activity: String(activityName || "(blank)"),
    requestedTargetTypes: rule?.targetTypes ?? [],
    requestedSourceTypes: rule?.sourceTypes ?? [],
    requestedSourceSubtype: rule?.sourceSubtype ?? "",
    requestedTargetSubtype: rule?.targetSubtype ?? ""
  };
}

/* -------------------------------------------- */
/*  Rule sources                                */
/* -------------------------------------------- */

/** Runtime rules on an item at its current tier (native rules excluded). */
export function rulesOnItem(item) {
  const tier = Number(item?.getFlag?.(MODULE_ID, "currentTier") ?? 1);
  return foundry.utils.deepClone(item?.getFlag?.(MODULE_ID, "rules") ?? [])
    .filter(r => (Number(r.minTier) || 1) <= tier && !r.native);
}

/** Is an owned item's passive magic active (equipped / attuned as D&D5e requires)? */
function itemActive(item) {
  try { if ( "areEffectsSuppressed" in item ) return !item.areEffectsSuppressed; } catch { /* fall through */ }
  const sys = item.system ?? {};
  if ( sys.equipped === false ) return false;
  return !(sys.attunement === "required" && !sys.attuned);
}

/** An item being used to attack/heal still needs attunement for its magic. */
function rollingItemActive(item) {
  const sys = item?.system ?? {};
  return !(sys.attunement === "required" && !sys.attuned);
}

/** Does this item make its own attacks, saves, damage or healing? */
export function itemHasOwnUse(item) { return hasOwnUse(item); }

function hasOwnUse(item) {
  if ( ["weapon", "spell"].includes(item?.type) ) return true;
  for ( const a of item?.system?.activities ?? [] ) if ( ATTACK_ACTIVITY_TYPES.has(a.type) ) return true;
  return false;
}

/**
 * Rules that affect something an actor does with an item: the item's own rules, plus
 * rules on the actor's active passive items (rings, cloaks, feats without attacks).
 */
function userRules(actor, usedItem) {
  const out = [];
  if ( usedItem && rollingItemActive(usedItem) ) out.push(...rulesOnItem(usedItem));
  for ( const item of actor?.items ?? [] ) {
    if ( usedItem && item.id === usedItem.id ) continue;
    if ( hasOwnUse(item) || !itemActive(item) ) continue;
    out.push(...rulesOnItem(item));
  }
  return out;
}

/** Rules on every active item an actor carries (defensive / passive effects). */
function holderRules(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !itemActive(item) ) continue;
    for ( const rule of rulesOnItem(item) ) out.push(rule);
  }
  return out;
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const userTargets = () => [...(game.user?.targets ?? [])].map(t => t.actor).filter(Boolean);

function actionTypeOf(activity, attackMode) {
  try {
    const t = activity?.getActionType?.(attackMode) ?? activity?.actionType;
    if ( typeof t === "string" && t ) return t.toLowerCase();
  } catch { /* fall through */ }
  const value = activity?.attack?.type?.value;
  const cls = activity?.attack?.type?.classification;
  if ( value ) return `${value === "ranged" ? "r" : "m"}${cls === "spell" ? "s" : "w"}ak`;
  return String(activity?.type ?? "").toLowerCase();
}

function firstRoll(config) {
  if ( !Array.isArray(config.rolls) ) config.rolls = [];
  if ( !config.rolls.length ) config.rolls.push({ parts: [], data: {}, options: {} });
  const roll = config.rolls[0];
  roll.parts ??= [];
  roll.options ??= {};
  return roll;
}

/** Roll a formula that may contain dice, synchronously (used where hooks cannot await). */
function rollSync(formula, data={}) {
  let f = String(formula ?? "").trim();
  if ( !f ) return 0;
  try { f = Roll.replaceFormulaData(f, data, { missing: 0 }); } catch { /* keep raw */ }
  try {
    const roll = new Roll(f);
    if ( roll.isDeterministic ) return Number(roll.evaluateSync().total) || 0;
  } catch { /* use manual dice below */ }
  const withDice = f.replace(/(\d*)d(\d+)/gi, (_m, n, d) => {
    let total = 0;
    const count = Math.min(100, Number(n) || 1);
    for ( let i = 0; i < count; i++ ) total += 1 + Math.floor(Math.random() * (Number(d) || 1));
    return String(total);
  });
  try { return Number(Roll.safeEval(withDice)) || 0; } catch { return 0; }
}

/** Damage previews recalculate repeatedly; dice are rolled once per card + target + rule. */
const rollCache = new Map();
function cachedRoll(key, formula, data) {
  if ( !rollCache.has(key) ) {
    rollCache.set(key, rollSync(formula, data));
    if ( rollCache.size > 500 ) rollCache.delete(rollCache.keys().next().value);
  }
  return rollCache.get(key);
}

const isHealingType = type => type in (CONFIG.DND5E?.healingTypes ?? { healing: 1, temphp: 1 });

function isHealingMessage(message) {
  if ( !message ) return false;
  if ( message.system?.isHealing !== undefined ) return !!message.system.isHealing;
  if ( message.flags?.dnd5e?.roll?.type ) return message.flags.dnd5e.roll.type === "healing";
  try { return message.getAssociatedActivity?.()?.type === "heal"; } catch { return false; }
}

/** Attacker context for a damage/healing card (both D&D5e versions pass it as originatingMessage). */
function contextFromMessage(message) {
  try {
    if ( !message?.getAssociatedItem ) return null;
    const item = message.getAssociatedItem();
    if ( !item ) return null;
    const act = message.getAssociatedActivity?.() ?? null;
    const dtypes = [];
    for ( const roll of message.rolls ?? [] ) {
      if ( roll?.options?.type ) dtypes.push(String(roll.options.type).toLowerCase());
      for ( const t of roll?.options?.types ?? [] ) dtypes.push(String(t).toLowerCase());
    }
    return {
      fromMessage: true, time: Date.now(), messageId: message.id,
      sourceActor: item.actor ?? null, sourceItem: item,
      activityName: act?.name ?? item.name, activityType: String(act?.type ?? "").toLowerCase(),
      actionType: actionTypeOf(act), damageTypes: [...new Set(dtypes)]
    };
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read card context`, err);
    return null;
  }
}

/** Actor UUIDs targeted by a chat card (dnd5e 6 system data, dnd5e 5.3 flags, or automation-module flags). */
function cardTargetActorUuids(message) {
  const out = new Set();
  const push = uuid => {
    if ( !uuid || typeof uuid !== "string" ) return;
    if ( uuid.includes(".Token.") ) {
      const actorUuid = resolveUuidSync(uuid)?.actor?.uuid;
      if ( actorUuid ) out.add(actorUuid);
    }
    out.add(uuid);
  };
  for ( const t of message?.system?.targets ?? [] ) { push(t?.actor); push(t?.uuid); push(t?.token); }
  for ( const t of message?.flags?.dnd5e?.targets ?? [] ) { push(t?.uuid); push(t?.actor); }
  const auto = message?.flags?.["midi-qol"] ?? {};
  for ( const key of ["targetUuids", "hitTargetUuids", "hitTargetUuidsEC", "saveUuids", "failedSaveUuids"] ) {
    for ( const uuid of auto[key] ?? [] ) push(uuid);
  }
  return out;
}

/**
 * Context for damage/healing applied without a card (some automation modules apply
 * damage on another client and pass no card). Finds the newest card with a damage or
 * healing roll that targeted this creature. Chat is shared by every client, so this
 * works no matter which client applies the damage. No side effects: safe for previews.
 */
function contextFromRecentCards(target, { maxAge=120000, scan=30 }={}) {
  const messages = game.messages?.contents ?? [];
  const now = Date.now();
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  for ( let i = messages.length - 1, n = 0; (i >= 0) && (n < scan); i--, n++ ) {
    const m = messages[i];
    if ( now - (m.timestamp ?? 0) > maxAge ) break;
    const hasDamage = (m.rolls ?? []).some(r => (DamageRoll && (r instanceof DamageRoll)) || /DamageRoll/.test(r?.constructor?.name ?? ""));
    if ( !hasDamage ) continue;
    const targets = cardTargetActorUuids(m);
    if ( targets.size && target?.uuid && !targets.has(target.uuid) ) continue;
    if ( !targets.size && (now - (m.timestamp ?? 0) > 20000) ) continue;
    const ctx = contextFromMessage(m);
    if ( ctx?.sourceActor ) return ctx;
  }
  return null;
}

function addDamageIgnore(options, category, types=[]) {
  if ( options.ignore === true ) return;
  if ( !options.ignore || typeof options.ignore !== "object" ) options.ignore = {};
  if ( !types.length ) { options.ignore[category] = true; return; }
  if ( options.ignore[category] === true ) return;
  const current = options.ignore[category] instanceof Set ? options.ignore[category] : new Set(options.ignore[category] ?? []);
  for ( const type of types ) current.add(type);
  options.ignore[category] = current;
}

function saveRollContext(config={}, message={}) {
  const subject = config.subject ?? config.actor ?? message.subject;
  const actor = subject?.documentName === "Actor" ? subject : subject?.actor ?? config.actor ?? null;
  let activity = config.activity ?? subject?.activity ?? message.activity ?? null;
  let origin = config.origin ?? message.origin ?? config.data?.origin ?? null;
  if ( typeof origin === "string" ) origin = resolveUuidSync(origin);
  activity ??= origin?.item ? origin : null;
  let item = activity?.item ?? (origin?.documentName === "Item" ? origin : origin?.item) ?? config.item ?? null;
  // Roll-request data attached by automation modules (recognised by shape, not module):
  // a workflow object, or uuids for the save item / activity / originating card.
  const requestSources = [config, config.midiOptions, config.options, config.workflowOptions].filter(o => o && typeof o === "object");
  let magicHint = false;
  for ( const src of requestSources ) {
    if ( src.isMagicSave === true ) magicHint = true;
    const wf = src.workflow;
    if ( !item && wf && typeof wf === "object" ) {
      activity ??= wf.activity ?? null;
      item = wf.item ?? activity?.item ?? null;
    }
    if ( !item && typeof src.saveActivityUuid === "string" ) {
      const act = resolveUuidSync(src.saveActivityUuid);
      if ( act?.item ) { activity ??= act; item = act.item; }
    }
    if ( !item && typeof src.saveItemUuid === "string" ) item = resolveUuidSync(src.saveItemUuid);
    if ( !item && typeof src.itemCardUuid === "string" ) {
      try {
        const card = resolveUuidSync(src.itemCardUuid);
        item = card?.getAssociatedItem?.() ?? null;
        activity ??= card?.getAssociatedActivity?.() ?? null;
      } catch { /* not a card */ }
    }
    if ( item ) break;
  }

  // Saves rolled from a chat card do not carry their origin on 5.3, and 6.0 stores
  // only the card id. Resolve the source from the card that was clicked.
  if ( !item ) {
    const messageId = config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId
      ?? foundry.utils.getProperty(message, "data.system.origin")
      ?? foundry.utils.getProperty(message, "data.flags.dnd5e.originatingMessage");
    const card = messageId ? game.messages?.get(messageId) : null;
    try {
      item = card?.getAssociatedItem?.() ?? null;
      activity ??= card?.getAssociatedActivity?.() ?? null;
    } catch { /* card without an associated item */ }
  }
  return {
    actor, item, sourceActor: item?.actor ?? activity?.actor ?? null,
    activityName: activity?.name ?? item?.name ?? "",
    ability: String(config.abilityId ?? config.ability ?? config.data?.ability ?? "").toLowerCase(),
    isSpell: isSpellSource(item, activity),
    isMagical: magicHint || isMagicalSource(item, activity),
    conditions: conditionsOfSource(item, activity)
  };
}

/**
 * Conditions a save's source would apply: the statuses on the activity's (or item's) effects,
 * otherwise conditions named in its description ("…or have the Charmed condition").
 */
export function conditionsOfSource(item, activity) {
  const out = new Set();
  const addStatuses = e => { for ( const s of e?.statuses ?? [] ) out.add(String(s).toLowerCase()); };
  try {
    for ( const ref of activity?.effects ?? [] ) addStatuses(ref?.effect ?? item?.effects?.get?.(ref?._id));
    if ( !out.size ) for ( const e of item?.effects ?? [] ) if ( !e.transfer ) addStatuses(e);
    if ( !out.size ) {
      const text = `${activity?.description?.chatFlavor ?? ""} ${item?.system?.description?.value ?? ""}`.toLowerCase();
      for ( const [id, cond] of Object.entries(globalThis.CONFIG?.DND5E?.conditionTypes ?? {}) ) {
        const label = String(globalThis.game?.i18n?.localize?.(cond?.name ?? cond?.label ?? id) ?? id).toLowerCase();
        if ( new RegExp(`\\b(?:${id}|${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`).test(text) ) out.add(id);
      }
    }
  } catch { /* unknown source */ }
  return out;
}

const COVER_CAPS = { half: 2, threeQuarters: 5, all: 5 };

/** Is the save caused by a spell (including a spell cast from an item)? */
export function isSpellSource(item, activity) {
  if ( item?.type === "spell" ) return true;
  if ( activity?.type === "cast" ) return true;
  return activity?.item?.type === "spell";
}

/** Has a set-like or array-like property collection got this key? */
const hasProp = (props, key) => !!(props?.has?.(key) || (Array.isArray(props) && props.includes(key)) || props?.[key] === true);

/**
 * Is the save caused by magic? Spells, items or features marked Magical,
 * and effects D&D5e marks as magical all count.
 */
export function isMagicalSource(item, activity) {
  if ( isSpellSource(item, activity) ) return true;
  if ( hasProp(item?.system?.properties, "mgc") ) return true;
  if ( hasProp(activity?.item?.system?.properties, "mgc") ) return true;
  return false;
}

/* -------------------------------------------- */
/*  Advantage / disadvantage                    */
/* -------------------------------------------- */

const newGrants = () => ({ advantage: [], disadvantage: [] });

/**
 * Apply Item Builder advantage/disadvantage to a D20 roll configuration so it survives
 * whatever else is installed. Nothing here depends on a specific module:
 *
 *  1. dnd5e's own flags (`config.advantage`, `rolls[].options.advantage`): all vanilla dnd5e needs.
 *  2. The resolved `advantageMode` and dialog `defaultButton`: standard dnd5e fields that
 *     roll-automation modules read when they have already settled a mode before our hook runs.
 *  3. Any per-choice advantage map attached to the roll (`advantageByChoice`), recognised
 *     purely by its shape. Entries exposing an `advantage` / `disadvantage` tracker with
 *     `add()` are credited to Item Builder; plain entries get `hasAdvantage` / `hasDisadvantage`.
 *
 * Advantage and disadvantage from every source still cancel exactly as the rules require.
 */
export function applyRollModes(config, grants, dialog=null) {
  const wantAdv = grants.advantage.length > 0;
  const wantDis = grants.disadvantage.length > 0;
  if ( !config || (!wantAdv && !wantDis) ) return;
  const ADV = CONFIG.Dice?.D20Roll?.ADV_MODE ?? { NORMAL: 0, ADVANTAGE: 1, DISADVANTAGE: -1 };
  if ( !Array.isArray(config.rolls) ) config.rolls = [];
  if ( !config.rolls.length ) config.rolls.push({ parts: [], data: {}, options: {} });
  const r0 = config.rolls[0].options ?? {};
  const prior = typeof config.advantageMode === "number" ? config.advantageMode
    : typeof r0.advantageMode === "number" ? r0.advantageMode : null;
  const priorAdv = !!(config.advantage || r0.advantage) || prior === ADV.ADVANTAGE;
  const priorDis = !!(config.disadvantage || r0.disadvantage) || prior === ADV.DISADVANTAGE;
  const adv = priorAdv || wantAdv;
  const dis = priorDis || wantDis;
  const mode = (adv && !dis) ? ADV.ADVANTAGE : (dis && !adv) ? ADV.DISADVANTAGE : ADV.NORMAL;

  if ( wantAdv ) config.advantage = true;
  if ( wantDis ) config.disadvantage = true;
  for ( const roll of config.rolls ) {
    roll.options ??= {};
    if ( wantAdv ) roll.options.advantage = true;
    if ( wantDis ) roll.options.disadvantage = true;
    roll.options.advantageMode = mode;
  }
  config.advantageMode = mode;
  const buttonFor = m => m === ADV.ADVANTAGE ? "advantage" : m === ADV.DISADVANTAGE ? "disadvantage" : "normal";
  if ( "defaultButton" in config ) config.defaultButton = buttonFor(mode);

  // Roll windows prepared before this hook (some automation modules pre-fill the
  // window's advantage choice, mode and default button from their own calculation).
  const dlg = dialog?.options;
  if ( dlg && typeof dlg === "object" ) {
    if ( "advantageMode" in dlg ) dlg.advantageMode = mode;
    if ( "defaultButton" in dlg ) dlg.defaultButton = buttonFor(mode);
  }

  // Per-choice advantage maps prepared by roll-automation modules (shape-detected).
  const keys = [config.skill, config.tool, config.ability, r0.ability, r0.skill, r0.tool]
    .filter(k => typeof k === "string" && k);
  const maps = [config.midiOptions?.advantageByChoice, config.options?.advantageByChoice, dlg?.advantageByChoice]
    .filter(m => m && typeof m === "object");
  for ( const map of maps ) {
    for ( const key of (keys.length ? [...new Set(keys)] : Object.keys(map)) ) {
      const entry = map[key];
      if ( !entry || typeof entry !== "object" ) continue;
      for ( const kind of ["advantage", "disadvantage"] ) {
        const names = grants[kind];
        if ( !names.length ) continue;
        const tracker = entry.tracker?.[kind];
        if ( typeof tracker?.add === "function" ) {
          for ( const name of names ) {
            try { tracker.add(MODULE_ID, name); } catch { /* foreign tracker API changed; flags below still apply */ }
          }
        }
        entry[kind === "advantage" ? "hasAdvantage" : "hasDisadvantage"] = true;
      }
      if ( "defaultButton" in entry || "hasAdvantage" in entry ) {
        const a = !!entry.hasAdvantage, d = !!entry.hasDisadvantage;
        entry.defaultButton = (a && !d) ? "advantage" : (d && !a) ? "disadvantage" : "normal";
      }
    }
  }
  log("roll mode applied", { advantage: grants.advantage, disadvantage: grants.disadvantage, mode });
}

/* -------------------------------------------- */
/*  Runtime hooks                               */
/* -------------------------------------------- */

let registered = false;
const recent = new Map();

export function registerRuleHooks() {
  if ( registered ) return;
  registered = true;

  // Only the base hook names are used: D&D5e fires both `preRollX` and `preRollXV2`
  // for every roll, and listening to both would apply bonuses twice.

  /* ---------- Attack rolls ---------- */
  Hooks.on("dnd5e.preRollAttack", (config, dialog) => {
    try {
      const act = config?.subject, item = act?.item, attacker = item?.actor;
      if ( !item || !attacker ) return;
      const roll = firstRoll(config);
      const targets = userTargets();
      const ctx = { activityName: act.name ?? item.name, activityType: "attack", actionType: actionTypeOf(act, config.attackMode) };
      const everyTarget = fn => (targets.length ? targets.every(fn) : fn(null));
      let coverCap = 0;
      const grants = newGrants();

      for ( const rule of userRules(attacker, item) ) {
        const relevant = ["attackBonus", "attackAdvantage"].includes(rule.effect) || COVER_RULES[rule.effect]
          || (rule.category === "utility" && ["advantage", "disadvantage"].includes(rule.effect) && rule.rollTarget === "attack");
        if ( !relevant ) continue;
        if ( !everyTarget(t => match(rule, { ...ctx, sourceActor: attacker, targetActor: t })) ) continue;
        if ( rule.effect === "attackBonus" && String(rule.formula).trim() ) roll.parts.push(`(${rule.formula})`);
        else if ( rule.effect === "attackAdvantage" || rule.effect === "advantage" ) grants.advantage.push(rule.name || "Item Builder");
        else if ( rule.effect === "disadvantage" ) grants.disadvantage.push(rule.name || "Item Builder");
        else if ( COVER_RULES[rule.effect] ) coverCap = Math.max(coverCap, COVER_CAPS[COVER_RULES[rule.effect]]);
        log("attack rule applied", rule.name, rule.effect);
      }

      applyRollModes(config, grants, dialog);

      // Ignore cover: cancel the cover bonus the targets currently have.
      if ( coverCap && targets.length ) {
        const comp = Math.min(...targets.map(t => {
          const cover = Number(t.system?.attributes?.ac?.cover) || 0;
          return cover <= coverCap ? cover : 0;
        }));
        if ( comp > 0 ) roll.parts.push(String(comp));
      }

      // Conditional AC bonuses on the defenders: a penalty to this attack is equivalent.
      if ( targets.length ) {
        const penalties = targets.map(target => holderRules(target)
          .filter(r => r.category === "defensive" && r.effect === "acBonus" && !["save", "saveagainstspell", "saveagainstmagic"].includes(String(r.trigger).toLowerCase()))
          .filter(r => match(r, { ...ctx, sourceActor: attacker, targetActor: target }))
          .reduce((sum, r) => sum + rollSync(r.formula, target.getRollData?.() ?? {}), 0));
        const penalty = Math.min(...penalties);
        if ( penalty ) roll.parts.push(String(-penalty));
      }
    } catch (err) { console.error(`${MODULE_ID} | preRollAttack`, err); }
  });

  /* ---------- Damage & healing rolls ---------- */
  Hooks.on("dnd5e.preRollDamage", (config) => {
    try {
      const act = config?.subject, item = act?.item, source = item?.actor;
      if ( !item || !source || !Array.isArray(config.rolls) ) return;
      const targets = userTargets();
      const damageTypes = [...new Set(config.rolls.flatMap(r => [r?.options?.type, ...(r?.options?.types ?? [])])
        .map(t => String(t ?? "").trim().toLowerCase()).filter(Boolean))];
      const healing = act.type === "heal" || (damageTypes.length && damageTypes.every(isHealingType));
      const ctx = { activityName: act.name ?? item.name, activityType: String(act.type ?? "").toLowerCase(), actionType: actionTypeOf(act), damageTypes };
      const everyTarget = fn => (targets.length ? targets.every(fn) : fn(null));
      const data = source.getRollData?.() ?? {};

      for ( const rule of userRules(source, item) ) {
        if ( !healing && ["extraDamage", "sameTypeDamage"].includes(rule.effect) ) {
          const matched = everyTarget(t => match(rule, { ...ctx, sourceActor: source, targetActor: t }));
          log("extra-damage", { rule: rule.name, matched, targets: targets.map(t => t.name), damageTypes });
          if ( !matched ) continue;
          const type = rule.effect === "sameTypeDamage" ? (rule.damageTypes?.find(t => damageTypes.includes(t)) ?? "") : (rule.extraType || "");
          if ( !type ) continue;
          config.rolls.push({
            parts: [rule.formula || "1d6"], data,
            options: { type, types: [type], critical: { allow: !!rule.canCrit },
              [MODULE_ID]: { extraDamage: true, canCrit: !!rule.canCrit, ruleId: rule.id, ruleName: rule.name, formula: rule.formula || "1d6" } }
          });
        } else if ( healing && rule.effect === "bonusHealing" && String(rule.formula).trim() ) {
          if ( !everyTarget(t => match(rule, { ...ctx, damageTypes: [], sourceActor: source, targetActor: t })) ) continue;
          const type = damageTypes.find(isHealingType) ?? "healing";
          config.rolls.push({
            parts: [rule.formula], data,
            options: { type, types: [type], critical: { allow: false },
              [MODULE_ID]: { extraDamage: true, canCrit: false, ruleId: rule.id, ruleName: rule.name, formula: rule.formula } }
          });
          log("bonus healing", rule.name);
        }
      }
    } catch (err) { console.error(`${MODULE_ID} | preRollDamage`, err); }
  });

  // Return non-crit extra damage to normal (D&D5e 6.0 applies crit scaling once at construction).
  Hooks.on("dnd5e.postDamageRollConfiguration", rolls => {
    try {
      if ( !Array.isArray(rolls) ) return;
      rolls.forEach((roll, index) => {
        const meta = roll?.options?.[MODULE_ID];
        if ( !meta?.extraDamage || meta.canCrit || !roll.isCritical ) return;
        const options = foundry.utils.deepClone(roll.options ?? {});
        options.isCritical = false;
        delete options.configured;
        delete options.preprocessed;
        rolls[index] = new roll.constructor(meta.formula || roll.formula, roll.data ?? {}, options);
      });
    } catch (err) { console.error(`${MODULE_ID} | postDamageRollConfiguration`, err); }
  });

  // Fallback context for damage applied without a card.
  Hooks.on("dnd5e.rollDamage", (rolls, data) => {
    try {
      const act = data?.subject, item = act?.item, source = item?.actor;
      if ( !item || !source ) return;
      const dtypes = [];
      for ( const roll of rolls ?? [] ) if ( roll?.options?.type ) dtypes.push(String(roll.options.type).toLowerCase());
      for ( const target of userTargets() ) {
        recent.set(target.uuid, { time: Date.now(), sourceActor: source, sourceItem: item, activityName: act?.name ?? item.name,
          activityType: String(act?.type ?? "").toLowerCase(), actionType: actionTypeOf(act), damageTypes: [...new Set(dtypes)] });
      }
    } catch (err) { console.error(`${MODULE_ID} | rollDamage`, err); }
  });

  /* ---------- Damage / healing application ---------- */
  // Runs for previews in the damage tray as well as the real application, so it must
  // have no side effects and give the same answer every time.
  Hooks.on("dnd5e.preCalculateDamage", (target, damages, options={}) => {
    try {
      let ctx = contextFromMessage(options?.originatingMessage);
      if ( !ctx ) {
        const r = recent.get(target?.uuid);
        if ( r && Date.now() - r.time <= 30000 ) ctx = r;
      }
      ctx ??= contextFromRecentCards(target);
      const incoming = (damages ?? []).map(d => String(d?.type ?? "").toLowerCase()).filter(Boolean);
      const healing = incoming.length > 0 && incoming.every(isHealingType);
      const matchContext = {
        sourceActor: ctx?.sourceActor ?? null, targetActor: target,
        activityName: ctx?.activityName ?? "", activityType: ctx?.activityType ?? "", actionType: ctx?.actionType ?? "",
        damageTypes: incoming.length ? incoming : (ctx?.damageTypes ?? [])
      };

      if ( healing ) {
        const key = ctx?.messageId ?? "nocard";
        for ( const rule of holderRules(target) ) {
          if ( rule.effect !== "healingReceived" || !String(rule.formula).trim() ) continue;
          if ( !match(rule, { ...matchContext, damageTypes: [] }) ) continue;
          const amount = cachedRoll(`${key}|${target.uuid}|${rule.id}`, rule.formula, target.getRollData?.() ?? {});
          const entry = damages.find(d => d.type === "healing") ?? damages[0];
          if ( entry && Number.isFinite(Number(entry.value)) ) entry.value = Math.max(0, Number(entry.value) + amount);
        }
        return;
      }

      // Offensive overrides use D&D5e's DamageApplicationOptions ignore API. Forced
      // vulnerability is applied once here while native vulnerability is ignored.
      if ( ctx?.sourceActor ) {
        const forceVulnerable = new Set(); let forceAll = false;
        for ( const rule of userRules(ctx.sourceActor, ctx.sourceItem) ) {
          if ( !OFFENSIVE_DAMAGE_RULES.has(rule.effect) || !match(rule, matchContext) ) continue;
          const types = (rule.damageTypes ?? []).map(x => String(x).toLowerCase());
          if ( ["ignoreResistance", "ignoreResistanceImmunity"].includes(rule.effect) ) addDamageIgnore(options, "resistance", types);
          if ( ["ignoreImmunity", "ignoreResistanceImmunity"].includes(rule.effect) ) addDamageIgnore(options, "immunity", types);
          if ( rule.effect === "causeVulnerability" ) {
            addDamageIgnore(options, "vulnerability", types);
            if ( types.length ) types.forEach(t => forceVulnerable.add(t)); else forceAll = true;
          }
        }
        if ( forceAll || forceVulnerable.size ) {
          for ( const d of damages ?? [] ) {
            const type = String(d?.type ?? "").toLowerCase();
            if ( Number.isFinite(Number(d?.value)) && !isHealingType(type) && (forceAll || forceVulnerable.has(type)) ) d.value = Number(d.value) * 2;
          }
        }
      }

      // Conditional resistance / immunity / vulnerability on the creature taking damage.
      for ( const rule of holderRules(target) ) {
        if ( !DEFENSIVE_DAMAGE_RULES.has(rule.effect) || !match(rule, matchContext) ) continue;
        const only = new Set((rule.damageTypes ?? []).map(x => String(x).toLowerCase()));
        for ( const d of damages ?? [] ) {
          const type = String(d?.type ?? "").toLowerCase();
          if ( !Number.isFinite(Number(d?.value)) || isHealingType(type) ) continue;
          if ( only.size && !only.has(type) ) continue;
          const n = Number(d.value);
          d.value = rule.effect === "resistance" ? Math.floor(n / 2) : rule.effect === "immunity" ? 0 : n * 2;
        }
        log(`${rule.effect} applied`, rule.name, target.name);
      }
    } catch (err) { console.error(`${MODULE_ID} | preCalculateDamage`, err); }
  });

  // Temporary HP granted by the healer: only on real application, never previews.
  Hooks.on("dnd5e.preApplyDamage", (actor, amount, updates, options={}) => {
    try {
      const message = options?.originatingMessage;
      const ctx = contextFromMessage(message) ?? (amount < 0 ? contextFromRecentCards(actor) : null);
      if ( !ctx?.sourceActor || !(amount < 0 || isHealingMessage(message)) ) return;
      const key = "system.attributes.hp.temp";
      for ( const rule of userRules(ctx.sourceActor, ctx.sourceItem) ) {
        if ( rule.effect !== "temporaryHp" || !String(rule.formula).trim() ) continue;
        if ( !match(rule, { sourceActor: ctx.sourceActor, targetActor: actor, activityName: ctx.activityName, activityType: ctx.activityType, actionType: ctx.actionType }) ) continue;
        const temp = cachedRoll(`${ctx.messageId}|${actor.uuid}|${rule.id}|temp`, rule.formula, ctx.sourceActor.getRollData?.() ?? {});
        const current = Number(updates[key] ?? actor.system?.attributes?.hp?.temp ?? 0) || 0;
        if ( temp > current ) updates[key] = temp;
        log("temporary HP", rule.name, actor.name, temp);
      }
    } catch (err) { console.error(`${MODULE_ID} | preApplyDamage`, err); }
  });

  /* ---------- Saving throws ---------- */
  Hooks.on("dnd5e.preRollSavingThrow", (config={}, dialog={}, message={}) => {
    try {
      const ctx = saveRollContext(config, message);
      if ( !ctx.actor ) return;
      const roll = firstRoll(config);
      const grants = newGrants();
      const decisions = [];
      for ( const rule of holderRules(ctx.actor) ) {
        if ( rule.ability && String(rule.ability).toLowerCase() !== ctx.ability ) continue;
        if ( rule.category === "defensive" && ["saveBonus", "saveAdvantage"].includes(rule.effect) ) {
          const trig = String(rule.trigger ?? "").toLowerCase();
          if ( trig === "saveagainstspell" && !ctx.isSpell ) { decisions.push(`${rule.name}: skipped (not a spell)`); continue; }
          if ( trig === "saveagainstmagic" && !ctx.isMagical ) { decisions.push(`${rule.name}: skipped (not magical)`); continue; }
          if ( trig === "saveagainstcondition" && !(rule.status && ctx.conditions.has(String(rule.status).toLowerCase())) ) { decisions.push(`${rule.name}: skipped (save is not against ${rule.status || "the chosen condition"})`); continue; }
          if ( !match({ ...rule, trigger: "" }, { sourceActor: ctx.sourceActor, targetActor: ctx.actor, activityName: ctx.activityName, activityType: "save", actionType: "save" }) ) {
            decisions.push(`${rule.name}: skipped (creature/activity filters did not match)`); continue;
          }
          decisions.push(`${rule.name}: APPLIED ${rule.effect}`);
          if ( rule.effect === "saveAdvantage" ) grants.advantage.push(rule.name || "Item Builder");
          else if ( String(rule.formula).trim() ) roll.parts.push(`(${rule.formula})`);
          log("save rule applied", rule.name);
        } else if ( rule.category === "utility" && ["advantage", "disadvantage"].includes(rule.effect) && rule.rollTarget === "save" ) {
          if ( !match({ ...rule, trigger: "" }, { sourceActor: ctx.actor, targetActor: ctx.sourceActor, activityName: ctx.activityName, activityType: "save", actionType: "save" }) ) continue;
          grants[rule.effect === "advantage" ? "advantage" : "disadvantage"].push(rule.name || "Item Builder");
        }
      }
      applyRollModes(config, grants, dialog);
      if ( debug() ) {
        const src = ctx.sourceActor;
        console.log(`${MODULE_ID} | save diagnostic | ${ctx.actor.name} ${ctx.ability || "?"} save | caster: ${src ? `${src.name} (${src.system?.details?.type?.value || "no type"})` : "UNKNOWN"} | source: ${ctx.item?.name ?? "UNKNOWN"} | spell: ${ctx.isSpell} | magical: ${ctx.isMagical} | user: ${game.user?.name} | ${decisions.join("; ") || "no Item Builder save rules on this creature"} | final mode: ${config.advantageMode ?? config.rolls?.[0]?.options?.advantageMode ?? "unset"}`);
      }
    } catch (err) { console.error(`${MODULE_ID} | preRollSavingThrow`, err); }
  });

  /* ---------- Ability & skill checks ---------- */
  Hooks.on("dnd5e.preRollAbilityCheck", (config={}, dialog={}) => {
    try {
      const actor = config.subject?.documentName === "Actor" ? config.subject : config.subject?.actor;
      if ( !actor ) return;
      firstRoll(config);
      const grants = newGrants();
      const skill = config.skill ?? "", tool = config.tool ?? "", ability = String(config.ability ?? "").toLowerCase();
      for ( const rule of holderRules(actor) ) {
        if ( rule.category !== "utility" || !["advantage", "disadvantage"].includes(rule.effect) ) continue;
        const applies = (rule.rollTarget === "check" && !skill && !tool && (!rule.ability || rule.ability === ability))
          || (rule.rollTarget === "skill" && skill && (!rule.skill || rule.skill === skill));
        if ( !applies || !match({ ...rule, trigger: "" }, { sourceActor: actor, targetActor: null }) ) continue;
        grants[rule.effect === "advantage" ? "advantage" : "disadvantage"].push(rule.name || "Item Builder");
      }
      applyRollModes(config, grants, dialog);
    } catch (err) { console.error(`${MODULE_ID} | preRollAbilityCheck`, err); }
  });

  /* ---------- Hit dice ---------- */
  Hooks.on("dnd5e.preRollHitDie", (config={}) => {
    try {
      const actor = config.subject;
      if ( actor?.documentName !== "Actor" ) return;
      const roll = firstRoll(config);
      for ( const rule of holderRules(actor) ) {
        if ( rule.effect !== "recoveryBonus" || !String(rule.formula).trim() ) continue;
        if ( !match({ ...rule, trigger: "" }, { sourceActor: actor, targetActor: actor }) ) continue;
        roll.parts.push(`(${rule.formula})`);
      }
    } catch (err) { console.error(`${MODULE_ID} | preRollHitDie`, err); }
  });
}
