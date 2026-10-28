/**
 * Item Builder 5e — version compatibility layer.
 *
 * Supported combinations:
 *   - Foundry VTT 13 + D&D5e 5.3.x
 *   - Foundry VTT 14 + D&D5e 5.3.x
 *   - Foundry VTT 14 + D&D5e 6.0.x (verified 6.0.6)
 *
 * Two independent axes are handled here:
 *   1. Foundry core generation decides the Active Effect *storage format*
 *      (v13: top-level `changes` with numeric `mode`; v14: `system.changes` with string `type`).
 *   2. The D&D5e system version decides *data paths* (movement speeds, rarity).
 */

export const MODULE_ID = "item-builder-5e";

/* -------------------------------------------- */
/*  Version detection                           */
/* -------------------------------------------- */

/** Foundry core generation (13, 14, …). */
export function coreGeneration() {
  const gen = Number(game.release?.generation);
  if ( Number.isFinite(gen) && gen > 0 ) return gen;
  return Number(String(game.version ?? "13").split(".")[0]) || 13;
}

/** True when Foundry core stores Active Effect changes in `system.changes` with string types. */
export function usesTypedEffectChanges() {
  return coreGeneration() >= 14;
}

/** Installed D&D5e version string. */
export function systemVersion() {
  return String(game.system?.version ?? "0.0.0");
}

/** True when D&D5e is 6.0.0 or newer. */
export function isDnd5e6() {
  return !foundry.utils.isNewerVersion("6.0.0", systemVersion());
}

/* -------------------------------------------- */
/*  Active Effect change formats                */
/* -------------------------------------------- */

/** Legacy numeric modes (Foundry ≤13) mapped to v14 string change types. */
export const MODE_TO_TYPE = Object.freeze({ 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" });

/** v14 string change types mapped to legacy numeric modes. */
export const TYPE_TO_MODE = Object.freeze({ custom: 0, multiply: 1, add: 2, subtract: 2, downgrade: 3, upgrade: 4, override: 5 });

/**
 * Convert any change (legacy `mode` or v14 `type`) into the canonical in-memory shape
 * `{ key, type, value, priority }` used throughout this module.
 * @param {object} change
 * @returns {{key:string,type:string,value:string,priority?:number}}
 */
export function canonicalChange(change={}) {
  let type = change.type;
  if ( typeof type !== "string" || !type ) {
    const mode = Number(change.mode);
    type = MODE_TO_TYPE[Number.isFinite(mode) ? mode : 2] ?? "add";
  }
  const out = { key: String(change.key ?? ""), type, value: change.value === undefined || change.value === null ? "" : String(change.value) };
  if ( Number.isFinite(Number(change.priority)) && change.priority !== null && change.priority !== "" ) out.priority = Number(change.priority);
  // D&D5e 6.0 rule changes may carry their own roll-time conditions (a JSON filter string).
  if ( typeof change.conditions === "string" && change.conditions && change.conditions !== "{}" ) out.conditions = change.conditions;
  return out;
}

/**
 * Convert a canonical change into the storage format the running Foundry version expects.
 * @param {{key:string,type:string,value:string,priority?:number}} change
 * @returns {object}
 */
export function storageChange(change) {
  const c = canonicalChange(change);
  if ( usesTypedEffectChanges() ) {
    const out = { key: c.key, type: c.type, value: c.value };
    if ( c.priority !== undefined ) out.priority = c.priority;
    if ( c.conditions ) out.conditions = c.conditions;
    return out;
  }
  // Foundry 13 has no "subtract" mode: express it as an addition of the negated value.
  let value = c.value;
  if ( c.type === "subtract" ) {
    const n = Number(value);
    value = Number.isFinite(n) && value.trim() !== "" ? String(-n) : `-(${value})`;
  }
  const out = { key: c.key, mode: TYPE_TO_MODE[c.type] ?? TYPE_TO_MODE.add, value };
  if ( c.priority !== undefined ) out.priority = c.priority;
  return out;
}

/**
 * Read the change list from Active Effect data in either format.
 * @param {object} effectData  Effect source data or an ActiveEffect document.
 * @returns {object[]}         Canonical changes.
 */
export function readEffectChanges(effectData) {
  const system = effectData?.system;
  let raw = null;
  if ( Array.isArray(system?.changes) ) raw = system.changes;
  else if ( Array.isArray(effectData?._source?.system?.changes) ) raw = effectData._source.system.changes;
  else if ( Array.isArray(effectData?._source?.changes) ) raw = effectData._source.changes;
  else if ( Array.isArray(effectData?.changes) ) raw = effectData.changes;
  return (raw ?? []).map(canonicalChange);
}

/**
 * Return a copy of effect data whose changes are stored in the current Foundry format.
 * @param {object} effectData           Effect source data (any format).
 * @param {object[]} [changes]          Canonical changes to store. Defaults to the effect's own changes.
 * @param {object} [options]
 * @param {boolean} [options.remapKeys=true]  Rewrite movement/sense keys for the running D&D5e version.
 * @returns {object}
 */
export function withEffectChanges(effectData, changes, { remapKeys=true }={}) {
  const out = foundry.utils.deepClone(effectData ?? {});
  let list = (changes ?? readEffectChanges(effectData)).map(canonicalChange);
  if ( remapKeys ) list = list.map(c => ({ ...c, key: remapChangeKey(c.key) }));
  delete out.changes;
  if ( out.system && typeof out.system === "object" ) delete out.system.changes;
  const stored = list.map(storageChange);
  if ( usesTypedEffectChanges() ) {
    out.system = { ...(out.system ?? {}), changes: stored };
  } else {
    out.changes = stored;
    if ( out.system && !Object.keys(out.system).length ) delete out.system;
  }
  return out;
}

/**
 * Update payload that replaces an existing effect's changes in the current Foundry format.
 * @param {object[]} changes  Canonical changes.
 * @returns {object}
 */
export function effectChangesUpdate(changes) {
  const stored = changes.map(storageChange);
  return usesTypedEffectChanges() ? { "system.changes": stored } : { changes: stored };
}

/* -------------------------------------------- */
/*  D&D5e data paths                            */
/* -------------------------------------------- */

const MOVEMENT_KEY = /^system\.attributes\.movement\.(?:speeds\.)?(walk|burrow|climb|fly|swim|jump)$/;
const SENSE_KEY = /^system\.attributes\.senses\.(?:ranges\.)?(darkvision|blindsight|tremorsense|truesight)$/;

/** Active Effect key for a movement speed. D&D5e 6.0 moved speeds under `movement.speeds`. */
export function movementKey(type="walk") {
  return isDnd5e6() ? `system.attributes.movement.speeds.${type}` : `system.attributes.movement.${type}`;
}

/** Active Effect key for a sense range. Both 5.3 and 6.0 store ranges under `senses.ranges`. */
export function senseKey(sense="darkvision") {
  return `system.attributes.senses.ranges.${sense}`;
}

/* Bonus keys that D&D5e 6.0 moved (5.3 path ⇄ 6.0 path). */
const BONUS_KEYS_5_TO_6 = [
  [/^system\.abilities\.(\w+)\.bonuses\.(check|save)$/, (_m, a, t) => `system.abilities.${a}.${t}.roll.bonus`],
  [/^system\.bonuses\.abilities\.(check|save|skill)$/, (_m, t) => `system.rolls.ability.${t}.bonus`],
  [/^system\.bonuses\.(mwak|rwak|msak|rsak)\.(attack|damage)$/, (_m, a, t) => `system.rolls.${t}.${a}.bonus`]
];
const BONUS_KEYS_6_TO_5 = [
  [/^system\.abilities\.(\w+)\.(check|save)\.roll\.bonus$/, (_m, a, t) => `system.abilities.${a}.bonuses.${t}`],
  [/^system\.rolls\.ability\.(check|save|skill)\.bonus$/, (_m, t) => `system.bonuses.abilities.${t}`],
  [/^system\.rolls\.(attack|damage)\.(mwak|rwak|msak|rsak)\.bonus$/, (_m, t, a) => `system.bonuses.${a}.${t}`]
];

/** Rewrite a movement, sense, or roll-bonus key so it targets the path used by the running D&D5e version. */
export function remapChangeKey(key) {
  const k = String(key ?? "");
  const m = k.match(MOVEMENT_KEY);
  if ( m ) return movementKey(m[1]);
  const s = k.match(SENSE_KEY);
  if ( s ) return senseKey(s[1]);
  for ( const [re, to] of (isDnd5e6() ? BONUS_KEYS_5_TO_6 : BONUS_KEYS_6_TO_5) ) {
    if ( re.test(k) ) return k.replace(re, to);
  }
  return k;
}

/** Read an item's rarity from source data or a prepared document in either system version. */
export function readRarity(system) {
  if ( !system ) return "";
  const direct = system.rarity;
  if ( typeof direct === "string" && direct ) return direct;
  const many = system.rarities;
  if ( many instanceof Set ) return many.first?.() ?? [...many][0] ?? "";
  if ( Array.isArray(many) ) return many[0] ?? "";
  return typeof direct === "string" ? direct : "";
}

/**
 * Write a rarity into item source data using the running system's field.
 * D&D5e 6.0 replaced `rarity` (string) with `rarities` (set of strings).
 * @param {object} system  Mutable `system` source data.
 * @param {string} rarity
 */
export function writeRarity(system, rarity) {
  if ( !system ) return;
  if ( isDnd5e6() ) {
    system.rarities = rarity ? [rarity] : [];
    delete system.rarity;
  } else {
    system.rarity = rarity ?? "";
    delete system.rarities;
  }
}

/**
 * Normalise attunement from any historical representation to the current string enum.
 * @returns {{attunement: string, attuned: boolean}}
 */
export function normalizeAttunement(value, attuned=false) {
  switch ( String(value ?? "") ) {
    case "2": return { attunement: "required", attuned: true };
    case "1":
    case "required": return { attunement: "required", attuned: !!attuned };
    case "optional": return { attunement: "optional", attuned: !!attuned };
    default: return { attunement: "", attuned: false };
  }
}

/**
 * Active Effect key for a saving-throw bonus.
 * D&D5e 6.0 moved `abilities.<a>.bonuses.save` to `abilities.<a>.save.roll.bonus`
 * and `bonuses.abilities.save` to `rolls.ability.save.bonus`.
 * @param {string} [ability]  Ability key, or blank for all saving throws.
 */
export function saveBonusKey(ability="") {
  if ( isDnd5e6() ) return ability ? `system.abilities.${ability}.save.roll.bonus` : "system.rolls.ability.save.bonus";
  return ability ? `system.abilities.${ability}.bonuses.save` : "system.bonuses.abilities.save";
}

/**
 * Active Effect keys that grant advantage (+1) or disadvantage (-1) on a kind of roll.
 * These `roll.mode` paths are identical in D&D5e 5.3 and 6.0.
 * @param {"save"|"check"|"skill"|"initiative"|"concentration"} target
 * @param {object} [options]
 * @param {string} [options.ability]  Limit saves/checks to one ability.
 * @param {string} [options.skill]    Limit skill checks to one skill.
 * @returns {string[]}
 */
export function rollModeKeys(target, { ability="", skill="" }={}) {
  const abilities = ability ? [ability] : Object.keys(CONFIG.DND5E?.abilities ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  switch ( target ) {
    case "save": return abilities.map(a => `system.abilities.${a}.save.roll.mode`);
    case "check": return abilities.map(a => `system.abilities.${a}.check.roll.mode`);
    case "skill": return (skill ? [skill] : Object.keys(CONFIG.DND5E?.skills ?? {})).map(s => `system.skills.${s}.roll.mode`);
    case "initiative": return ["system.attributes.init.roll.mode"];
    case "concentration": return ["system.attributes.concentration.roll.mode"];
    default: return [];
  }
}

/** Initiative bonus field: `init.roll.bonus` in D&D5e 6, `init.bonus` in 5.3. */
export function initiativeBonusKey() {
  return isDnd5e6() ? "system.attributes.init.roll.bonus" : "system.attributes.init.bonus";
}

/** Initiative component formula: a number, the proficiency bonus, an ability modifier, or both. */
export function initiativeFormula(c) {
  const ab = c?.ability || "dex";
  switch ( c?.bonusMode ) {
    case "prof": return "@prof";
    case "ability": return `@abilities.${ab}.mod`;
    case "profAbility": return `@prof + @abilities.${ab}.mod`;
    case "none": return "";
    default: return String(c?.value ?? "").trim();
  }
}

/** Active Effect value for a 2024 Half-ASI (+1, capped at 20). */
export function halfAsiChange(ability) {
  // D&D5e 6.0 documents the `delta <= limit` syntax for capped additions.
  const value = isDnd5e6() ? "1 <= 20" : `max(0, min(1, 20 - @abilities.${ability}.value))`;
  return { key: `system.abilities.${ability}.value`, type: "add", value, priority: 20 };
}

/** `CONFIG.statusEffects` became a keyed object under D&D5e 6 / Foundry 14. */
export function statusEffectList() {
  const s = CONFIG.statusEffects;
  if ( Array.isArray(s) ) return s;
  if ( s && typeof s === "object" ) return Object.entries(s).map(([id, data]) => ({ id, ...data }));
  return [];
}

/* -------------------------------------------- */
/*  Documents & files                           */
/* -------------------------------------------- */

/** Safe async UUID resolution that never throws. */
export async function resolveUuid(uuid) {
  if ( !uuid ) return null;
  try {
    const fn = foundry.utils.fromUuid ?? globalThis.fromUuid;
    return await fn(uuid);
  } catch {
    return null;
  }
}

/** Safe synchronous UUID resolution (index entries for compendium documents). */
export function resolveUuidSync(uuid) {
  if ( !uuid ) return null;
  try {
    const fn = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    return fn?.(uuid, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

/** Download a JSON payload as a file. */
export function downloadJSON(data, filename) {
  const text = JSON.stringify(data, null, 2);
  const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
  if ( typeof save === "function" ) {
    try { return save(text, "application/json", filename); } catch (err) { console.warn(`${MODULE_ID} | saveDataToFile failed, using fallback`, err); }
  }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/** Read a File chosen in an <input type="file"> as text. */
export function readFileText(file) {
  if ( typeof file?.text === "function" ) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Filesystem-safe slug. */
export function slug(text, fallback="items") {
  const s = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return s || fallback;
}

/**
 * Remove the feature list and prerequisite line that Item Builder before 0.8.1 appended to item
 * descriptions (they showed up in chat cards). Anything the GM wrote is kept.
 */
export function stripBuilderDescription(html) {
  if ( typeof html !== "string" ) return html;
  return html
    .replace(/<h2[^>]*>\s*Item Builder Features\s*<\/h2>\s*<ul[^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<p[^>]*>\s*<strong>\s*Prerequisite:\s*<\/strong>[\s\S]*?<\/p>/gi, "")
    .replace(/^(\s*<p>\s*<\/p>\s*)+$/i, "")
    .trim();
}

/** How a limited-use count is chosen in the builder. */
export const USES_MODES = {
  unlimited: "Unlimited",
  fixed: "Fixed number",
  prof: "Proficiency bonus",
  ability: "Ability modifier (minimum 1)",
  profAbility: "Proficiency bonus + ability modifier"
};

/**
 * Read a component's uses setting, including components saved before the selection existed
 * (a free-text `uses` formula).
 * @returns {{mode: string, count: string, ability: string}}
 */
export function usesSetting(c) {
  if ( c?.usesMode && USES_MODES[c.usesMode] ) {
    return { mode: c.usesMode, count: String(c.usesCount ?? "1"), ability: c.usesAbility || "cha" };
  }
  const raw = String(c?.uses ?? "").trim();
  if ( !raw ) return { mode: "unlimited", count: "1", ability: c?.usesAbility || "cha" };
  if ( raw === "@prof" ) return { mode: "prof", count: "1", ability: "cha" };
  const m = raw.match(/^(?:max\(\s*1\s*,\s*)?@abilities\.(\w+)\.mod\s*\)?$/);
  if ( m ) return { mode: "ability", count: "1", ability: m[1] };
  return { mode: "fixed", count: raw, ability: "cha" };
}

/** The D&D5e uses formula for a component, or "" for unlimited. */
export function usesFormula(c) {
  const { mode, count, ability } = usesSetting(c);
  switch ( mode ) {
    case "fixed": return String(count || "1");
    case "prof": return "@prof";
    case "ability": return `max(1, @abilities.${ability}.mod)`;
    case "profAbility": return `max(1, @prof + @abilities.${ability}.mod)`;
    default: return "";
  }
}

/** Short label for a component's uses, e.g. "Proficiency bonus" or "Charisma modifier". */
export function usesLabel(c, abilityLabel=k => k) {
  const { mode, count, ability } = usesSetting(c);
  if ( mode === "fixed" ) return String(count || "1");
  if ( mode === "prof" ) return "proficiency bonus";
  if ( mode === "ability" ) return `${abilityLabel(ability)} modifier`;
  if ( mode === "profAbility" ) return `proficiency bonus + ${abilityLabel(ability)} modifier`;
  return "";
}

/**
 * Update that marks an item Magical when it requires attunement but lacks the property
 * (D&D5e drops attunement from non-magical items), or null when nothing is needed.
 */
export function magicalPropertyUpdate(item) {
  const src = item?._source?.system ?? {};
  if ( !src.attunement || !item?.system?.validProperties?.has?.("mgc") ) return null;
  const props = src.properties ?? [];
  const list = Array.isArray(props) ? props : (props instanceof Set) ? [...props] : Object.keys(props ?? {}).filter(k => props[k]);
  if ( list.includes("mgc") ) return null;
  return { "system.properties": [...list, "mgc"] };
}

/**
 * The item's rarity at a tier: the Basics rarity, raised by the most recent tier (up to and
 * including `tier`) that sets one. Tiers left on "no change" keep the rarity they inherit.
 */
export function rarityForTier(baseRarity, tiers=[], tier=1) {
  let rarity = baseRarity ?? "";
  for ( let i = 1; i < Math.min(Number(tier) || 1, tiers.length); i++ ) {
    if ( tiers[i]?.rarity ) rarity = tiers[i].rarity;
  }
  return rarity;
}
