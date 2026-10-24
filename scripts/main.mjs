import {
  MODULE_ID, effectChangesUpdate, halfAsiChange, movementKey, normalizeAttunement,
  USES_MODES, magicalPropertyUpdate, readEffectChanges, readRarity, stripBuilderDescription, usesFormula, usesLabel, usesSetting, remapChangeKey, resolveUuid, resolveUuidSync, senseKey, statusEffectList,
  withEffectChanges, writeRarity
} from "./compat.mjs";
import { ItemExportApp, ItemImportApp, exportItemsToFile } from "./portability.mjs";
import { applyNativeAsi, halfAsiHandled, halfAsiIsNative, upgradeHalfAsi } from "./asi.mjs";
import { enhanceSearchableSelects } from "./combo.mjs";
import { ItemBuilderHelp, registerHelpMenu } from "./help.mjs";
import { registerTokenSizeHooks } from "./tokensize.mjs";
import { REACTION_EFFECTS, REACTION_TRIGGERS, reactionSummary, syncReactions } from "./reactions.mjs";
import {
  DAMAGE_RULES, DEFENSIVE_TRIGGERS, FORMULA_RULES, OFFENSIVE_DAMAGE_RULES, ROLL_TARGETS, RULE_CATEGORIES,
  STATUS_TARGETS, handlingLabel, hasAutomationEffect, participantLabels, triggerOptions, match, registerRuleHooks, ruleDiagnostic,
  itemHasOwnUse, ruleFromComponent, sizeAfter, ruleHandling, syncRuleEffects
} from "./rules.mjs";

const MODULE_VERSION = "1.0.1";
const { ApplicationV2, DialogV2 } = foundry.applications.api;

const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
const rid = () => foundry.utils.randomID();
const cfg = (path, fallback={}) => foundry.utils.getProperty(CONFIG.DND5E ?? {}, path) ?? fallback;
const loc = (raw, fallback="") => game.i18n.localize(raw?.label ?? raw ?? fallback) || fallback;

function selectOptions(obj, selected="", blank=true) {
  const out = blank ? ['<option value="">—</option>'] : [];
  for (const [key, raw] of Object.entries(obj ?? {})) {
    out.push(`<option value="${esc(key)}" ${selected===key?"selected":""}>${esc(loc(raw,key))}</option>`);
  }
  return out.join("");
}

function movementOptions(selected="walk") {
  return selectOptions(cfg("movementTypes", {
    walk:"Walk", fly:"Fly", swim:"Swim", climb:"Climb", burrow:"Burrow"
  }), selected, false);
}

function abilityOptions(selected="str", blank=false) {
  return selectOptions(cfg("abilities", {
    str:{label:"Strength"}, dex:{label:"Dexterity"}, con:{label:"Constitution"},
    int:{label:"Intelligence"}, wis:{label:"Wisdom"}, cha:{label:"Charisma"}
  }), selected, blank);
}

function standardDamageOptions(selected="radiant") {
  const allowed = ["acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"];
  const source = cfg("damageTypes",{});
  const filtered = {};
  for (const k of allowed) if (source[k]) filtered[k] = source[k];
  return selectOptions(filtered, selected, false);
}

function conditionOptions(selected="") {
  const choices={};
  for(const condition of statusEffectList()) {
    const id=String(condition.id??condition._id??"").trim();
    if(!id)continue;
    choices[id]=game.i18n.localize(condition.name??condition.label??id)||id;
  }
  if(!Object.keys(choices).length) {
    for(const [id,value] of Object.entries(cfg("conditionTypes",{}))) choices[id]=loc(value,id);
  }
  return `<option value="">Choose a condition…</option>${selectOptions(choices,selected,false)}`;
}

function creatureSubtypeOptions(selected="") {
  const values=new Set(["angel","demon","devil","dinosaur","gith","goblinoid","gnoll","kobold","orc","shapechanger","titan","vampire","yugoloth"]);
  for(const actor of game.actors??[]){const raw=String(actor.system?.details?.type?.subtype??"").trim().toLowerCase();if(raw)values.add(raw);}
  if(selected)values.add(String(selected).trim().toLowerCase());
  const choices=Object.fromEntries([...values].sort((a,b)=>a.localeCompare(b)).map(value=>[value,value.replace(/\b\w/g,c=>c.toUpperCase())]));
  return `<option value="">Any Subtype</option>${selectOptions(choices,String(selected).toLowerCase(),false)}`;
}


/** Which side of a rule is always the item's own user (its creature filters would only ever test the user). */
function selfSide(c){
  if(c.ruleCategory==="healing")return null;
  const p=participantLabels(c);
  if(/item user|effect user/i.test(p.source))return "source";
  if(/item user|effect user/i.test(p.target))return "target";
  return null;
}

function listText(items,joiner="or"){
  if(items.length<2)return items.join("");
  return `${items.slice(0,-1).join(", ")} ${joiner} ${items.at(-1)}`;
}

/** One plain-English sentence describing a rule card, for the builder. */
function ruleSentence(c){
  const f=String(c.formula??"").trim()||"?";
  const dt=c.damageType&&c.damageType!=="any"?loc(cfg("damageTypes",{})[c.damageType],c.damageType).toLowerCase():"";
  const ab=c.ability?loc(cfg("abilities",{})[c.ability],c.ability):"";
  const effect={
    extraDamage:`Deals an extra ${f}${dt?` ${dt}`:""} damage`,
    sameTypeDamage:`Deals an extra ${f} damage when the attack deals ${dt||"the chosen"} damage`,
    attackBonus:`+${f} to attack rolls`,
    attackAdvantage:"Advantage on attack rolls",
    reachBonus:`+${f} ft. reach`,
    resistance:`Resistance to ${dt||"all"} damage`,
    immunity:`Immunity to ${dt||"all"} damage`,
    vulnerability:`Vulnerability to ${dt||"all"} damage`,
    acBonus:`+${f} AC`,
    saveBonus:`+${f} to ${ab?`${ab} `:""}saving throws`,
    saveAdvantage:`Advantage on ${ab?`${ab} `:""}saving throws`,
    bonusHealing:`Healing you do restores ${f} more`,
    healingReceived:`Healing you receive changes by ${f}`,
    temporaryHp:`Grants ${f} temporary hit points`,
    recoveryBonus:`+${f} per Hit Die spent`,
    sizeChange:c.sizeMode==="set"?`Becomes ${loc(cfg("actorSizes",{})[c.size||"lg"],c.size||"lg")} size, with tokens resized to match`:`${Number(c.sizeSteps)<0||c.sizeMode==="shrink"?"Shrinks":"Grows"} ${Math.abs(Number(c.sizeSteps)||1)} size${Math.abs(Number(c.sizeSteps)||1)===1?"":"s"}, with tokens resized to match`,
    movementControl:`${f} ft. ${loc(cfg("movementTypes",{})[c.ability||"walk"],c.ability||"walk").toLowerCase()} speed`,
    advantage:`Advantage on ${(ROLL_TARGETS[c.rollTarget||"attack"]??"rolls").toLowerCase()}`,
    disadvantage:`Disadvantage on ${(ROLL_TARGETS[c.rollTarget||"attack"]??"rolls").toLowerCase()}`
  }[c.effect]??(RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect]??"This effect");
  const parts=[effect];
  if(c.ruleCategory==="defensive"){
    const trig=c.trigger||"damage";
    let t;
    if(["saveBonus","saveAdvantage"].includes(c.effect))t={saveAgainstMagic:"against spells and magical effects",saveAgainstSpell:"against spells"}[trig]??"";
    else if(c.effect==="acBonus")t={melee:"against melee attacks",ranged:"against ranged attacks",spell:"against spell attacks"}[trig]??"against attacks";
    else t=String(triggerOptions(c.effect)[trig]??"").toLowerCase();
    if(t)parts.push(t);
  }
  const types=k=>(c[k]??[]).map(t=>loc(cfg("creatureTypes",{})[t],t).toLowerCase());
  const p=participantLabels(c);
  const who=(label,list,sub)=>{
    const bits=[];if(list.length)bits.push(listText(list));if(sub)bits.push(`${sub} subtype`);
    return bits.length?`the ${label.split(/\s*[/(]/)[0].trim().toLowerCase()} is ${bits.join(", ")}`:"";
  };
  const filters=[who(p.source,types("sourceTypes"),c.sourceSubtype),who(p.target,types("targetTypes"),c.targetSubtype)].filter(Boolean);
  if(String(c.activityName??"").trim())filters.push(`the attack or ability is named “${String(c.activityName).trim()}”`);
  let out=parts.join(" ");
  out+=filters.length?`, only when ${listText(filters,"and")}.`:`, always.`;
  return out;
}


/** Uses selection shared by Spell and Reaction components. */
function usesFields(c,i,{recovery}={}){
  const u=usesSetting(c);
  const abilities=Object.fromEntries(Object.entries(cfg("abilities",{})).map(([k,v])=>[k,loc(v,k)]));
  return `<label>Uses<select name="c.${i}.usesMode">${selectOptions(USES_MODES,u.mode,false)}</select></label>
    ${u.mode==="fixed"?`<label>Number of Uses<input type="number" min="1" name="c.${i}.usesCount" value="${esc(u.count)}"></label>`:""}
    ${["ability","profAbility"].includes(u.mode)?`<label>Ability<select name="c.${i}.usesAbility">${selectOptions(abilities,u.ability,false)}</select></label>`:""}
    ${u.mode!=="unlimited"&&recovery?`<label>Recovery<select name="c.${i}.recovery">${selectOptions(recovery,c.recovery&&c.recovery in recovery?c.recovery:"lr",false)}</select></label>`:""}`;
}

/** Mark item source data as Magical. D&D5e clears attunement on items without this property. */
function addMagicalProperty(system){
  if(Array.isArray(system.properties)){ if(!system.properties.includes("mgc"))system.properties.push("mgc"); }
  else if(system.properties instanceof Set) system.properties.add("mgc");
  else if(system.properties&&typeof system.properties==="object") system.properties.mgc=true;
  else system.properties=["mgc"];
}

function creatureMulti(selected=[]) {
  return Object.entries(cfg("creatureTypes",{})).map(([k,v]) =>
    `<option value="${esc(k)}" ${selected.includes(k)?"selected":""}>${esc(loc(v,k))}</option>`
  ).join("");
}

function creatureChecklist(namePrefix, selected=[]) {
  const chosen = new Set((selected ?? []).map(x => String(x).toLowerCase()));
  return `<div class="ib311-check-grid">${
    Object.entries(cfg("creatureTypes",{})).map(([k,v]) =>
      `<label class="ib311-check-option">
        <input type="checkbox" name="${esc(namePrefix)}.${esc(k)}" ${chosen.has(String(k).toLowerCase()) ? "checked" : ""}>
        <span>${esc(loc(v,k))}</span>
      </label>`
    ).join("")
  }</div>`;
}

function skillOptions(selected="acr") {
  return selectOptions(cfg("skills",{}), selected, false);
}

function tierOptions(tiers, selected=1) {
  return tiers.map((t,i)=>`<option value="${i+1}" ${Number(selected)===i+1?"selected":""}>${esc(t.name || `Tier ${i+1}`)}</option>`).join("");
}

/** Read weapon damage (5.3 and 6.0 share the same DamageField shape). */
function weaponDamageFromSystem(system,source=""){
  const base=system?.damage?.base??{};
  const vers=system?.damage?.versatile??{};
  const types=base.types instanceof Set?[...base.types]:Array.isArray(base.types)?base.types:[];
  const props=system?.properties;
  const versatile=props instanceof Set?props.has("ver"):Array.isArray(props)?props.includes("ver"):!!props?.ver;
  return {
    number:base.number?String(base.number):"1",
    denomination:base.denomination?String(base.denomination):"8",
    type:types[0]??"slashing",
    versatile,
    versatileNumber:vers.number?String(vers.number):"",
    versatileDenomination:vers.denomination?String(vers.denomination):"",
    source
  };
}

/** Write builder weapon damage into item source data, keeping any base bonus/scaling. */
function applyWeaponDamage(system,wd){
  if(!wd)return;
  const number=Math.max(1,Math.min(20,Math.floor(Number(wd.number)||1)));
  const denomination=Number(wd.denomination)||8;
  system.damage??={};
  system.damage.base={...(system.damage.base??{}),number,denomination,types:wd.type?[wd.type]:[]};
  system.damage.base.custom={...(system.damage.base.custom??{}),enabled:false};
  if(wd.versatile){
    system.damage.versatile={...(system.damage.versatile??{}),
      number:wd.versatileNumber?Math.max(1,Math.min(20,Math.floor(Number(wd.versatileNumber)))):null,
      denomination:wd.versatileDenomination?Number(wd.versatileDenomination):null};
  }
}

class ItemBuilder5e extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id:"item-builder-5e",
    tag:"form",
    window:{title:"Item Builder 5e",icon:"fa-solid fa-hammer",resizable:true},
    position:{width:1120,height:840},
    classes:["item-builder-5e"]
  };

  constructor(options={}) {
    super(options);
    this.activeTab = "basics";
    this.catalog = { spells:[], weapons:[], armor:[], shields:[], focuses:[], equipment:[] };
    this.catalogLoaded = false;
    this.editItem = options.editItem ?? null;
    this.builderData = {
      name:"New Item",
      category:"weapon",
      nativeType:"weapon",
      rarity:"",
      attunement:"",
      value:"0",
      currency:"gp",
      levelRequirement:"",
      featType:"general",
      requirementAbility:"",
      requirementScore:"",
      baseUuid:"",
      enhancementBonus:"0",
      weaponType:"simpleM",
      weaponDamage:{number:"1",denomination:"8",type:"slashing",versatile:false,versatileNumber:"",versatileDenomination:"",source:""},
      armorType:"light",
      focusType:"wizard",
      description:"",
      editingUuid:this.editItem?.uuid ?? "",
      currentTier:1,
      tiers:[
        {id:rid(),name:"Tier 1"},
        {id:rid(),name:"Tier 2"},
        {id:rid(),name:"Tier 3"}
      ],
      progressionNotes:"",
      components:[]
    };

    if (this.editItem) this._hydrateFromItem(this.editItem);
  }

  _hydrateFromItem(item) {
    const ib = foundry.utils.deepClone(item.flags?.[MODULE_ID] ?? {});

    this.builderData.name = item.name ?? this.builderData.name;
    this.builderData.nativeType = item.type ?? this.builderData.nativeType;
    this.builderData.description = ib.description ?? (item.system?.description?.value
      ? String(item.system.description.value).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
      : "");
    this.builderData.rarity = readRarity(item.system);
    // Read the stored value: D&D5e blanks the prepared one on items not marked Magical.
    this.builderData.attunement = normalizeAttunement(item._source?.system?.attunement ?? item.system?.attunement, item._source?.system?.attuned ?? item.system?.attuned).attunement;
    this.builderData.value = String(item.system?.price?.value ?? item.system?.price ?? 0);
    this.builderData.currency = String(item.system?.price?.denomination ?? "gp");
    this.builderData.levelRequirement = String(item.system?.prerequisites?.level ?? "");
    const nativeFeatSubtype=String(item.system?.type?.subtype??item.system?.type?.value??"");
    this.builderData.featType=ib.featType??(["origin","general","fightingStyle","epicBoon"].includes(nativeFeatSubtype)?nativeFeatSubtype:"general");
    this.builderData.requirementAbility = String(ib.requirementAbility ?? "");
    this.builderData.requirementScore = String(ib.requirementScore ?? "");
    this.builderData.editingUuid = item.uuid;
    this.builderData.progressionNotes = String(ib.progressionNotes ?? "");

    const cat = ib.category;
    if (cat==="shield") {this.builderData.category="armor";this.builderData.armorType="shield";}
    else if (cat) this.builderData.category = cat;
    else if (item.type === "weapon") this.builderData.category = "weapon";
    else if (item.type === "equipment") {
      const armorType = String(item.system?.armor?.type ?? "").toLowerCase();
      const name = String(item.name ?? "").toLowerCase();
      if (armorType === "shield" || name === "shield" || name.endsWith(" shield")) {this.builderData.category="armor";this.builderData.armorType="shield";}
      else if (armorType) this.builderData.category = "armor";
      else if (
        name.includes("arcane focus") ||
        name.includes("druidic focus") ||
        name.includes("holy symbol") ||
        name.includes("component pouch") ||
        name.includes("spellcasting focus")
      ) this.builderData.category = "focus";
      else this.builderData.category = "equipment";
    } else this.builderData.category = item.type ?? "equipment";

    this.builderData.baseUuid = ib.baseUuid ?? "";
    this.builderData.weaponType = ib.weaponType ?? this.builderData.weaponType;
    this.builderData.armorType = cat==="shield"?"shield":(ib.armorType ?? this.builderData.armorType);
    const oldFocus={arcane:"wizard",druidic:"druid",holy:"cleric",component:"wizard"};
    this.builderData.focusType = oldFocus[ib.focusType] ?? ib.focusType ?? this.builderData.focusType;
    if (item.type === "weapon") {
      this.builderData.weaponDamage = weaponDamageFromSystem(item.system, ib.baseUuid ?? "");
    }
    this.builderData.enhancementBonus = String(
      ib.enhancementBonus ??
      (item.type === "weapon" ? item.system?.magicalBonus : item.system?.armor?.magicalBonus) ??
      0
    );

    if (Array.isArray(ib.tiers) && ib.tiers.length) {
      this.builderData.tiers = foundry.utils.deepClone(ib.tiers);
    }
    this.builderData.currentTier = Number(ib.currentTier ?? 1) || 1;

    if (Array.isArray(ib.components)) {
      this.builderData.components = foundry.utils.deepClone(ib.components);
    }
  }

  async _loadCatalog() {
    if (this.catalogLoaded) return;

    const buckets = {
      spells: new Map(),
      weapons: new Map(),
      armor: new Map(),
      shields: new Map(),
      focuses: new Map(),
      equipment: new Map()
    };

    const normalizeName = name => String(name ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘]/g, "'")
      .replace(/[,.;:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const looksMagicalByName = name => {
      const n = normalizeName(name);
      return (
        /(?:^|\s)\+\s*[1-9]\d*(?:\s|$)/.test(n) ||
        /(?:^|\s)[+-][1-9]\d*(?:\s|$)/.test(n) ||
        /\bof\s+[a-z]/.test(n) ||
        /\b(?:flame tongue|frost brand|vicious|warning|dragon slayer|giant slayer|vorpal|dancing|defender|holy avenger|sun blade)\b/.test(n)
      );
    };

    const isMundaneBase = e => {
      const rarity = String(readRarity(e.system) ?? "").trim().toLowerCase();
      const magicalBonus = Number(foundry.utils.getProperty(e, "system.magicalBonus") ?? 0) || 0;
      const attunement = normalizeAttunement(foundry.utils.getProperty(e, "system.attunement")).attunement;

      if (rarity && !["none", "mundane"].includes(rarity)) return false;
      if (magicalBonus !== 0) return false;
      if (attunement === "required") return false;

      // Some module/legacy packs do not expose rarity/magicalBonus in their index.
      // Keep obvious enchanted variants out of Base Item selectors anyway.
      if (looksMagicalByName(e.name)) return false;

      return true;
    };

    const packRank = pack => {
      const collection = String(pack.collection ?? "").toLowerCase();
      const packageName = String(pack.metadata?.packageName ?? pack.metadata?.package ?? "").toLowerCase();
      const label = String(pack.metadata?.label ?? pack.title ?? "").toLowerCase();

      let score = 0;
      if (packageName === "dnd5e" || collection.startsWith("dnd5e.")) score += 1000;
      if (
        collection.includes("24") ||
        label.includes("2024") ||
        label.includes("phb 2024") ||
        label.includes("player's handbook 2024")
      ) score += 500;
      if (collection.includes("spells24")) score += 300;
      if (collection.includes("items24")) score += 300;
      if (collection.includes("equipment24")) score += 300;
      if (collection.includes("srd") || label.includes("srd")) score -= 100;
      if (collection === "world") score -= 2000;
      if (label.includes("2014") || collection.includes("2014")) score -= 150;
      return score;
    };

    const canonicalKey = (bucket, entry, raw) => {
      if (bucket === "spells") return `${entry.type}|${normalizeName(entry.name)}`;

      const baseItem = String(foundry.utils.getProperty(raw, "system.baseItem") ?? "").trim().toLowerCase();
      if (baseItem) return `${entry.type}|base:${baseItem}`;

      // After filtering magical variants, punctuation-normalized names are a safe fallback.
      return `${entry.type}|name:${normalizeName(entry.name)}`;
    };

    const addPreferred = (bucket, entry, pack, raw) => {
      const key = canonicalKey(bucket, entry, raw);
      const candidate = {
        ...entry,
        _rank: packRank(pack),
        _pack: pack.collection,
        _packLabel: pack.metadata?.label ?? pack.title ?? pack.collection
      };
      const existing = buckets[bucket].get(key);
      if (!existing || candidate._rank > existing._rank) buckets[bucket].set(key, candidate);
    };

    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
      let index;
      try {
        index = await pack.getIndex({
          fields: [
            "name",
            "type",
            "img",
            "system.type.value",
            "system.type",
            "system.weaponType",
            "system.armor.type",
            "system.baseItem",
            "system.rarity",
            "system.rarities",
            "system.magicalBonus",
            "system.attunement"
          ]
        });
      } catch (_) {
        try { index = await pack.getIndex(); }
        catch (_) { continue; }
      }

      for (const e of index) {
        const uuid = `Compendium.${pack.collection}.Item.${e._id}`;
        const entry = { uuid, name:e.name, type:e.type, img:e.img };
        const lower = normalizeName(e.name);

        if (e.type === "spell") {
          addPreferred("spells", entry, pack, e);
          continue;
        }

        // Base item selectors should contain physical/mundane bases, not +1/+2/+3
        // or named magic-item variants.
        if (!isMundaneBase(e)) continue;

        if (e.type === "weapon") {
          addPreferred("weapons", entry, pack, e);
          continue;
        }

        if (e.type === "equipment") {
          const armorType = String(
            foundry.utils.getProperty(e, "system.armor.type") ??
            foundry.utils.getProperty(e, "system.type.value") ??
            "").toLowerCase();
          const isShield=armorType==="shield"||lower==="shield"||lower.endsWith(" shield");
          const isArmor=["light","medium","heavy"].includes(armorType);
          const isFocus=
            lower.includes("arcane focus") ||
            lower.includes("druidic focus") ||
            lower.includes("holy symbol") ||
            lower.includes("component pouch") ||
            lower.includes("spellcasting focus") ||
            lower.includes("focus");

          if(isShield)addPreferred("shields",{...entry,armorType:"shield"},pack,e);
          else if(isArmor)addPreferred("armor",{...entry,armorType},pack,e);
          else if(isFocus)addPreferred("focuses",{...entry,focusClasses:this._focusClasses(lower,armorType)},pack,e);
          else addPreferred("equipment",entry,pack,e);
          continue;
        }

        if (e.type === "tool") {
          const toolType=String(foundry.utils.getProperty(e,"system.type.value")??"").toLowerCase();
          if (
            lower.includes("focus") ||
            lower.includes("holy symbol") ||
            lower.includes("component pouch") ||
            lower.includes("instrument") ||
            lower.includes("lute") || lower.includes("lyre") || lower.includes("flute") ||
            lower.includes("artisan") || lower.includes("thieves") || ["music","art"].includes(toolType)
          ) {
            addPreferred("focuses",{...entry,focusClasses:this._focusClasses(lower,toolType)},pack,e);
          } else {
            addPreferred("equipment",entry,pack,e);
          }
        }
      }
    }

    // World spells (for example, spells created by an Item Builder import) fill gaps
    // when no compendium copy of the same spell exists.
    for (const spell of game.items?.filter(i => i.type === "spell") ?? []) {
      addPreferred("spells", { uuid: spell.uuid, name: spell.name, type: spell.type, img: spell.img },
        { collection: "world", metadata: { label: "World" }, title: "World" }, spell);
    }

    const finish = map => [...map.values()]
      .map(({_rank, _pack, _packLabel, ...entry}) => entry)
      .sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:"base"}));

    this.catalog.spells = finish(buckets.spells);
    this.catalog.weapons = finish(buckets.weapons);
    this.catalog.armor = finish(buckets.armor);
    this.catalog.shields = finish(buckets.shields);
    this.catalog.focuses = finish(buckets.focuses);
    this.catalog.equipment = finish(buckets.equipment);

    this.catalogLoaded = true;
  }

  /** Pre-fill weapon damage from the chosen base weapon whenever the base changes. */
  async _syncWeaponDamageFromBase(){
    const b=this.builderData;
    if(b.category!=="weapon"||!b.baseUuid||b.weaponDamage?.source===b.baseUuid)return;
    const base=await resolveUuid(b.baseUuid);
    if(base?.type!=="weapon")return;
    b.weaponDamage=weaponDamageFromSystem(base.system,b.baseUuid);
  }

  _focusClasses(name,type=""){
    const out=new Set(),text=`${name} ${type}`.toLowerCase();
    if(text.includes("component pouch"))for(const c of ["artificer","bard","cleric","druid","paladin","ranger","sorcerer","warlock","wizard"])out.add(c);
    if(text.includes("arcane"))for(const c of ["sorcerer","warlock","wizard"])out.add(c);
    if(text.includes("druid"))for(const c of ["druid","ranger"])out.add(c);
    if(text.includes("holy symbol"))for(const c of ["cleric","paladin"])out.add(c);
    if(/instrument|lute|lyre|flute|music/.test(text))out.add("bard");
    if(/artisan|thieves|art\b/.test(text))out.add("artificer");
    if(!out.size)out.add("other");
    return [...out];
  }

  _catalogOptions(entries, selected="", placeholder="Choose a base item…") {
    const out = [`<option value="">${esc(placeholder)}</option>`];
    // De-duplication may hide the exact copy an existing item references (another
    // pack, a world copy, or a spell re-linked by import). Keep it selectable so a
    // save never silently clears the reference.
    if (selected && !entries.some(e => e.uuid === selected)) {
      const doc = resolveUuidSync(selected);
      out.push(`<option value="${esc(selected)}" selected>${esc(doc?.name ?? "Current selection (unavailable)")}</option>`);
    }
    let last = "";
    for (const e of entries) {
      const first = e.name?.[0]?.toUpperCase() ?? "#";
      if (first !== last) last = first;
      out.push(`<option value="${esc(e.uuid)}" ${selected===e.uuid?"selected":""}>${esc(e.name)}</option>`);
    }
    return out.join("");
  }

  async _renderHTML() {
    await this._loadCatalog();
    await this._syncWeaponDamageFromBase();
    const root=document.createElement("div");
    root.className="ib33-root";
    root.innerHTML=this._html();
    return root;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }

  _onRender(context, options) {
    super._onRender(context, options);
    const el=this.element;

    el.querySelector("[data-open-help]")?.addEventListener("click",e=>{e.preventDefault();ItemBuilderHelp.open(this._helpSection());});
    el.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",e=>{
      e.preventDefault(); this._capture(); this.activeTab=e.currentTarget.dataset.tab; this.render({force:true});
    }));

    // Long lists (base items, spells) open as dropdowns with a search field inside.
    enhanceSearchableSelects(el);

    el.querySelectorAll("input:not(.ib92-combo input),select,textarea").forEach(n=>{
      n.addEventListener("input",()=>{this._capture();this._refreshPreview();this._refreshHandling();});
      n.addEventListener("change",()=>{this._capture();this._refreshPreview();this._refreshHandling();});
    });

    el.querySelector("[name='category']")?.addEventListener("change",()=>{
      this._capture();
      const cat=this.builderData.category;
      this.builderData.nativeType = cat==="weapon" ? "weapon" : ["armor","focus","equipment"].includes(cat) ? "equipment" : cat;
      this.builderData.baseUuid="";
      this.render({force:true});
    });

    el.querySelector("[name='baseUuid']")?.addEventListener("change",()=>{
      this._capture();
      if(this.builderData.category==="weapon")this.render({force:true});
    });

    for(const name of ["armorType","focusType"]){
      el.querySelector(`[name='${name}']`)?.addEventListener("change",()=>{this._capture();this.builderData.baseUuid="";this.render({force:true});});
    }
    el.querySelector("[name='requirementAbility']")?.addEventListener("change",()=>{this._capture();this.render({force:true});});

    el.querySelectorAll('select[name$=".effect"]').forEach(sel=>sel.addEventListener("change",()=>{
      this._capture();
      this.render({force:true});
    }));
    el.querySelectorAll('select[name$=".rollTarget"],select[name$=".appliesTo"]').forEach(sel=>sel.addEventListener("change",()=>{this._capture();this.render({force:true});}));
    el.querySelectorAll('select[name$=".reactionEffect"],select[name$=".trigger"],select[name$=".usesMode"],select[name$=".sizeMode"]').forEach(sel=>sel.addEventListener("change",()=>{this._capture();this.render({force:true});}));
    el.querySelectorAll('select[name$=".selectionMode"]').forEach(sel=>sel.addEventListener("change",()=>{this._capture();this.render({force:true});}));

    el.querySelectorAll("[data-add-component]").forEach(btn=>btn.addEventListener("click",e=>{
      e.preventDefault(); this._capture(); this._addComponent(e.currentTarget.dataset.addComponent); this.render({force:true});
    }));

    el.querySelectorAll("[data-remove-component]").forEach(btn=>btn.addEventListener("click",e=>{
      e.preventDefault(); this._capture(); this.builderData.components.splice(Number(e.currentTarget.dataset.removeComponent),1); this.render({force:true});
    }));

    el.querySelector("[data-add-tier]")?.addEventListener("click",e=>{
      e.preventDefault(); this._capture();
      this.builderData.tiers.push({id:rid(),name:`Tier ${this.builderData.tiers.length+1}`});
      this.render({force:true});
    });

    el.querySelectorAll("[data-remove-tier]").forEach(btn=>btn.addEventListener("click",e=>{
      e.preventDefault(); this._capture();
      if (this.builderData.tiers.length<=1) return ui.notifications.warn("An item must have at least one tier.");
      this.builderData.tiers.splice(Number(e.currentTarget.dataset.removeTier),1);
      this.builderData.currentTier=Math.min(this.builderData.currentTier,this.builderData.tiers.length);
      this.builderData.components.forEach(c=>c.tier=Math.min(Number(c.tier)||1,this.builderData.tiers.length));
      this.render({force:true});
    }));

    el.querySelector("[data-open-export]")?.addEventListener("click",e=>{e.preventDefault();new ItemExportApp().render({force:true});});
    el.querySelector("[data-open-import]")?.addEventListener("click",e=>{e.preventDefault();new ItemImportApp().render({force:true});});
    el.querySelector("[data-export-current]")?.addEventListener("click",async e=>{
      e.preventDefault();
      if(this.editItem)await exportItemsToFile([this.editItem]);
    });

    el.querySelector("[data-create]")?.addEventListener("click",async e=>{
      e.preventDefault(); this._capture(); await this._createItem();
    });

    this._refreshPreview();
  }

  _capture() {
    const el=this.element;
    if(!el)return;
    const v=n=>el.querySelector(`[name="${CSS.escape(n)}"]`)?.value;
    const checked=n=>el.querySelector(`[name="${CSS.escape(n)}"]`)?.checked;
    const multi=n=>[...(el.querySelector(`[name="${CSS.escape(n)}"]`)?.selectedOptions??[])].map(o=>o.value);

    const b=this.builderData;
    b.name=v("name")??b.name; b.category=v("category")??b.category;
    b.rarity=v("rarity")??b.rarity; b.attunement=v("attunement")??b.attunement;
    b.value=v("value")??b.value; b.currency=v("currency")??b.currency;
    b.levelRequirement=v("levelRequirement")??b.levelRequirement;
    b.featType=v("featType")??b.featType;
    b.requirementAbility=v("requirementAbility")??b.requirementAbility;b.requirementScore=v("requirementScore")??b.requirementScore;
    b.baseUuid=v("baseUuid")??b.baseUuid; b.enhancementBonus=v("enhancementBonus")??b.enhancementBonus; b.weaponType=v("weaponType")??b.weaponType;
    b.armorType=v("armorType")??b.armorType; b.focusType=v("focusType")??b.focusType;
    if(b.weaponDamage){
      const wd=b.weaponDamage;
      wd.number=v("weaponDamage.number")??wd.number; wd.denomination=v("weaponDamage.denomination")??wd.denomination;
      wd.type=v("weaponDamage.type")??wd.type;
      wd.versatileNumber=v("weaponDamage.versatileNumber")??wd.versatileNumber;
      wd.versatileDenomination=v("weaponDamage.versatileDenomination")??wd.versatileDenomination;
    }
    b.description=v("description")??b.description;
    b.currentTier=Number(v("currentTier")??b.currentTier)||1;

    b.tiers.forEach((t,i)=>{t.name=v(`tier.${i}.name`)??t.name;t.gmNote=v(`tier.${i}.gmNote`)??t.gmNote??"";});
    b.progressionNotes=v("progressionNotes")??b.progressionNotes??"";

    b.components.forEach((c,i)=>{
      c.name=v(`c.${i}.name`)??c.name;
      c.tier=Number(v(`c.${i}.tier`)??c.tier)||1;
      c.activation=v(`c.${i}.activation`)??c.activation;
      if(c.type==="movement"){c.movementType=v(`c.${i}.movementType`)??c.movementType;c.mode=v(`c.${i}.mode`)??c.mode;c.value=v(`c.${i}.value`)??c.value}
      if(c.type==="sense"){c.sense=v(`c.${i}.sense`)??c.sense;c.mode=v(`c.${i}.mode`)??c.mode;c.value=v(`c.${i}.value`)??c.value}
      if(c.type==="ability"){c.ability=v(`c.${i}.ability`)??c.ability;c.mode=v(`c.${i}.mode`)??c.mode;c.value=v(`c.${i}.value`)??c.value}
      if(c.type==="halfAsi"){
        c.selectionMode=v(`c.${i}.selectionMode`)??c.selectionMode;
        c.ability=v(`c.${i}.ability`)??c.ability;
        const abilityKeys=Object.keys(cfg("abilities",{}));
        if(abilityKeys.some(k=>checked(`c.${i}.allowedAbility.${k}`)!==undefined))c.allowedAbilities=abilityKeys.filter(k=>checked(`c.${i}.allowedAbility.${k}`));
      }
      if(c.type==="reference")c.text=v(`c.${i}.text`)??c.text;
      if(c.type==="reaction"){
        for(const k of ["trigger","triggerText","reactionEffect","formula","damageType","saveAbility","saveDC","onSave","usesMode","usesCount","usesAbility","recovery","text"])c[k]=v(`c.${i}.${k}`)??c[k];
      }
      if(c.type==="spell"){
        c.spellUuid=v(`c.${i}.spellUuid`)??c.spellUuid;
        const displayInSpellbook=checked(`c.${i}.displayInSpellbook`);
        if(displayInSpellbook!==undefined)c.displayInSpellbook=displayInSpellbook;
        c.castingAbility=v(`c.${i}.castingAbility`)??c.castingAbility;
        c.level=v(`c.${i}.level`)??c.level;
        for(const k of ["usesMode","usesCount","usesAbility"])c[k]=v(`c.${i}.${k}`)??c[k];
        c.recovery=v(`c.${i}.recovery`)??c.recovery;
      }
      if(c.type==="conditional"){
        const creatureKeys=Object.keys(cfg("creatureTypes",{}));
        if(creatureKeys.some(k=>checked(`c.${i}.sourceType.${k}`)!==undefined))c.sourceTypes=creatureKeys.filter(k=>checked(`c.${i}.sourceType.${k}`));
        if(creatureKeys.some(k=>checked(`c.${i}.targetType.${k}`)!==undefined))c.targetTypes=creatureKeys.filter(k=>checked(`c.${i}.targetType.${k}`));
        c.sourceSubtype=v(`c.${i}.sourceSubtype`)??c.sourceSubtype;
        c.targetSubtype=v(`c.${i}.targetSubtype`)??c.targetSubtype;
        c.activityName=v(`c.${i}.activityName`)??c.activityName;
        c.effect=v(`c.${i}.effect`)??c.effect;
        c.formula=v(`c.${i}.formula`)??c.formula;
        c.damageType=v(`c.${i}.damageType`)??c.damageType;
        const canCrit=checked(`c.${i}.canCrit`);
        if(canCrit!==undefined)c.canCrit=canCrit;
        c.ruleCategory=v(`c.${i}.ruleCategory`)??c.ruleCategory;
        c.ability=v(`c.${i}.ability`)??c.ability;
        c.status=v(`c.${i}.status`)??c.status;
        c.sizeMode=v(`c.${i}.sizeMode`)??c.sizeMode;
        c.size=v(`c.${i}.size`)??c.size;
        {const steps=v(`c.${i}.sizeSteps`);if(steps!==undefined)c.sizeSteps=String((c.sizeMode==="shrink"?-1:1)*Math.abs(Number(steps)||1));
         else if(c.sizeSteps!==undefined)c.sizeSteps=String((c.sizeMode==="shrink"?-1:1)*Math.abs(Number(c.sizeSteps)||1));}
        c.activeEffectKey=v(`c.${i}.activeEffectKey`)??c.activeEffectKey;
        c.activeEffectMode=v(`c.${i}.activeEffectMode`)??c.activeEffectMode;
        c.activeEffectValue=v(`c.${i}.activeEffectValue`)??c.activeEffectValue;
        c.trigger=v(`c.${i}.trigger`)??c.trigger;
        c.rollTarget=v(`c.${i}.rollTarget`)??c.rollTarget;
        c.skill=v(`c.${i}.skill`)??c.skill;
        c.appliesTo=v(`c.${i}.appliesTo`)??c.appliesTo;
      }
      if(c.type==="skill"){
        c.skill=v(`c.${i}.skill`)??c.skill;
        c.proficiency=v(`c.${i}.proficiency`)??c.proficiency;
        c.ability=v(`c.${i}.ability`)??c.ability;
      }
    });
  }

  /** Guide section matching the tab being viewed. */
  _helpSection(){return {basics:"basics",components:"components",progression:"progression",description:"description"}[this.activeTab]??null;}

  _tip(text){return `<span class="tip" title="${esc(text)}"><i class="fa-solid fa-circle-info"></i></span>`}

  _html() {
    const tabs=[["basics","Basics","fa-tag"],["components","Components","fa-puzzle-piece"],["progression","Progression","fa-arrow-trend-up"],["description","Description","fa-align-left"]];
    return `
      <header class="top"><div><h1><i class="fa-solid fa-hammer"></i> Item Builder 5e <small>v${MODULE_VERSION}</small></h1><p>${this.editItem ? `Editing: <strong>${esc(this.editItem.name)}</strong>` : "Choose normal D&D5e items and spells; the builder handles the Foundry data."}</p></div>
        <div class="ib50-top-actions">
          ${this.editItem ? `<button type="button" data-export-current title="Download this item as a portable file another world can import"><i class="fa-solid fa-file-export"></i> Export This Item</button>` : ""}
          <button type="button" data-open-export title="Export several items to a portable file"><i class="fa-solid fa-file-export"></i> Export Items</button>
          <button type="button" data-open-import title="Import items exported from another world"><i class="fa-solid fa-file-import"></i> Import Items</button>
          <button type="button" data-open-help title="Guide: where every feature is and how it works"><i class="fa-solid fa-book-open"></i> Guide</button>
        </div></header>
      <nav class="tabs">${tabs.map(([id,l,i])=>`<button type="button" data-tab="${id}" class="${this.activeTab===id?"active":""}"><i class="fa-solid ${i}"></i>${l}</button>`).join("")}</nav>
      <main class="body"><section>${this._tab()}</section><aside><h2>Preview</h2><div data-preview class="preview"></div>
      <div class="help"><strong>Progressing a growing item</strong><p>After creation, open the item's sheet. At the top you will see an <b>Item Builder Tier</b> button showing its current tier. Click it, choose the new tier, and click <b>Apply</b>. The module enables the components unlocked at that tier.</p></div></aside></main>
      <footer><button type="button" data-create class="primary"><i class="fa-solid fa-hammer"></i> ${this.editItem ? "Save Changes" : "Create Item"}</button></footer>`;
  }

  _tab(){
    if(this.activeTab==="basics")return this._basics();
    if(this.activeTab==="components")return this._components();
    if(this.activeTab==="progression")return this._progression();
    return `<h2>Description</h2><label>Item Description<textarea name="description" rows="22">${esc(this.builderData.description)}</textarea></label>`;
  }

  _baseList() {
    const c=this.builderData.category;
    if(c==="weapon")return this.catalog.weapons;
    if(c==="armor")return this.builderData.armorType==="shield"?this.catalog.shields:this.catalog.armor.filter(e=>!this.builderData.armorType||e.armorType===this.builderData.armorType);
    if(c==="focus")return this.catalog.focuses.filter(e=>!this.builderData.focusType||e.focusClasses?.includes(this.builderData.focusType)||e.focusClasses?.includes("other"));
    if(c==="equipment")return this.catalog.equipment;
    return [];
  }

  _basics(){
    const b=this.builderData;
    const weaponTypes=cfg("weaponTypes",{simpleM:"Simple Melee",simpleR:"Simple Ranged",martialM:"Martial Melee",martialR:"Martial Ranged"});
    const armorTypes=cfg("armorTypes",{light:"Light",medium:"Medium",heavy:"Heavy",shield:"Shield"});
    const baseList=this._baseList();

    return `
      <h2>Item Basics</h2>
      <div class="grid2 basics-grid">
        <label>Name<input name="name" value="${esc(b.name)}"></label>
        <label>Item Category ${this._tip("Choose what you are building. Weapon, Armor, Shield, and Spellcasting Focus use native D&D5e base items when one is selected.")}
          <select name="category">
            <option value="weapon" ${b.category==="weapon"?"selected":""}>Weapon</option>
            <option value="armor" ${b.category==="armor"?"selected":""}>Armor</option>
            <option value="focus" ${b.category==="focus"?"selected":""}>Spellcasting Focus</option>
            <option value="equipment" ${b.category==="equipment"?"selected":""}>Other Equipment</option>
            <option value="consumable" ${b.category==="consumable"?"selected":""}>Consumable</option>
            <option value="feat" ${b.category==="feat"?"selected":""}>Feat / Feature</option>
          </select>
        </label>

        ${b.category==="weapon"?`<label>Weapon Type ${this._tip("The D&D5e weapon family. This is no longer left blank.")}
          <select name="weaponType">${selectOptions(weaponTypes,b.weaponType,false)}</select></label>`:""}

        ${b.category==="feat"?`<label>2024 Feat Type ${this._tip("Classifies the feat as an Origin Feat, General Feat, Fighting Style Feat, or Epic Boon Feat.")}<select name="featType"><option value="origin" ${b.featType==="origin"?"selected":""}>Origin</option><option value="general" ${b.featType==="general"?"selected":""}>General</option><option value="fightingStyle" ${b.featType==="fightingStyle"?"selected":""}>Fighting Style</option><option value="epicBoon" ${b.featType==="epicBoon"?"selected":""}>Epic Boon</option></select></label>`:""}

        ${b.category==="armor"?`<label>Armor Type ${this._tip("The D&D5e armor family used to narrow what kind of base item you are creating.")}
          <select name="armorType">${selectOptions(armorTypes,b.armorType,false)}</select></label>`:""}


        ${b.category==="focus"?`<label>Spellcasting Class ${this._tip("Choose the class that will use this focus. The Base Item list then shows compatible foci, tools, instruments, holy symbols, and component pouches.")}
          <select name="focusType">
            <option value="artificer" ${b.focusType==="artificer"?"selected":""}>Artificer</option>
            <option value="bard" ${b.focusType==="bard"?"selected":""}>Bard</option>
            <option value="cleric" ${b.focusType==="cleric"?"selected":""}>Cleric</option>
            <option value="druid" ${b.focusType==="druid"?"selected":""}>Druid</option>
            <option value="paladin" ${b.focusType==="paladin"?"selected":""}>Paladin</option>
            <option value="ranger" ${b.focusType==="ranger"?"selected":""}>Ranger</option>
            <option value="sorcerer" ${b.focusType==="sorcerer"?"selected":""}>Sorcerer</option>
            <option value="warlock" ${b.focusType==="warlock"?"selected":""}>Warlock</option>
            <option value="wizard" ${b.focusType==="wizard"?"selected":""}>Wizard</option>
            <option value="other" ${b.focusType==="other"?"selected":""}>Other Focus</option>
          </select></label>`:""}

        ${baseList.length?`<label>Base Item ${this._tip("Starts from an actual D&D5e compendium item, preserving its native weapon/armor/equipment data. Your custom name and components are layered on top.")}
          <select name="baseUuid" data-searchable="Search ${({weapon:"weapons",armor:"armor and shields",focus:"foci",equipment:"equipment"})[b.category]??"items"}…">${this._catalogOptions(baseList,b.baseUuid,"Choose a native base item…")}</select></label>`:
          (["weapon","armor","focus","equipment"].includes(b.category)?`<label>Base Item<select disabled><option>No matching compendium items found</option></select></label>`:"")}

        ${["weapon","armor"].includes(b.category)?`<label>Enhancement Bonus ${this._tip("Creates the native magical +1, +2, or +3 version of the selected mundane base item. Weapons receive the bonus to attack and damage; armor and shields receive the bonus to AC.")}
          <select name="enhancementBonus">
            <option value="0" ${String(b.enhancementBonus)==="0"?"selected":""}>None</option>
            <option value="1" ${String(b.enhancementBonus)==="1"?"selected":""}>+1</option>
            <option value="2" ${String(b.enhancementBonus)==="2"?"selected":""}>+2</option>
            <option value="3" ${String(b.enhancementBonus)==="3"?"selected":""}>+3</option>
          </select></label>`:""}

        ${b.category==="weapon"?this._weaponDamageFields():""}

        ${b.category==="feat"
          ? `<label>Required Level ${this._tip("The minimum character level required to select this feat. Leave blank for no level requirement.")}<input type="number" min="1" max="20" name="levelRequirement" value="${esc(b.levelRequirement)}" placeholder="No level requirement"></label>
             <label>Required Ability ${this._tip("Optional ability-score prerequisite, such as Strength 13 for Great Weapon Master.")}<select name="requirementAbility"><option value="">No ability requirement</option>${abilityOptions(b.requirementAbility)}</select></label>
             <label>Minimum Ability Score<input type="number" min="1" max="30" name="requirementScore" value="${esc(b.requirementScore)}" placeholder="13" ${b.requirementAbility?"":"disabled"}></label>`
          : `<label>Rarity<select name="rarity">${selectOptions(cfg("itemRarity",cfg("rarities",{})),b.rarity,true)}</select></label>
             <label>Attunement<select name="attunement"><option value="" ${!b.attunement?"selected":""}>Not Required</option><option value="required" ${b.attunement==="required"?"selected":""}>Required</option><option value="optional" ${b.attunement==="optional"?"selected":""}>Optional</option></select></label>
             <label>Value ${this._tip("The item's sale or market value, stored in D&D5e's native price field.")}<span class="ib315-money"><input type="number" min="0" step="0.01" name="value" value="${esc(b.value)}"><select name="currency">${selectOptions(cfg("currencies",{pp:"Platinum Pieces",gp:"Gold Pieces",ep:"Electrum Pieces",sp:"Silver Pieces",cp:"Copper Pieces"}),b.currency,false)}</select></span></label>`}
      </div>
      <div class="callout"><i class="fa-solid fa-circle-info"></i><div><strong>Base Item matters.</strong> Choosing Longsword, Plate, Shield, Arcane Focus, etc. copies the actual native D&D5e item first. Item Builder then adds your custom effects, spells, rules, and progression.</div></div>`;
  }

  _handlingBanner(c,i){
    const h=ruleHandling(c,this._nativeItemType(),{ownUse:this._ownUse()});
    const icon={native:"fa-layer-group",runtime:"fa-bolt",reference:"fa-book-open"}[h.mode];
    const title={native:"Active Effect on the item",runtime:"Automated by Item Builder",reference:"Reference only"}[h.mode];
    const needs={native:"Built into the item: works even with Item Builder disabled.",runtime:"Needs Item Builder enabled.",reference:""}[h.mode];
    const automation=hasAutomationEffect(c,this._nativeItemType(),{ownUse:this._ownUse()})?" This rule is also written into the item as roll-automation conditions, so Midi-QOL's own roll dialogs include it, even before Item Builder's code runs.":"";
    return `<div class="ib60-handling ${h.mode}" data-handling="${i}"><i class="fa-solid ${icon}"></i><div><strong>${title}</strong> — ${esc(h.note)}${h.ignoresConditions?" <em>Creature and activity filters don't apply to this effect.</em>":""}${needs?`<br><small>${esc(needs)}${esc(automation)}</small>`:""}</div></div>`;
  }

  _refreshHandling(){
    const el=this.element;if(!el)return;
    this.builderData.components.forEach((c,i)=>{
      if(c.type!=="conditional")return;
      const sum=el.querySelector(`[data-summary="${i}"]`);
      if(sum)sum.innerHTML=`<i class="fa-solid fa-quote-left"></i> ${esc(ruleSentence(c))}`;
      const node=el.querySelector(`[data-handling="${i}"]`);
      if(!node)return;
      const tmp=document.createElement("div");tmp.innerHTML=this._handlingBanner(c,i);
      node.replaceWith(tmp.firstElementChild);
    });
  }

  _weaponDamageFields(){
    const wd=this.builderData.weaponDamage??{};
    const dice=d=>[4,6,8,10,12,20].map(n=>`<option value="${n}" ${String(d)===String(n)?"selected":""}>d${n}</option>`).join("");
    const out=[`<label>Damage Dice ${this._tip("The weapon's base damage dice, for example 1d8 for a longsword. Your ability modifier and enhancement bonus are added automatically when rolling.")}
      <span class="ib315-money ib51-dice"><input type="number" min="1" max="20" step="1" name="weaponDamage.number" value="${esc(wd.number)}" placeholder="1"><select name="weaponDamage.denomination">${dice(wd.denomination||8)}</select></span></label>`,
      `<label>Damage Type ${this._tip("The damage type of the weapon's attack. Versatile two-handed damage uses the same type.")}
      <select name="weaponDamage.type">${standardDamageOptions(wd.type||"slashing")}</select></label>`];
    if(wd.versatile)out.push(`<label>Versatile Dice ${this._tip("Damage when wielded with two hands. Leave the count blank to step the base die up one size automatically.")}
      <span class="ib315-money ib51-dice"><input type="number" min="1" max="20" step="1" name="weaponDamage.versatileNumber" value="${esc(wd.versatileNumber)}" placeholder="Auto"><select name="weaponDamage.versatileDenomination"><option value="" ${!wd.versatileDenomination?"selected":""}>Auto</option>${dice(wd.versatileDenomination)}</select></span></label>`);
    return out.join("");
  }

  _addComponent(type){
    const c={id:rid(),type,name:"",tier:1,activation:"equipped"};
    if(type==="movement")Object.assign(c,{name:"Movement",movementType:"walk",mode:"add",value:"10"});
    if(type==="sense")Object.assign(c,{name:"Senses",sense:"darkvision",mode:"upgrade",value:"60"});
    if(type==="ability")Object.assign(c,{name:"Ability Score",ability:"str",mode:"add",value:"2"});
    if(type==="halfAsi")Object.assign(c,{name:"2024 Half-ASI",selectionMode:"choice",ability:"str",allowedAbilities:Object.keys(cfg("abilities",{})),selectedAbility:""});
    if(type==="reference")Object.assign(c,{name:"Special Rule",text:""});
    if(type==="reaction")Object.assign(c,{name:"Reaction",trigger:"hit",triggerText:"",reactionEffect:"acBonus",formula:"2",damageType:"any",saveAbility:"dex",saveDC:"13",onSave:"half",usesMode:"unlimited",usesCount:"1",usesAbility:"cha",recovery:"lr",text:""});
    if(type==="spell")Object.assign(c,{name:"Granted Spell",spellUuid:"",displayInSpellbook:true,castingAbility:"",level:"",usesMode:"unlimited",usesCount:"1",usesAbility:"cha",recovery:"lr"});
    if(type==="skill")Object.assign(c,{name:"Skill Training",skill:"acr",proficiency:"1",ability:""});
    if(RULE_CATEGORIES[type])Object.assign(c,{type:"conditional",ruleCategory:type,name:RULE_CATEGORIES[type].label,sourceTypes:[],sourceSubtype:"",targetSubtype:"",activityName:"",targetTypes:[],effect:Object.keys(RULE_CATEGORIES[type].effects)[0],formula:type==="offensive"?"1d6":"",damageType:type==="offensive"?"radiant":"any",canCrit:false,ability:"",status:"",activeEffectKey:"",activeEffectMode:"2",activeEffectValue:"",trigger:type==="defensive"?"damage":"",rollTarget:"attack",skill:"",appliesTo:"self"});
    this.builderData.components.push(c);
  }

  _components(){
    const btn=(type,icon,label)=>`<button type="button" data-add-component="${type}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`;
    return `<div class="section-head"><div><h2>Components</h2><p>Add mechanics without touching UUIDs, data paths, or Active Effect keys.</p></div></div>
      <div class="ib90-add">
        <div class="ib90-group"><h4>Character Traits</h4><div class="ib90-buttons">
          ${btn("movement","fa-person-running","Movement")}${btn("sense","fa-eye","Senses")}${btn("ability","fa-dumbbell","Ability Score")}${btn("skill","fa-graduation-cap","Skill")}${this.builderData.category==="feat"?btn("halfAsi","fa-arrow-up-1-9","2024 Half-ASI"):""}
        </div></div>
        <div class="ib90-group"><h4>Actions</h4><div class="ib90-buttons">
          ${btn("spell","fa-wand-sparkles","Spell")}${btn("reaction","fa-bolt-lightning","Reaction")}${btn("reference","fa-align-left","Rules Text")}
        </div></div>
        <div class="ib90-group"><h4>Rule Effects</h4><div class="ib90-buttons">
          ${btn("offensive","fa-burst","Offensive")}${btn("defensive","fa-shield-halved","Defensive")}${btn("healing","fa-heart-pulse","Healing / Recovery")}${btn("utility","fa-wand-magic-sparkles","Utility / Control")}
        </div></div>
      </div>
    ${this.builderData.components.length?this.builderData.components.map((c,i)=>this._component(c,i)).join(""):`<div class="empty"><i class="fa-solid fa-puzzle-piece"></i><p>No components yet.</p></div>`}`;
  }

  _activation(c,i){return `<label>Active While ${this._tip("When this passive component should apply. Equipped is typical for weapons/armor; Attuned is typical for magic items.")}
    <select name="c.${i}.activation"><option value="always" ${c.activation==="always"?"selected":""}>Owned / Always</option><option value="equipped" ${c.activation==="equipped"?"selected":""}>Equipped</option><option value="attuned" ${c.activation==="attuned"?"selected":""}>Attuned</option></select></label>`}

  _component(c,i){
    let body="";
    if(c.type==="movement")body=`<div class="grid2"><label>Movement Type<select name="c.${i}.movementType">${movementOptions(c.movementType)}</select></label><label>Operation<select name="c.${i}.mode"><option value="add" ${c.mode==="add"?"selected":""}>Increase by</option><option value="override" ${c.mode==="override"?"selected":""}>Grant / Set to</option></select></label><label>Feet<input type="number" name="c.${i}.value" value="${esc(c.value)}"></label>${this._activation(c,i)}</div>`;
    if(c.type==="sense")body=`<div class="grid2"><label>Sense<select name="c.${i}.sense">${selectOptions({darkvision:"Darkvision",blindsight:"Blindsight",tremorsense:"Tremorsense",truesight:"Truesight"},c.sense,false)}</select></label><label>Operation<select name="c.${i}.mode"><option value="upgrade" ${c.mode==="upgrade"?"selected":""}>Grant / Minimum Range</option><option value="add" ${c.mode==="add"?"selected":""}>Increase Existing Range by</option><option value="override" ${c.mode==="override"?"selected":""}>Set Range to</option></select></label><label>Range (feet)<input type="number" min="0" name="c.${i}.value" value="${esc(c.value)}"></label>${this._activation(c,i)}</div>`;
    if(c.type==="ability")body=`<div class="grid2"><label>Ability<select name="c.${i}.ability">${abilityOptions(c.ability)}</select></label><label>Operation<select name="c.${i}.mode"><option value="add" ${c.mode==="add"?"selected":""}>Increase by</option><option value="override" ${c.mode==="override"?"selected":""}>Set Score to</option></select></label><label>Value<input type="number" name="c.${i}.value" value="${esc(c.value)}"></label>${this._activation(c,i)}</div>`;
    if(c.type==="halfAsi"){
      const allowed=new Set(c.allowedAbilities??Object.keys(cfg("abilities",{})));
      body=`<div class="grid2"><label>Who Chooses?<select name="c.${i}.selectionMode"><option value="choice" ${c.selectionMode==="choice"?"selected":""}>Player Chooses</option><option value="fixed" ${c.selectionMode==="fixed"?"selected":""}>GM Sets Ability</option></select></label>${c.selectionMode==="fixed"?`<label>Ability<select name="c.${i}.ability">${abilityOptions(c.ability)}</select></label>`:`<fieldset class="ib324-abilities"><legend>Allowed Player Choices</legend>${Object.entries(cfg("abilities",{})).map(([key,value])=>`<label><input type="checkbox" name="c.${i}.allowedAbility.${key}" ${allowed.has(key)?"checked":""}> ${esc(loc(value,key))}</label>`).join("")}</fieldset>`}<label>Increase<input value="+1 (maximum 20)" disabled></label></div>${halfAsiIsNative(c,this._nativeItemType())?`<div class="ib60-handling native"><i class="fa-solid fa-layer-group"></i><div><strong>Built into the feat</strong> — written as D&D5e Ability Score Improvement advancement, so D&D5e asks for (or applies) the +1 when the feat is dropped on a character. Works even with Item Builder disabled.</div></div>`:`<div class="ib60-handling runtime"><i class="fa-solid fa-bolt"></i><div><strong>Applied by Item Builder</strong> — D&D5e advancement cannot wait for a later tier, so this +1 is an Active Effect; the player is prompted when the tier unlocks or the feat is added.</div></div>`}`;
    }
    if(c.type==="reaction"){
      const e=c.reactionEffect;
      const fLabel={acBonus:["AC Bonus","2"],reduceDamage:["Reduce Damage By","5, @prof, or 1d10 + @prof"],damageAttacker:["Damage","2d6"],saveAttacker:["Damage on a Failed Save","2d6"],healSelf:["Hit Points Regained","1d8 + @prof"],tempHp:["Temporary Hit Points","1d6 + @prof"],saveBonus:["Saving Throw Bonus","2"]}[e];
      const dmgType=["resistance","reduceDamage"].includes(e)
        ?`<label>Damage Type<select name="c.${i}.damageType"><option value="any" ${c.damageType==="any"?"selected":""}>Any Damage</option>${standardDamageOptions(c.damageType==="any"?"":c.damageType)}</select></label>`
        :["damageAttacker","saveAttacker"].includes(e)?`<label>Damage Type<select name="c.${i}.damageType">${standardDamageOptions(c.damageType==="any"?"force":c.damageType)}</select></label>`:"";
      const saveFields=e==="saveAttacker"?`<label>Save Ability<select name="c.${i}.saveAbility">${abilityOptions(c.saveAbility)}</select></label><label>Save DC<input name="c.${i}.saveDC" value="${esc(c.saveDC)}" placeholder="13 or 8 + @prof + @abilities.con.mod"></label><label>On a Successful Save<select name="c.${i}.onSave"><option value="half" ${c.onSave!=="none"?"selected":""}>Half damage</option><option value="none" ${c.onSave==="none"?"selected":""}>No damage</option></select></label>`:"";
      const note=e==="reduceDamage"?"A fixed amount (such as 5 or @prof) is applied automatically when the player uses the reaction before damage is applied. A rolled amount is rolled on the card for the player to subtract.":["acBonus","resistance","saveBonus"].includes(e)?"Using the reaction applies the effect to the user until the start of their next turn.":"";
      body=`<div class="grid2">
        <label>Trigger ${this._tip("Shown on the character sheet and chat card as the reaction's trigger.")}<select name="c.${i}.trigger">${selectOptions(REACTION_TRIGGERS,c.trigger||"hit",false)}</select></label>
        ${c.trigger==="custom"?`<label>Custom Trigger<input name="c.${i}.triggerText" value="${esc(c.triggerText)}" placeholder="When a creature within 5 feet of you casts a spell"></label>`:""}
        <label>What Happens<select name="c.${i}.reactionEffect">${selectOptions(REACTION_EFFECTS,e,false)}</select></label>
        ${fLabel?`<label>${fLabel[0]}<input name="c.${i}.formula" value="${esc(c.formula)}" placeholder="${esc(fLabel[1])}"></label>`:""}
        ${dmgType}${saveFields}
        ${usesFields(c,i,{recovery:{lr:"Long Rest",sr:"Short Rest",dawn:"Dawn",day:"Day",none:"Never"}})}
      </div>
      <label>Rules Text (optional) ${this._tip("Shown on the chat card when the reaction is used.")}<textarea name="c.${i}.text" rows="2">${esc(c.text)}</textarea></label>
      <div class="ib60-handling native"><i class="fa-solid fa-layer-group"></i><div><strong>Built into the item</strong> — added as a D&D5e activity with Reaction activation${note?`. ${esc(note)}`:"."} Works even with Item Builder disabled.</div></div>
      <p class="ib80-summary"><i class="fa-solid fa-quote-left"></i> ${esc(reactionSummary(c,k=>loc(cfg("abilities",{})[k],k)))}</p>`;
    }
    if(c.type==="reference")body=`<label>Rules Text ${this._tip("Reference text for mechanics that Item Builder does not automate, such as allowing a two-handed weapon to be wielded in one hand.")}<textarea name="c.${i}.text" rows="5" placeholder="You can wield this two-handed weapon with one hand.">${esc(c.text)}</textarea></label><p class="hint">This is displayed in the item's description and preview but does not apply automation.</p>`;
    if(c.type==="spell")body=`<div class="grid2">
      <label>Spell ${this._tip("Choose a spell by name from your available D&D5e spell compendiums. No UUID entry is required.")}
        <select name="c.${i}.spellUuid" data-searchable="Search spells…">${this._catalogOptions(this.catalog.spells,c.spellUuid,"Choose a spell…")}</select></label>
      <label>Casting Ability<select name="c.${i}.castingAbility"><option value="">Actor / spell default</option>${abilityOptions(c.castingAbility)}</select></label>
      <label>Casting Level<input type="number" min="0" max="9" name="c.${i}.level" value="${esc(c.level)}" placeholder="Spell default"></label>
      <label class="check"><input type="checkbox" name="c.${i}.displayInSpellbook" ${c.displayInSpellbook?"checked":""}> Show in Item Spells</label>
      ${usesFields(c,i,{recovery:{lr:"Long Rest",sr:"Short Rest",dawn:"Dawn",day:"Day",none:"Never"}})}
    </div>`;
    if(c.type==="skill")body=`<div class="grid2">
      <label>Skill ${this._tip("Choose the skill this item grants or modifies.")}
        <select name="c.${i}.skill">${skillOptions(c.skill)}</select></label>
      <label>Training ${this._tip("Proficient grants normal proficiency. Expertise doubles the proficiency bonus for this skill.")}
        <select name="c.${i}.proficiency">
          <option value="1" ${String(c.proficiency)==="1"?"selected":""}>Proficient</option>
          <option value="2" ${String(c.proficiency)==="2"?"selected":""}>Expertise</option>
        </select></label>
      <label>Use Ability ${this._tip("Leave Default to use the skill's normal ability. Choose another ability to make this skill use that ability while the item effect is active.")}
        <select name="c.${i}.ability"><option value="">Default ability</option>${abilityOptions(c.ability)}</select></label>
      ${this._activation(c,i)}
    </div>`;

    if(c.type==="conditional"){
      // v0.3.11 items did not store a category. Infer it so they remain fully editable.
      if(!RULE_CATEGORIES[c.ruleCategory]) c.ruleCategory=["resistance","immunity","vulnerability"].includes(c.effect)?"defensive":"offensive";
      const category=RULE_CATEGORIES[c.ruleCategory];
      const participants=participantLabels(c);
      const defensive=["resistance","immunity","vulnerability"].includes(c.effect);
      const formula=FORMULA_RULES.has(c.effect);
      const damage=DAMAGE_RULES.has(c.effect);
      const effectOptions=Object.entries(category.effects).map(([key,text])=>`<option value="${key}" ${c.effect===key?"selected":""}>${text}</option>`).join("");
      let relevantFields="";
      const formulaLabels={extraDamage:["Extra Damage Formula","2d10"],sameTypeDamage:["Extra Damage Formula","2d10"],attackBonus:["Attack Bonus","1"],reachBonus:["Additional Reach (feet)","5"],acBonus:["AC Bonus","1"],saveBonus:["Saving Throw Bonus","1"],bonusHealing:["Bonus Healing Formula","1d4"],healingReceived:["Healing Modifier (can be negative)","2"],temporaryHp:["Temporary HP Granted","1d4 + @prof"],recoveryBonus:["Bonus per Hit Die","2"],movementControl:["Speed Change (feet)","10 or -10"]};
      if(formula){const [label,ph]=formulaLabels[c.effect]??["Formula / Modifier","2 or 1d6"];relevantFields+=`<label>${label}<input name="c.${i}.formula" value="${esc(c.formula)}" placeholder="${esc(ph)}"></label>`;}
      if(c.effect==="extraDamage") relevantFields+=`<label>Extra Damage Type<select name="c.${i}.damageType">${standardDamageOptions(c.damageType)}</select></label>`;
      if(c.effect==="sameTypeDamage") relevantFields+=`<label>Triggering Damage Type ${this._tip("The extra damage is rolled only when the activity deals this type, and the additional damage uses this same type.")}<select name="c.${i}.damageType">${standardDamageOptions(c.damageType)}</select></label>`;
      if(["extraDamage","sameTypeDamage"].includes(c.effect)) relevantFields+=`<label class="check"><input type="checkbox" name="c.${i}.canCrit" ${c.canCrit?"checked":""}> Can This Damage Crit? ${this._tip("When enabled, this extra damage inherits a critical hit from the triggering attack and uses D&D5e's configured critical-damage rules.")}</label>`;
      if(defensive) relevantFields+=`<label>Affected Damage Type ${this._tip("Choose Any Resulting Damage to affect the whole matching attack, or restrict the rule to one normal D&D damage type.")}<select name="c.${i}.damageType"><option value="any" ${c.damageType==="any"?"selected":""}>Any Resulting Damage</option>${standardDamageOptions(c.damageType==="any"?"radiant":c.damageType)}</select></label>`;
      if(OFFENSIVE_DAMAGE_RULES.has(c.effect)) relevantFields+=`<label>Affected Damage Type ${this._tip("Choose Any Resulting Damage or restrict this offensive bypass/vulnerability to one normal D&D damage type.")}<select name="c.${i}.damageType"><option value="any" ${c.damageType==="any"?"selected":""}>Any Resulting Damage</option>${standardDamageOptions(c.damageType==="any"?"radiant":c.damageType)}</select></label>`;
      if(c.ruleCategory==="defensive") relevantFields+=`<label>Applies When ${this._tip("Which incoming event this defensive effect applies to.")}<select name="c.${i}.trigger">${selectOptions(triggerOptions(c.effect),c.trigger||"damage",false)}</select></label>`;
      if(["saveBonus","saveAdvantage"].includes(c.effect)) relevantFields+=`<label>Saving Throw Ability<select name="c.${i}.ability"><option value="">Any Save</option>${abilityOptions(c.ability,true).replace('<option value="">—</option>','')}</select></label>`;
      if(["advantage","disadvantage"].includes(c.effect)){
        const rt=c.rollTarget||"attack";
        relevantFields+=`<label>Applies To Roll ${this._tip("Which rolls get advantage or disadvantage. Attack rolls follow this item's attacks; the others apply to the item user.")}<select name="c.${i}.rollTarget">${selectOptions(ROLL_TARGETS,rt,false)}</select></label>`;
        if(["save","check"].includes(rt))relevantFields+=`<label>Ability<select name="c.${i}.ability"><option value="">Any Ability</option>${abilityOptions(c.ability,true).replace('<option value="">—</option>','')}</select></label>`;
        if(rt==="skill")relevantFields+=`<label>Skill<select name="c.${i}.skill"><option value="">Any Skill</option>${selectOptions(cfg("skills",{}),c.skill,false)}</select></label>`;
      }
      if(c.effect==="sizeChange"){
        const sizes=Object.fromEntries(Object.entries(cfg("actorSizes",{})).filter(([,v])=>typeof v==="object").map(([k,v])=>[k,loc(v,k)]));
        const mode=c.sizeMode||"grow";
        relevantFields+=`<label>How ${this._tip("Grow/shrink is relative to the creature's normal size (Enlarge makes a Medium creature Large and a Small creature Medium). Set makes the creature exactly that size.")}<select name="c.${i}.sizeMode">${selectOptions({grow:"Grow by size categories",shrink:"Shrink by size categories",set:"Become a set size"},mode,false)}</select></label>`;
        relevantFields+=mode==="set"
          ?`<label>Size<select name="c.${i}.size">${selectOptions(sizes,c.size||"lg",false)}</select></label>`
          :`<label>Amount<select name="c.${i}.sizeSteps">${selectOptions(Object.fromEntries([1,2,3].map(n=>{
              const name=k=>loc(cfg("actorSizes",{})[k],k);
              const dir=mode==="shrink"?-1:1;
              const ex=["sm","med","lg"].map(k=>`${name(k)} → ${name(sizeAfter(k,dir*n))}`).filter(t=>!/(\S+) → \1$/.test(t)).slice(0,2).join(", ");
              return [String(n),`${["One","Two","Three"][n-1]} size${n>1?"s":""} ${mode==="shrink"?"smaller":"larger"} (${ex})`];
            })),String(Math.abs(Number(c.sizeSteps)||1)),false)}</select></label>`;
      }
      if(c.effect==="movementControl") relevantFields+=`<label>Movement Type<select name="c.${i}.ability">${movementOptions(c.ability||"walk")}</select></label>`;
      if(c.effect==="statusEffect") relevantFields+=`<label>Status / Condition<select name="c.${i}.status">${conditionOptions(c.status)}</select></label><label>Who Gets It ${this._tip("The item user: they have this condition while the item is active. The target: the item's attack, save and damage cards get an Apply Effect button for it.")}<select name="c.${i}.appliesTo">${selectOptions(STATUS_TARGETS,c.appliesTo||"self",false)}</select></label>`;
      if(c.effect==="activeEffect") relevantFields+=`<label>Active Effect Key<input name="c.${i}.activeEffectKey" value="${esc(c.activeEffectKey)}" placeholder="system.attributes.ac.bonus"></label><label>Mode<select name="c.${i}.activeEffectMode"><option value="2" ${c.activeEffectMode==="2"?"selected":""}>Add</option><option value="5" ${c.activeEffectMode==="5"?"selected":""}>Override</option><option value="0" ${c.activeEffectMode==="0"?"selected":""}>Custom</option></select></label><label>Value<input name="c.${i}.activeEffectValue" value="${esc(c.activeEffectValue)}"></label>`;
      const self=selfSide(c);
      const showSource=self!=="source"||c.sourceTypes?.length||c.sourceSubtype;
      const showTarget=self!=="target"||c.targetTypes?.length||c.targetSubtype;
      const whoNote=self?` The ${self==="source"?participants.source:participants.target} is always the item's user, so only the other creature can be filtered.`:"";
      const nameTip=c.ruleCategory==="defensive"
        ?"Only applies when the attacker's attack or ability has this text in its name: “Bite” matches Bite and Poisonous Bite. Leave blank to apply to every attack and ability."
        :"Only applies when the attack or ability being used has this text in its name: “Bite” matches Bite and Poisonous Bite. Leave blank to apply to every attack and ability.";
      body=`<div class="rule-category ${esc(c.ruleCategory)}"><h3><i class="fa-solid ${category.icon}"></i> ${category.label}</h3><input type="hidden" name="c.${i}.ruleCategory" value="${esc(c.ruleCategory)}">${this._handlingBanner(c,i)}
        <div class="grid2">
          <label>Effect<select name="c.${i}.effect">${effectOptions}</select></label>
          ${relevantFields}
        </div>
        <fieldset class="ib80-conditions"><legend>Only when… <span class="muted">(optional)</span></legend>
          <p class="hint">Leave everything here blank and the effect always applies. Each box you fill in narrows it, and all of them must match.${esc(whoNote)}</p>
          <div class="grid2">
            ${showSource?`<div class="ib311-field-block">
              <div class="ib311-label">${esc(participants.source)} Is ${this._tip(`Leave all unchecked for any creature type.`)}</div>
              ${creatureChecklist(`c.${i}.sourceType`,c.sourceTypes)}
            </div>`:""}
            ${showTarget?`<div class="ib311-field-block">
              <div class="ib311-label">${esc(participants.target)} Is ${this._tip(`Leave all unchecked for any creature type.`)}</div>
              ${creatureChecklist(`c.${i}.targetType`,c.targetTypes)}
            </div>`:""}
            ${showSource?`<label>${esc(participants.source)} Subtype ${this._tip(`Uses subtype metadata first, then custom creature type or actor name when metadata is blank.`)}
              <select name="c.${i}.sourceSubtype">${creatureSubtypeOptions(c.sourceSubtype)}</select></label>`:""}
            ${showTarget?`<label>${esc(participants.target)} Subtype ${this._tip(`Uses subtype metadata first, then custom creature type or actor name when metadata is blank.`)}
              <select name="c.${i}.targetSubtype">${creatureSubtypeOptions(c.targetSubtype)}</select></label>`:""}
            <label>${c.ruleCategory==="defensive"?"Attacker's Attack or Ability Named":"Attack or Ability Named"} ${this._tip(nameTip)}
              <input name="c.${i}.activityName" value="${esc(c.activityName)}" placeholder="Any attack or ability"></label>
          </div>
        </fieldset>
        <p class="ib80-summary" data-summary="${i}"><i class="fa-solid fa-quote-left"></i> ${esc(ruleSentence(c))}</p></div>`;
    }

    const badge=c.type==="conditional"?(RULE_CATEGORIES[c.ruleCategory]?.label??"Rule Effect"):c.type;
    return `<article class="component ${c.type==="conditional"?`rule-card ${esc(c.ruleCategory)}`:""}"><header><div><span class="badge">${esc(badge)}</span><input name="c.${i}.name" value="${esc(c.name)}"></div><button type="button" data-remove-component="${i}" title="Remove"><i class="fa-solid fa-trash"></i></button></header>
      <div class="meta"><label>Begins at <select name="c.${i}.tier">${tierOptions(this.builderData.tiers,c.tier)}</select></label></div><div class="component-body">${body}</div></article>`;
  }

  _progression(){
    const b=this.builderData;
    return `<div class="section-head"><div><h2>Progression</h2><p>Create Dormant/Awakened/Exalted items or any other tier structure.</p></div><button type="button" data-add-tier><i class="fa-solid fa-plus"></i> Add Tier</button></div>
      <div class="callout progression"><i class="fa-solid fa-hand-pointer"></i><div><strong>How to progress the item manually:</strong><br>1. Create the item.<br>2. Open that item's sheet.<br>3. Click the <b>Item Builder Tier</b> button at the top of the sheet.<br>4. Choose the new tier.<br>5. Click <b>Apply</b>.<br><br>Any components whose <b>Begins at</b> tier has now been reached will activate.</div></div>
      <div class="tier-list">${b.tiers.map((t,i)=>`<div class="ib91-tier"><div class="tier-row"><span>${i+1}</span><input name="tier.${i}.name" value="${esc(t.name)}"><button type="button" data-remove-tier="${i}" title="Remove tier"><i class="fa-solid fa-trash"></i></button></div>
        <label class="ib91-note"><i class="fa-solid fa-eye-slash"></i> ${i===0?"Starting state":"How it reaches this tier"} <span class="muted">(GM only)</span><textarea name="tier.${i}.gmNote" rows="2" placeholder="${i===0?"e.g. Found dormant in the lich's vault; the wielder doesn't know its true name.":"e.g. Awakens when the wielder lands the killing blow on a dragon."}">${esc(t.gmNote??"")}</textarea></label></div>`).join("")}</div>
      <label class="ib91-note"><i class="fa-solid fa-eye-slash"></i> Progression Notes <span class="muted">(GM only)</span> ${this._tip("Your own reminders about how this item grows. Shown only to GMs: here and in the tier window on the item sheet. Players never see it.")}
        <textarea name="progressionNotes" rows="4" placeholder="e.g. Ties to Kaelen's backstory. Reveal the second tier's name only after the temple session.">${esc(b.progressionNotes??"")}</textarea></label>
      <label>Starting Tier<select name="currentTier">${tierOptions(b.tiers,b.currentTier)}</select></label>
      <h3>Unlock Summary</h3>
      ${b.tiers.map((t,i)=>{const list=b.components.filter(c=>Number(c.tier)===i+1);return `<div class="tier-summary"><strong>${esc(t.name)}</strong>${t.gmNote?`<p class="ib91-summary-note"><i class="fa-solid fa-eye-slash"></i> ${esc(t.gmNote)}</p>`:""}${list.length?`<ul>${list.map(c=>`<li>${esc(c.name)}</li>`).join("")}</ul>`:"<p>No new components.</p>"}</div>`}).join("")}`;
  }

  _previewText(c){
    const tier=this.builderData.tiers[(Number(c.tier)||1)-1]?.name??`Tier ${c.tier}`;
    if(c.type==="movement")return `${tier}: ${c.mode==="add"?"+":"Set"} ${esc(c.value)} ft. ${esc(loc(cfg("movementTypes",{})[c.movementType],c.movementType))}.`;
    if(c.type==="sense")return `${tier}: ${c.mode==="add"?"+":""}${esc(c.value)} ft. ${esc({darkvision:"Darkvision",blindsight:"Blindsight",tremorsense:"Tremorsense",truesight:"Truesight"}[c.sense]??c.sense)}.`;
    if(c.type==="ability")return `${tier}: ${c.mode==="add"?"+":"Set"} ${esc(c.value)} ${esc(loc(cfg("abilities",{})[c.ability],c.ability))}.`;
    if(c.type==="spell"){const s=this.catalog.spells.find(x=>x.uuid===c.spellUuid)??resolveUuidSync(c.spellUuid);return `${tier}: grants ${esc(s?.name??"no spell selected")}.`}
    if(c.type==="reaction")return `${tier}: ${esc(reactionSummary(c,k=>loc(cfg("abilities",{})[k],k)))}`;
    if(c.type==="skill"){const sk=cfg("skills",{})[c.skill];const training=String(c.proficiency)==="2"?"Expertise":"Proficiency";const abil=c.ability?` using ${loc(cfg("abilities",{})[c.ability],c.ability)}`:"";return `${tier}: ${training} in ${esc(loc(sk,c.skill))}${esc(abil)}.`}
    if(c.type==="halfAsi")return `${tier}: +1 ${c.selectionMode==="fixed"?esc(loc(cfg("abilities",{})[c.ability],c.ability)):c.selectedAbility?esc(loc(cfg("abilities",{})[c.selectedAbility],c.selectedAbility)):"ability score chosen by the player"} (maximum 20).`;
    if(c.type==="reference")return `${tier}: ${esc(c.name)} — ${esc(c.text||"No rules text entered")}`;
    if(c.type==="conditional")return `${tier}: ${esc(RULE_CATEGORIES[c.ruleCategory]?.label??"Rule Effect")} — ${esc(RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect]??c.effect)}${FORMULA_RULES.has(c.effect)&&c.formula?` ${esc(c.formula)}`:""}${DAMAGE_RULES.has(c.effect)&&c.damageType&&c.damageType!=="any"?` (${esc(c.damageType)})`:""}. <span class="ib60-tag">${esc(handlingLabel(c,this._nativeItemType(),{ownUse:this._ownUse()}))}</span>`;
    return `${tier}: ${esc(c.name)}`;
  }

  _refreshPreview(){
    const p=this.element?.querySelector("[data-preview]");if(!p)return;
    const b=this.builderData,base=this._baseList().find(x=>x.uuid===b.baseUuid);
    const enh=Number(b.enhancementBonus)||0;const baseLabel=base?`${base.name}${enh?` +${enh}`:""}`:"";
    const wd=b.weaponDamage;const dmg=b.category==="weapon"&&wd?.number&&wd?.denomination?`<p><strong>Damage:</strong> ${esc(wd.number)}d${esc(wd.denomination)}${enh?` + ${enh}`:""} ${esc(loc(cfg("damageTypes",{})[wd.type],wd.type))}${wd.versatile?` (versatile ${esc(wd.versatileNumber||wd.number)}d${esc(wd.versatileDenomination||"↑")})`:""}</p>`:"";
    p.innerHTML=`<h3>${esc(b.name)}</h3><p class="muted">${esc(b.category)}${baseLabel?` • base: ${esc(baseLabel)}`:""} • ${esc(b.tiers[b.currentTier-1]?.name??"Tier 1")}</p>${dmg}${b.components.length?b.components.map(c=>`<p>${this._previewText(c)}</p>`).join(""):"<p>No components yet.</p>"}`;
  }

  _savedComponentText(c){
    const tier=this.builderData.tiers[(Number(c.tier)||1)-1]?.name??`Tier ${c.tier||1}`;
    if(c.type==="conditional"){
      const effect=RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect]??c.effect??"Effect";
      const details=[];
      if(c.formula&&FORMULA_RULES.has(c.effect))details.push(c.formula);
      if(c.damageType&&c.damageType!=="any"&&DAMAGE_RULES.has(c.effect))details.push(`${c.damageType} damage`);
      if(["extraDamage","sameTypeDamage"].includes(c.effect))details.push(c.canCrit?"can benefit from critical hits":"does not multiply on critical hits");
      if(c.sourceTypes?.length)details.push(`attacker/item user: ${c.sourceTypes.join(", ")}`);
      if(c.sourceSubtype)details.push(`attacker/item user subtype: ${c.sourceSubtype}`);
      if(c.targetTypes?.length)details.push(`target: ${c.targetTypes.join(", ")}`);
      if(c.targetSubtype)details.push(`target subtype: ${c.targetSubtype}`);
      if(c.activityName)details.push(`activity contains “${c.activityName}”`);
      if(c.trigger)details.push(triggerOptions(c.effect)[c.trigger]??DEFENSIVE_TRIGGERS[c.trigger]??c.trigger);
      if(c.ability)details.push(`ability: ${loc(cfg("abilities",{})[c.ability],c.ability)}`);
      if(c.status)details.push(`condition: ${c.status}`);
      if(c.effect==="activeEffect"&&c.activeEffectKey)details.push(`${c.activeEffectKey} = ${c.activeEffectValue}`);
      if(["advantage","disadvantage"].includes(c.effect))details.push(`on ${(ROLL_TARGETS[c.rollTarget||"attack"]??"rolls").toLowerCase()}${c.skill&&c.rollTarget==="skill"?` (${loc(cfg("skills",{})[c.skill],c.skill)})`:""}`);
      if(c.effect==="statusEffect")details.push(c.appliesTo==="target"?"applied to the target from the chat card":"on the item user");
      return `${tier} — ${c.name||effect}: ${effect}${details.length?` (${details.join("; ")})`:""} [${handlingLabel(c,this._nativeItemType(),{ownUse:this._ownUse()})}]`;
    }
    if(c.type==="reference")return `${tier} — ${c.name||"Special Rule"}: ${c.text||"No rules text entered"}`;
    if(c.type==="movement")return `${tier} — ${c.name}: ${c.mode==="override"?"set":"increase"} ${c.movementType} movement ${c.mode==="override"?"to":"by"} ${c.value} feet`;
    if(c.type==="sense")return `${tier} — ${c.name}: ${c.mode==="add"?"increase":"grant/set"} ${c.sense} ${c.value} feet`;
    if(c.type==="ability")return `${tier} — ${c.name}: ${c.mode==="override"?"set":"increase"} ${loc(cfg("abilities",{})[c.ability],c.ability)} ${c.mode==="override"?"to":"by"} ${c.value}`;
    if(c.type==="halfAsi")return `${tier} — ${c.name}: +1 ability score (maximum 20; ${c.selectionMode==="fixed"?loc(cfg("abilities",{})[c.ability],c.ability):"player choice"})`;
    if(c.type==="skill")return `${tier} — ${c.name}: ${String(c.proficiency)==="2"?"expertise":"proficiency"} in ${loc(cfg("skills",{})[c.skill],c.skill)}${c.ability?` using ${loc(cfg("abilities",{})[c.ability],c.ability)}`:""}`;
    if(c.type==="spell"){const spell=this.catalog.spells.find(s=>s.uuid===c.spellUuid)??resolveUuidSync(c.spellUuid);return `${tier} — ${c.name}: grants ${spell?.name??"selected spell"}`;}
    if(c.type==="reaction")return `${tier} — ${c.name}: ${reactionSummary(c,k=>loc(cfg("abilities",{})[k],k))}`;
    return `${tier} — ${c.name||c.type}`;
  }

  _effect(c,itemName,activeTier){
    if(!["movement","sense","ability","skill","halfAsi"].includes(c.type))return null;
    const active=Number(c.tier)<=Number(activeTier);
    const changes=[];

    if(c.type==="movement"){
      changes.push({key:movementKey(c.movementType),type:c.mode==="override"?"override":"add",value:String(c.value),priority:20});
    } else if(c.type==="sense"){
      changes.push({key:senseKey(c.sense),type:c.mode==="override"?"override":c.mode==="add"?"add":"upgrade",value:String(c.value),priority:20});
    } else if(c.type==="ability"){
      changes.push({key:`system.abilities.${c.ability}.value`,type:c.mode==="override"?"override":"add",value:String(c.value),priority:20});
    } else if(c.type==="halfAsi"){
      // Tier-1 feats use D&D5e's own advancement; only owned copies the advancement never ran on keep an effect.
      if(halfAsiIsNative(c,this._nativeItemType())&&(!this.editItem?.parent||halfAsiHandled(this.editItem,c)))return null;
      const ability=c.selectionMode==="fixed"?c.ability:c.selectedAbility;
      if(!ability)return null;
      changes.push(halfAsiChange(ability));
    } else if(c.type==="skill"){
      changes.push({key:`system.skills.${c.skill}.value`,type:"override",value:String(String(c.proficiency)==="2"?2:1),priority:20});
      if(c.ability)changes.push({key:`system.skills.${c.skill}.ability`,type:"override",value:String(c.ability),priority:21});
    }

    return withEffectChanges({name:`${itemName}: ${c.name}`,img:"icons/svg/aura.svg",transfer:true,disabled:!active,flags:{[MODULE_ID]:{componentId:c.id,minTier:Number(c.tier)||1,activation:c.activation,managed:true}}},changes);
  }

  _rule(c){
    return ruleFromComponent(c,this._nativeItemType(),{ownUse:this._ownUse()});
  }

  /** Does the item make its own attack, damage, or healing rolls (so rules can be built into its activities)? */
  _ownUse(){
    if(this.editItem)return itemHasOwnUse(this.editItem);
    return ["weapon","spell"].includes(this._nativeItemType());
  }

  /** Native D&D5e item type this build produces. */
  _nativeItemType(){
    const b=this.builderData;
    if(this.editItem)return this.editItem.type;
    return b.category==="weapon"?"weapon":["armor","focus","equipment"].includes(b.category)?"equipment":b.category;
  }

  async _createSpellActivity(item,c){
    return createSpellActivity(item,c);
  }

  async _createItem(){
    const b=this.builderData;
    if(!b.name.trim())return ui.notifications.error("Item name is required.");
    if(!this.editItem && ["weapon","armor","focus"].includes(b.category) && !b.baseUuid)
      return ui.notifications.error(`Choose a base ${b.category==="focus"?"spellcasting focus":b.category} first.`);

    let data;

    // Editing an existing item starts from that exact item's native data so
    // Item Builder does not wipe its activities, properties, damage, armor,
    // uses, or other D&D5e configuration.
    if(this.editItem){
      data=this.editItem.toObject();
      delete data._id;
      data.name=b.name.trim();
    } else if(b.baseUuid){
      const base=await resolveUuid(b.baseUuid);
      if(!base)return ui.notifications.error("The selected base item could not be loaded.");
      data=base.toObject();
      delete data._id;
      data.name=b.name.trim();
    }else{
      const nativeType=b.category==="weapon"?"weapon":["armor","focus","equipment"].includes(b.category)?"equipment":b.category;
      data={name:b.name.trim(),type:nativeType,img:"icons/svg/item-bag.svg",system:{description:{value:"",chat:""}}};
    }

    data.system ??= {};
    data.system.description ??= {value:"",chat:""};
    // The description is only what the GM wrote: no generated feature list in the item or its chat card.
    data.system.description.value=b.description.trim()?`<p>${esc(b.description).replace(/\n/g,"<br>")}</p>`:"";
    if(b.category==="feat"){
      // Prerequisites go in D&D5e's own Requirements field.
      const req=[];
      if(b.levelRequirement)req.push(`Level ${Number(b.levelRequirement)}`);
      if(b.requirementAbility&&b.requirementScore)req.push(`${loc(cfg("abilities",{})[b.requirementAbility],b.requirementAbility)} ${Number(b.requirementScore)}`);
      if(req.length)data.system.requirements=req.join(", ");
    }
    if(b.category==="feat"){
      if(!data.system.type||typeof data.system.type!=="object")data.system.type={};
      data.system.type.value="feat";
      data.system.type.subtype=b.featType||"general";
      data.system.prerequisites??={};
      data.system.prerequisites.level=b.levelRequirement===""?null:Math.max(1,Math.min(20,Number(b.levelRequirement)||1));
    }else{
      writeRarity(data.system,b.rarity||"");
      const att=normalizeAttunement(b.attunement,data.system.attuned);
      data.system.attunement=att.attunement;
      if(!att.attunement)data.system.attuned=false;
      // D&D5e ignores attunement (and rarity-based magic) on items that are not marked Magical.
      if(att.attunement||b.rarity)addMagicalProperty(data.system);
      data.system.price={value:Math.max(0,Number(b.value)||0),denomination:b.currency||"gp"};
    }

    if (b.category === "weapon" && data.type === "weapon") applyWeaponDamage(data.system, b.weaponDamage);

    const enhancement = Number(b.enhancementBonus) || 0;
    if (["weapon","armor"].includes(b.category)) {
      if (enhancement > 0) addMagicalProperty(data.system);

      if (b.category === "weapon") {
        data.system.magicalBonus = enhancement;
      } else {
        data.system.armor ??= {};
        data.system.armor.magicalBonus = enhancement;
      }
    }

    data.flags ??= {};
    let nativeAsi={ids:{},removed:[]};
    if(data.type==="feat")nativeAsi=applyNativeAsi(data,b.components,Object.keys(cfg("abilities",{})),()=>foundry.utils.randomID());
    data.flags[MODULE_ID]={
      schemaVersion:12,nativeAsiIds:nativeAsi.ids,nativePatches:data.flags?.[MODULE_ID]?.nativePatches??"",reactions:data.flags?.[MODULE_ID]?.reactions??"",progressionNotes:b.progressionNotes||"",currentTier:b.currentTier,tiers:foundry.utils.deepClone(b.tiers),
      components:foundry.utils.deepClone(b.components),
      rules:b.components.filter(c=>c.type==="conditional").map(c=>this._rule(c)),
      category:b.category,baseUuid:b.baseUuid,enhancementBonus:Number(b.enhancementBonus)||0,
      weaponType:b.weaponType,weaponDamage:b.category==="weapon"?foundry.utils.deepClone(b.weaponDamage):null,armorType:b.armorType,focusType:b.focusType,
      description:b.description,
      value:Math.max(0,Number(b.value)||0),currency:b.currency||"gp"
      ,levelRequirement:b.levelRequirement===""?null:Number(b.levelRequirement),featType:b.featType||"general",requirementAbility:b.requirementAbility||"",requirementScore:b.requirementScore===""?null:Number(b.requirementScore)
    };

    const effects=b.components.map(c=>this._effect(c,b.name,b.currentTier)).filter(Boolean);
    data.effects=[...(data.effects??[]),...effects];

    try{
      let item;
      if(this.editItem){
        // Preserve the existing document identity and native D&D5e data.
        const update=foundry.utils.deepClone(data);
        delete update._id;

        // Embedded Active Effects are managed separately below.
        delete update.effects;

        // Foundry merges object updates, so advancement Item Builder no longer wants is deleted explicitly.
        for(const id of nativeAsi.removed)delete update.system?.advancement?.[id];
        await this.editItem.update(update);
        item=this.editItem;
        for(const id of nativeAsi.removed){
          try{ await item.deleteAdvancement?.(id); }
          catch(err){ console.warn(`${MODULE_ID} | could not remove old Half-ASI advancement`,err); }
        }

        // Remove old builder-managed Active Effects so the current component
        // definition is authoritative.
        const managed=[...(item.effects??[])].filter(e=>e.getFlag(MODULE_ID,"managed")&&!e.getFlag(MODULE_ID,"ruleEffect")).map(e=>e.id);
        if(managed.length)await item.deleteEmbeddedDocuments("ActiveEffect",managed);

        const freshEffects=b.components.map(c=>this._effect(c,b.name,b.currentTier)).filter(Boolean);
        if(freshEffects.length)await item.createEmbeddedDocuments("ActiveEffect",freshEffects);

        // Existing Cast activities are left intact for now unless newly required.
        for(const c of b.components.filter(c=>c.type==="spell"&&Number(c.tier)<=b.currentTier)){
          if(!hasCastActivity(item,c.spellUuid))await this._createSpellActivity(item,c);
        }

        await syncRuleEffects(item);
        await syncReactions(item);
        ui.notifications.info(`Item Builder: Updated "${item.name}".`);
      }else{
        item=await Item.create(data,{renderSheet:false});
        for(const c of b.components.filter(c=>c.type==="spell"&&Number(c.tier)<=b.currentTier))await this._createSpellActivity(item,c);
        await syncRuleEffects(item);
        await syncReactions(item);
        ui.notifications.info(`Item Builder: Created "${item.name}".`);
      }
      item.sheet?.render({force:true});
    }catch(err){console.error(`${MODULE_ID} | save failed`,err);ui.notifications.error(`Item Builder could not save the item: ${err.message}`)}
  }
}

// ---- granted spells (shared by the builder and tier progression) ----
function castActivityData(spell,c={}){
  const data={name:spell.name,spell:{uuid:spell.uuid,spellbook:c.displayInSpellbook!==false}};
  if(c.castingAbility)data.spell.ability=c.castingAbility;
  if(c.level!==""&&c.level!==undefined&&c.level!==null&&Number.isFinite(Number(c.level)))data.spell.level=Number(c.level);
  const uses=usesFormula(c);
  if(uses){
    data.uses={max:uses,spent:0,recovery:["sr","lr","dawn","day"].includes(c.recovery)?[{period:c.recovery,type:"recoverAll"}]:[]};
    data.consumption={targets:[{type:"activityUses",value:"1"}],spellSlot:false};
  }
  return data;
}

function hasCastActivity(item,uuid){
  return [...(item.system?.activities??[])].some(a=>a.type==="cast"&&(a.spell?.uuid===uuid||a.system?.spell?.uuid===uuid));
}

async function createSpellActivity(item,c){
  if(!c?.spellUuid)return;
  const spell=await resolveUuid(c.spellUuid);
  if(!spell||spell.type!=="spell")return ui.notifications.warn(`${c.name||item.name}: selected spell could not be loaded.`);
  try{await item.createActivity("cast",castActivityData(spell,c),{renderSheet:false})}
  catch(err){
    console.warn(`${MODULE_ID} | Cast activity full payload rejected; retrying minimal`,err);
    try{await item.createActivity("cast",{name:spell.name,spell:{uuid:spell.uuid}},{renderSheet:false})}
    catch(err2){console.error(`${MODULE_ID} | Cast activity failed`,err2);ui.notifications.error(`${c.name}: spell could not be added as a Cast activity.`)}
  }
}

async function setTier(item,newTier){
  const tiers=item.getFlag(MODULE_ID,"tiers")??[];
  newTier=Math.max(1,Math.min(Number(newTier)||1,tiers.length||1));
  await item.setFlag(MODULE_ID,"currentTier",newTier);

  const updates=[];
  for(const effect of item.effects??[]){const min=Number(effect.getFlag(MODULE_ID,"minTier")??1);if(effect.getFlag(MODULE_ID,"managed"))updates.push({_id:effect.id,disabled:min>newTier})}
  if(updates.length)await item.updateEmbeddedDocuments("ActiveEffect",updates);

  const comps=item.getFlag(MODULE_ID,"components")??[];
  for(const c of comps.filter(c=>c.type==="spell"&&(Number(c.tier)||1)<=newTier&&c.spellUuid)){
    if(hasCastActivity(item,c.spellUuid))continue;
    try{await createSpellActivity(item,c)}catch(err){console.warn(`${MODULE_ID} | tier spell unlock failed`,err)}
  }
  await syncRuleEffects(item);
  await syncReactions(item);
  ui.notifications.info(`${item.name}: now ${tiers[newTier-1]?.name??`Tier ${newTier}`}.`);
  item.sheet?.render({force:true});
}

function openBuilder(){
  try{
    if(!game.user.isGM)return ui.notifications.warn("Item Builder 5e is GM-only.");
    return new ItemBuilder5e().render({force:true});
  }catch(err){
    console.error(`${MODULE_ID} | failed to open`,err);
    ui.notifications.error(`Item Builder failed to open: ${err.message}`);
  }
}

Hooks.once("init",()=>{
  registerRuleHooks();
  registerTokenSizeHooks();
  registerHelpMenu();
  // Retained as a hidden legacy setting so existing worlds do not lose stored configuration.
  // Extra damage now travels through D&D5e's native damage card and application controls.
  game.settings.register(MODULE_ID,"autoExtra",{name:"Legacy automatic conditional extra damage",scope:"world",config:false,type:Boolean,default:true,restricted:true});
  game.settings.register(MODULE_ID,"effectMigration",{scope:"world",config:false,type:String,default:"",restricted:true});
  game.settings.register(MODULE_ID,"debugRules",{name:"Item Builder rule diagnostics",hint:"Logs the actual source/target creature metadata and rule match result to the browser console.",scope:"world",config:true,type:Boolean,default:false,restricted:true});
});
Hooks.once("ready",()=>{
  game.modules.get(MODULE_ID).api={
    open:openBuilder,
    guide:section=>ItemBuilderHelp.open(section),
    edit:item=>new ItemBuilder5e({editItem:item}).render({force:true}),
    setTier,
    match,
    ruleDiagnostic,
    syncRuleEffects,
    exportItems:exportItemsToFile,
    openExport:()=>new ItemExportApp().render({force:true}),
    openImport:()=>new ItemImportApp().render({force:true})
  };
  void migrateManagedEffects();
});

/**
 * One-time GM migration: rewrite movement/sense keys on Item Builder-managed
 * effects so they target the paths used by the running D&D5e version
 * (movement.speeds.* on 6.0, senses.ranges.* on 5.3 and 6.0). D&D5e shims the
 * old keys, but those shims are scheduled for removal.
 */
async function migrateManagedEffects(){
  try{
    if(!game.user.isGM||game.users.activeGM?.id!==game.user.id)return;
    const stamp=`${MODULE_VERSION}|${game.system.version}|${game.release?.generation??""}`;
    if(game.settings.get(MODULE_ID,"effectMigration")===stamp)return;
    const items=[...game.items];
    for(const actor of game.actors)items.push(...actor.items);
    let count=0,rebuilt=0;
    for(const item of items){
      if(!item.flags?.[MODULE_ID])continue;
      // Items saved before 0.7.0 are missing rule effects (0.6.0) or automation conditions (0.7.0).
      // Rebuild their native Active Effects and stored rules from the components.
      // Items saved before 0.8.0 get their rules rebuilt "native first" (built into activities and
      // D&D5e rule changes), and unowned feats get their Half-ASI as D&D5e advancement.
      if((Number(item.getFlag(MODULE_ID,"schemaVersion"))||0)<10){
        try{
          const components=item.getFlag(MODULE_ID,"components")??[];
          if(components.some(c=>c.type==="conditional")){await syncRuleEffects(item);rebuilt++;}
          if(await upgradeHalfAsi(item))rebuilt++;
          await item.setFlag(MODULE_ID,"schemaVersion",10);
        }catch(err){console.warn(`${MODULE_ID} | could not rebuild rules on ${item.name}`,err)}
      }
      // 0.8.1: descriptions hold only the GM's text (the generated feature list showed in chat cards).
      if((Number(item.getFlag(MODULE_ID,"schemaVersion"))||0)<11){
        try{
          const html=item.system?.description?.value??"";
          const clean=stripBuilderDescription(html);
          const update={[`flags.${MODULE_ID}.schemaVersion`]:11};
          if(clean!==html)update["system.description.value"]=clean;
          // The prerequisite line moves to D&D5e's own Requirements field.
          if(item.type==="feat"&&!item.system?.requirements){
            const f=item.flags[MODULE_ID],req=[];
            if(f.levelRequirement)req.push(`Level ${Number(f.levelRequirement)}`);
            if(f.requirementAbility&&f.requirementScore)req.push(`${loc(cfg("abilities",{})[f.requirementAbility],f.requirementAbility)} ${Number(f.requirementScore)}`);
            if(req.length)update["system.requirements"]=req.join(", ");
          }
          await item.update(update);
        }catch(err){console.warn(`${MODULE_ID} | could not rebuild rules on ${item.name}`,err)}
      }
      // 0.10.1: items that require attunement must be Magical, or D&D5e drops the attunement.
      if((Number(item.getFlag(MODULE_ID,"schemaVersion"))||0)<12){
        try{
          const update={[`flags.${MODULE_ID}.schemaVersion`]:12,...(magicalPropertyUpdate(item)??{})};
          await item.update(update);
          if(update["system.properties"])rebuilt++;
        }catch(err){console.warn(`${MODULE_ID} | could not mark ${item.name} magical`,err)}
      }
      for(const effect of item.effects){
        if(!effect.getFlag(MODULE_ID,"managed"))continue;
        const changes=readEffectChanges(effect);
        const remapped=changes.map(c=>({...c,key:remapChangeKey(c.key)}));
        if(remapped.every((c,i)=>c.key===changes[i].key))continue;
        await effect.update(effectChangesUpdate(remapped));
        count++;
      }
    }
    await game.settings.set(MODULE_ID,"effectMigration",stamp);
    if(count)console.log(`${MODULE_ID} | migrated ${count} managed effect(s) to D&D5e ${game.system.version} paths`);
    if(rebuilt){
      console.log(`${MODULE_ID} | rebuilt rule effects on ${rebuilt} item(s)`);
      ui.notifications.info(`Item Builder: updated rule effects on ${rebuilt} existing item${rebuilt===1?"":"s"}.`);
    }
  }catch(err){console.error(`${MODULE_ID} | effect migration failed`,err)}
}

Hooks.on("renderItemDirectory",(_app,html)=>{
  if(!game.user.isGM)return;
  const root=html instanceof HTMLElement?html:html?.[0];
  if(!root||root.querySelector(".ib33-directory-button"))return;
  let header=root.querySelector(".directory-header .header-actions")??root.querySelector(".header-actions");
  if(!header){
    const host=root.querySelector(".directory-header")??root.querySelector(":scope > header");
    if(!host)return;
    header=document.createElement("div");header.className="header-actions action-buttons flexrow";host.prepend(header);
  }
  const wrap=document.createElement("div");wrap.className="ib50-directory-row";
  const make=(cls,icon,label,title,fn)=>{const b=document.createElement("button");b.type="button";b.className=cls;b.innerHTML=`<i class="fa-solid ${icon}" inert></i>${label?` ${label}`:""}`;b.title=title;b.setAttribute("aria-label",title);b.addEventListener("click",e=>{e.preventDefault();fn();});return b;};
  wrap.append(
    make("ib33-directory-button","fa-hammer","Item Builder","Open Item Builder",openBuilder),
    make("ib50-directory-icon","fa-file-import","","Import Item Builder items",()=>new ItemImportApp().render({force:true})),
    make("ib50-directory-icon","fa-file-export","","Export items for another world",()=>new ItemExportApp().render({force:true})),
    make("ib50-directory-icon","fa-book-open","","Item Builder guide",()=>ItemBuilderHelp.open())
  );
  header.after(wrap);
});

/** Half-ASI components on an owned feat that still need Item Builder's fallback (native advancement never ran). */
function pendingHalfAsi(item){
  if(!item?.parent||item.parent.documentName!=="Actor")return [];
  const owned=new Set([...(item.effects??[])].map(e=>e.getFlag?.(MODULE_ID,"componentId")).filter(Boolean));
  return (item.getFlag?.(MODULE_ID,"components")??[]).filter(c=>c.type==="halfAsi"&&!halfAsiHandled(item,c)&&!owned.has(c.id)&&(c.selectionMode==="fixed"?!!c.ability:!c.selectedAbility));
}

async function writeHalfAsiEffect(item,component,ability){
  const old=[...(item.effects??[])].filter(e=>e.getFlag(MODULE_ID,"componentId")===component.id).map(e=>e.id);
  if(old.length)await item.deleteEmbeddedDocuments("ActiveEffect",old);
  const currentTier=Number(item.getFlag(MODULE_ID,"currentTier")??1);
  await item.createEmbeddedDocuments("ActiveEffect",[withEffectChanges({name:`${item.name}: ${component.name}`,img:"icons/svg/upgrade.svg",transfer:true,disabled:(Number(component.tier)||1)>currentTier,flags:{[MODULE_ID]:{componentId:component.id,minTier:Number(component.tier)||1,activation:"always",managed:true,halfAsi:true}}},[halfAsiChange(ability)])]);
}

/** Fixed Half-ASIs on an owned feat whose advancement never ran get their effect without a prompt. */
async function applyFixedHalfAsi(item){
  if(!item?.isOwner)return;
  for(const c of pendingHalfAsi(item).filter(c=>c.selectionMode==="fixed"))await writeHalfAsiEffect(item,c,c.ability);
}

async function chooseHalfAsi(item,componentId=null){
  if(!item?.parent||item.parent.documentName!=="Actor"||!item.isOwner)return false;
  const components=foundry.utils.deepClone(item.getFlag(MODULE_ID,"components")??[]);
  const pending=new Set(pendingHalfAsi(item).filter(c=>c.selectionMode==="choice").map(c=>c.id));
  const component=components.find(c=>pending.has(c.id)&&(!componentId||c.id===componentId));
  if(!component)return false;
  const actor=item.parent;
  const allowed=(component.allowedAbilities?.length?component.allowedAbilities:Object.keys(cfg("abilities",{}))).filter(key=>Number(actor.system?.abilities?.[key]?.value??0)<20);
  if(!allowed.length){ui.notifications.warn(`${item.name}: every allowed ability is already 20.`);return false;}
  const choices=Object.fromEntries(allowed.map(key=>[key,`${loc(cfg("abilities",{})[key],key)} (${Number(actor.system?.abilities?.[key]?.value??0)} → ${Math.min(20,Number(actor.system?.abilities?.[key]?.value??0)+1)})`]));
  const content=`<form><div class="form-group"><label>Increase an Ability by 1 (Maximum 20)</label><select name="ability">${selectOptions(choices,allowed[0],false)}</select></div></form>`;
  const selected=await DialogV2.prompt({window:{title:`${item.name}: Choose Ability Score`},content,ok:{label:"Choose",callback:(_e,button)=>button.form.elements.ability.value}});
  if(!selected)return false;
  component.selectedAbility=selected;
  await item.setFlag(MODULE_ID,"components",components);
  await writeHalfAsiEffect(item,component,selected);
  ui.notifications.info(`${item.name}: ${loc(cfg("abilities",{})[selected],selected)} increases by 1, to a maximum of 20.`);
  return true;
}

// Feats normally go through D&D5e's advancement flow when dropped on a character. Only when that
// flow did not run (created by script, another module, or a higher-tier Half-ASI) does Item Builder step in.
Hooks.on("createItem",(item,_options,userId)=>{
  if(userId!==game.user.id||item?.parent?.documentName!=="Actor")return;
  setTimeout(async()=>{
    try{
      await applyFixedHalfAsi(item);
      if(!game.user.isGM)await chooseHalfAsi(item);
    }catch(err){console.warn(`${MODULE_ID} | Half-ASI fallback failed`,err)}
  },250);
});

function injectItemBuilderSheetControls(app, element){
  try{
    const root=element instanceof HTMLElement ? element : element?.[0] ?? app.element;
    const item=app?.document ?? app?.item;
    if(!(item instanceof Item)||!root)return;
    const header=root.querySelector(".window-header") ?? root.querySelector(".sheet-header") ?? root;
    if(!header)return;

    const pending=pendingHalfAsi(item).find(c=>c.selectionMode==="choice");
    if(pending&&item.parent?.documentName==="Actor"&&item.isOwner&&!root.querySelector(".ib324-choice-button")){
      const choose=document.createElement("button");choose.type="button";choose.className="ib310-sheet-button ib324-choice-button";choose.innerHTML='<i class="fa-solid fa-arrow-up-1-9"></i>';choose.title="Choose Half-ASI Ability";choose.setAttribute("aria-label","Choose Half-ASI Ability");choose.addEventListener("click",async e=>{e.preventDefault();e.stopPropagation();if(await chooseHalfAsi(item,pending.id))app.render?.({force:true});});
      const close=header.querySelector('[data-action="close"], .close');if(close)close.before(choose);else header.append(choose);
    }

    // Never show Item Builder sheet controls to players.
    if(!game.user.isGM){
      root?.querySelectorAll?.(".ib310-edit-button,.ib310-tier-button,.ib39-edit-button,.ib33-tier-button,.ib50-export-button").forEach(el=>el.remove());
      return;
    }

    if(!root.querySelector(".ib310-edit-button")){
      const edit=document.createElement("button");
      edit.type="button";
      edit.className="ib310-sheet-button ib310-edit-button";
      edit.innerHTML='<i class="fa-solid fa-pen-to-square"></i>';
      edit.setAttribute("aria-label","Edit in Item Builder");
      edit.title="Edit in Item Builder";
      edit.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        new ItemBuilder5e({editItem:item}).render({force:true});
      });

      const close=header.querySelector('[data-action="close"], .close');
      if(close)close.before(edit);
      else header.append(edit);
    }

    if(!root.querySelector(".ib50-export-button")){
      const exp=document.createElement("button");
      exp.type="button";
      exp.className="ib310-sheet-button ib50-export-button";
      exp.innerHTML='<i class="fa-solid fa-file-export"></i>';
      exp.title="Export for another world (Item Builder)";
      exp.setAttribute("aria-label",exp.title);
      exp.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();void exportItemsToFile([item]);});
      const editButton=header.querySelector(".ib310-edit-button");
      if(editButton)editButton.after(exp);else header.append(exp);
    }

    const tiers=item.getFlag?.(MODULE_ID,"tiers")??[];
    if(game.user.isGM && tiers.length>1 && !root.querySelector(".ib310-tier-button")){
      const current=Number(item.getFlag(MODULE_ID,"currentTier")??1);
      const tierButton=document.createElement("button");
      tierButton.type="button";
      tierButton.className="ib310-sheet-button ib310-tier-button";
      tierButton.innerHTML=`<i class="fa-solid fa-arrow-trend-up"></i><span class="ib310-tier-badge">${current}</span>`;
      tierButton.setAttribute("aria-label",`Item Builder Tier: ${tiers[current-1]?.name??`Tier ${current}`}`);
      tierButton.title=`Item Builder Tier: ${tiers[current-1]?.name??`Tier ${current}`}`;
      tierButton.addEventListener("click",async e=>{
        e.preventDefault();
        e.stopPropagation();
        const notes=String(item.getFlag(MODULE_ID,"progressionNotes")??"").trim();
        const tierNotes=tiers.map((t,i)=>`<li class="${i+1===current?"current":""}"><strong>${esc(t.name??`Tier ${i+1}`)}</strong>${i+1===current?" <em>(current)</em>":""}${t.gmNote?`<br>${esc(t.gmNote).replace(/\n/g,"<br>")}`:""}</li>`).join("");
        const hasNotes=notes||tiers.some(t=>t.gmNote);
        const content=`<form class="ib91-tier-dialog"><div class="form-group"><label>Current Tier</label><select name="tier">${tierOptions(tiers,current)}</select></div>${hasNotes?`<div class="ib91-gm-notes"><p><i class="fa-solid fa-eye-slash"></i> <strong>GM notes</strong></p><ol>${tierNotes}</ol>${notes?`<p>${esc(notes).replace(/\n/g,"<br>")}</p>`:""}</div>`:""}</form>`;
        const result=await DialogV2.prompt({
          window:{title:`${item.name}: Progression Tier`},
          content,
          ok:{label:"Apply",callback:(_e,button)=>Number(button.form.elements.tier.value)}
        });
        if(result)await setTier(item,result);
      });

      const editButton=header.querySelector(".ib310-edit-button");
      if(editButton)editButton.before(tierButton);
      else header.append(tierButton);
    }
  }catch(err){
    console.error(`${MODULE_ID} | failed to inject item-sheet controls`,err);
  }
}

// Foundry v13 / D&D5e ApplicationV2 sheets.
Hooks.on("renderApplicationV2",(app,element)=>injectItemBuilderSheetControls(app,element));

// More-specific V2 hook where available.
Hooks.on("renderItemSheetV2",(app,element)=>injectItemBuilderSheetControls(app,element));

// Legacy fallback for alternate/older sheet implementations.
Hooks.on("renderItemSheet",(app,html)=>injectItemBuilderSheetControls(app,html));
