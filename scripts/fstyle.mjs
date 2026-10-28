/**
 * Fighting Styles granted by an item or feat: either one the GM picks, or one the player chooses
 * from a list.
 *
 * On a tier-1 feat this is written as D&D5e advancement (Item Grant for the GM's pick, Item Choice
 * for the player's), so D&D5e adds the style when the feat is dropped on a character. Otherwise
 * (magic items, higher tiers, or a feat added without the advancement flow) Item Builder adds it:
 * the GM's pick is granted directly, and the player is asked to choose.
 */
import { MODULE_ID } from "./compat.mjs";
import { advancementObject } from "./asi.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Is this Fighting Style component written as native advancement? */
export function fightingStyleIsNative(c, itemType) {
  return c?.type === "fightingStyle" && itemType === "feat" && (Number(c.tier) || 1) <= 1;
}

/** The pool a player chooses from: the GM's list, or every Fighting Style found. */
export function fightingStylePool(c, allStyles=[]) {
  return (c.poolUuids?.length ? c.poolUuids : allStyles.map(s => s.uuid)).filter(Boolean);
}

/** Advancement data for one Fighting Style component. */
export function fightingStyleAdvancement(c, id, allStyles=[], existing=null) {
  const same = existing && existing.type === (c.mode === "gm" ? "ItemGrant" : "ItemChoice");
  if ( c.mode === "gm" ) {
    return {
      _id: id, type: "ItemGrant", level: 0, title: c.name || "Fighting Style", hint: "",
      configuration: { items: c.styleUuid ? [{ uuid: c.styleUuid, optional: false }] : [], optional: false },
      value: same ? (existing.value ?? {}) : {}
    };
  }
  return {
    _id: id, type: "ItemChoice", level: 0, title: c.name || "Fighting Style", hint: "Choose a Fighting Style.",
    configuration: {
      allowDrops: false,
      choices: { 0: { count: 1, replacement: false } },
      pool: fightingStylePool(c, allStyles).map(uuid => ({ uuid })),
      restriction: { type: "feat", subtype: "fightingStyle" },
      type: "feat"
    },
    value: same ? (existing.value ?? {}) : {}
  };
}

/** Write native advancement for the item's Fighting Style components (feats, tier 1). */
export function applyFightingStyleAdvancement(data, components, allStyles, randomId) {
  data.system ??= {};
  const adv = advancementObject(data.system.advancement);
  const prev = { ...(data.flags?.[MODULE_ID]?.nativeStyleIds ?? {}) };
  const next = {};
  for ( const c of components ) {
    if ( !fightingStyleIsNative(c, data.type) ) continue;
    const id = prev[c.id] && (prev[c.id] in adv) ? prev[c.id] : (prev[c.id] || randomId());
    adv[id] = fightingStyleAdvancement(c, id, allStyles, adv[id]);
    next[c.id] = id;
  }
  const removed = Object.values(prev).filter(id => !Object.values(next).includes(id) && (id in adv));
  for ( const id of removed ) delete adv[id];
  data.system.advancement = adv;
  return { ids: next, removed };
}

/** Did D&D5e's advancement already add a style for this component? */
function advancementGranted(item, c) {
  const id = item.flags?.[MODULE_ID]?.nativeStyleIds?.[c.id];
  if ( !id ) return false;
  const a = advancementObject(item._source?.system?.advancement)[id];
  const added = a?.value?.added;
  if ( !added ) return false;
  // ItemGrant: { itemId: uuid }; ItemChoice: { level: { itemId: uuid } }.
  return Object.values(added).some(v => typeof v === "string" || Object.keys(v ?? {}).length);
}

/** Styles this item already granted through Item Builder. */
function grantedBy(item, c) {
  return [...(item.parent?.items ?? [])].filter(i => i.getFlag?.(MODULE_ID, "grantedBy") === `${item.id}.${c.id}`);
}

async function grant(item, c, uuid) {
  const src = await fromUuid(uuid);
  if ( !src ) return ui.notifications?.warn(`${item.name}: the Fighting Style could not be found.`);
  const actor = item.parent;
  if ( actor.items.some(i => i.name === src.name && i.type === src.type) ) {
    return ui.notifications?.info(`${actor.name} already has ${src.name}.`);
  }
  const data = src.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.grantedBy`, `${item.id}.${c.id}`);
  foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);
  await actor.createEmbeddedDocuments("Item", [data]);
  ui.notifications?.info(`${actor.name} gains the ${src.name} Fighting Style from ${item.name}.`);
}

async function choose(item, c, allStyles) {
  const pool = fightingStylePool(c, allStyles);
  if ( !pool.length ) return ui.notifications?.warn(`${item.name}: no Fighting Styles to choose from.`);
  const names = await Promise.all(pool.map(async u => [u, (await fromUuid(u))?.name ?? u]));
  const owned = new Set([...(item.parent?.items ?? [])].map(i => i.name));
  const options = names.filter(([, n]) => !owned.has(n)).map(([u, n]) => `<option value="${esc(u)}">${esc(n)}</option>`).join("");
  if ( !options ) return ui.notifications?.info(`${item.parent.name} already has every Fighting Style on offer.`);
  const picked = await DialogV2.prompt({
    window: { title: `${item.name}: Choose a Fighting Style` },
    content: `<form><div class="form-group"><label>Fighting Style</label><select name="style">${options}</select></div></form>`,
    ok: { label: "Choose", callback: (_e, button) => button.form.elements.style.value }
  });
  if ( picked ) await grant(item, c, picked);
}

/**
 * Grant the item's Fighting Styles that native advancement did not handle (owned items only).
 * GM picks are added directly; player choices open a picker for the user who triggered it.
 */
export async function syncFightingStyles(item, allStyles=[]) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" || !item.isOwner ) return;
  const tier = Number(item.getFlag(MODULE_ID, "currentTier") ?? 1) || 1;
  for ( const c of item.getFlag(MODULE_ID, "components") ?? [] ) {
    if ( c.type !== "fightingStyle" ) continue;
    const unlocked = (Number(c.tier) || 1) <= tier;
    const mine = grantedBy(item, c);
    if ( !unlocked ) { if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine.map(i => i.id)); continue; }
    if ( mine.length || advancementGranted(item, c) ) continue;
    if ( c.mode === "gm" ) { if ( c.styleUuid ) await grant(item, c, c.styleUuid); }
    else await choose(item, c, allStyles);
  }
}

/** Remove styles Item Builder granted when the granting item leaves the character. */
export async function removeGrantedStyles(item) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const mine = [...actor.items].filter(i => String(i.getFlag?.(MODULE_ID, "grantedBy") ?? "").startsWith(`${item.id}.`));
  if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine.map(i => i.id));
}

/** Every Fighting Style feat in the world's compendiums and Items directory. */
export async function findFightingStyles() {
  const out = new Map();
  const consider = (uuid, e, label) => {
    const sub = foundry.utils.getProperty(e, "system.type.subtype");
    if ( e.type !== "feat" || sub !== "fightingStyle" ) return;
    const key = String(e.name).toLowerCase();
    const prefer = /24/.test(label);
    if ( !out.has(key) || (prefer && !out.get(key).prefer) ) out.set(key, { uuid, name: e.name, label, prefer });
  };
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    let index;
    try { index = await pack.getIndex({ fields: ["type", "system.type"] }); } catch { continue; }
    for ( const e of index ) consider(`Compendium.${pack.collection}.Item.${e._id}`, e, pack.collection);
  }
  for ( const i of game.items ?? [] ) consider(i.uuid, i, "world");
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ uuid, name, label }) => ({ uuid, name, label }));
}

export function registerFightingStyleHooks() {
  let cache = null;
  const styles = async () => (cache ??= await findFightingStyles());
  Hooks.on("createItem", (item, _o, userId) => {
    if ( userId !== game.user.id || item.parent?.documentName !== "Actor" ) return;
    if ( !(item.flags?.[MODULE_ID]?.components ?? []).some(c => c.type === "fightingStyle") ) return;
    setTimeout(async () => { try { await syncFightingStyles(item, await styles()); } catch (err) { console.warn(`${MODULE_ID} | fighting style grant failed`, err); } }, 400);
  });
  Hooks.on("deleteItem", (item, _o, userId) => {
    if ( userId !== game.user.id ) return;
    if ( (item.flags?.[MODULE_ID]?.components ?? []).some(c => c.type === "fightingStyle") ) removeGrantedStyles(item);
  });
  return styles;
}
