/**
 * Reactions: an item feature the holder uses with their reaction ("When a creature hits you…").
 *
 * Each reaction is written as a native D&D5e activity with Reaction activation, the trigger as its
 * condition, its own limited uses, and (for timed benefits) an Active Effect it applies to the user.
 * It shows on the character sheet and works the same with or without Item Builder or Midi-QOL.
 */
import { MODULE_ID, coreGeneration, saveBonusKey, usesFormula, usesLabel, withEffectChanges } from "./compat.mjs";

/** Reaction outcomes offered in the builder. */
export const REACTION_EFFECTS = {
  acBonus: "Bonus to AC until your next turn",
  resistance: "Resistance to the triggering damage",
  reduceDamage: "Reduce the triggering damage",
  damageAttacker: "Deal damage to the attacker",
  saveAttacker: "Attacker makes a saving throw",
  healSelf: "Regain hit points",
  tempHp: "Gain temporary hit points",
  saveBonus: "Bonus to saving throws until your next turn",
  description: "Something else (rules text only)"
};

/** Common reaction triggers; "custom" lets the GM type their own. */
export const REACTION_TRIGGERS = {
  hit: "When a creature you can see hits you with an attack",
  targeted: "When a creature you can see targets you with an attack",
  damaged: "When you take damage",
  save: "When you must make a saving throw",
  ally: "When a creature you can see attacks an ally within 5 feet of you",
  leaves: "When a creature you can see leaves your reach",
  custom: "Custom trigger…"
};

/** The trigger sentence shown on the activity. */
export function reactionTriggerText(c) {
  if ( c.trigger === "custom" ) return String(c.triggerText ?? "").trim();
  return REACTION_TRIGGERS[c.trigger] ?? REACTION_TRIGGERS.hit;
}

const isDeterministic = f => !/\d*d\d/i.test(String(f ?? ""));

/** Effect duration lasting until the start of the user's next turn, in this core version's format. */
export function untilNextTurn() {
  return coreGeneration() >= 14
    ? { value: 1, units: "rounds", expiry: "turnStart" }
    : { rounds: 1, turns: 0 };
}

/** Which outcomes use an Active Effect applied to the user? */
function usesEffect(c) {
  if ( c.reactionEffect === "reduceDamage" ) return isDeterministic(c.formula) && !!String(c.formula ?? "").trim();
  return ["acBonus", "resistance", "saveBonus"].includes(c.reactionEffect);
}

/** The Active Effect a reaction applies to its user, or null. */
export function reactionEffectData(c, itemName) {
  if ( !usesEffect(c) ) return null;
  const f = String(c.formula ?? "").trim();
  const type = c.damageType && c.damageType !== "any" ? c.damageType : "ALL";
  let changes = [];
  switch ( c.reactionEffect ) {
    case "acBonus": changes = [{ key: "system.attributes.ac.bonus", type: "add", value: f || "1", priority: 20 }]; break;
    case "resistance": changes = [{ key: "system.traits.dr.value", type: "add", value: type, priority: 20 }]; break;
    case "reduceDamage": changes = [{ key: `system.traits.dm.amount.${type}`, type: "add", value: `-${f.replace(/^-/, "")}`, priority: 20 }]; break;
    case "saveBonus": changes = [{ key: saveBonusKey(""), type: "add", value: f || "1", priority: 20 }]; break;
  }
  return withEffectChanges({
    name: `${c.name || itemName}`,
    img: "icons/svg/shield.svg",
    transfer: false,
    disabled: false,
    duration: untilNextTurn(),
    flags: { [MODULE_ID]: { componentId: c.id, managed: true, reaction: true } }
  }, changes, { remapKeys: true });
}

function damagePart(formula, type) {
  return { number: null, denomination: null, bonus: "", types: type && type !== "any" ? [type] : [],
    custom: { enabled: true, formula: String(formula) }, scaling: { mode: "", number: 1, formula: "" } };
}

/** The native activity for a reaction: `{ type, data }`. */
export function reactionActivityData(c, { id, effectId=null, spent=0 }={}) {
  const f = String(c.formula ?? "").trim();
  const data = {
    _id: id,
    name: c.name || "Reaction",
    activation: { type: "reaction", value: 1, condition: reactionTriggerText(c), override: false },
    description: { chatFlavor: c.text ? String(c.text) : "" },
    range: { units: "self" },
    target: { affects: { type: "self" }, prompt: false },
    effects: effectId ? [{ _id: effectId }] : []
  };
  const uses = usesFormula(c);
  if ( uses ) {
    const period = ["sr", "lr", "day", "dawn"].includes(c.recovery) ? c.recovery : "";
    data.uses = { max: uses, spent: Number(spent) || 0, recovery: period ? [{ period, type: "recoverAll" }] : [] };
    data.consumption = { targets: [{ type: "activityUses", target: "", value: "1" }], spellSlot: false };
  }
  let type = "utility";
  switch ( c.reactionEffect ) {
    case "damageAttacker":
      type = "damage";
      data.damage = { critical: { allow: false }, parts: f ? [damagePart(f, c.damageType)] : [] };
      data.range = { units: "ft", value: "60" };
      data.target = { affects: { type: "creature", count: "1" }, prompt: false };
      break;
    case "saveAttacker":
      type = "save";
      data.damage = { onSave: c.onSave === "none" ? "none" : "half", parts: f ? [damagePart(f, c.damageType)] : [] };
      data.save = { ability: [c.saveAbility || "dex"], dc: { calculation: "", formula: String(c.saveDC || "13") } };
      data.range = { units: "ft", value: "60" };
      data.target = { affects: { type: "creature", count: "1" }, prompt: false };
      break;
    case "healSelf":
    case "tempHp":
      type = "heal";
      data.healing = damagePart(f || "1d8", c.reactionEffect === "tempHp" ? "temphp" : "healing");
      break;
    case "reduceDamage":
      // A rolled reduction (e.g. 1d10 + @prof) cannot be stored as a fixed modifier; the roll is shown instead.
      if ( f && !isDeterministic(f) ) data.roll = { formula: f, name: "Damage Reduced", prompt: false, visible: true };
      break;
  }
  return { type, data };
}

/** Plain-English summary of a reaction for the builder preview. */
export function reactionSummary(c, abilityLabel=k => k) {
  const f = String(c.formula ?? "").trim();
  const dmg = c.damageType && c.damageType !== "any" ? ` ${c.damageType}` : "";
  const what = {
    acBonus: `+${f || 1} AC until the start of your next turn`,
    resistance: `resistance to${dmg || " all"} damage until the start of your next turn`,
    reduceDamage: `reduce the damage by ${f || "?"}`,
    damageAttacker: `deal ${f || "?"}${dmg} damage to the attacker`,
    saveAttacker: `the attacker makes a DC ${c.saveDC || 13} ${abilityLabel(c.saveAbility || "dex")} save or takes ${f || "?"}${dmg} damage`,
    healSelf: `regain ${f || "?"} hit points`,
    tempHp: `gain ${f || "?"} temporary hit points`,
    saveBonus: `+${f || 1} to saving throws until the start of your next turn`,
    description: "see the rules text"
  }[c.reactionEffect] ?? "";
  const uses = usesLabel(c, abilityLabel);
  const per = { sr: "short rest", lr: "long rest", day: "day", dawn: "dawn" }[c.recovery];
  const usesText = uses ? ` (${/^\d+$/.test(uses) ? `${uses} use${uses === "1" ? "" : "s"}` : `uses equal to your ${uses}`}${per ? ` per ${per}` : ""})` : "";
  return `Reaction — ${reactionTriggerText(c) || "trigger not set"}: ${what}${usesText}.`;
}

function readRecord(item) {
  try {
    const raw = item.getFlag?.(MODULE_ID, "reactions");
    return typeof raw === "string" ? JSON.parse(raw || "{}") : {};
  } catch { return {}; }
}

/**
 * Make the item's reaction activities match its reaction components at the current tier.
 * Activities and effects Item Builder made before are replaced; spent uses are kept.
 */
export async function syncReactions(item) {
  if ( !item?.system?.activities ) return;
  const comps = item.getFlag(MODULE_ID, "components") ?? [];
  const tier = Number(item.getFlag(MODULE_ID, "currentTier") ?? 1);
  const wanted = comps.filter(c => c.type === "reaction" && (Number(c.tier) || 1) <= tier);
  const record = readRecord(item);
  const hadAny = Object.keys(record).length || wanted.length;
  if ( !hadAny ) return;

  // Remove what the previous build created.
  const spent = {};
  const oldEffects = [];
  for ( const [cid, rec] of Object.entries(record) ) {
    const act = item.system.activities.get?.(rec.activity);
    if ( act ) { spent[cid] = act.uses?.spent ?? 0; await item.deleteActivity(rec.activity); }
    if ( rec.effect && item.effects.get(rec.effect) ) oldEffects.push(rec.effect);
  }
  const strays = [...item.effects].filter(e => e.getFlag(MODULE_ID, "reaction") && !oldEffects.includes(e.id)).map(e => e.id);
  if ( oldEffects.length || strays.length ) await item.deleteEmbeddedDocuments("ActiveEffect", [...oldEffects, ...strays]);

  // Build the current ones.
  const next = {};
  for ( const c of wanted ) {
    let effectId = null;
    const fx = reactionEffectData(c, item.name);
    if ( fx ) [effectId] = (await item.createEmbeddedDocuments("ActiveEffect", [fx])).map(e => e.id);
    const id = foundry.utils.randomID();
    const { type, data } = reactionActivityData(c, { id, effectId, spent: spent[c.id] });
    try {
      await item.createActivity(type, data, { renderSheet: false });
      next[c.id] = { activity: id, effect: effectId };
    } catch (err) {
      console.error(`${MODULE_ID} | could not create reaction "${c.name}"`, err);
      ui.notifications?.error(`${item.name}: reaction "${c.name}" could not be added.`);
    }
  }
  await item.setFlag(MODULE_ID, "reactions", JSON.stringify(next));
}
