/**
 * Use requirements: "requires attunement by a wizard", "Strength 15 to wear without penalty",
 * "a creature below 5th level that attunes takes 4d6 psychic damage"…
 *
 * A Requirement component names who may use the item (a class, a minimum ability score, or a
 * minimum level) and what happens to anyone else. Item Builder enforces it while it is enabled:
 * it blocks attuning or equipping, applies disadvantage, deals damage on the attempt, or turns on
 * a speed penalty. The requirement is also listed in the item's description.
 */
import { MODULE_ID, movementKey, withEffectChanges } from "./compat.mjs";
import { applyRollModes } from "./rules.mjs";

export const REQUIREMENT_KINDS = {
  class: "A specific class",
  ability: "A minimum ability score",
  level: "A minimum character level"
};

export const REQUIREMENT_PENALTIES = {
  blockAttune: "They cannot attune to it",
  blockEquip: "They cannot equip or wield it",
  damage: "They take damage when they try to attune or equip it",
  disAttacks: "Disadvantage on attack rolls made with it",
  disChecks: "Disadvantage on ability checks and saving throws",
  speed: "Their speed is reduced",
  note: "Rules text only (GM adjudicates)"
};

export const CLASS_CHOICES = {
  artificer: "Artificer", barbarian: "Barbarian", bard: "Bard", cleric: "Cleric", druid: "Druid",
  fighter: "Fighter", monk: "Monk", paladin: "Paladin", ranger: "Ranger", rogue: "Rogue",
  sorcerer: "Sorcerer", warlock: "Warlock", wizard: "Wizard"
};

const cfg = (path, fallback={}) => foundry.utils.getProperty(globalThis.CONFIG?.DND5E ?? {}, path) ?? fallback;
const loc = (raw, fallback="") => game.i18n.localize(raw?.label ?? raw ?? fallback) || fallback;
const abilityName = k => loc(cfg("abilities", {})[k], k);
const list = (items, joiner="or") => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`;
const article = w => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
const ORD = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

/** Class identifiers an actor has (from its class items). */
export function actorClasses(actor) {
  const ids = new Set(Object.keys(actor?.classes ?? {}));
  for ( const i of actor?.items ?? [] ) {
    if ( i.type !== "class" ) continue;
    ids.add(String(i.system?.identifier || i.name || "").toLowerCase().replace(/\s+/g, "-"));
  }
  return ids;
}

/** Does the actor meet this Requirement component? */
export function meetsRequirement(actor, c) {
  if ( !actor ) return true;
  switch ( c.requireKind ) {
    case "class": {
      const wanted = (c.classes ?? []).map(s => String(s).toLowerCase());
      if ( !wanted.length ) return true;
      const have = actorClasses(actor);
      return wanted.some(w => have.has(w));
    }
    case "ability": {
      const score = Number(actor.system?.abilities?.[c.ability || "str"]?.value ?? 0);
      return score >= (Number(c.minimum) || 0);
    }
    case "level": {
      const lvl = Number(actor.system?.details?.level ?? actor.system?.details?.cr ?? 0);
      return lvl >= (Number(c.minimum) || 0);
    }
    default: return true;
  }
}

/** "a wizard or sorcerer", "Strength 15", "5th level". */
export function requirementWho(c) {
  if ( c.requireKind === "class" ) {
    const names = (c.classes ?? []).map(k => (CLASS_CHOICES[k] ?? k).toLowerCase());
    return names.length ? article(list(names)) : "anyone";
  }
  if ( c.requireKind === "ability" ) return `${abilityName(c.ability || "str")} ${Number(c.minimum) || 0}`;
  if ( c.requireKind === "level" ) return `${ORD(Number(c.minimum) || 1)} level`;
  return "";
}

/** "a wizard or sorcerer", "a creature with Strength 15 or higher", "a creature of 5th level or higher". */
export function requirementCreature(c) {
  if ( c.requireKind === "class" ) return requirementWho(c);
  if ( c.requireKind === "ability" ) return `a creature with ${requirementWho(c)} or higher`;
  if ( c.requireKind === "level" ) return `a creature of ${requirementWho(c)} or higher`;
  return "anyone";
}

/** Player-facing description line. */
export function requirementLine(c) {
  const who = requirementCreature(c);
  const dmg = `${c.formula || "?"} ${c.damageType && c.damageType !== "none" ? `${c.damageType} ` : ""}damage`;
  switch ( c.penalty ) {
    case "blockAttune": return `Requires attunement by ${who}`;
    case "blockEquip": return `Can only be equipped or wielded by ${who}`;
    case "damage": return `Meant for ${who}; anyone else who tries to attune to or equip it takes ${dmg}${c.blocks ? " and fails" : ""}`;
    case "disAttacks": return `Meant for ${who}; anyone else has disadvantage on attack rolls made with it`;
    case "disChecks": return `Meant for ${who}; anyone else has disadvantage on ${c.penaltyAbility ? `${abilityName(c.penaltyAbility)} ` : ""}ability checks and saving throws while using it`;
    case "speed": return `Meant for ${who}; anyone else has their speed reduced by ${Math.abs(Number(c.formula) || 10)} ft. while using it`;
    case "note": { const t = String(c.text ?? "").trim(); return `Meant for ${who}${t ? `; ${t}` : ""}`; }
    default: return `Meant for ${who}`;
  }
}

function requirementsOn(item) {
  return (item?.flags?.[MODULE_ID]?.components ?? []).filter(c => c.type === "requirement"
    && (Number(c.tier) || 1) <= (Number(item.flags[MODULE_ID].currentTier ?? 1) || 1));
}

/** Is the item currently "in use" for penalties (equipped when it can be). */
function inUse(item) {
  const sys = item.system ?? {};
  if ( "equipped" in sys && !sys.equipped ) return false;
  return true;
}

/* -------------------------------------------- */
/*  Speed penalty: an Active Effect switched on  */
/*  only for owners who don't meet the rule      */
/* -------------------------------------------- */

export function speedPenaltyEffect(c, itemName) {
  return withEffectChanges({
    name: `${itemName}: ${c.name || "Requirement"}`,
    img: "icons/svg/downgrade.svg",
    transfer: true,
    disabled: true,
    flags: { [MODULE_ID]: { componentId: c.id, managed: true, requirement: true } }
  }, [{ key: movementKey("walk"), type: "add", value: `-${Math.abs(Number(c.formula) || 10)}`, priority: 30 }]);
}

/** Create / remove speed-penalty effects to match the item's Requirement components. */
export async function syncRequirementEffects(item) {
  if ( !item?.flags?.[MODULE_ID] ) return;
  const wanted = (item.flags[MODULE_ID].components ?? []).filter(c => c.type === "requirement" && c.penalty === "speed");
  const old = [...item.effects].filter(e => e.getFlag(MODULE_ID, "requirement")).map(e => e.id);
  if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
  if ( wanted.length ) await item.createEmbeddedDocuments("ActiveEffect", wanted.map(c => speedPenaltyEffect(c, item.name)));
  await refreshRequirementState(item);
}

/** Switch an owned item's penalty effects on or off for its owner. */
export async function refreshRequirementState(item) {
  const actor = item?.parent;
  const updates = [];
  const tier = Number(item?.flags?.[MODULE_ID]?.currentTier ?? 1) || 1;
  for ( const e of item?.effects ?? [] ) {
    if ( !e.getFlag(MODULE_ID, "requirement") ) continue;
    const c = (item.flags[MODULE_ID].components ?? []).find(x => x.id === e.getFlag(MODULE_ID, "componentId"));
    const active = !!(actor?.documentName === "Actor" && c && (Number(c.tier) || 1) <= tier && !meetsRequirement(actor, c));
    if ( e.disabled === active ) updates.push({ _id: e.id, disabled: !active });
  }
  if ( updates.length && item.isOwner ) await item.updateEmbeddedDocuments("ActiveEffect", updates);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

const isResponsible = actor => actor?.isOwner && (game.user.isGM
  ? (game.users.activeGM?.id ?? game.user.id) === game.user.id || !actor.hasPlayerOwner
  : true);

export function registerRequirementHooks() {
  // Block attuning / equipping, and deal damage on the attempt.
  Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    if ( userId !== game.user.id ) return;
    const actor = item.parent;
    if ( actor?.documentName !== "Actor" ) return;
    const attuning = foundry.utils.getProperty(changes, "system.attuned") === true && !item.system?.attuned;
    const equipping = foundry.utils.getProperty(changes, "system.equipped") === true && !item.system?.equipped;
    if ( !attuning && !equipping ) return;
    let allow = true;
    for ( const c of requirementsOn(item) ) {
      if ( meetsRequirement(actor, c) ) continue;
      const verb = attuning ? "attune to" : "equip";
      if ( (c.penalty === "blockAttune" && attuning) || (c.penalty === "blockEquip" && equipping) ) {
        ui.notifications.warn(`${actor.name} can't ${verb} ${item.name}: ${requirementLine(c)}.`);
        allow = false;
      } else if ( c.penalty === "damage" && (attuning || (equipping && !item.system?.attunement)) ) {
        const formula = String(c.formula || "1d6");
        const type = c.damageType && c.damageType !== "none" ? c.damageType : "force";
        (async () => {
          try {
            const roll = await new Roll(formula).evaluate();
            await roll.toMessage({ speaker: globalThis.ChatMessage.getSpeaker({ actor }), flavor: `${item.name}: ${actor.name} doesn't meet the requirement (${requirementWho(c)}) — ${type} damage` });
            await actor.applyDamage([{ value: roll.total, type, properties: new Set() }]);
          } catch (err) { console.warn(`${MODULE_ID} | requirement damage failed`, err); }
        })();
        if ( c.blocks ) {
          ui.notifications.warn(`${actor.name} fails to ${verb} ${item.name}.`);
          allow = false;
        }
      }
    }
    return allow ? undefined : false;
  });

  // Disadvantage penalties.
  const grantsFor = (actor, test) => {
    const g = { advantage: [], disadvantage: [] };
    for ( const item of actor?.items ?? [] ) {
      if ( !inUse(item) ) continue;
      for ( const c of requirementsOn(item) ) if ( test(item, c) && !meetsRequirement(actor, c) ) g.disadvantage.push(item.name);
    }
    return g;
  };
  Hooks.on("dnd5e.preRollAttack", (config={}, dialog={}) => {
    const item = config.subject?.item;
    const actor = item?.actor;
    if ( !actor || !inUse(item) ) return;
    const g = { advantage: [], disadvantage: requirementsOn(item).filter(c => c.penalty === "disAttacks" && !meetsRequirement(actor, c)).map(() => item.name) };
    applyRollModes(config, g, dialog);
  });
  const checkOrSave = (config={}, dialog={}) => {
    const actor = config.subject?.documentName === "Actor" ? config.subject : config.subject?.actor;
    const ability = config.ability;
    applyRollModes(config, grantsFor(actor, (_i, c) => c.penalty === "disChecks" && (!c.penaltyAbility || c.penaltyAbility === ability)), dialog);
  };
  Hooks.on("dnd5e.preRollAbilityCheck", checkOrSave);
  Hooks.on("dnd5e.preRollSavingThrow", checkOrSave);

  // Keep speed penalties right as the owner changes (level up, ability scores, class).
  const refreshActor = actor => {
    if ( !isResponsible(actor) ) return;
    for ( const item of actor.items ) if ( item.effects.some(e => e.getFlag(MODULE_ID, "requirement")) ) refreshRequirementState(item);
  };
  Hooks.on("createItem", item => { if ( item.parent?.documentName === "Actor" ) refreshActor(item.parent); });
  Hooks.on("deleteItem", item => { if ( item.parent?.documentName === "Actor" && item.type === "class" ) refreshActor(item.parent); });
  Hooks.on("updateItem", item => { if ( item.parent?.documentName === "Actor" && item.type === "class" ) refreshActor(item.parent); });
  Hooks.on("updateActor", (actor, changes) => {
    if ( foundry.utils.hasProperty(changes, "system.abilities") || foundry.utils.hasProperty(changes, "system.details") ) refreshActor(actor);
  });
}
