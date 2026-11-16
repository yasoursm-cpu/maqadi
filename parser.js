// parser: من نص رسالة واتساب لأغراض مصنّفة. دالة نقية بدون DOM.
// parse(text, learned) → { items[], unknowns[] }
import {
  RAW, FILLERS, CONJ_WORDS, ALT_WORDS, REL_WORDS, NUMWORDS, UNITS,
  EXCLUSIVE, IDENTITY, MODS, STORE_WORDS,
} from './dictionary.js';

const MARKS = /[ً-ٰٟـ]/g; // التشكيل والتطويل
const isMark = (c) => /[ً-ٰٟـ]/.test(c);

function digits(s) {
  return s
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}

// التوحيد للمطابقة فقط
export function norm(s) {
  return digits(String(s == null ? '' : s))
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const stripAl = (n) => n.split(' ').map((w) => (w.length >= 5 && w.startsWith('ال') ? w.slice(2) : w)).join(' ');

// مفتاح الدمج والتعلّم: توحيد + حذف "ال" من أول كل كلمة
export function keyOf(s) {
  return stripAl(norm(s));
}

// ---------- بناء القاموس ----------
const DICT = new Map();
export const DUPLICATES = []; // تهجئة مكررة بين غرضين (لازم تبقى فاضية)
let MAXW = 1;
for (const [section, block] of Object.entries(RAW)) {
  for (const line0 of block.split('\n')) {
    const line = line0.trim();
    if (!line) continue;
    const hash = line.indexOf('#');
    const left = hash < 0 ? line : line.slice(0, hash);
    const opts = hash < 0 ? '' : line.slice(hash + 1);
    const sp = left.split('|').map((s) => s.trim()).filter(Boolean);
    const e = { name: sp[0], section, fa: false, fl: false, drink: false, amb: false, raw: false, ms: null, acc: new Set() };
    for (const o of opts.split(';').map((s) => s.trim()).filter(Boolean)) {
      if (o.startsWith('ms=')) e.ms = o.slice(3);
      else if (o.startsWith('acc=')) for (const a of o.slice(4).split('/')) e.acc.add(norm(a));
      else e[o] = true;
    }
    for (const s of sp) {
      const n = norm(s);
      const old = DICT.get(n);
      if (old && old !== e) { DUPLICATES.push(`${n}: ${old.name} / ${e.name}`); continue; }
      DICT.set(n, e);
      MAXW = Math.max(MAXW, n.split(' ').length);
    }
  }
}
const SINGLE = [...DICT.keys()].filter((k) => k.length >= 4 && !k.includes(' '));
const JUICE = DICT.get('عصير');
const JUICES = DICT.get('عصيرات');
const BREAD = DICT.get('خبز');
const FOUL = DICT.get('فول');
const TAMEES = DICT.get('تميس');

const mapKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [norm(k), v]));
const FILL = new Set(FILLERS.map(norm));
const CONJ = new Set(CONJ_WORDS.map(norm));
const ALT = new Set(ALT_WORDS.map(norm));
const REL = new Set(REL_WORDS.map(norm));
const NUMW = mapKeys(NUMWORDS);
const UNITN = mapKeys(UNITS);
const MODN = mapKeys(MODS);
const STOREW = mapKeys(STORE_WORDS);
const MEASURE = new Set(['كيلو', 'جرام', 'لتر', 'حبة', 'درزن']); // وحدة قياس: بدون رقم = 1
const ALIAS = { 'حل': 'حلو', 'سايل': 'سائل', 'سايله': 'سائله' };
const IDG = new Set([...IDENTITY, 'kind']);

// ---------- التقسيم والتوكنز ----------
function segments(text) {
  let t = digits(String(text || '')).replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/٫/g, '.');
  t = t.split(/\r?\n/).map((l) => l
    // بادئة الواتساب: [تاريخ، وقت] اسم:
    .replace(/^\s*\[[^\]\n]{4,40}\]\s*[^:\n]{1,40}:\s*/, '')
    // صيغة التصدير: تاريخ، وقت - اسم:
    .replace(/^\s*\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?[^\-\n]{0,6}-\s*[^:\n]{1,40}:\s*/, '')
    // ترقيم القوائم: "1- " أو "2) "
    .replace(/^\s*\d{1,2}\s*[-.)]\s*(?=\p{L})/u, '')).join('\n');
  t = t.replace(/(\d)\.(\d)/g, '$1\u0001$2');
  return t.split(/[\n،,;؛•·\-–—*|()\[\]{}:!?؟\/+=.]+/).map((s) => s.replace(/\u0001/g, '.')).filter((s) => s.trim());
}

function tokenize(seg) {
  const toks = [];
  const re = /[0-9]+(?:\.[0-9]+)?|[\p{L}\p{M}]+/gu;
  let m, prev = null, prevEnd = -1;
  while ((m = re.exec(seg))) {
    const raw = m[0];
    let tk;
    if (/^[0-9]/.test(raw)) {
      tk = {
        raw, num: true, val: parseFloat(raw), digits: raw.replace('.', '').length,
        attached: !!prev && !prev.num && prevEnd === m.index && prev.n !== 'و',
      };
    } else {
      const n = norm(raw);
      if (!n) continue;
      tk = { raw, n, num: false };
    }
    if (!(tk.n === 'x')) toks.push(tk); // "x2" = ×2
    prev = tk; prevEnd = re.lastIndex;
  }
  return toks;
}

// يحذف أول k حروف من الكلمة الأصلية (مع تخطي التشكيل)
function dropHead(raw, k) {
  let i = 0, c = 0;
  while (i < raw.length && c < k) { if (!isMark(raw[i])) c++; i++; }
  while (i < raw.length && isMark(raw[i])) i++;
  return raw.slice(i);
}

// فرق حرف واحد (تبديل، حذف، زيادة، أو قلب حرفين متجاورين)
function within1(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  if (la === lb) {
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const s = la < lb ? a : b, l = la < lb ? b : a;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

// ---------- حقن التعلّم ----------
function makeFinder(L) {
  const ov = new Map();
  let maxw = MAXW;
  const base = (n) => DICT.get(n) || DICT.get(stripAl(n));
  for (const [k0, v] of Object.entries(L)) {
    const k = keyOf(k0);
    if (!k || !v) continue;
    const ws = k.split(' ');
    // مفتاح يبدأ بغرض معروف (حليب نستله): ما ينحقن، يتطبق وقت التصنيف
    let known = false;
    for (let len = ws.length; len >= 1 && !known; len--) if (base(ws.slice(0, len).join(' '))) known = true;
    if (known) continue;
    ov.set(k, v === 'ignore'
      ? { ignore: true }
      : { name: k, section: v, fa: false, fl: false, drink: false, amb: false, raw: true, ms: null, acc: new Set() });
    maxw = Math.max(maxw, ws.length);
  }
  const find = (n) => {
    const e = DICT.get(n) || ov.get(n);
    if (e) return e;
    const k = stripAl(n);
    return k === n ? undefined : (DICT.get(k) || ov.get(k));
  };
  return { find, maxw };
}

// ---------- lex ----------
const one = (x) => ({ lex: [x], len: 1 });

function lexWord(toks, i, w, raw, find, maxw, stripped) {
  const nx = toks[i + 1];
  if (!stripped && CONJ.has(w)) return one({ t: 'conj', raw });
  if (w === 'ولا' && nx && !nx.num && nx.n.startsWith('تنس')) return one({ t: 'filler', raw }); // "ولا تنسى"
  if (ALT.has(w)) return one({ t: 'alt', raw });
  if (REL.has(w)) return one({ t: 'rel', raw });
  if (w === 'من' && nx && !nx.num && STOREW[nx.n]) {
    return { lex: [{ t: 'header', store: STOREW[nx.n], raw: raw + ' ' + nx.raw }], len: 2 };
  }
  // القاموس بأطول تطابق
  const words = [w], raws = [raw];
  for (let j = i + 1; j < toks.length && words.length < maxw && !toks[j].num; j++) { words.push(toks[j].n); raws.push(toks[j].raw); }
  for (let len = words.length; len >= 1; len--) {
    const n = words.slice(0, len).join(' ');
    const e = find(n);
    if (!e) continue;
    const r = raws.slice(0, len).join(' ');
    return { lex: [e.ignore ? { t: 'filler', raw: r } : { t: 'item', e, n, raw: r }], len };
  }
  if (FILL.has(w)) return one({ t: 'filler', raw });
  if (w in NUMW) return one({ t: 'num', v: NUMW[w], attached: false, digits: 1, raw });
  if (UNITN[w]) return one({ t: 'unit', unit: UNITN[w][0], count: UNITN[w][1] || 0, raw });
  if ((w === 'ابو' || w === 'ام' || w === 'على') && nx && !nx.num) {
    const r = raw + ' ' + nx.raw;
    return { lex: [{ t: 'mod', g: 'desc', text: r, raw: r }], len: 2 };
  }
  const mg = MODN[w] || MODN[stripAl(w)];
  if (mg) return one({ t: 'mod', g: mg, text: ALIAS[w] || raw, raw });
  if (w.startsWith('بال') && w.length >= 5) {
    const x = w.slice(3);
    const e = find(x);
    return one({ t: 'mod', g: 'flavor', text: e && !e.ignore && !e.raw ? e.name : (ALIAS[x] || dropHead(raw, 3)), raw });
  }
  if (w[0] === 'ب' && w.length >= 4) {
    const e = find(w.slice(1));
    if (e && !e.ignore) return one({ t: 'mod', g: 'flavor', text: e.raw ? dropHead(raw, 1) : e.name, raw });
  }
  if (w.startsWith('لل') && w.length >= 4) return one({ t: 'note', raw });
  return null;
}

function lexLoose(tk, find) {
  const forms = [[tk.n, tk.raw, false]];
  if (tk.n.length >= 5 && tk.n[0] === 'و') forms.push([tk.n.slice(1), dropHead(tk.raw, 1), true]);
  const wrap = (st, lex) => ({ lex: st ? [{ t: 'conj', raw: 'و' }, ...lex] : lex, len: 1 });
  // فرق حرف واحد
  for (const [w, raw, st] of forms) {
    if (w.length < 4) continue;
    const ws = stripAl(w);
    for (const s of SINGLE) {
      if (within1(ws, s) || (ws !== w && within1(w, s))) return wrap(st, [{ t: 'item', e: DICT.get(s), n: s, raw }]);
    }
  }
  // كلمتين ملزوقة (سكرزيت)
  for (const [w, , st] of forms) {
    if (w.length < 6) continue;
    for (let k = 3; k <= w.length - 3; k++) {
      const a = find(w.slice(0, k)), b = find(w.slice(k));
      if (a && b && !a.ignore && !b.ignore) {
        return wrap(st, [
          { t: 'item', e: a, n: w.slice(0, k), raw: a.name },
          { t: 'item', e: b, n: w.slice(k), raw: b.name },
        ]);
      }
    }
  }
  // كلمة مجهولة تبدأ بـ "و": تنعامل كعطف + كلمة، عشان "وزعفران" و"زعفران" يتعلّمون كغرض واحد
  if (tk.n.length >= 4 && tk.n[0] === 'و') {
    return wrap(true, [{ t: 'unknown', raw: dropHead(tk.raw, 1), n: tk.n.slice(1) }]);
  }
  return one({ t: 'unknown', raw: tk.raw, n: tk.n });
}

function lexSegment(toks, find, maxw) {
  const out = [];
  let i = 0;
  while (i < toks.length) {
    const tk = toks[i];
    if (tk.num) {
      out.push({ t: 'num', v: tk.val, attached: tk.attached, digits: tk.digits, raw: tk.raw });
      i++;
      continue;
    }
    let r = lexWord(toks, i, tk.n, tk.raw, find, maxw, false);
    if (!r && tk.n.length >= 3 && tk.n[0] === 'و') {
      const r2 = lexWord(toks, i, tk.n.slice(1), dropHead(tk.raw, 1), find, maxw, true);
      if (r2) r = { lex: [{ t: 'conj', raw: 'و' }, ...r2.lex], len: r2.len };
    }
    if (!r) r = lexLoose(tk, find);
    out.push(...r.lex);
    i += r.len;
  }
  return out;
}

// ---------- assemble ----------
function mk(entry, raw) {
  return {
    entry, base: entry ? (entry.raw ? raw : entry.name) : raw,
    prefix: null, mods: [], qty: null, unit: null, notes: [], unknown: !entry, amb: false, ctx: null,
  };
}
const hasG = (it, g) => it.mods.some((m) => m.g === g);
const juiceFlavor = (e) => e.fl && (e.section === 'veg' || e.name === 'شوكولاتة');

function assemble(lex, last, ctxStore, unkAsDesc) {
  const out = [], ops = [];
  let cur = null, pend = null, prefix = null, conj = false, store = ctxStore;
  const first = lex.find((x) => x.t !== 'filler' && x.t !== 'conj' && x.t !== 'header');
  const pre = !!first && (first.t === 'num' || (first.t === 'unit' && (first.count > 0 || MEASURE.has(first.unit))));
  const nextOf = (i) => { for (let j = i + 1; j < lex.length; j++) if (lex[j].t !== 'filler') return lex[j]; return null; };
  const setQ = (it, q) => { it.qty = q.qty; if (q.unit) it.unit = q.unit; };
  const add = (it) => {
    it.ctx = store;
    if (pend) { setQ(it, pend); pend = null; }
    if (prefix) { it.prefix = prefix; prefix = null; }
    out.push(it); cur = it; conj = false;
  };
  const placeQ = (q, iFirst, iLast) => {
    if (!cur) { pend = q; return; }
    const nx = nextOf(iLast), pv = lex[iFirst - 1];
    if (!nx || nx.t === 'conj' || nx.t === 'alt' || nx.t === 'rel' || nx.t === 'note' || nx.t === 'header') {
      if (!(pv && pv.t === 'filler')) setQ(cur, q); // "حولت لك 50" مو كمية
      return;
    }
    if (conj || pre || cur.qty != null) { pend = q; return; }
    setQ(cur, q);
  };
  const unknownWord = (raw, n) => {
    if (cur && !conj && !pend) {
      if (cur.entry && cur.entry.acc.has(n)) { cur.mods.push({ g: 'kind', text: raw }); return; }
      if (cur.unknown) { cur.base += ' ' + raw; return; }
      if (unkAsDesc) { cur.mods.push({ g: 'unk', text: raw }); return; }
    }
    add(mk(null, raw));
  };
  const noteTo = (text) => {
    if (cur) cur.notes.push(text);
    else if (last) ops.push({ note: text });
    else add(mk(null, text));
  };

  for (let i = 0; i < lex.length; i++) {
    const x = lex[i];
    if (x.t === 'filler') continue;
    if (x.t === 'conj') { conj = true; continue; }
    if (x.t === 'header') { store = x.store; cur = null; pend = null; prefix = null; conj = false; continue; }

    if (x.t === 'num') {
      const pv = lex[i - 1];
      if (x.attached && cur && pv && (pv.t === 'item' || pv.t === 'mod' || pv.t === 'unknown')) {
        if (x.digits >= 3) cur.mods.push({ g: 'desc', text: x.raw }); // رقم موديل
        else cur.qty = x.v;
        continue;
      }
      const q = { qty: x.v, unit: null };
      let j = i;
      const nx = lex[i + 1];
      if (nx && nx.t === 'unit') { q.unit = nx.unit; if (nx.count) q.qty *= nx.count; j = i + 1; }
      placeQ(q, i, j);
      i = j;
      continue;
    }

    if (x.t === 'unit') {
      if (x.count || MEASURE.has(x.unit)) { placeQ({ qty: x.count || 1, unit: x.unit }, i, i); continue; }
      const nx = nextOf(i);
      if (nx && nx.t === 'item') prefix = x.raw; // ربطة مويه
      else if (cur) cur.mods.push({ g: 'desc', text: x.unit }); // لبنه علبه
      else unknownWord(x.raw, norm(x.raw));
      continue;
    }

    if (x.t === 'mod') {
      if (!cur) { unknownWord(x.raw, norm(x.raw)); continue; }
      const g = x.g, same = hasG(cur, g);
      if (EXCLUSIVE.has(g) && ((same && (conj || g === 'shape')) || (conj && pend))) {
        // نوع ثاني من نفس الغرض: بند جديد
        const it = mk(cur.entry, cur.base);
        it.base = cur.base; it.unknown = cur.unknown; it.prefix = cur.prefix; it.amb = cur.amb;
        it.mods = cur.mods.filter((m) => m.g !== g).concat([{ g, text: x.text }]);
        add(it);
      } else {
        cur.mods.push({ g, text: x.text });
        conj = false;
      }
      continue;
    }

    if (x.t === 'note') { noteTo(x.raw); continue; }

    if (x.t === 'alt' || x.t === 'rel') {
      const parts = [x.raw];
      let j = i + 1;
      while (j < lex.length && lex[j].t !== 'conj' && lex[j].t !== 'header') parts.push(lex[j++].raw);
      noteTo(parts.join(' '));
      i = j - 1;
      continue;
    }

    if (x.t === 'item') {
      const e = x.e;
      if (cur && cur.entry && !conj && !pend && !prefix) {
        if (cur.entry.acc.has(norm(e.name)) || cur.entry.acc.has(x.n)) {
          cur.mods.push({ g: 'kind', text: e.raw ? x.raw : e.name });
          continue;
        }
        if (cur.entry.fa && e.fl && !hasG(cur, 'flavor')) {
          cur.mods.push({ g: 'flavor', text: e.name });
          continue;
        }
      }
      // سياق العصير: "2 عصير شوكلاتة و1 مانجو"
      if (juiceFlavor(e) && (conj || pend) && cur && cur.entry && cur.entry.drink && hasG(cur, 'flavor')) {
        const it = mk(JUICE, JUICE.name);
        it.mods.push({ g: 'flavor', text: e.name });
        it.amb = true;
        add(it);
        continue;
      }
      // "عصيرات" عنوان لمشروبات بعدها
      if (cur && cur.entry === JUICES && !conj && e.drink && cur.qty == null && !hasG(cur, 'flavor')) {
        out.splice(out.indexOf(cur), 1);
      }
      add(mk(e, x.raw));
      continue;
    }

    if (x.t === 'unknown') unknownWord(x.raw, x.n);
  }

  if (pend) {
    if (cur) { if (cur.qty == null) setQ(cur, pend); }
    else if (!out.length && lex.every((x) => x.t === 'num' || x.t === 'unit')) ops.push({ q: pend });
  }
  return { out, ops, store };
}

// ---------- parse ----------
export function parse(text, learned) {
  const L = learned || {};
  const { find, maxw } = makeFinder(L);
  const all = [];
  let last = null, store = null;

  for (const seg of segments(text)) {
    const toks = tokenize(seg);
    if (!toks.length) continue;
    const lex = lexSegment(toks, find, maxw);
    let r = assemble(lex, last, store, false);
    // مقطع فيه غرض واحد معروف: الكلمات المجهولة بعده وصف له
    if (r.out.filter((it) => !it.unknown).length === 1 && r.out.some((it) => it.unknown)) {
      r = assemble(lex, last, store, true);
    }
    for (const op of r.ops) {
      if (!last) continue;
      if (op.note) last.notes.push(op.note);
      if (op.q && last.qty == null) { last.qty = op.q.qty; if (op.q.unit) last.unit = op.q.unit; }
    }
    all.push(...r.out);
    if (r.out.length) last = r.out[r.out.length - 1];
    store = r.store;
  }

  const withFoul = all.some((it) => it.entry === FOUL || it.entry === TAMEES);
  const items = [], unknowns = [], index = new Map();
  for (const it of all) {
    const name = [it.prefix, it.base, ...it.mods.map((m) => m.text)].filter(Boolean).join(' ');
    const idm = it.mods.filter((m) => IDG.has(m.g)).map((m) => m.text);
    const learnKey = keyOf([it.base, ...idm].join(' '));
    const lv = L[learnKey];
    if (lv === 'ignore') continue;
    let section = null, unknown = it.unknown, suggest = null;
    if (it.entry) {
      const e = it.entry;
      const lb = L[keyOf(it.base)];
      const msOn = e.ms && it.mods.some((m) => m.g === 'brand' || m.g === 'flavor');
      section = lv || (msOn ? e.ms : (lb && lb !== 'ignore' ? lb : e.section));
      if (!lv && e === BREAD && withFoul && !it.mods.length && !it.prefix) section = 'foul';
    } else if (lv) {
      section = lv; unknown = false;
    } else if (it.ctx && it.ctx !== 'market') {
      suggest = it.ctx;
    }
    const o = {
      name, base: it.base, qty: it.qty, unit: it.unit,
      note: it.notes.length ? [...new Set(it.notes)].join('، ') : null,
      section, key: keyOf(name), learnKey,
      amb: it.amb || !!(it.entry && it.entry.amb && !idm.length),
      unknown, suggest,
    };
    const mkey = (unknown ? 'u|' : 'k|') + o.key;
    const old = index.get(mkey);
    if (!old) {
      index.set(mkey, o);
      (unknown ? unknowns : items).push(o);
      continue;
    }
    // مكرر في نفس الرسالة: يندمج والكميات تنجمع
    if (old.qty != null && o.qty != null) old.qty += o.qty;
    else if (o.qty != null) old.qty = o.qty;
    if (!old.unit) old.unit = o.unit;
    if (o.note && o.note !== old.note) old.note = old.note ? old.note + '، ' + o.note : o.note;
  }
  return { items, unknowns };
}
