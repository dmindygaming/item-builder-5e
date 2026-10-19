/**
 * Native 2024 Half-ASI support.
 *
 * A Half-ASI on a tier-1 feat is written as a D&D5e AbilityScoreImprovement
 * advancement, so D&D5e's own advancement flow asks for (or applies) the +1
 * when the feat is added to a character, with or without Item Builder.
 * Higher-tier Half-ASIs (which advancement cannot gate) and feats added
 * without the advancement flow fall back to Item Builder's Active Effect.
 */
import { MODULE_ID } from "./compat.mjs";

/** Is this Half-ASI component written as native D&D5e advancement? */
export function halfAsiIsNative(c, itemType) {
  return c?.type === "halfAsi" && itemType === "feat" && (Number(c.tier) || 1) <= 1;
}

/** Build the AbilityScoreImprovement advancement for one Half-ASI component. */
export function halfAsiAdvancement(c, abilityKeys, id, existing=null) {
  const fixed = Object.fromEntries(abilityKeys.map(k => [k, 0]));
  let points = 1;
  let locked = [];
  if ( c.selectionMode === "fixed" ) {
    if ( c.ability in fixed ) fixed[c.ability] = 1;
    points = 0;
    locked = abilityKeys.filter(k => k !== c.ability);
  } else {
    const allowed = c.allowedAbilities?.length ? c.allowedAbilities : abilityKeys;
    locked = abilityKeys.filter(k => !allowed.includes(k));
  }
  const sameShape = existing && (existing.type === "AbilityScoreImprovement");
  return {
    _id: id,
    type: "AbilityScoreImprovement",
    configuration: { cap: 1, fixed, locked, points },
    value: sameShape ? (existing.value ?? {}) : {},
    level: 0,
    title: c.name || "",
    hint: ""
  };
}

/** Normalise stored advancement (array in old data, id-keyed object since D&D5e 3/4). */
export function advancementObject(raw) {
  if ( Array.isArray(raw) ) return Object.fromEntries(raw.filter(a => a?._id).map(a => [a._id, a]));
  return (raw && typeof raw === "object") ? { ...raw } : {};
}

/**
 * Write native advancement for every native Half-ASI into item source data,
 * replacing advancement Item Builder created before and leaving any other
 * advancement alone. Returns the new id map to store in the module flags and
 * the ids of advancement that was removed.
 */
export function applyNativeAsi(data, components, abilityKeys, randomId) {
  data.system ??= {};
  const advancement = advancementObject(data.system.advancement);
  const previous = { ...(data.flags?.[MODULE_ID]?.nativeAsiIds ?? {}) };
  const next = {};
  for ( const c of components ) {
    if ( !halfAsiIsNative(c, data.type) ) continue;
    const id = previous[c.id] && (previous[c.id] in advancement) ? previous[c.id] : (previous[c.id] || randomId());
    advancement[id] = halfAsiAdvancement(c, abilityKeys, id, advancement[id]);
    next[c.id] = id;
  }
  const removed = Object.values(previous).filter(id => !Object.values(next).includes(id) && (id in advancement));
  for ( const id of removed ) delete advancement[id];
  data.system.advancement = advancement;
  return { ids: next, removed };
}

/** Has D&D5e's advancement flow already applied this component's +1 on the owning actor? */
export function halfAsiApplied(item, c) {
  const id = item?.flags?.[MODULE_ID]?.nativeAsiIds?.[c?.id];
  if ( !id ) return false;
  const source = advancementObject(item._source?.system?.advancement ?? item.system?.advancement);
  const value = source[id]?.value ?? item.advancement?.byId?.[id]?.value;
  return !!value && Object.values(value.assignments ?? {}).some(n => Number(n) > 0);
}

/** Is this component handled natively on this item (so no fallback effect or prompt is needed)? */
export function halfAsiHandled(item, c) {
  if ( !halfAsiIsNative(c, item?.type) || !item?.flags?.[MODULE_ID]?.nativeAsiIds?.[c.id] ) return false;
  // On an unowned item, the advancement will run when it is added to a character.
  if ( item.parent?.documentName !== "Actor" ) return true;
  return halfAsiApplied(item, c);
}

/**
 * Bring an unowned feat saved before Item Builder 0.8.0 up to native advancement,
 * removing the Active Effect the advancement replaces. Returns true when changed.
 */
export async function upgradeHalfAsi(item) {
  if ( item?.type !== "feat" || item.parent ) return false;
  const components = item.flags?.[MODULE_ID]?.components ?? [];
  if ( !components.some(c => halfAsiIsNative(c, item.type)) ) return false;
  const data = {
    type: item.type,
    system: { advancement: item.toObject().system?.advancement },
    flags: { [MODULE_ID]: { nativeAsiIds: item.flags?.[MODULE_ID]?.nativeAsiIds ?? {} } }
  };
  const { ids } = applyNativeAsi(data, components, Object.keys(globalThis.CONFIG?.DND5E?.abilities ?? {}),
    () => foundry.utils.randomID());
  await item.update({ "system.advancement": data.system.advancement, [`flags.${MODULE_ID}.nativeAsiIds`]: ids });
  const stale = [...item.effects].filter(e => e.getFlag(MODULE_ID, "halfAsi")
    || (e.getFlag(MODULE_ID, "managed") && ids[e.getFlag(MODULE_ID, "componentId")])).map(e => e.id);
  if ( stale.length ) await item.deleteEmbeddedDocuments("ActiveEffect", stale);
  return true;
}
