/**
 * Searchable dropdowns. A `<select data-searchable="Search weapons…">` is shown as a dropdown
 * whose open list has a search field at the top. The real select stays in the form (hidden),
 * so saving and change listeners work exactly as before.
 */

const norm = s => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Enhance every searchable select inside `root`. Safe to call after each render. */
export function enhanceSearchableSelects(root) {
  for ( const select of root.querySelectorAll("select[data-searchable]") ) {
    if ( select.dataset.comboReady ) continue;
    select.dataset.comboReady = "1";
    buildCombo(select);
  }
}

function buildCombo(select) {
  const combo = document.createElement("div");
  combo.className = "ib92-combo";
  combo.innerHTML = `
    <button type="button" class="ib92-combo-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="ib92-combo-value"></span><i class="fa-solid fa-chevron-down"></i>
    </button>
    <div class="ib92-combo-panel" hidden>
      <div class="ib92-combo-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" autocomplete="off" spellcheck="false"></div>
      <ul class="ib92-combo-list" role="listbox"></ul>
      <div class="ib92-combo-empty" hidden>No matches</div>
    </div>`;
  const trigger = combo.querySelector(".ib92-combo-trigger");
  const valueEl = combo.querySelector(".ib92-combo-value");
  const panel = combo.querySelector(".ib92-combo-panel");
  const input = combo.querySelector("input");
  const list = combo.querySelector(".ib92-combo-list");
  const empty = combo.querySelector(".ib92-combo-empty");
  input.placeholder = select.dataset.searchable || "Search…";
  if ( select.disabled ) trigger.disabled = true;

  const options = [...select.options].map(o => ({ value: o.value, label: o.textContent, key: norm(o.textContent) }));
  list.innerHTML = options.map((o, i) =>
    `<li role="option" data-index="${i}" class="${o.value ? "" : "placeholder"}">${escapeText(o.label)}</li>`).join("");
  const items = [...list.children];
  let active = -1;

  const showValue = () => {
    const opt = select.selectedOptions[0];
    valueEl.textContent = opt?.textContent ?? "";
    valueEl.classList.toggle("placeholder", !opt?.value);
    items.forEach((li, i) => li.classList.toggle("selected", options[i].value === select.value));
  };
  const visible = () => items.filter(li => !li.hidden);
  const setActive = li => {
    items[active]?.classList.remove("active");
    active = li ? items.indexOf(li) : -1;
    if ( li ) { li.classList.add("active"); li.scrollIntoView({ block: "nearest" }); }
  };
  const filter = () => {
    const terms = norm(input.value).trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    items.forEach((li, i) => {
      const o = options[i];
      const hit = !terms.length || (o.value && terms.every(t => o.key.includes(t)));
      li.hidden = !hit;
      if ( hit ) shown++;
    });
    empty.hidden = shown > 0;
    setActive(visible().find(li => options[li.dataset.index].value) ?? null);
  };
  // While open, the list floats above the window so scrolling areas and window edges never clip it.
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 && above > below;
    const maxH = Math.max(140, Math.min(320, up ? above : below));
    Object.assign(panel.style, {
      left: `${Math.round(r.left)}px`, width: `${Math.round(r.width)}px`, maxHeight: `${Math.round(maxH)}px`,
      top: up ? "" : `${Math.round(r.bottom + 2)}px`, bottom: up ? `${Math.round(window.innerHeight - r.top + 2)}px` : ""
    });
  };
  const onScroll = e => { if ( !panel.contains(e.target) ) place(); };
  const open = () => {
    if ( trigger.disabled ) return;
    document.body.append(panel);
    place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    panel.hidden = false;
    combo.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    input.value = "";
    filter();
    const current = items.find((li, i) => options[i].value && options[i].value === select.value);
    if ( current ) setActive(current);
    input.focus();
    document.addEventListener("pointerdown", outside, true);
  };
  const close = (refocus=false) => {
    panel.hidden = true;
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", place);
    combo.append(panel);
    combo.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if ( refocus ) trigger.focus();
  };
  const outside = e => {
    if ( !combo.isConnected ) { close(); return; }
    if ( !combo.contains(e.target) && !panel.contains(e.target) ) close();
  };
  const choose = li => {
    if ( !li ) return;
    const value = options[li.dataset.index].value;
    close(true);
    if ( select.value === value ) return;
    select.value = value;
    showValue();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  trigger.addEventListener("click", e => { e.preventDefault(); panel.hidden ? open() : close(); });
  trigger.addEventListener("keydown", e => {
    if ( ["ArrowDown", "Enter", " "].includes(e.key) ) { e.preventDefault(); open(); }
    else if ( e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ) {
      // Typing on the closed dropdown opens it and starts the search.
      e.preventDefault(); open(); input.value = e.key; filter();
    }
  });
  input.addEventListener("input", e => { e.stopPropagation(); filter(); });
  input.addEventListener("change", e => e.stopPropagation());
  input.addEventListener("keydown", e => {
    const vis = visible();
    const pos = vis.indexOf(items[active]);
    if ( e.key === "ArrowDown" ) { e.preventDefault(); setActive(vis[Math.min(vis.length - 1, pos + 1)] ?? vis[0]); }
    else if ( e.key === "ArrowUp" ) { e.preventDefault(); setActive(vis[Math.max(0, pos - 1)] ?? vis[0]); }
    else if ( e.key === "Enter" ) { e.preventDefault(); choose(items[active]); }
    else if ( e.key === "Escape" ) { e.preventDefault(); e.stopPropagation(); close(true); }
    else if ( e.key === "Tab" ) close();
  });
  list.addEventListener("pointermove", e => { const li = e.target.closest("li"); if ( li && li !== items[active] ) setActive(li); });
  list.addEventListener("click", e => choose(e.target.closest("li")));
  // The dropdown usually sits inside a <label>; stop clicks in the list from re-triggering it.
  panel.addEventListener("click", e => { if ( e.target !== input ) e.preventDefault(); });
  select.addEventListener("change", showValue);

  select.hidden = true;
  select.tabIndex = -1;
  select.after(combo);
  showValue();
}

function escapeText(s) {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}
