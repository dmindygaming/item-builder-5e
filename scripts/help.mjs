/**
 * In-game guide for Item Builder 5e: a window with a linked table of contents that tells GMs
 * where every feature lives. Opened from the builder header, the Items sidebar, and Module Settings.
 */
import { MODULE_ID } from "./compat.mjs";

const { ApplicationV2 } = foundry.applications.api;

/* Where-to-find-it breadcrumbs: <span class="where">Items sidebar → Item Builder</span> */
const where = path => `<p class="ibh-where"><i class="fa-solid fa-location-dot"></i> ${path}</p>`;

/** Guide sections, in order. Each becomes a table-of-contents entry with a link. */
export const HELP_SECTIONS = [
  {
    id: "start", title: "Getting Started", icon: "fa-play",
    body: `
      <p>Item Builder makes D&amp;D5e magic items, weapons, armor, foci, consumables and feats without hand-editing item data. Everything it can is written into the item itself, so items keep working for players, in other worlds, and even with Item Builder disabled.</p>
      <h4>Open the builder</h4>
      ${where("Items sidebar → <b>Item Builder</b> button at the top")}
      <h4>Edit an item made with Item Builder</h4>
      ${where("Open the item's sheet → <b>edit</b> (<i class='fa-solid fa-pen-to-square'></i>) button in the sheet header (“Edit in Item Builder”)")}
      <h4>Save</h4>
      ${where("Builder → <b>Create Item</b> / <b>Save Changes</b> at the bottom right")}
      <p>The <b>Preview</b> panel on the right summarises the item as you build it. Hover the <i class="fa-solid fa-circle-info"></i> icons next to fields for tips.</p>
      <h4>Open this guide</h4>
      ${where("Builder → <b>Guide</b> button (opens at the tab you're on), or Items sidebar → <b>book</b> icon, or Game Settings → Configure Settings → Item Builder 5e → <b>Open Guide</b>")}
      <p class="ibh-note"><b>GM only.</b> The builder, the edit, tier and export buttons are only shown to GMs.</p>`
  },
  {
    id: "basics", title: "Basics Tab", icon: "fa-tag",
    body: `
      ${where("Builder → <b>Basics</b> tab")}
      <dl>
        <dt>Name</dt><dd>The item's name.</dd>
        <dt>Item Category</dt><dd>Weapon, Armor, Spellcasting Focus, Other Equipment, Consumable, or Feat / Feature. The other fields change to match.</dd>
        <dt>Weapon Type / Armor Type / Spellcasting Class</dt><dd>Narrows the Base Item list (weapons, armor and shields, or the foci a class can use).</dd>
        <dt>Base Item</dt><dd>Starts from a real D&amp;D5e item (Longsword, Plate, Arcane Focus…), keeping its native data. Click the list and type to search; arrow keys and Enter pick a result.</dd>
        <dt>Damage Dice, Damage Type, Versatile Dice</dt><dd>Weapons only. Filled from the base weapon; change them to make a custom weapon.</dd>
        <dt>Enhancement Bonus</dt><dd>Weapons and armor. Makes the native +1/+2/+3 version (attack and damage, or AC) and marks the item Magical.</dd>
        <dt>Rarity, Attunement, Value</dt><dd>Stored in D&amp;D5e's own fields. Setting attunement or a rarity also marks the item Magical, which D&amp;D5e needs for attunement to count.</dd>
        <dt>2024 Feat Type, Required Level, Required Ability, Minimum Ability Score</dt><dd>Feats only. Prerequisites go in the feat's D&amp;D5e Requirements field.</dd>
      </dl>`
  },
  {
    id: "description", title: "Description Tab", icon: "fa-align-left",
    body: `
      ${where("Builder → <b>Description</b> tab → Item Description")}
      <p>Your text for the item. Below it, the item's description automatically lists its <b>Item Properties</b> at the current tier (for example “+1 bonus to attack and damage rolls”, “You can cast Misty Step 5 times per long rest”, a reaction, or a resistance), so players can see what it does. Properties from locked tiers are not listed; when you raise the tier, they appear. Chat cards show only your text.</p>`
  },
  {
    id: "components", title: "Components Tab", icon: "fa-puzzle-piece",
    body: `
      ${where("Builder → <b>Components</b> tab → buttons at the top")}
      <p>Components are the item's mechanics. The add buttons are grouped into three rows:</p>
      <ul>
        <li><b>Character Traits</b> — <a data-jump="movement">Movement</a>, <a data-jump="senses">Senses</a>, <a data-jump="ability">Ability Score</a>, <a data-jump="skill">Skill</a>, and <a data-jump="halfasi">2024 Half-ASI</a> (feats only).</li>
        <li><b>Actions</b> — <a data-jump="spell">Spell</a>, <a data-jump="reaction">Reaction</a>, <a data-jump="rulestext">Rules Text</a>.</li>
        <li><b>Restrictions</b> — <a data-jump="requirement">Use Requirement</a>.</li>
        <li><b>Rule Effects</b> — <a data-jump="offensive">Offensive</a>, <a data-jump="defensive">Defensive</a>, <a data-jump="healing">Healing / Recovery</a>, <a data-jump="utility">Utility / Control</a>.</li>
      </ul>
      <p>Every component card has a name (top of the card), a <b>Begins at</b> tier (see <a data-jump="progression">Progression</a>), a trash button to remove it, and its own settings.</p>`
  },
  {
    id: "movement", title: "Movement", icon: "fa-person-running", parent: "components",
    body: `${where("Components → Character Traits → <b>Movement</b>")}
      <p>Increase a speed by some feet, or grant/set a speed (walk, fly, swim, climb, burrow). <b>Active While</b> chooses Owned, Equipped or Attuned.</p>`
  },
  {
    id: "senses", title: "Senses", icon: "fa-eye", parent: "components",
    body: `${where("Components → Character Traits → <b>Senses</b>")}
      <p>Darkvision, blindsight, tremorsense, truesight or <b>Devil's Sight</b>: grant a minimum range, increase an existing range, or set it. Devil's Sight gives darkvision at that range and notes Devil's Sight under the character's special senses (D&amp;D5e has no separate Devil's Sight sense).</p>`
  },
  {
    id: "ability", title: "Ability Score", icon: "fa-dumbbell", parent: "components",
    body: `${where("Components → Character Traits → <b>Ability Score</b>")}
      <p>Increase an ability score, or set it (like a Belt of Giant Strength).</p>`
  },
  {
    id: "skill", title: "Skill", icon: "fa-graduation-cap", parent: "components",
    body: `${where("Components → Character Traits → <b>Skill</b>")}
      <p>Proficiency or Expertise in a skill, optionally using a different ability.</p>`
  },
  {
    id: "halfasi", title: "2024 Half-ASI", icon: "fa-arrow-up-1-9", parent: "components",
    body: `${where("Basics → Item Category: Feat → Components → Character Traits → <b>2024 Half-ASI</b>")}
      <p>+1 to an ability (maximum 20). <b>Who Chooses?</b> lets the player pick from the abilities you allow, or you set it.</p>
      <p>On a tier-1 feat it becomes D&amp;D5e's own Ability Score Improvement, so D&amp;D5e asks for the +1 when the feat is dropped on a character. If that prompt never ran, a <b>choose ability</b> button appears in the feat's sheet header.</p>`
  },
  {
    id: "spell", title: "Spell", icon: "fa-wand-sparkles", parent: "components",
    body: `${where("Components → Actions → <b>Spell</b>")}
      <p>Grants a spell the item can cast. Click the <b>Spell</b> list and type to search. Set the casting ability and level, whether it shows in Item Spells, and its <a data-jump="uses">Uses</a>.</p>`
  },
  {
    id: "reaction", title: "Reaction", icon: "fa-bolt-lightning", parent: "components",
    body: `${where("Components → Actions → <b>Reaction</b>")}
      <p>Something the user does with their reaction. It appears on the character sheet as a D&amp;D5e reaction.</p>
      <dl>
        <dt>Trigger</dt><dd>Hit by an attack, targeted, taking damage, making a save, an ally attacked, a creature leaving your reach, or a custom trigger.</dd>
        <dt>What Happens</dt><dd>Bonus to AC, resistance, or a save bonus until your next turn; reduce the triggering damage; damage the attacker or make them save; regain hit points or gain temporary hit points; or rules text only.</dd>
        <dt>Uses / Recovery</dt><dd>See <a data-jump="uses">Uses</a>.</dd>
      </dl>
      <p class="ibh-note">D&amp;D5e does not prompt for reactions; the player uses it from their sheet when it's triggered.</p>`
  },
  {
    id: "rulestext", title: "Rules Text", icon: "fa-align-left", parent: "components",
    body: `${where("Components → Actions → <b>Rules Text</b>")}
      <p>A rule Item Builder doesn't automate, kept with the item's components for reference (for example “you can wield this two-handed weapon in one hand”).</p>`
  },
  {
    id: "requirement", title: "Use Requirement", icon: "fa-user-lock", parent: "components",
    body: `${where("Components → Restrictions → <b>Use Requirement</b>")}
      <p>Who the item is meant for, and what happens to anyone else.</p>
      <dl>
        <dt>Who Can Use It</dt><dd>A specific class (any of the ones you tick), a minimum ability score (such as Strength 15), or a minimum character level.</dd>
        <dt>If Someone Else Uses It</dt><dd>They cannot attune to it; they cannot equip or wield it; they take damage when they try (and can also fail); disadvantage on attack rolls made with it; disadvantage on ability checks and saving throws (all, or one ability); their speed is reduced; or rules text only.</dd>
      </dl>
      <p>Item Builder checks the character when they attune, equip or use the item, and again when their class, level or ability scores change. The requirement is listed in the item's description.</p>`
  },
  {
    id: "rules", title: "Rule Effects: How They Work", icon: "fa-sliders",
    body: `
      ${where("Components → Rule Effects → any of the four buttons")}
      <p>Each rule effect card has three parts:</p>
      <ol>
        <li><b>Effect</b> and its settings at the top (amount, damage type, when it applies…).</li>
        <li><b>Only when… (optional)</b> — creature type, subtype, and attack or ability name filters. Leave them blank and the effect always applies; every box you fill in must match.</li>
        <li>A <b>plain-English summary</b> at the bottom that updates as you edit.</li>
      </ol>
      <p>The coloured banner on each card says how the rule works:</p>
      <ul class="ibh-badges">
        <li><span class="ibh-badge native">Built into item</span> written into the item's own D&amp;D5e data; works without Item Builder.</li>
        <li><span class="ibh-badge runtime">Automated</span> applied by Item Builder while it's enabled, because D&amp;D5e can't express it (usually rules that depend on the other creature).</li>
        <li><span class="ibh-badge reference">Reference only</span> shown for the GM to adjudicate.</li>
      </ul>
      <p>Rules follow the item's equipped and attuned state, and its <a data-jump="progression">tier</a>.</p>`
  },
  {
    id: "offensive", title: "Offensive Effects", icon: "fa-burst", parent: "rules",
    body: `${where("Components → Rule Effects → <b>Offensive</b> → Effect")}
      <ul>
        <li><b>Extra Damage</b>, <b>Additional Same-Type Damage</b> — with <b>Can This Damage Crit?</b></li>
        <li><b>Attack Bonus</b>, <b>Attack Advantage</b></li>
        <li><b>Increase Reach</b> — on weapons, written into the weapon's reach.</li>
        <li><b>Ignore Half / Three-Quarters / All Cover</b></li>
        <li><b>Ignore Damage Resistance / Immunity / Both</b>, <b>Cause Damage Vulnerability</b></li>
      </ul>`
  },
  {
    id: "defensive", title: "Defensive Effects", icon: "fa-shield-halved", parent: "rules",
    body: `${where("Components → Rule Effects → <b>Defensive</b> → Effect")}
      <ul>
        <li><b>Resistance</b>, <b>Immunity</b>, <b>Vulnerability</b> — to one damage type or any damage.</li>
        <li><b>AC Bonus</b> — against any, melee, ranged or spell attacks.</li>
        <li><b>Saving Throw Bonus</b>, <b>Saving Throw Advantage</b> — any save, or only saves against spells, or against spells and magical effects.</li>
      </ul>
      <p><b>Applies When</b> picks the triggering event. <b>Attacker's Attack or Ability Named</b> (under Only when…) limits the rule to attacks whose name contains that text, e.g. “Bite”.</p>`
  },
  {
    id: "healing", title: "Healing / Recovery Effects", icon: "fa-heart-pulse", parent: "rules",
    body: `${where("Components → Rule Effects → <b>Healing / Recovery</b> → Effect")}
      <ul>
        <li><b>Bonus Healing</b> — healing the user does restores more.</li>
        <li><b>Healing Received Modifier</b> — healing the user receives changes.</li>
        <li><b>Temporary HP</b> — granted when the user's healing is applied.</li>
        <li><b>Recovery Roll Bonus</b> — extra per Hit Die spent.</li>
      </ul>`
  },
  {
    id: "utility", title: "Utility / Control Effects", icon: "fa-wand-magic-sparkles", parent: "rules",
    body: `${where("Components → Rule Effects → <b>Utility / Control</b> → Effect")}
      <ul>
        <li><b>Movement / Control</b> — change a speed (negative to reduce).</li>
        <li><b>Change Size</b> — grow or shrink by 1–3 sizes, or become a set size. Tokens on the map resize to match (see <a data-jump="size">Change Size</a>).</li>
        <li><b>Status / Condition</b> — the user has a condition while the item is active, or the item's attack and save cards get an Apply Effect button for the target.</li>
        <li><b>Advantage</b>, <b>Disadvantage</b> — on attacks, saves, checks, skills, initiative or concentration.</li>
        <li><b>Apply Active Effect</b> — any D&amp;D5e data key, for advanced GMs.</li>
      </ul>`
  },
  {
    id: "size", title: "Change Size", icon: "fa-up-right-and-down-left-from-center", parent: "rules",
    body: `${where("Components → Rule Effects → Utility / Control → Effect: <b>Change Size</b> → How / Amount")}
      <p><b>Grow</b> and <b>Shrink</b> are relative to the creature's normal size (Enlarge-style); <b>Become a set size</b> is absolute. The size is built into the item; resizing tokens on the map needs Item Builder running.</p>
      <p class="ibh-note">A copy of an item on a character is separate from the one in the Items sidebar. After editing the sidebar item, edit the character's copy too (or give them a fresh copy).</p>`
  },
  {
    id: "uses", title: "Uses & Recovery", icon: "fa-battery-half",
    body: `${where("Spell or Reaction component → <b>Uses</b> / <b>Recovery</b>")}
      <p><b>Uses</b>: Unlimited, Fixed number, Proficiency bonus, Ability modifier (minimum 1), or Proficiency bonus + ability modifier, with an ability choice. Uses scale with the character automatically.</p>
      <p><b>Recovery</b> (limited uses only): Long Rest, Short Rest, Dawn, Day, or Never.</p>`
  },
  {
    id: "progression", title: "Progression & Tiers", icon: "fa-arrow-trend-up",
    body: `
      ${where("Builder → <b>Progression</b> tab")}
      <dl>
        <dt>Tiers</dt><dd>Name each tier (Dormant, Awakened, Exalted…). <b>Add Tier</b> adds one; the trash button removes one.</dd>
        <dt>Begins at</dt><dd>On every component card: the tier it switches on.</dd>
        <dt>GM-only notes</dt><dd>Under each tier: how the item reaches it (the first tier's note describes its starting state). <b>Progression Notes</b> holds your overall plan. Players never see these in the game screens.</dd>
        <dt>Rarity at this tier</dt><dd>Under each tier after the first: the rarity the item becomes when it reaches that tier (for example Uncommon → Rare → Very Rare). <b>No change</b> keeps the rarity from the tier before; the first tier uses the rarity on the Basics tab.</dd>
        <dt>Starting Tier</dt><dd>The tier a new item starts at.</dd>
        <dt>Unlock Summary</dt><dd>What each tier unlocks, with your notes.</dd>
      </dl>
      <h4>Change an item's tier</h4>
      ${where("Item sheet → <b>Item Builder Tier</b> button in the header (shows the current tier number) → choose → <b>Apply</b>")}
      <p>The tier window also shows your GM notes, so you can check your plan before applying it. Applying a tier updates the item's <a data-jump="description">Item Properties</a> list.</p>`
  },
  {
    id: "sheet", title: "Item Sheet Buttons", icon: "fa-window-maximize",
    body: `
      ${where("Open any Item Builder item → buttons in the sheet header")}
      <dl>
        <dt><i class="fa-solid fa-pen-to-square"></i> Edit in Item Builder</dt><dd>Reopens the item in the builder.</dd>
        <dt><i class="fa-solid fa-arrow-trend-up"></i> Item Builder Tier</dt><dd>Changes the item's tier (items with more than one tier).</dd>
        <dt><i class="fa-solid fa-file-export"></i> Export</dt><dd>Downloads this item for another world.</dd>
        <dt><i class="fa-solid fa-arrow-up-1-9"></i> Choose Half-ASI Ability</dt><dd>Shown to the item's owner when a Half-ASI still needs a choice.</dd>
      </dl>`
  },
  {
    id: "portability", title: "Export & Import", icon: "fa-file-export",
    body: `
      <h4>Export</h4>
      ${where("Items sidebar → <b>export</b> icon, or Builder → <b>Export Items</b> / <b>Export This Item</b>, or an item sheet's <b>export</b> button")}
      <p>Saves items (and their granted spells) to a file another world can import.</p>
      <h4>Import</h4>
      ${where("Items sidebar → <b>import</b> icon, or Builder → <b>Import Items</b>")}
      <p>Choose the file, a destination folder or compendium, and what to do with items that already exist (copy, skip or replace). Items are converted for the importing world's Foundry and D&amp;D5e versions.</p>`
  },
  {
    id: "native", title: "Works With or Without Item Builder", icon: "fa-layer-group",
    body: `
      <p>Rules marked <span class="ibh-badge native">Built into item</span>, plus movement, senses, ability scores, skills, spells, reactions, Half-ASI and size are stored in the item's own D&amp;D5e data. They keep working with Item Builder disabled, in worlds without it, and alongside Midi-QOL, DAE, AC5e and similar modules.</p>
      <p>Rules marked <span class="ibh-badge runtime">Automated</span> (usually those limited to certain creatures or sources) and token resizing need Item Builder enabled. For advantage and disadvantage rules, the item also carries Midi-QOL conditions, so Midi applies them in its own roll dialogs.</p>`
  },
  {
    id: "troubleshooting", title: "Troubleshooting", icon: "fa-screwdriver-wrench",
    body: `
      <dl>
        <dt>A character's item didn't change after I edited it</dt><dd>Editing the item in the Items sidebar doesn't change copies characters already have. Edit the character's copy, or replace it.</dd>
        <dt>A rule doesn't seem to apply</dt><dd>Check the item is equipped (and attuned, if required), its tier has been reached, and the card's <b>Only when…</b> filters match. Creature-type filters don't match creatures with no type set.</dd>
        <dt>Rule diagnostics</dt><dd>${where("Game Settings → Configure Settings → Item Builder 5e → <b>Item Builder rule diagnostics</b>")}Logs why each rule did or didn't match to the browser console (F12).</dd>
        <dt>Updates</dt><dd>Installed from the manifest link, Foundry's <b>Check for Updates</b> offers new versions. Version history: <a href="https://github.com/dmindygaming/item-builder-5e/blob/main/CHANGELOG.md" target="_blank" rel="noopener">changelog</a>.</dd>
      </dl>`
  }
];

export function renderGuide(sections=HELP_SECTIONS) {
  const tops = sections.filter(s => !s.parent);
  const toc = tops.map(s => {
    const kids = sections.filter(k => k.parent === s.id);
    return `<li><a data-jump="${s.id}"><i class="fa-solid ${s.icon}"></i> ${s.title}</a>${kids.length
      ? `<ul>${kids.map(k => `<li><a data-jump="${k.id}">${k.title}</a></li>`).join("")}</ul>` : ""}</li>`;
  }).join("");
  const body = sections.map(s => `
    <section class="ibh-section${s.parent ? " sub" : ""}" id="ibh-${s.id}" data-section="${s.id}">
      <h${s.parent ? 3 : 2}><i class="fa-solid ${s.icon}"></i> ${s.title}<a class="ibh-top" data-jump="toc" title="Back to contents"><i class="fa-solid fa-arrow-up"></i></a></h${s.parent ? 3 : 2}>
      ${s.body}
    </section>`).join("");
  return `<div class="ibh-root">
    <nav class="ibh-toc" data-section="toc"><h2><i class="fa-solid fa-list"></i> Contents</h2><ul>${toc}</ul></nav>
    <div class="ibh-body">${body}</div>
  </div>`;
}

export class ItemBuilderHelp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "item-builder-5e-help",
    classes: ["item-builder-5e-help"],
    window: { title: "Item Builder 5e — Guide", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 860, height: 720 }
  };

  constructor(options={}) {
    super(options);
    this.section = options.section ?? null;
  }

  async _renderHTML() {
    const tpl = document.createElement("template");
    tpl.innerHTML = renderGuide().trim();
    return tpl.content.firstElementChild;   // the .ibh-root grid itself, so it fills the window
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    const body = content.querySelector(".ibh-body");
    content.querySelectorAll("[data-jump]").forEach(a => a.addEventListener("click", e => {
      e.preventDefault();
      const id = a.dataset.jump;
      const target = id === "toc" ? content.querySelector(".ibh-toc") : content.querySelector(`#ibh-${id}`);
      if ( !target ) return;
      if ( id === "toc" ) { body.scrollTop = 0; content.querySelector(".ibh-toc").scrollTop = 0; return; }
      // Jump straight there: smooth scrolling is unreliable inside Foundry windows.
      body.scrollTop = body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
      target.classList.remove("ibh-flash"); void target.offsetWidth; target.classList.add("ibh-flash");
    }));
    if ( this.section ) requestAnimationFrame(() => content.querySelector(`[data-jump="${this.section}"]`)?.click());
  }

  /** Open the guide, optionally at a section id. */
  static open(section=null) {
    const existing = foundry.applications.instances?.get("item-builder-5e-help");
    if ( existing ) { existing.section = section; return existing.render({ force: true }); }
    return new ItemBuilderHelp({ section }).render({ force: true });
  }
}

/** Settings-menu entry that opens the guide. */
export class ItemBuilderHelpMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "item-builder-5e-help-menu", window: { title: "Item Builder 5e — Guide" } };
  render() { ItemBuilderHelp.open(); return this; }
}

export function registerHelpMenu() {
  game.settings.registerMenu(MODULE_ID, "guide", {
    name: "Item Builder Guide",
    label: "Open Guide",
    hint: "Where every Item Builder feature is and how it works.",
    icon: "fa-solid fa-book-open",
    type: ItemBuilderHelpMenu,
    restricted: true
  });
}
