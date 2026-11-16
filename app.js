// واجهة قائمة المقاضي: لصق، قائمة صح، نقل، تعلّم، تراجع، وحفظ على الجهاز
import { parse, keyOf } from './parser.js';
import { STORES, SECTIONS } from './dictionary.js';

const VERSION = 1;
const KEYS = {
  list: 'grocery.list',
  learned: 'grocery.learned',
  order: 'grocery.order',
  version: 'grocery.version',
};
const MARKET = 'market';
const UNDO_MS = 7000;

const SEC = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
const STORE = Object.fromEntries(STORES.map((s) => [s.id, s]));

// ---------- التخزين ----------
let storageOk = true;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageOk = false;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function loadList() {
  const v = read(KEYS.list, null);
  const items = isObj(v) && Array.isArray(v.items)
    ? v.items.filter((x) => isObj(x) && typeof x.name === 'string')
    : [];
  const messages = isObj(v) && Array.isArray(v.messages)
    ? v.messages.filter((m) => typeof m === 'string')
    : [];
  for (const it of items) if (!it.id) it.id = newId();
  return { items, messages };
}

function loadOrder() {
  const v = read(KEYS.order, null);
  const fix = (saved, all) => {
    const keep = (Array.isArray(saved) ? saved : [])
      .filter((id, i, a) => all.includes(id) && a.indexOf(id) === i);
    return [...keep, ...all.filter((id) => !keep.includes(id))];
  };
  return {
    stores: fix(v?.stores, STORES.map((s) => s.id)),
    sections: fix(v?.sections, SECTIONS.filter((s) => s.store === MARKET).map((s) => s.id)),
  };
}

let state = loadList();
let learned = (() => {
  const v = read(KEYS.learned, {});
  return isObj(v) ? v : {};
})();
const order = loadOrder();
const collapsed = {}; // طي يدوي للمحلات (للجلسة بس)؛ بدون قيمة = يطوي نفسه لما يكتمل

function saveAll() {
  storageOk = true;
  write(KEYS.list, state);
  write(KEYS.learned, learned);
  write(KEYS.version, VERSION);
}

// ---------- أدوات ----------
const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const byId = (id) => state.items.find((x) => x.id === id);
const isUnknown = (it) => !!it.unknown || !SEC[it.section];

function fmt(q) {
  if (q === 0.5) return 'نص';
  if (q === 0.25) return 'ربع';
  return String(+Number(q).toFixed(2));
}

function qtyText(it) {
  if (it.unit) return it.qty != null ? `${fmt(it.qty)} ${it.unit}` : it.unit;
  return it.qty != null ? `×${fmt(it.qty)}` : '';
}

function qtyEl(it) {
  const text = qtyText(it);
  return text && h('span', { class: 'qty', dir: it.unit ? 'rtl' : 'ltr', text });
}

function parseQty(raw) {
  const s = String(raw)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[٫,]/g, '.')
    .trim();
  if (!s) return null;
  if (s === 'نص' || s === 'نصف') return 0.5;
  if (s === 'ربع') return 0.25;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined; // undefined = مو رقم
}

// ---------- الرسم ----------
function renderAll() {
  renderUnknowns();
  renderList();
  renderMessages();
  renderOrder();
  renderLearned();
  $('storage-warn').hidden = storageOk;
}

function commit() {
  saveAll();
  renderAll();
}

function renderUnknowns() {
  const box = $('unknowns');
  const list = state.items.filter(isUnknown);
  box.hidden = list.length === 0;
  if (!list.length) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h('h2', { class: 'unk-title', text: `⚠️ ما عرفته (${list.length})` }),
    ...list.map((it) => {
      const sug = SEC[it.suggest];
      return h('div', { class: 'unk' },
        h('div', { class: 'unk-name' },
          h('span', { text: it.name }),
          qtyEl(it),
          it.note && h('span', { class: 'note', text: it.note })),
        h('div', { class: 'unk-actions' },
          sug && h('button', {
            class: 'btn primary', type: 'button', text: `حطه في ${sug.name}`,
            onclick: () => place(it.id, sug.id, true),
          }),
          h('button', {
            class: sug ? 'btn' : 'btn primary', type: 'button', text: 'حدد مكانه',
            onclick: () => pickPlace(`وين مكان «${it.name}»؟`, (sec) => place(it.id, sec, true)),
          }),
          h('button', { class: 'btn', type: 'button', text: 'مو غرض', onclick: () => notItem(it.id) })));
    }));
}

function rowEl(it) {
  return h('li', { class: it.done ? 'row done' : 'row' },
    h('button', {
      class: 'row-main', type: 'button', 'aria-pressed': String(!!it.done),
      onclick: () => toggle(it.id),
    },
      h('span', { class: 'check', 'aria-hidden': 'true' }),
      h('span', { class: 'row-text' },
        h('span', { class: 'name', text: it.name }),
        it.fresh && h('span', { class: 'tag', text: 'طلب جديد' }),
        it.note && h('span', { class: 'note', text: it.note })),
      qtyEl(it)),
    h('button', {
      class: 'more', type: 'button', 'aria-label': `خيارات ${it.name}`, text: '⋯',
      onclick: () => rowMenu(it.id),
    }));
}

function renderList() {
  const known = state.items.filter((it) => !isUnknown(it));
  const nodes = [];
  for (const storeId of order.stores) {
    const store = STORE[storeId];
    const items = known.filter((it) => SEC[it.section].store === storeId);
    if (!items.length) continue;
    const done = items.filter((it) => it.done).length;
    const complete = done === items.length;
    const isCollapsed = collapsed[storeId] ?? complete;

    const body = h('div', { class: 'store-body', hidden: isCollapsed });
    if (storeId === MARKET) {
      for (const secId of order.sections) {
        const rows = items.filter((it) => it.section === secId);
        if (!rows.length) continue;
        body.append(
          h('h3', { class: 'sec-head', text: SEC[secId].name }),
          h('ul', { class: 'rows' }, rows.map(rowEl)));
      }
    } else {
      body.append(h('ul', { class: 'rows' }, items.map(rowEl)));
    }

    nodes.push(h('section', { class: complete ? 'store complete' : 'store' },
      h('button', {
        class: 'store-head', type: 'button', 'aria-expanded': String(!isCollapsed),
        onclick: () => { collapsed[storeId] = !isCollapsed; renderList(); },
      },
        h('span', { class: 'store-icon', 'aria-hidden': 'true', text: store.icon }),
        h('span', { class: 'store-name', text: store.name }),
        complete && h('span', { class: 'store-done', text: '✓' }),
        h('span', { class: 'store-count', dir: 'ltr', text: `${done}/${items.length}` }),
        h('span', { class: 'chev', 'aria-hidden': 'true' })),
      body));
  }
  $('list').replaceChildren(...nodes);
  $('empty').hidden = state.items.length > 0;
  $('new-trip').hidden = state.items.length === 0 && state.messages.length === 0;
}

function renderMessages() {
  $('messages-count').textContent = `(${state.messages.length})`;
  $('messages-body').replaceChildren(...(state.messages.length
    ? state.messages.map((m) => h('p', { class: 'msg', dir: 'auto', text: m }))
    : [h('p', { class: 'muted', text: 'ما فيه رسائل في هذا المشوار.' })]));
}

function renderOrder() {
  const mk = (kind, nameOf) => h('ul', { class: 'order-list' },
    order[kind].map((id, i, ids) => h('li', { class: 'order-row' },
      h('span', { class: 'order-name', text: nameOf(id) }),
      h('button', {
        class: 'icon-btn', type: 'button', text: '↑', 'aria-label': `ارفع ${nameOf(id)}`,
        disabled: i === 0, onclick: () => moveOrder(kind, i, -1),
      }),
      h('button', {
        class: 'icon-btn', type: 'button', text: '↓', 'aria-label': `نزّل ${nameOf(id)}`,
        disabled: i === ids.length - 1, onclick: () => moveOrder(kind, i, 1),
      }))));
  $('order-body').replaceChildren(
    h('h3', { class: 'sub', text: 'المحلات' }),
    mk('stores', (id) => `${STORE[id].icon} ${STORE[id].name}`),
    h('h3', { class: 'sub', text: 'أقسام السوبرماركت' }),
    mk('sections', (id) => SEC[id].name));
}

function moveOrder(kind, i, d) {
  const a = order[kind];
  const j = i + d;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  write(KEYS.order, order);
  renderList();
  renderOrder();
}

function renderLearned() {
  const keys = Object.keys(learned);
  $('learned-count').textContent = keys.length ? `(${keys.length})` : '';
  $('learned-body').replaceChildren(keys.length
    ? h('ul', { class: 'learned-list' }, keys.map((k) => h('li', { class: 'learned-row' },
        h('span', { class: 'learned-key', text: k }),
        h('span', {
          class: 'learned-val',
          text: learned[k] === 'ignore' ? 'مو غرض' : (SEC[learned[k]]?.name ?? String(learned[k])),
        }),
        h('button', {
          class: 'btn', type: 'button', text: 'حذف', 'aria-label': `احذف ${k}`,
          onclick: () => { delete learned[k]; hideUndo(); commit(); },
        }))))
    : h('p', { class: 'muted', text: 'ما تعلّم شي للحين.' }));
}

// ---------- القائمة السفلية ----------
function openSheet(title, build) {
  const sheet = $('sheet');
  sheet.replaceChildren(h('h2', { class: 'sheet-title', text: title }));
  build(sheet);
  sheet.append(h('button', { class: 'btn block sheet-cancel', type: 'button', text: 'إلغاء', onclick: closeSheet }));
  sheet.scrollTop = 0;
  $('backdrop').hidden = false;
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  $('backdrop').hidden = true;
  $('sheet').replaceChildren();
  document.body.classList.remove('sheet-open');
}

function pickPlace(title, onPick, current) {
  const btn = (secId, label) => h('button', {
    class: secId === current ? 'btn current' : 'btn', type: 'button', text: label,
    onclick: () => { closeSheet(); onPick(secId); },
  });
  openSheet(title, (sheet) => {
    const market = STORE[MARKET];
    const others = order.stores.filter((id) => id !== MARKET);
    sheet.append(
      h('h3', { class: 'sheet-group', text: `${market.icon} ${market.name}` }),
      h('div', { class: 'place-grid' }, order.sections.map((id) => btn(id, SEC[id].name))),
      h('h3', { class: 'sheet-group', text: 'محلات ثانية' }),
      h('div', { class: 'place-grid' },
        others.filter((id) => SEC[id]).map((id) => btn(id, `${STORE[id].icon} ${STORE[id].name}`))));
  });
}

function rowMenu(id) {
  const it = byId(id);
  if (!it) return;
  openSheet(it.name, (sheet) => {
    sheet.append(
      h('button', {
        class: 'btn block', type: 'button', text: 'نقل لقسم ثاني',
        onclick: () => pickPlace(`وين تنقل «${it.name}»؟`, (sec) => place(id, sec, !it.amb), it.section),
      }),
      h('button', { class: 'btn block', type: 'button', text: 'تعديل', onclick: () => editItem(id) }),
      h('button', {
        class: 'btn block danger', type: 'button', text: 'حذف',
        onclick: () => { closeSheet(); removeItem(id); },
      }));
  });
}

function editItem(id) {
  const it = byId(id);
  if (!it) return;
  openSheet('تعديل', (sheet) => {
    const name = h('input', {
      class: 'field', type: 'text', value: it.name, autocomplete: 'off', enterkeyhint: 'done',
    });
    const qty = h('input', {
      class: 'field', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
      value: it.qty == null ? '' : String(it.qty), placeholder: 'بدون كمية',
    });
    sheet.append(h('form', {
      class: 'edit-form',
      onsubmit: (e) => {
        e.preventDefault();
        const n = name.value.trim().replace(/\s+/g, ' ');
        if (!n) { name.focus(); return; }
        const q = parseQty(qty.value);
        if (q === undefined) { qty.focus(); qty.select(); return; }
        if (n !== it.name) {
          it.name = n;
          try { it.key = keyOf(n); } catch { it.key = n; }
        }
        it.qty = q;
        closeSheet();
        hideUndo();
        commit();
      },
    },
      h('label', { class: 'field-label' }, 'الاسم', name),
      h('label', { class: 'field-label' }, `الكمية${it.unit ? ` (${it.unit})` : ''}`, qty),
      h('button', { class: 'btn primary block', type: 'submit', text: 'حفظ' })));
  });
}

// ---------- التراجع ----------
let undoTimer = null;
let undoSnap = null;

const snapshot = () => JSON.stringify({ state, learned });

function showBar(label, snap) {
  undoSnap = snap || null;
  $('undo-text').textContent = label;
  $('undo-btn').hidden = !snap;
  $('undo').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, UNDO_MS);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoSnap = null;
  $('undo').hidden = true;
}

function undo() {
  if (!undoSnap) return;
  const s = JSON.parse(undoSnap);
  state = s.state;
  learned = s.learned;
  hideUndo();
  commit();
}

// ---------- الأفعال ----------
function mergeNotes(a, b) {
  if (!b) return a ?? null;
  if (!a) return b;
  return a.includes(b) ? a : `${a}، ${b}`;
}

// الدمج بين الرسائل (8.4): القديم بدون صح ← الكمية الأكبر. القديم عليه صح ← سطر جديد «طلب جديد».
function mergeItem(it) {
  const same = state.items.filter((x) => x.key === it.key);
  const open = same.find((x) => !x.done);
  if (open) {
    if (it.qty != null && (open.qty == null || it.qty > open.qty)) {
      open.qty = it.qty;
      open.unit = it.unit ?? open.unit ?? null;
    } else if (open.qty == null && open.unit == null && it.unit != null) {
      open.unit = it.unit;
    }
    open.note = mergeNotes(open.note, it.note);
    return;
  }
  state.items.push({ ...it, id: newId(), done: false, fresh: same.length > 0 });
}

function addMessage() {
  const ta = $('paste');
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  let res;
  try {
    res = parse(text, learned);
  } catch (err) {
    console.error(err);
    showBar('ما قدرت أقرأ الرسالة. النص باقي في الخانة.');
    return;
  }
  const incoming = [...(res?.items ?? []), ...(res?.unknowns ?? [])];
  for (const it of incoming) mergeItem(it);
  state.messages.push(text);
  ta.value = '';
  grow();
  hideUndo();
  commit();
  if (!incoming.length) showBar('ما لقيت أغراض في الرسالة.');
}

function toggle(id) {
  const it = byId(id);
  if (!it) return;
  it.done = !it.done;
  delete collapsed[SEC[it.section]?.store]; // يرجع للطي التلقائي
  hideUndo();
  commit();
}

function place(id, secId, learn) {
  const it = byId(id);
  if (!it || !SEC[secId]) return;
  if (!isUnknown(it) && it.section === secId) return;
  const snap = snapshot();
  it.section = secId;
  it.unknown = false;
  it.suggest = null;
  if (learn && it.learnKey) learned[it.learnKey] = secId;
  delete collapsed[SEC[secId].store];
  commit();
  showBar(`«${it.name}» صار في ${SEC[secId].name}${learn ? '' : ' (هذي المرة بس)'}`, snap);
}

function notItem(id) {
  const it = byId(id);
  if (!it) return;
  const snap = snapshot();
  if (it.learnKey) learned[it.learnKey] = 'ignore';
  state.items = state.items.filter((x) => x.id !== id);
  commit();
  showBar(`«${it.name}» مو غرض`, snap);
}

function removeItem(id) {
  const it = byId(id);
  if (!it) return;
  const snap = snapshot();
  state.items = state.items.filter((x) => x.id !== id);
  commit();
  showBar(`انحذف «${it.name}»`, snap);
}

function newTrip() {
  const n = state.items.filter((x) => x.done).length;
  const m = state.items.length - n;
  openSheet('مشوار جديد', (sheet) => {
    sheet.append(
      h('p', { class: 'sheet-text', text: `بيمسح ${n} غرض جبتها، ويبقى ${m}. والرسائل الأصلية تنمسح معها.` }),
      h('button', {
        class: 'btn primary block', type: 'button', text: 'امسح وابدأ مشوار جديد',
        onclick: () => {
          state.items = state.items.filter((x) => !x.done);
          for (const x of state.items) x.fresh = false;
          state.messages = [];
          for (const k of Object.keys(collapsed)) delete collapsed[k];
          closeSheet();
          hideUndo();
          commit();
        },
      }));
  });
}

// ---------- الربط ----------
function grow() {
  const ta = $('paste');
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

$('add-form').addEventListener('submit', (e) => { e.preventDefault(); addMessage(); });
$('paste').addEventListener('input', grow);
$('new-trip').addEventListener('click', newTrip);
$('undo-btn').addEventListener('click', undo);
$('backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('backdrop').hidden) closeSheet(); });

renderAll();

// يشتغل بدون نت: التسجيل على https بس (GitHub Pages)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
