/**
 * Feats: granting a feat from an item, and keeping builder feats in a compendium players can see.
 *
 * Feat component
 *   An item or feat grants a feat: one the GM picks, or one the player chooses (any Origin /
 *   General / Fighting Style / Epic Boon feat, any feat, or only the feats the GM lists).
 *   On a tier-1 feat it is written as D&D5e advancement (Item Grant / Item Choice), so D&D5e adds
 *   it when the feat is dropped on a character. On other items, or at higher tiers, Item Builder
 *   adds it while the item is active (owned, equipped or attuned, per Active While) and removes
 *   it again when it isn't. A player's pick is remembered, so re-equipping gives the same feat.
 *
 * Character Options compendium
 *   Feats and backgrounds made with the builder are copied into the world compendium "Item Builder
 *   Character Options", which players can see. D&D5e's level-up feat browser (and its compendium
 *   browser) only list compendium items, so this is what makes them available when a character
 *   gains a feat or picks a background. The Items-sidebar feat stays the one you
 *   edit; the compendium copy is refreshed every time it is saved or tiered.
 */
import { MODULE_ID } from "./compat.mjs";
import { advancementObject } from "./asi.mjs";
import { enhanceSearchableSelects } from "./combo.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const FEAT_PACK_NAME = "item-builder-character-options";
export const FEAT_PACK_LABEL = "Item Builder Character Options";
export const FEAT_POOLS = {
  origin: "Any Origin feat",
  general: "Any General feat",
  fightingStyle: "Any Fighting Style feat",
  epicBoon: "Any Epic Boon feat",
  any: "Any feat",
  list: "Only the feats I list"
};
export const FEAT_SUBTYPES = { origin: "Origin", general: "General", fightingStyle: "Fighting Style", epicBoon: "Epic Boon" };

/* -------------------------------------------- */
/*  Catalog                                     */
/* -------------------------------------------- */

/** Every feat (Feat type "feat", not class features) in visible compendiums and the Items directory. */
export async function findFeats() {
  const out = new Map();
  const consider = (uuid, e, label) => {
    if ( e.type !== "feat" ) return;
    const type = foundry.utils.getProperty(e, "system.type") ?? {};
    if ( type.value !== "feat" ) return;
    const key = String(e.name).toLowerCase();
    const prefer = /24/.test(label);
    const entry = { uuid, name: e.name, subtype: type.subtype ?? "", level: Number(foundry.utils.getProperty(e, "system.prerequisites.level")) || 0, label, prefer };
    const cur = out.get(key);
    // Prefer the 2024 rules, then compendium copies over sidebar copies.
    if ( !cur || (prefer && !cur.prefer) || (cur.label === "world" && label !== "world") ) out.set(key, entry);
  };
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    let index;
    try { index = await pack.getIndex({ fields: ["type", "system.type", "system.prerequisites.level"] }); } catch { continue; }
    for ( const e of index ) consider(`Compendium.${pack.collection}.Item.${e._id}`, e, pack.collection);
  }
  for ( const i of game.items ?? [] ) consider(i.uuid, i, "world");
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ prefer, ...e }) => e);
}

/** Feats a player may choose from for this component. */
export function featPool(c, allFeats=[]) {
  const type = c.poolType || "any";
  if ( type === "list" ) return (c.poolUuids ?? []).filter(Boolean);
  return allFeats.filter(f => type === "any" || f.subtype === type).map(f => f.uuid);
}

/* -------------------------------------------- */
/*  Native advancement (tier-1 feats)           */
/* -------------------------------------------- */

export function featGrantIsNative(c, itemType) {
  return c?.type === "grantFeat" && itemType === "feat" && (Number(c.tier) || 1) <= 1;
}

export function featAdvancement(c, id, allFeats=[], existing=null) {
  const wanted = c.mode === "gm" ? "ItemGrant" : "ItemChoice";
  const value = existing?.type === wanted ? (existing.value ?? {}) : {};
  if ( c.mode === "gm" ) {
    return {
      _id: id, type: "ItemGrant", level: 0, title: c.name || "Feat", hint: "",
      configuration: { items: c.featUuid ? [{ uuid: c.featUuid, optional: false }] : [], optional: false }, value
    };
  }
  const type = c.poolType || "any";
  return {
    _id: id, type: "ItemChoice", level: 0, title: c.name || "Feat", hint: "Choose a feat.",
    configuration: {
      allowDrops: type !== "list",
      choices: { 0: { count: 1, replacement: false } },
      pool: featPool(c, allFeats).map(uuid => ({ uuid })),
      restriction: { type: "feat", subtype: FEAT_SUBTYPES[type] ? type : "" },
      type: "feat"
    },
    value
  };
}

/** Write native advancement for the item's Feat components (feats, tier 1). */
export function applyFeatAdvancement(data, components, allFeats, randomId) {
  data.system ??= {};
  const adv = advancementObject(data.system.advancement);
  const prev = { ...(data.flags?.[MODULE_ID]?.nativeFeatIds ?? {}) };
  const next = {};
  for ( const c of components ) {
    if ( !featGrantIsNative(c, data.type) ) continue;
    const id = prev[c.id] && (prev[c.id] in adv) ? prev[c.id] : (prev[c.id] || randomId());
    adv[id] = featAdvancement(c, id, allFeats, adv[id]);
    next[c.id] = id;
  }
  const removed = Object.values(prev).filter(id => !Object.values(next).includes(id) && (id in adv));
  for ( const id of removed ) delete adv[id];
  data.system.advancement = adv;
  return { ids: next, removed };
}

/* -------------------------------------------- */
/*  Granting on owned items                     */
/* -------------------------------------------- */

/** Is the item "active" for this component (owned / equipped / attuned)? */
export function grantActive(item, c) {
  const sys = item?.system ?? {};
  if ( item?.type === "feat" ) return true;
  const mode = c.activation || "equipped";
  if ( mode === "always" ) return true;
  const equipped = !("equipped" in sys) || !!sys.equipped;
  if ( mode === "equipped" ) return equipped;
  // "Attuned": the item must be attuned if it can be (attunement required or optional).
  const canAttune = !!sys.attunement;
  return equipped && (!canAttune || !!sys.attuned);
}

function advancementGranted(item, c) {
  const id = item.flags?.[MODULE_ID]?.nativeFeatIds?.[c.id];
  if ( !id ) return false;
  const added = advancementObject(item._source?.system?.advancement)[id]?.value?.added;
  return !!added && Object.values(added).some(v => typeof v === "string" || Object.keys(v ?? {}).length);
}

const tag = (item, c) => `${item.id}.${c.id}`;
const grantedFor = (item, c) => [...(item.parent?.items ?? [])].filter(i => i.getFlag?.(MODULE_ID, "grantedFeat") === tag(item, c));

async function grantFeat(item, c, uuid) {
  const src = await fromUuid(uuid);
  if ( !src ) return ui.notifications?.warn(`${item.name}: the feat could not be found.`);
  const actor = item.parent;
  if ( actor.items.some(i => i.name === src.name && i.type === "feat" && !i.getFlag?.(MODULE_ID, "grantedFeat")) ) {
    return ui.notifications?.info(`${actor.name} already has ${src.name}.`);
  }
  const data = src.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.grantedFeat`, tag(item, c));
  foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);
  await actor.createEmbeddedDocuments("Item", [data]);
  ui.notifications?.info(`${actor.name} gains the ${src.name} feat from ${item.name}.`);
}

/** Ask the user to pick a feat; resolves to a UUID or null. */
async function chooseFeat(item, c, allFeats) {
  const actor = item.parent;
  const level = Number(actor?.system?.details?.level) || 0;
  const byUuid = new Map(allFeats.map(f => [f.uuid, f]));
  const owned = new Set([...(actor?.items ?? [])].map(i => i.name));
  const options = [];
  for ( const uuid of featPool(c, allFeats) ) {
    const f = byUuid.get(uuid) ?? { uuid, name: (await fromUuid(uuid))?.name ?? uuid, level: 0 };
    if ( owned.has(f.name) ) continue;
    if ( level && f.level && f.level > level ) continue;
    options.push(`<option value="${esc(uuid)}">${esc(f.name)}${f.level ? ` (level ${f.level}+)` : ""}</option>`);
  }
  if ( !options.length ) { ui.notifications?.info(`${actor.name} has no feats left to choose from ${item.name}.`); return null; }
  return DialogV2.prompt({
    window: { title: `${item.name}: Choose a Feat` },
    content: `<form><div class="form-group"><label>Feat</label><select name="feat" data-searchable="Search feats…">${options.join("")}</select></div></form>`,
    ok: { label: "Choose", callback: (_e, button) => button.form.elements.feat.value },
    render: (_e, dialog) => { try { enhanceSearchableSelects(dialog.element ?? dialog); } catch { /* plain list */ } },
    rejectClose: false
  });
}

/**
 * Make the feats an owned item grants match its Feat components, tier and active state.
 * GM picks are added directly; the player is asked once for a choice, which is then remembered.
 */
export async function syncFeatGrants(item, allFeats=[]) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" || !item.isOwner ) return;
  const tier = Number(item.getFlag(MODULE_ID, "currentTier") ?? 1) || 1;
  for ( const c of item.getFlag(MODULE_ID, "components") ?? [] ) {
    if ( c.type !== "grantFeat" ) continue;
    const mine = grantedFor(item, c);
    const want = (Number(c.tier) || 1) <= tier && grantActive(item, c);
    if ( !want ) { if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine.map(i => i.id)); continue; }
    if ( mine.length || advancementGranted(item, c) ) continue;
    let uuid = c.mode === "gm" ? c.featUuid : item.getFlag(MODULE_ID, `featChoices.${c.id}`);
    if ( !uuid && c.mode !== "gm" ) {
      uuid = await chooseFeat(item, c, allFeats);
      if ( uuid ) await item.setFlag(MODULE_ID, `featChoices.${c.id}`, uuid);
    }
    if ( uuid ) await grantFeat(item, c, uuid);
  }
}

export async function removeGrantedFeats(item) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const mine = [...actor.items].filter(i => String(i.getFlag?.(MODULE_ID, "grantedFeat") ?? "").startsWith(`${item.id}.`));
  if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine.map(i => i.id));
}

/* -------------------------------------------- */
/*  Feat compendium                             */
/* -------------------------------------------- */

const packCollection = () => `world.${FEAT_PACK_NAME}`;

/** The player-visible compendium for builder feats, created on first use (GM only). */
export async function featPack({ create=true }={}) {
  let pack = game.packs.get(packCollection());
  if ( pack || !create || !game.user?.isGM ) return pack ?? null;
  const Compendium = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
  pack = await Compendium.createCompendium({
    name: FEAT_PACK_NAME, label: FEAT_PACK_LABEL, type: "Item",
    ownership: { PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER" }
  });
  ui.notifications?.info(`Item Builder: created the "${FEAT_PACK_LABEL}" compendium so players can pick your feats.`);
  return pack;
}

/** Should this item have a copy in the Character Options compendium? (Builder feats and backgrounds.) */
export function publishesToPack(item) {
  if ( !item || item.documentName !== "Item" || item.pack || item.parent || !item.flags?.[MODULE_ID]?.components ) return false;
  return item.type === "background" || (item.type === "feat" && item.system?.type?.value === "feat");
}

/** Copy (or refresh) a builder feat in the feat compendium. Returns the compendium copy. */
export async function publishFeat(item) {
  if ( !publishesToPack(item) || !game.user?.isGM ) return null;
  try {
    const pack = await featPack();
    if ( !pack ) return null;
    if ( pack.locked ) await pack.configure({ locked: false });
    const data = item.toObject();
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.mirrorOf`, item.uuid);
    delete data.folder;
    delete data.ownership;
    const existing = await pack.getDocument(item.id);
    // Replace the copy outright so its effects, activities and advancement match exactly.
    if ( existing ) await existing.delete();
    const Doc = CONFIG.Item.documentClass;
    return await Doc.create(data, { pack: pack.collection, keepId: true });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not copy ${item.name} to the Character Options compendium`, err);
    ui.notifications?.warn(`Item Builder: "${item.name}" could not be copied to the ${FEAT_PACK_LABEL} compendium (${err.message}).`);
    return null;
  }
}

/** Copy builder feats made before the compendium existed (GM, once per world). */
export async function publishExistingFeats() {
  if ( !game.user?.isGM || game.users?.activeGM?.id !== game.user.id ) return;
  const feats = (game.items ?? []).filter(publishesToPack);
  if ( !feats.length ) return;
  const pack = await featPack();
  if ( !pack ) return;
  const index = await pack.getIndex();
  for ( const item of feats ) if ( !index.has(item.id) ) await publishFeat(item);
}

/** The editable sidebar feat for a compendium copy, if it still exists. */
export function sourceOfCopy(item) {
  const src = item?.pack ? item.getFlag?.(MODULE_ID, "mirrorOf") : null;
  return src ? fromUuidSync(src) ?? null : null;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const hasGrants = item => (item?.flags?.[MODULE_ID]?.components ?? []).some(c => c.type === "grantFeat");

export function registerFeatHooks() {
  let cache = null;
  const feats = async () => (cache ??= await findFeats());
  const refresh = () => { cache = null; };
  const run = item => setTimeout(async () => {
    try { await syncFeatGrants(item, await feats()); } catch (err) { console.warn(`${MODULE_ID} | feat grant failed`, err); }
  }, 450);
  Hooks.on("createItem", (item, _o, userId) => {
    if ( item.type === "feat" && !item.parent ) refresh();
    if ( userId === game.user.id && item.parent?.documentName === "Actor" && hasGrants(item) ) run(item);
  });
  Hooks.on("updateItem", (item, change, _o, userId) => {
    if ( userId !== game.user.id || item.parent?.documentName !== "Actor" || !hasGrants(item) ) return;
    const sys = change.system ?? {};
    if ( "equipped" in sys || "attuned" in sys || "attunement" in sys || foundry.utils.hasProperty(change, `flags.${MODULE_ID}.currentTier`) ) run(item);
  });
  Hooks.on("deleteItem", (item, _o, userId) => {
    if ( item.type === "feat" && !item.parent ) refresh();
    if ( userId === game.user.id && hasGrants(item) ) removeGrantedFeats(item);
  });
  Hooks.once("ready", () => { publishExistingFeats().catch(err => console.warn(`${MODULE_ID} | feat compendium sync failed`, err)); });
  return { feats, refresh };
}
