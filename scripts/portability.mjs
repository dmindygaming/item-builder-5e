/**
 * Item Builder 5e — portable item export / import.
 *
 * Export writes a single JSON bundle containing:
 *   - full item data (system data, activities, Active Effects, Item Builder flags),
 *   - the folder path each item lived in,
 *   - a copy of every spell the items grant (from components and Cast activities),
 *   - the Foundry / D&D5e versions that produced it.
 *
 * Import accepts that bundle (or a plain Foundry "Export Data" item JSON),
 * re-links granted spells in the destination world, converts Active Effects and
 * data paths between Foundry 13/14 and D&D5e 5.3/6.0, and creates the items in the
 * Items directory or an unlocked Item compendium.
 */

import {
  MODULE_ID, downloadJSON, stripBuilderDescription, isDnd5e6, readFileText, readRarity, resolveUuid, slug, systemVersion,
  withEffectChanges, writeRarity
} from "./compat.mjs";
import { syncRuleEffects } from "./rules.mjs";
import { upgradeHalfAsi } from "./asi.mjs";
import { syncReactions } from "./reactions.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

export const EXPORT_FORMAT = "item-builder-5e.export";
export const EXPORT_FORMAT_VERSION = 1;

const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
const normalizeName = name => String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

/* -------------------------------------------- */
/*  Export                                      */
/* -------------------------------------------- */

/** Names of the folders containing a document, outermost first. */
function folderPath(doc) {
  const out = [];
  let folder = doc?.folder;
  let guard = 0;
  while ( folder && guard++ < 20 ) {
    out.unshift(folder.name);
    folder = folder.folder;
  }
  return out;
}

/** Spell UUIDs referenced by item source data. */
export function referencedSpellUuids(data) {
  const out = new Set();
  for ( const c of data?.flags?.[MODULE_ID]?.components ?? [] ) {
    if ( c?.type === "spell" && c.spellUuid ) out.add(c.spellUuid);
  }
  const activities = data?.system?.activities;
  const list = Array.isArray(activities) ? activities : Object.values(activities ?? {});
  for ( const a of list ) {
    if ( a?.type === "cast" && a.spell?.uuid ) out.add(a.spell.uuid);
  }
  return out;
}

/** Portable copy of a document's source data. */
function portableData(doc) {
  let data;
  try {
    data = doc.toCompendium(null, { clearFolder: true, clearSort: true, clearOwnership: true, clearState: true, keepId: true });
  } catch {
    data = doc.toObject();
    delete data.folder;
    delete data.sort;
    delete data.ownership;
  }
  return data;
}

/**
 * Build an export bundle for a set of items.
 * @param {Item[]} items
 * @param {object} [options]
 * @param {boolean} [options.includeSpells=true]  Embed copies of granted spells.
 * @returns {Promise<object>}
 */
export async function buildExportBundle(items, { includeSpells=true }={}) {
  const entries = [];
  const dependencies = {};
  for ( const item of items ) {
    if ( !(item instanceof Item) ) continue;
    const data = portableData(item);
    entries.push({ sourceUuid: item.uuid, folder: item.pack ? [] : folderPath(item), data });

    for ( const uuid of referencedSpellUuids(data) ) {
      if ( dependencies[uuid] ) continue;
      const spell = await resolveUuid(uuid);
      if ( spell?.type === "spell" ) {
        dependencies[uuid] = {
          kind: "spell",
          name: spell.name,
          img: spell.img,
          sourceUuid: uuid,
          pack: spell.pack ?? null,
          data: includeSpells ? portableData(spell) : null
        };
      } else {
        dependencies[uuid] = { kind: "spell", name: null, sourceUuid: uuid, missing: true, data: null };
      }
    }
  }
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      module: game.modules.get(MODULE_ID)?.version ?? null,
      foundry: game.version,
      system: game.system.id,
      systemVersion: game.system.version,
      world: game.world?.title ?? game.world?.id ?? null
    },
    items: entries,
    dependencies
  };
}

/**
 * Export items and download the bundle.
 * @param {Item[]} items
 * @param {object} [options]
 * @param {string} [options.filename]
 * @param {boolean} [options.includeSpells=true]
 */
export async function exportItemsToFile(items, { filename, includeSpells=true }={}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Item Builder export is GM-only.");
  const list = (items ?? []).filter(i => i instanceof Item);
  if ( !list.length ) return ui.notifications.warn("Item Builder: choose at least one item to export.");
  const bundle = await buildExportBundle(list, { includeSpells });
  const name = filename || (list.length === 1
    ? `${slug(list[0].name, "item")}.ib5e.json`
    : `item-builder-${slug(game.world?.title ?? "world")}-${list.length}-items.ib5e.json`);
  downloadJSON(bundle, name.endsWith(".json") ? name : `${name}.json`);
  const spellCount = Object.values(bundle.dependencies).filter(d => !d.missing).length;
  ui.notifications.info(`Item Builder: exported ${list.length} item${list.length === 1 ? "" : "s"}${spellCount ? ` and ${spellCount} granted spell${spellCount === 1 ? "" : "s"}` : ""}.`);
  return bundle;
}

/* -------------------------------------------- */
/*  Import: parsing & conversion                */
/* -------------------------------------------- */

/**
 * Normalise any supported file into the bundle shape.
 * Accepts Item Builder bundles, a Foundry single-document "Export Data" JSON, or an array of item data.
 */
export function parseImportPayload(json) {
  const isItemData = d => d && typeof d === "object" && typeof d.name === "string" && typeof d.type === "string" && d.system;
  if ( json?.format === EXPORT_FORMAT ) {
    if ( Number(json.formatVersion) > EXPORT_FORMAT_VERSION ) {
      throw new Error("This file was made by a newer Item Builder. Update the module to import it.");
    }
    if ( !Array.isArray(json.items) ) throw new Error("The export file has no items.");
    return { ...json, dependencies: json.dependencies ?? {} };
  }
  const list = Array.isArray(json) ? json : (isItemData(json) ? [json] : null);
  if ( !list || !list.length || !list.every(isItemData) ) {
    throw new Error("This file is not an Item Builder export or a Foundry item export.");
  }
  const sys = list[0]?._stats?.systemId ?? "dnd5e";
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    source: { system: sys, systemVersion: list[0]?._stats?.systemVersion ?? null, foundry: list[0]?._stats?.coreVersion ?? null, world: null, native: true },
    items: list.map(data => ({ data, folder: [], sourceUuid: null })),
    dependencies: {}
  };
}

/**
 * Convert item source data from any supported Foundry / D&D5e version into the
 * format expected by the running versions.
 * @param {object} data  Item source data (mutated copy is returned).
 * @returns {object}
 */
export function convertItemData(data) {
  const out = foundry.utils.deepClone(data);
  out.system ??= {};

  // Rarity: string (5.3) <-> set (6.0).
  if ( ("rarity" in out.system) || ("rarities" in out.system) ) writeRarity(out.system, readRarity(out.system));

  // Active Effects: storage format by Foundry generation, keys by D&D5e version.
  if ( Array.isArray(out.effects) ) {
    out.effects = out.effects.map(effect => {
      const converted = withEffectChanges(effect);
      // Origins point at documents in the exporting world.
      if ( typeof converted.origin === "string" ) converted.origin = null;
      if ( converted.system?.origin && typeof converted.system.origin === "object" ) delete converted.system.origin;
      return converted;
    });
  }

  // Enchantment / activity effect payloads embedded in activities keep their own
  // structure; D&D5e migrates those on load.
  return out;
}

/** Major.minor of a version string, for messaging. */
const majorMinor = v => String(v ?? "").split(".").slice(0, 2).join(".");

/** Human-readable warnings about version differences between the file and this world. */
export function compatibilityNotes(bundle) {
  const notes = [];
  const src = bundle.source ?? {};
  if ( src.system && src.system !== game.system.id ) {
    notes.push({ level: "error", text: `This file was exported from the "${src.system}" system. Item Builder imports only D&D5e items.` });
  }
  if ( src.systemVersion && foundry.utils.isNewerVersion(majorMinor(src.systemVersion), majorMinor(systemVersion())) ) {
    notes.push({ level: "warn", text: `Exported from D&D5e ${src.systemVersion}, which is newer than this world's ${systemVersion()}. Newer system fields may be dropped.` });
  }
  if ( src.systemVersion && majorMinor(src.systemVersion) !== majorMinor(systemVersion()) ) {
    notes.push({ level: "info", text: `Item data will be converted from D&D5e ${src.systemVersion} to ${systemVersion()} (${isDnd5e6() ? "6.x" : "5.x"} data paths).` });
  }
  if ( src.foundry && String(src.foundry).split(".")[0] !== String(game.version).split(".")[0] ) {
    notes.push({ level: "info", text: `Active Effects will be converted from Foundry ${String(src.foundry).split(".")[0]} to Foundry ${String(game.version).split(".")[0]} format.` });
  }
  if ( src.native ) notes.push({ level: "info", text: "This is a plain Foundry item export. Granted spells were not bundled, so spell links are kept only if they exist in this world." });
  return notes;
}

/* -------------------------------------------- */
/*  Import: spell resolution                    */
/* -------------------------------------------- */

/** Rank compendium packs the same way the builder catalog does. */
function packRank(pack) {
  const collection = String(pack.collection ?? "").toLowerCase();
  const packageName = String(pack.metadata?.packageName ?? pack.metadata?.package ?? "").toLowerCase();
  const label = String(pack.metadata?.label ?? pack.title ?? "").toLowerCase();
  let score = 0;
  if ( packageName === "dnd5e" || collection.startsWith("dnd5e.") ) score += 1000;
  if ( collection.includes("24") || label.includes("2024") ) score += 500;
  if ( collection.includes("srd") || label.includes("srd") ) score -= 100;
  if ( label.includes("2014") || collection.includes("2014") ) score -= 150;
  return score;
}

/** Build a name → best spell UUID lookup across the world and all Item compendiums. */
async function buildSpellIndex() {
  const index = new Map();
  const offer = (name, uuid, rank) => {
    const key = normalizeName(name);
    const existing = index.get(key);
    if ( !existing || rank > existing.rank ) index.set(key, { uuid, rank });
  };
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    let entries;
    try { entries = await pack.getIndex({ fields: ["type"] }); } catch { continue; }
    const rank = packRank(pack);
    for ( const e of entries ) if ( e.type === "spell" ) offer(e.name, `Compendium.${pack.collection}.Item.${e._id}`, rank);
  }
  // World spells win ties over nothing but lose to official compendiums.
  for ( const item of game.items.filter(i => i.type === "spell") ) offer(item.name, item.uuid, -500);
  return index;
}

/* -------------------------------------------- */
/*  Import: destination helpers                 */
/* -------------------------------------------- */

async function ensureFolderPath(names, { rootId=null }={}) {
  let parent = rootId;
  for ( const name of names.filter(Boolean) ) {
    let folder = game.folders.find(f => f.type === "Item" && f.name === name && ((f.folder?.id ?? null) === parent));
    if ( !folder ) folder = await Folder.implementation.create({ name, type: "Item", folder: parent });
    parent = folder.id;
  }
  return parent;
}

/** Index of existing items in the destination, keyed by "type|normalized name". */
async function destinationIndex(packId) {
  const map = new Map();
  if ( packId ) {
    const pack = game.packs.get(packId);
    const idx = await pack.getIndex({ fields: ["type"] });
    for ( const e of idx ) map.set(`${e.type}|${normalizeName(e.name)}`, { id: e._id, folder: e.folder ?? null });
  } else {
    for ( const i of game.items ) map.set(`${i.type}|${normalizeName(i.name)}`, { id: i.id, folder: i.folder?.id ?? null });
  }
  return map;
}

async function getDestinationDoc(packId, id) {
  return packId ? game.packs.get(packId)?.getDocument(id) : game.items.get(id);
}

/**
 * Rebuild an imported item's rules for this world's D&D5e version. Rules are rebuilt
 * every time (the exporting world may have used other D&D5e data paths), and
 * feats from before 0.8.0 get their Half-ASI as native D&D5e advancement.
 */
async function upgradeImportedRules(item) {
  try {
    if ( !item?.flags?.[MODULE_ID] ) return;
    if ( (item.getFlag(MODULE_ID, "components") ?? []).some(c => c.type === "conditional") ) await syncRuleEffects(item);
    if ( (Number(item.getFlag(MODULE_ID, "schemaVersion")) || 0) < 10 ) await upgradeHalfAsi(item);
    if ( (item.getFlag(MODULE_ID, "components") ?? []).some(c => c.type === "reaction") ) await syncReactions(item);
    const html = item.system?.description?.value ?? "";
    const clean = stripBuilderDescription(html);
    await item.update({ [`flags.${MODULE_ID}.schemaVersion`]: 11, ...(clean !== html ? { "system.description.value": clean } : {}) });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not rebuild rules on imported ${item?.name}`, err);
  }
}

/* -------------------------------------------- */
/*  Import: main routine                        */
/* -------------------------------------------- */

/**
 * Import a parsed bundle.
 * @param {object} bundle
 * @param {object} options
 * @param {number[]} [options.selected]            Indices of items to import (default: all).
 * @param {string|null} [options.packId]           Destination compendium, or null for the Items directory.
 * @param {"recreate"|"single"|"none"} [options.folderMode="recreate"]
 * @param {string} [options.rootFolder]            Root folder name for world imports.
 * @param {"copy"|"skip"|"replace"} [options.duplicates="copy"]
 * @param {"link"|"copy"} [options.spellMode="link"]
 * @returns {Promise<object>} Summary of what happened.
 */
export async function importBundle(bundle, {
  selected=null, packId=null, folderMode="recreate", rootFolder="", duplicates="copy", spellMode="link"
}={}) {
  if ( !game.user.isGM ) throw new Error("Item Builder import is GM-only.");
  const fatal = compatibilityNotes(bundle).find(n => n.level === "error");
  if ( fatal ) throw new Error(fatal.text);
  const pack = packId ? game.packs.get(packId) : null;
  if ( packId && (!pack || pack.locked || pack.documentName !== "Item") ) throw new Error("Choose an unlocked Item compendium.");

  const summary = { created: [], replaced: [], skipped: [], spellsLinked: 0, spellsCopied: 0, spellsMissing: [], errors: [] };
  const entries = bundle.items.map((e, i) => ({ ...e, index: i })).filter(e => !selected || selected.includes(e.index));
  if ( !entries.length ) return summary;

  // Folders (world destination only).
  let rootId = null;
  const useFolders = !pack && folderMode !== "none";
  if ( useFolders && rootFolder.trim() ) rootId = await ensureFolderPath([rootFolder.trim()]);

  // --- Resolve granted spells ---
  const needed = new Set();
  for ( const e of entries ) for ( const uuid of referencedSpellUuids(e.data) ) needed.add(uuid);
  const spellMap = new Map();
  let spellIndex = null;
  let spellFolderId;
  const sourceWorld = bundle.source?.world ?? null;

  for ( const uuid of needed ) {
    const dep = bundle.dependencies?.[uuid] ?? { name: null, data: null };
    const depName = dep.name ?? dep.data?.name ?? null;

    if ( spellMode === "link" ) {
      // 1. Same UUID resolves here (same compendium installed, or same world).
      const same = await resolveUuid(uuid);
      if ( same?.type === "spell" && (!depName || normalizeName(same.name) === normalizeName(depName)) ) {
        spellMap.set(uuid, uuid); summary.spellsLinked++; continue;
      }
      // 2. A spell with the same name exists in this world's compendiums or Items.
      if ( depName ) {
        spellIndex ??= await buildSpellIndex();
        const hit = spellIndex.get(normalizeName(depName));
        if ( hit ) { spellMap.set(uuid, hit.uuid); summary.spellsLinked++; continue; }
      }
    }

    // 3. Create a local copy from the bundled spell data.
    if ( dep.data ) {
      try {
        // Reuse a copy made by an earlier import of the same spell.
        const reuse = pack
          ? null
          : game.items.find(i => i.type === "spell" && i.getFlag(MODULE_ID, "importedSpell") === uuid);
        if ( reuse ) { spellMap.set(uuid, reuse.uuid); summary.spellsLinked++; continue; }
        const spellData = convertItemData(dep.data);
        delete spellData._id;
        foundry.utils.setProperty(spellData, `flags.${MODULE_ID}.importedSpell`, uuid);
        if ( !pack ) {
          if ( spellFolderId === undefined ) {
            spellFolderId = useFolders ? await ensureFolderPath(["Granted Spells"], { rootId }) : null;
          }
          spellData.folder = spellFolderId;
        }
        const [created] = await Item.implementation.createDocuments([spellData], pack ? { pack: pack.collection } : {});
        spellMap.set(uuid, created.uuid);
        summary.spellsCopied++;
        continue;
      } catch (err) {
        console.error(`${MODULE_ID} | could not import spell ${depName}`, err);
        summary.errors.push(`Spell "${depName ?? uuid}": ${err.message}`);
      }
    }
    summary.spellsMissing.push(depName ?? uuid);
  }

  // --- Items ---
  const existing = duplicates === "copy" ? null : await destinationIndex(pack?.collection ?? null);
  const folderCache = new Map();

  for ( const entry of entries ) {
    const name = entry.data?.name ?? "Unnamed Item";
    try {
      const data = convertItemData(entry.data);
      delete data._id;
      delete data._stats;
      data.ownership = { default: 0 };

      // Re-link granted spells.
      const remap = uuid => spellMap.get(uuid) ?? uuid;
      for ( const c of data.flags?.[MODULE_ID]?.components ?? [] ) {
        if ( c?.type === "spell" && c.spellUuid ) c.spellUuid = remap(c.spellUuid);
      }
      for ( const a of Object.values(data.system?.activities ?? {}) ) {
        if ( a?.type === "cast" && a.spell?.uuid ) a.spell.uuid = remap(a.spell.uuid);
      }
      if ( data.flags?.[MODULE_ID] ) {
        data.flags[MODULE_ID].importedFrom = { world: sourceWorld, uuid: entry.sourceUuid ?? null, at: new Date().toISOString() };
      }

      // Folder.
      if ( !pack ) {
        if ( !useFolders ) data.folder = null;
        else if ( folderMode === "single" ) data.folder = rootId;
        else {
          const key = (entry.folder ?? []).join("\u0000");
          if ( !folderCache.has(key) ) folderCache.set(key, await ensureFolderPath(entry.folder ?? [], { rootId }));
          data.folder = folderCache.get(key);
        }
      } else delete data.folder;

      // Duplicates.
      const match = existing?.get(`${data.type}|${normalizeName(data.name)}`);
      if ( match && duplicates === "skip" ) { summary.skipped.push(name); continue; }
      if ( match && duplicates === "replace" ) {
        const doc = await getDestinationDoc(pack?.collection ?? null, match.id);
        if ( doc ) {
          // Delete and recreate under the same id so links to the item keep working
          // and stale activities/effects are not merged into the new data.
          if ( !pack ) data.folder = doc.folder?.id ?? data.folder ?? null;
          await doc.delete();
          data._id = match.id;
          const [doc2] = await Item.implementation.createDocuments([data], { keepId: true, ...(pack ? { pack: pack.collection } : {}) });
          await upgradeImportedRules(doc2);
          summary.replaced.push(name);
          continue;
        }
      }

      const [created] = await Item.implementation.createDocuments([data], pack ? { pack: pack.collection } : {});
      await upgradeImportedRules(created);
      summary.created.push(name);
    } catch (err) {
      console.error(`${MODULE_ID} | import failed for ${name}`, err);
      summary.errors.push(`${name}: ${err.message}`);
    }
  }
  return summary;
}

/* -------------------------------------------- */
/*  Applications                                */
/* -------------------------------------------- */

class PortabilityApp extends ApplicationV2 {
  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "ib50-root";
    root.innerHTML = await this._html();
    return root;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }
}

/**
 * Pick world items and download them as a portable bundle.
 */
export class ItemExportApp extends PortabilityApp {
  static DEFAULT_OPTIONS = {
    id: "item-builder-5e-export",
    tag: "form",
    window: { title: "Item Builder: Export Items", icon: "fa-solid fa-file-export", resizable: true },
    position: { width: 560, height: 680 },
    classes: ["item-builder-5e", "ib50-portability"]
  };

  constructor(options={}) {
    super(options);
    this.state = { onlyBuilder: true, includeSpells: true, search: "", selected: new Set(options.selected ?? []) };
  }

  _items() {
    const q = normalizeName(this.state.search);
    return game.items
      .filter(i => !this.state.onlyBuilder || i.flags?.[MODULE_ID])
      .filter(i => !q || normalizeName(i.name).includes(q))
      .sort((a, b) => {
        const fa = folderPath(a).join(" / "), fb = folderPath(b).join(" / ");
        return fa.localeCompare(fb) || a.name.localeCompare(b.name);
      });
  }

  async _html() {
    const items = this._items();
    const groups = new Map();
    for ( const item of items ) {
      const key = folderPath(item).join(" / ") || "(No folder)";
      if ( !groups.has(key) ) groups.set(key, []);
      groups.get(key).push(item);
    }
    const s = this.state;
    const rows = [...groups.entries()].map(([folder, list]) => `
      <fieldset class="ib50-group"><legend><label><input type="checkbox" data-folder-toggle="${esc(folder)}" ${list.every(i => s.selected.has(i.id)) ? "checked" : ""}> <i class="fa-solid fa-folder"></i> ${esc(folder)}</label></legend>
        ${list.map(i => `<label class="ib50-item"><input type="checkbox" data-item="${i.id}" data-folder="${esc(folder)}" ${s.selected.has(i.id) ? "checked" : ""}>
          <img src="${esc(i.img)}" alt=""><span>${esc(i.name)}</span><small>${esc(i.type)}${i.flags?.[MODULE_ID] ? " · Item Builder" : ""}</small></label>`).join("")}
      </fieldset>`).join("");
    return `
      <p class="ib50-intro">Choose items to save as a portable file. Another world with Item Builder can import it and get the same items, effects, activities and progression without rebuilding them.</p>
      <div class="ib50-controls">
        <input type="search" name="search" placeholder="Filter by name…" value="${esc(s.search)}">
        <label><input type="checkbox" name="onlyBuilder" ${s.onlyBuilder ? "checked" : ""}> Only Item Builder items</label>
        <label title="Embeds a copy of each spell the items grant, so they still work in worlds without the same compendiums."><input type="checkbox" name="includeSpells" ${s.includeSpells ? "checked" : ""}> Bundle granted spells</label>
      </div>
      <div class="ib50-list">${rows || `<p class="ib50-empty">No matching world items.</p>`}</div>
      <footer class="ib50-footer">
        <span class="ib50-count">${s.selected.size} selected</span>
        <button type="button" data-select-all>Select all shown</button>
        <button type="button" data-select-none>Clear</button>
        <button type="button" class="primary" data-export ${s.selected.size ? "" : "disabled"}><i class="fa-solid fa-file-export"></i> Export</button>
      </footer>`;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const search = el.querySelector("[name=search]");
    search?.addEventListener("input", foundry.utils.debounce(() => {
      this.state.search = search.value; this.render({ force: true });
    }, 250));
    if ( search && this.state.search ) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    el.querySelector("[name=onlyBuilder]")?.addEventListener("change", e => { this.state.onlyBuilder = e.currentTarget.checked; this.render({ force: true }); });
    el.querySelector("[name=includeSpells]")?.addEventListener("change", e => { this.state.includeSpells = e.currentTarget.checked; });
    el.querySelectorAll("[data-item]").forEach(cb => cb.addEventListener("change", e => {
      const id = e.currentTarget.dataset.item;
      if ( e.currentTarget.checked ) this.state.selected.add(id); else this.state.selected.delete(id);
      this.render({ force: true });
    }));
    el.querySelectorAll("[data-folder-toggle]").forEach(cb => cb.addEventListener("change", e => {
      const folder = e.currentTarget.dataset.folderToggle;
      el.querySelectorAll(`[data-item][data-folder="${CSS.escape(folder)}"]`).forEach(i => {
        if ( e.currentTarget.checked ) this.state.selected.add(i.dataset.item); else this.state.selected.delete(i.dataset.item);
      });
      this.render({ force: true });
    }));
    el.querySelector("[data-select-all]")?.addEventListener("click", e => {
      e.preventDefault(); for ( const i of this._items() ) this.state.selected.add(i.id); this.render({ force: true });
    });
    el.querySelector("[data-select-none]")?.addEventListener("click", e => {
      e.preventDefault(); this.state.selected.clear(); this.render({ force: true });
    });
    el.querySelector("[data-export]")?.addEventListener("click", async e => {
      e.preventDefault();
      const items = [...this.state.selected].map(id => game.items.get(id)).filter(Boolean);
      await exportItemsToFile(items, { includeSpells: this.state.includeSpells });
    });
  }
}

/**
 * Load a bundle file, review it, and import into the Items directory or a compendium.
 */
export class ItemImportApp extends PortabilityApp {
  static DEFAULT_OPTIONS = {
    id: "item-builder-5e-import",
    tag: "form",
    window: { title: "Item Builder: Import Items", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 600, height: 720 },
    classes: ["item-builder-5e", "ib50-portability"]
  };

  constructor(options={}) {
    super(options);
    this.bundle = null;
    this.fileName = "";
    this.error = "";
    this.summary = null;
    this.busy = false;
    this.opts = { packId: "", folderMode: "recreate", rootFolder: "", duplicates: "copy", spellMode: "link", selected: new Set() };
  }

  async _html() {
    const o = this.opts;
    const packs = game.packs.filter(p => p.documentName === "Item" && !p.locked);
    const notes = this.bundle ? compatibilityNotes(this.bundle) : [];
    const hasError = notes.some(n => n.level === "error");
    const deps = Object.values(this.bundle?.dependencies ?? {});

    const filePart = `
      <div class="ib50-file">
        <label class="ib50-file-button"><i class="fa-solid fa-folder-open"></i> Choose export file…
          <input type="file" name="file" accept=".json,application/json" hidden></label>
        <span>${this.fileName ? esc(this.fileName) : "No file chosen"}</span>
      </div>
      ${this.error ? `<p class="ib50-note error"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(this.error)}</p>` : ""}`;

    if ( this.summary ) return `${filePart}${this._summaryHTML()}`;
    if ( !this.bundle ) return `
      <p class="ib50-intro">Import items exported by Item Builder from another world. Plain Foundry “Export Data” item files also work.</p>
      ${filePart}`;

    const src = this.bundle.source ?? {};
    return `
      ${filePart}
      <div class="ib50-source">
        <div><strong>From:</strong> ${esc(src.world ?? "Unknown world")}</div>
        <div><strong>Made with:</strong> Foundry ${esc(src.foundry ?? "?")} · D&D5e ${esc(src.systemVersion ?? "?")}${src.module ? ` · Item Builder ${esc(src.module)}` : ""}</div>
        <div><strong>This world:</strong> Foundry ${esc(game.version)} · D&D5e ${esc(game.system.version)}</div>
      </div>
      ${notes.map(n => `<p class="ib50-note ${n.level}"><i class="fa-solid ${n.level === "error" ? "fa-triangle-exclamation" : n.level === "warn" ? "fa-circle-exclamation" : "fa-circle-info"}"></i> ${esc(n.text)}</p>`).join("")}

      <h3>Items <small>(${o.selected.size} of ${this.bundle.items.length} selected)</small></h3>
      <div class="ib50-list compact">
        ${this.bundle.items.map((e, i) => `<label class="ib50-item"><input type="checkbox" data-index="${i}" ${o.selected.has(i) ? "checked" : ""}>
          <img src="${esc(e.data?.img ?? "icons/svg/item-bag.svg")}" alt=""><span>${esc(e.data?.name)}</span>
          <small>${esc(e.data?.type)}${e.folder?.length ? ` · ${esc(e.folder.join(" / "))}` : ""}</small></label>`).join("")}
      </div>
      ${deps.length ? `<p class="ib50-hint"><i class="fa-solid fa-wand-sparkles"></i> Grants ${deps.length} spell${deps.length === 1 ? "" : "s"}: ${deps.map(d => esc(d.name ?? "unknown")).join(", ")}</p>` : ""}

      <div class="ib50-options">
        <label>Import into
          <select name="packId">
            <option value="" ${!o.packId ? "selected" : ""}>Items directory (this world)</option>
            ${packs.map(p => `<option value="${esc(p.collection)}" ${o.packId === p.collection ? "selected" : ""}>Compendium: ${esc(p.metadata?.label ?? p.title ?? p.collection)}</option>`).join("")}
          </select></label>
        ${o.packId ? "" : `
        <label>Folders
          <select name="folderMode">
            <option value="recreate" ${o.folderMode === "recreate" ? "selected" : ""}>Recreate the exported folders</option>
            <option value="single" ${o.folderMode === "single" ? "selected" : ""}>Put everything in one folder</option>
            <option value="none" ${o.folderMode === "none" ? "selected" : ""}>No folders</option>
          </select></label>
        ${o.folderMode === "none" ? "" : `<label>Inside folder <input name="rootFolder" value="${esc(o.rootFolder)}" placeholder="Leave blank for top level"></label>`}`}
        <label>If an item with the same name already exists
          <select name="duplicates">
            <option value="copy" ${o.duplicates === "copy" ? "selected" : ""}>Import a new copy anyway</option>
            <option value="skip" ${o.duplicates === "skip" ? "selected" : ""}>Skip it</option>
            <option value="replace" ${o.duplicates === "replace" ? "selected" : ""}>Replace the existing item</option>
          </select></label>
        <label>Granted spells
          <select name="spellMode">
            <option value="link" ${o.spellMode === "link" ? "selected" : ""}>Use this world's matching spells; copy only what's missing (recommended)</option>
            <option value="copy" ${o.spellMode === "copy" ? "selected" : ""}>Always import the bundled spell copies</option>
          </select></label>
      </div>
      <footer class="ib50-footer">
        <button type="button" class="primary" data-import ${hasError || !o.selected.size || this.busy ? "disabled" : ""}>
          <i class="fa-solid ${this.busy ? "fa-spinner fa-spin" : "fa-file-import"}"></i> ${this.busy ? "Importing…" : `Import ${o.selected.size} Item${o.selected.size === 1 ? "" : "s"}`}</button>
      </footer>`;
  }

  _summaryHTML() {
    const s = this.summary;
    const list = (title, arr, icon) => arr.length ? `<h4><i class="fa-solid ${icon}"></i> ${title} (${arr.length})</h4><ul>${arr.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
    return `
      <div class="ib50-summary">
        <h3><i class="fa-solid fa-circle-check"></i> Import finished</h3>
        ${list("Created", s.created, "fa-plus")}
        ${list("Replaced", s.replaced, "fa-rotate")}
        ${list("Skipped (already existed)", s.skipped, "fa-forward")}
        <p>Granted spells: ${s.spellsLinked} linked to this world's spells, ${s.spellsCopied} imported as copies.</p>
        ${list("Spells that could not be found", s.spellsMissing, "fa-triangle-exclamation")}
        ${list("Errors", s.errors, "fa-bug")}
      </div>
      <footer class="ib50-footer"><button type="button" data-reset>Import another file</button><button type="button" class="primary" data-close>Done</button></footer>`;
  }

  _capture() {
    const el = this.element;
    const v = n => el.querySelector(`[name="${n}"]`)?.value;
    for ( const key of ["packId", "folderMode", "rootFolder", "duplicates", "spellMode"] ) {
      const value = v(key);
      if ( value !== undefined ) this.opts[key] = value;
    }
  }

  async _loadFile(file) {
    this.error = ""; this.summary = null; this.bundle = null; this.fileName = file?.name ?? "";
    try {
      const text = await readFileText(file);
      const bundle = parseImportPayload(JSON.parse(text));
      this.bundle = bundle;
      this.opts.selected = new Set(bundle.items.map((_, i) => i));
      if ( !this.opts.rootFolder && bundle.source?.world ) this.opts.rootFolder = `Imported from ${bundle.source.world}`;
    } catch (err) {
      this.error = err instanceof SyntaxError ? "That file is not valid JSON." : err.message;
    }
    this.render({ force: true });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.querySelector("[name=file]")?.addEventListener("change", e => {
      const file = e.currentTarget.files?.[0];
      if ( file ) void this._loadFile(file);
    });
    for ( const name of ["packId", "folderMode"] ) {
      el.querySelector(`[name=${name}]`)?.addEventListener("change", () => { this._capture(); this.render({ force: true }); });
    }
    for ( const name of ["rootFolder", "duplicates", "spellMode"] ) {
      el.querySelector(`[name=${name}]`)?.addEventListener("change", () => this._capture());
    }
    el.querySelectorAll("[data-index]").forEach(cb => cb.addEventListener("change", e => {
      this._capture();
      const i = Number(e.currentTarget.dataset.index);
      if ( e.currentTarget.checked ) this.opts.selected.add(i); else this.opts.selected.delete(i);
      this.render({ force: true });
    }));
    el.querySelector("[data-reset]")?.addEventListener("click", e => {
      e.preventDefault(); this.summary = null; this.bundle = null; this.fileName = ""; this.render({ force: true });
    });
    el.querySelector("[data-close]")?.addEventListener("click", e => { e.preventDefault(); this.close(); });
    el.querySelector("[data-import]")?.addEventListener("click", async e => {
      e.preventDefault();
      if ( this.busy ) return;
      this._capture();
      if ( this.opts.duplicates === "replace" ) {
        const ok = await DialogV2.confirm({
          window: { title: "Replace existing items?" },
          content: "<p>Items with the same name and type will be <strong>deleted and recreated</strong> from the file. Copies already on actors are not changed.</p>"
        });
        if ( !ok ) return;
      }
      this.busy = true; this.render({ force: true });
      try {
        this.summary = await importBundle(this.bundle, {
          selected: [...this.opts.selected],
          packId: this.opts.packId || null,
          folderMode: this.opts.folderMode,
          rootFolder: this.opts.rootFolder ?? "",
          duplicates: this.opts.duplicates,
          spellMode: this.opts.spellMode
        });
        const n = this.summary.created.length + this.summary.replaced.length;
        ui.notifications.info(`Item Builder: imported ${n} item${n === 1 ? "" : "s"}.`);
      } catch (err) {
        console.error(`${MODULE_ID} | import failed`, err);
        this.error = err.message;
      }
      this.busy = false;
      this.render({ force: true });
    });
  }
}
