// ==UserScript==
// @name         PW 1.8.7 - Scanner de Reliquias
// @namespace    local.pw187.reliquias
// @version      1.6.0
// @description  Painel de céu, runas, cartas, arma e relíquias; histórico e notas locais.
// @match        https://marketplace.theclassic.games/pw187*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ruankbk-design/Repository/main/pw187-reliquias.user.js
// @downloadURL  https://raw.githubusercontent.com/ruankbk-design/Repository/main/pw187-reliquias.user.js
// ==/UserScript==

/*
 * Leitor LOCAL de paginas que voce mesmo abre.
 * Nao faz fetch, requests, navegacao automatica, cliques em anuncios ou compras.
 * Requisitos: 40 a 100 TCC e >=30 em pelo menos 2 das 3 reliquias,
 * somando Inventario e Banco (e a aba Cartas, se houver reliquias la).
 * Atualizações vêm do arquivo público do repositório GitHub configurado acima.
 */
(() => {
  'use strict';

  const PREFIX = 'pw187_relic_scan_v1';
  const KEY = `${PREFIX}_results`;
  const ITEMS = [
    { key: 'arma', name: 'Relíquia Maravilha: Arma', id: 50410, icon: '⚔️' },
    { key: 'armadura', name: 'Relíquia Maravilha: Armadura', id: 70020, icon: '🛡️' },
    { key: 'artefato', name: 'Relíquia Maravilha: Artefato', id: 54687, icon: '💠' },
  ];
  const MIN = 30;
  const MIN_PRICE = 40;
  const MAX_PRICE = 100;
  const CARD_GROUPS = [
    { label: 'Combo 1', names: ['Althea', 'Kestra', 'Lorelei', 'Astrid', 'Tensa', 'Saki'] },
    { label: 'Combo 2', names: ['Imperador Locen', 'Senhora da Noite', 'Gorath', 'Asa Espectral', 'Imperador Chigo', 'Imperador Aohe'] },
  ];
  const CARD_NAMES = CARD_GROUPS.flatMap((group) => group.names);
  const SAFE_MODE_KEY = `${PREFIX}_safe_mode`;
  const LAST_NAV_KEY = `${PREFIX}_last_navigation`;
  const NAV_COOLDOWN_MS = 8000;
  const SCANNER_TAB_NAME = 'PW187ScannerSingleTab';

  function safeModeEnabled() {
    try { return localStorage.getItem(SAFE_MODE_KEY) !== 'off'; }
    catch { return true; }
  }

  function detailUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && url.hostname === 'marketplace.theclassic.games'
        && /^\/pw187\/details\/\d+\/?$/.test(url.pathname) ? url : null;
    } catch { return null; }
  }

  function navigateSafely(url, onMessage) {
    if (safeModeEnabled()) {
      let last = 0;
      try { last = Number(localStorage.getItem(LAST_NAV_KEY)) || 0; } catch { /* Nada. */ }
      const remaining = NAV_COOLDOWN_MS - (Date.now() - last);
      if (remaining > 0) {
        onMessage(`Aguarde ${Math.ceil(remaining / 1000)} s antes de abrir outro anúncio.`);
        return;
      }
    }
    const target = safeModeEnabled() ? SCANNER_TAB_NAME : '_blank';
    const opened = window.open(url.href, target);
    if (!opened) { onMessage('O Firefox bloqueou a abertura da aba. Confira a permissão de pop-ups.'); return; }
    try { opened.opener = null; } catch { /* Nada. */ }
    try { localStorage.setItem(LAST_NAV_KEY, String(Date.now())); } catch { /* Nada. */ }
    onMessage(safeModeEnabled() ? 'Anúncio aberto na aba única do scanner.' : 'Anúncio aberto em nova aba.');
  }

  function classify(price, totals) {
    const priceOk = price >= MIN_PRICE && price <= MAX_PRICE;
    const qualified = ITEMS.filter((i) => totals[i.key] >= MIN).length;
    return {
      qualified,
      status: priceOk && qualified >= 2 ? 'pass' : 'fail',
      reason: !priceOk ? 'Preço fora de 40–100 TCC'
        : qualified < 2 ? `Apenas ${qualified}/3 relíquias atingiram 30 unidades`
          : `${qualified}/3 relíquias atingiram 30 unidades`,
    };
  }

  const normalize = (s) => String(s ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

  function readCelestial() {
    const rows = [...document.querySelectorAll('.character-info--list')];
    const row = rows.find((item) => normalize(item.querySelector('.skill-desc')?.textContent) === 'reino celestial');
    return row?.querySelector('.value')?.textContent?.trim() || null;
  }

  function readRunes() {
    const grid = document.querySelector('[data-pw187-panel="skills"] [data-pw187-section="runes"]');
    if (!grid) return null;
    const equipped = [...grid.querySelectorAll('.pw187-rune-pair__rune.is-filled')];
    const list = equipped.map((slot) => {
      const label = slot.getAttribute('aria-label') || '';
      const nameMatch = label.match(/^(.*?)\s+(?:N[ií]vel|Nv\.?)\s*(\d+)/i);
      const level = nameMatch ? Number(nameMatch[2]) : null;
      const rawName = nameMatch ? nameMatch[1].replace(/^Runa\s+/i, '') : label.split('·')[0].trim();
      return { name: rawName || 'Runa', level, slot: slot.closest('[data-rune-slot]')?.getAttribute('data-rune-slot') };
    });
    return { count: list.length, list };
  }

  function readWeapon() {
    const slot = document.querySelector('[data-pw187-panel="inventory"] .pw187-detail-inventory-upper section:first-child li[data-item]');
    if (!slot) return null;
    let data;
    try { data = JSON.parse(slot.getAttribute('data-item')); }
    catch { return null; }
    const name = data.item_name || data.name || data.title || 'Arma';
    const tooltip = slot.querySelector('[data-pw187-tooltip]')?.getAttribute('data-pw187-tooltip') || '';
    if (!tooltip) return { name, attackLevel: null, lines: 0 };
    const parsed = new DOMParser().parseFromString(tooltip.replace(/<br\s*\/?\s*>/gi, ' '), 'text/html');
    const text = parsed.body.textContent || '';
    const values = [...text.matchAll(/N[ií]vel\s+de\s+Ataque\s*\+\s*(\d+)/gi)].map((match) => Number(match[1]));
    return { name, attackLevel: values.reduce((sum, value) => sum + value, 0), lines: values.length };
  }

  function readCards() {
    const equippedContainer = document.querySelector('.pw187-equipped-cards');
    const collection = document.querySelector('[data-pw187-panel="inventory"] [data-pw187-subpanel="cards"]');
    if (!equippedContainer && !collection) return null;
    const equipped = [...(equippedContainer?.querySelectorAll('.pw187-equipped-card.is-filled') || [])]
      .map((node) => normalize(node.getAttribute('title') || node.querySelector('img')?.alt));
    const stored = [...(collection?.querySelectorAll('li[data-item]') || [])].map((element) => {
      try {
        const item = JSON.parse(element.getAttribute('data-item'));
        return normalize(item.item_name || item.name || item.title);
      } catch { return ''; }
    });
    const equippedFound = CARD_NAMES.filter((name) => equipped.some((card) => card.startsWith(normalize(name))));
    const found = CARD_NAMES.filter((name) => [...equipped, ...stored].some((card) => card.startsWith(normalize(name))));
    const groups = CARD_GROUPS.map((group) => {
      const owned = group.names.filter((name) => found.includes(name));
      return { label: group.label, found: owned, count: owned.length, complete: owned.length === group.names.length };
    });
    return { found, count: found.length, complete: found.length === CARD_NAMES.length,
      equippedCount: equippedFound.length, fromCollection: found.length > equippedFound.length, groups };
  }

  function parsePrice() {
    const source = document.querySelector('[data-character-price]')?.getAttribute('data-character-price')
      || document.querySelector('.btn-price .price')?.textContent || '';
    const match = source.match(/([\d.,]+)\s*TCC/i);
    if (!match) return null;
    const value = Number(match[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  function readContainers() {
    const names = { bag: 'Inventário', bank: 'Banco', cards: 'Cartas' };
    const totals = Object.fromEntries(ITEMS.map((i) => [i.key, 0]));
    const byTab = {};
    let invalid = 0;
    let slots = 0;
    for (const [tab, label] of Object.entries(names)) {
      const container = document.querySelector(`[data-pw187-panel="inventory"] [data-pw187-subpanel="${tab}"]`);
      if (!container) return { error: `A aba ${label} não foi encontrada no HTML.` };
      const entries = [...container.querySelectorAll('li[data-item]')];
      slots += entries.length;
      byTab[tab] = Object.fromEntries(ITEMS.map((i) => [i.key, 0]));
      for (const element of entries) {
        let data;
        try { data = JSON.parse(element.getAttribute('data-item')); }
        catch { invalid++; continue; }

        const name = normalize(data.item_name || data.name || data.title);
        const id = Number(data.id);
        const target = ITEMS.find((i) => id === i.id || name === normalize(i.name));
        if (!target) continue;

        const count = Number(data.count);
        if (!Number.isSafeInteger(count) || count < 1) { invalid++; continue; }
        totals[target.key] += count;
        byTab[tab][target.key] += count;
      }
    }
    if (invalid) return { error: `${invalid} item(ns) com dados inválidos. Conferir manualmente.` };
    if (!slots) return { error: 'Nenhum item estruturado foi encontrado nas três abas.' };
    return { totals, slots, byTab };
  }

  function readRecord() {
    const id = location.pathname.match(/\/details\/(\d+)/)?.[1];
    const price = parsePrice();
    const bag = readContainers();
    const name = document.querySelector('.item-manual__title')?.textContent?.trim()
      || document.querySelector('[data-character-name]')?.getAttribute('data-character-name')?.trim()
      || `Personagem ${id || '?'}`;
    const cards = readCards();
    const celestial = readCelestial();
    const runes = readRunes();
    const weapon = readWeapon();
    if (!id || price === null || bag.error) {
      return { id, name, price, cards, celestial, runes, weapon, totals: bag.totals || null, status: 'unknown', reason: bag.error || 'ID ou preço não encontrado.' };
    }
    const decision = classify(price, bag.totals);
    return {
      id, name, price, cards, celestial, runes, weapon, totals: bag.totals, slots: bag.slots, byTab: bag.byTab,
      ...decision,
      url: location.origin + location.pathname,
      time: new Date().toISOString(),
    };
  }

  function getSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      // Reclassifica contas salvas pela v1.0 usando a nova regra 2/3.
      for (const record of Object.values(value)) {
        if (typeof record?.price === 'number' && record.totals && ITEMS.every((i) => Number.isFinite(record.totals[i.key]))) {
          Object.assign(record, classify(record.price, record.totals));
        }
      }
      return value;
    } catch { return {}; }
  }

  function save(record) {
    if (record.status === 'unknown') return;
    try {
      const records = getSaved();
      records[record.id] = { ...records[record.id], ...record };
      localStorage.setItem(KEY, JSON.stringify(records));
    } catch { /* Painel continua útil mesmo sem armazenamento. */ }
  }

  function saveRating(id, rating) {
    const records = getSaved();
    if (!records[id]) return;
    if (rating === null) delete records[id].rating;
    else records[id].rating = rating;
    localStorage.setItem(KEY, JSON.stringify(records));
  }

  // Estimativa simples por proximidade: nenhuma requisição externa e nenhum modelo remoto.
  // Uma nota só tem peso em contas semelhantes em preço, relíquias e combo de cartas.
  function estimate(record, records) {
    if (!record.totals || typeof record.price !== 'number') return null;
    const rated = records.filter((other) => other.id !== record.id &&
      Number.isInteger(other.rating) && other.rating >= 1 && other.rating <= 5 &&
      other.totals && typeof other.price === 'number');
    if (rated.length < 2) return null;
    const neighbors = rated.map((other) => {
      const priceDistance = Math.abs(record.price - other.price) / 60;
      const quantityDistance = ITEMS.reduce((sum, item) =>
        sum + Math.abs(Math.min(record.totals[item.key], 100) - Math.min(other.totals[item.key], 100)) / 100, 0) / 3;
      const cardDistance = record.cards && other.cards
        ? Math.abs(record.cards.count - other.cards.count) / CARD_NAMES.length : 0.3;
      const weight = 1 / (0.25 + priceDistance + quantityDistance + 0.4 * cardDistance);
      return { rating: other.rating, weight };
    }).sort((a, b) => b.weight - a.weight).slice(0, 5);
    const totalWeight = neighbors.reduce((s, n) => s + n.weight, 0);
    return { value: neighbors.reduce((s, n) => s + n.rating * n.weight, 0) / totalWeight,
      samples: rated.length };
  }

  function createPanel() {
    const root = document.createElement('div');
    root.id = 'pw187-reliquias-scanner';
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { position: fixed; z-index: 2147483640; right: 18px; bottom: 18px;
          width: 385px; max-width: calc(100vw - 36px); max-height: 88vh; overflow:auto;
          background: #101827; color: #f9fafb; border: 1px solid #46566f;
          border-radius: 16px; padding: 16px; box-shadow: 0 18px 48px #000b;
          font: 13px/1.45 Arial,sans-serif; scrollbar-width: thin; }
        .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; gap:8px; }
        .head b { font-size:15px; letter-spacing:.2px; }
        .version { display:inline-block; margin-left:6px; font-size:10px; color:#a5b4fc; border:1px solid #6366f1;
          border-radius:99px; padding:2px 6px; vertical-align:2px; }
        button { cursor:pointer; background:#253752; color:white; border:1px solid #425570;
          padding:8px 10px; border-radius:8px; font-weight:600; }
        button:hover { background:#395473; }
        .identity { font-size:13px; font-weight:600; color:#e2e8f0; line-height:1.5; overflow-wrap:anywhere; }
        .status { margin:10px 0 14px; padding:10px; border-radius:9px; font-weight:bold; }
        .pass { color:#bbf7d0; background:#14532d; }
        .fail { color:#fecaca; background:#7f1d1d; }
        .unknown { color:#fde68a; background:#78350f; }
        .item { display:flex; justify-content:space-between; margin:7px 0; gap:10px; }
        .ok { color:#86efac; } .bad { color:#fca5a5; }
        .muted { color:#cbd5e1; font-size:12px; }
        .priority { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
        .feature { background:#172438; border:1px solid #30435d; border-radius:11px;
          padding:11px; min-width:0; }
        .feature.wide { grid-column:1 / -1; }
        .eyebrow { color:#9caec7; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
        .featureValue { font-size:17px; font-weight:800; margin-top:5px; overflow-wrap:anywhere; }
        .subvalue { color:#cbd5e1; font-size:12px; margin-top:4px; }
        .chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
        .chip { display:inline-block; border-radius:6px; padding:3px 6px; background:#283a52;
          color:#e2e8f0; font-size:11px; }
        .chip.found { background:#14532d; color:#bbf7d0; }
        .chip.missing { color:#94a3b8; background:#1e293b; }
        .cardGroup + .cardGroup { margin-top:9px; padding-top:9px; border-top:1px solid #334155; }
        .groupHead { display:flex; justify-content:space-between; gap:8px; align-items:center;
          font-size:12px; font-weight:bold; }
        .sectionDetails { margin-top:12px; border:1px solid #334155; border-radius:10px;
          background:#151f30; padding:10px; }
        .sectionDetails summary { cursor:pointer; font-weight:700; }
        .sectionDetails > .muted { margin-top:6px; }
        .subtleLine { margin:8px 0; border-top:1px solid #2e4059; }
        .actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
        .linkbox { display:flex; gap:5px; margin-top:10px; }
        .linkbox input { min-width:0; flex:1; background:#1e293b; color:white; border:1px solid #64748b;
          border-radius:6px; padding:7px; font:12px Arial,sans-serif; }
        .safe { display:flex; align-items:center; gap:7px; margin-top:10px; }
        .safe input { accent-color:#22c55e; width:16px; height:16px; }
        .notice { min-height:15px; margin-top:7px; }
        .overlay { position:fixed; inset:0; z-index:2147483641; display:grid; place-items:center;
          background:#000b; font:13px/1.45 Arial,sans-serif; color:#f9fafb; }
        .modal { width:min(920px,94vw); max-height:88vh; overflow:auto; background:#0f172a;
          border:1px solid #64748b; border-radius:13px; padding:18px; box-shadow:0 20px 55px #000b; }
        .modalhead { display:flex; gap:10px; align-items:center; justify-content:space-between; position:sticky;
          top:-18px; background:#0f172a; padding:8px 0; }
        .modalhead b { font-size:18px; }
        .columns { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .column { min-width:0; border:1px solid #334155; border-radius:9px; padding:10px; }
        .entry { border-top:1px solid #334155; padding:10px 0; }
        .entry a { color:#93c5fd; font-weight:bold; overflow-wrap:anywhere; }
        .entry select { background:#1e293b; color:white; border:1px solid #64748b; border-radius:5px; padding:5px; }
        .rating { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:6px; }
        @media(max-width:670px) { .columns { grid-template-columns:1fr; } }
        [hidden] { display:none!important; }
      </style>
      <aside class="panel" aria-label="Scanner de Personagens">
        <div class="head"><b>✦ PW Scanner <span class="version">v1.6</span></b><button id="toggle" title="Minimizar">−</button></div>
        <div id="body">
          <div class="identity" id="identity"></div>
          <div id="status" class="status unknown">Analisando…</div>
          <div class="priority">
            <section class="feature">
              <div class="eyebrow">01 · Reino Celestial</div>
              <div class="featureValue" id="celestial">—</div>
            </section>
            <section class="feature">
              <div class="eyebrow">02 · Runas equipadas</div>
              <div class="featureValue" id="runeCount">—</div>
              <div class="chips" id="runeList"></div>
            </section>
            <section class="feature wide">
              <div class="eyebrow">03 · Combos de cartas</div>
              <div class="featureValue" id="cardsSummary">—</div>
              <div id="cardGroups"></div>
            </section>
            <section class="feature wide">
              <div class="eyebrow">04 · Nível de Ataque da Arma</div>
              <div class="featureValue" id="attackLevel">—</div>
              <div class="subvalue" id="weaponName"></div>
            </section>
          </div>
          <details class="sectionDetails" open>
            <summary>Relíquias · 30+ em pelo menos 2/3</summary>
            <div id="items"></div>
            <div class="muted" id="sourceBreakdown"></div>
            <div class="muted" id="reason"></div>
          </details>
          <div class="subtleLine"></div>
          <div class="muted" id="prediction"></div>
          <div class="muted" id="saved"></div>
          <div class="actions">
            <button id="rescan">Reanalisar</button>
            <button id="history">📋 Histórico e notas</button>
            <button id="copy">Copiar aprovadas</button>
          </div>
          <div class="linkbox">
            <input id="targetUrl" type="url" placeholder="Cole o link de uma conta..." aria-label="Link de anúncio" />
            <button id="openUrl">Analisar</button>
          </div>
          <label class="safe"><input id="safeMode" type="checkbox" checked /> Modo seguro: aba única + intervalo de 8 s</label>
          <div class="muted">Com o modo seguro ligado, links abertos pela rodinha a partir da lista reutilizam uma aba. Não há varredura automática.</div>
          <div class="muted notice" id="notice" role="status"></div>
        </div>
      </aside>
      <div class="overlay" id="overlay" hidden>
        <section class="modal" role="dialog" aria-modal="true" aria-label="Histórico do scanner">
          <div class="modalhead"><b>📋 Contas analisadas</b><button id="close">Fechar ✕</button></div>
          <div class="muted">Sua nota de 1 a 5 mede o custo-benefício percebido. Ela não altera os critérios de classificação.</div>
          <div class="muted" id="learning"></div>
          <div class="columns">
            <section class="column"><h3>✅ Classificadas (<span id="passedCount">0</span>)</h3><div id="passedList"></div></section>
            <section class="column"><h3>❌ Desclassificadas (<span id="failedCount">0</span>)</h3><div id="failedList"></div></section>
          </div>
        </section>
      </div>`;

    const el = (id) => shadow.getElementById(id);
    const setText = (id, value) => { el(id).textContent = value; };
    function addChip(container, label, tone = '') {
      const chip = document.createElement('span');
      chip.className = `chip ${tone}`;
      chip.textContent = label;
      container.append(chip);
    }
    el('safeMode').checked = safeModeEnabled();
    el('safeMode').addEventListener('change', () => {
      try { localStorage.setItem(SAFE_MODE_KEY, el('safeMode').checked ? 'on' : 'off'); }
      catch { /* Modo funciona na aba atual, mas pode não persistir. */ }
      setText('notice', el('safeMode').checked ? 'Modo seguro ativado.' : 'Modo seguro desativado: novos cliques podem abrir várias abas.');
    });

    function render() {
      const record = readRecord();
      save(record);
      setText('identity', `${record.name} · ID ${record.id || '?'} · ${record.price === null ? 'Preço desconhecido' : `${record.price} TCC`}`);
      const status = el('status');
      status.className = `status ${record.status}`;
      status.textContent = record.status === 'pass' ? `✅ APROVADA (${record.qualified}/3)` : record.status === 'fail' ? `❌ REPROVADA (${record.qualified ?? '?'}/3)` : '⚠️ NÃO FOI POSSÍVEL CONFIRMAR';

      setText('celestial', record.celestial || 'Não identificado');
      setText('runeCount', record.runes ? `${record.runes.count} equipada(s)` : 'Não identificado');
      const runeList = el('runeList');
      runeList.replaceChildren();
      if (record.runes?.count) {
        for (const rune of record.runes.list) addChip(runeList, `${rune.name} · ${rune.level === null ? 'Nv. ?' : `Nv. ${rune.level}`}`);
      } else if (record.runes) addChip(runeList, 'Nenhuma runa equipada', 'missing');

      const groups = el('cardGroups');
      groups.replaceChildren();
      setText('cardsSummary', record.cards ? `${record.cards.count}/${CARD_NAMES.length} cartas encontradas` : 'Não identificado');
      for (const group of CARD_GROUPS) {
        const box = document.createElement('div');
        box.className = 'cardGroup';
        const head = document.createElement('div');
        head.className = 'groupHead';
        const found = record.cards?.found || [];
        const count = group.names.filter((name) => found.includes(name)).length;
        head.textContent = `${group.label}: ${count}/${group.names.length}${count === group.names.length ? ' ✓ completo' : ''}`;
        box.append(head);
        const chips = document.createElement('div');
        chips.className = 'chips';
        for (const name of group.names) addChip(chips, name, found.includes(name) ? 'found' : 'missing');
        box.append(chips);
        groups.append(box);
      }
      setText('attackLevel', record.weapon?.attackLevel === null || !record.weapon ? 'Não identificado'
        : `+${record.weapon.attackLevel} níveis`);
      setText('weaponName', record.weapon?.name || 'Arma não identificada');

      const items = el('items');
      items.replaceChildren();
      for (const item of ITEMS) {
        const count = record.totals?.[item.key];
        const line = document.createElement('div');
        line.className = 'item';
        const label = document.createElement('span');
        label.textContent = `${item.icon} ${item.name.replace('Relíquia Maravilha: ', '')}`;
        const amount = document.createElement('b');
        amount.className = count >= MIN ? 'ok' : 'bad';
        amount.textContent = `${count ?? '?'} / ${MIN}`;
        line.append(label, amount);
        items.append(line);
      }
      const sources = record.byTab;
      setText('sourceBreakdown', sources
        ? `Origem: Inventário (${ITEMS.map((i) => sources.bag[i.key]).join('/')}) · Banco (${ITEMS.map((i) => sources.bank[i.key]).join('/')}) · Cartas (${ITEMS.map((i) => sources.cards[i.key]).join('/')}) — ordem Arma/Armadura/Artefato`
        : 'Origem: não disponível para esta análise');
      setText('reason', record.reason);
      const values = Object.values(getSaved());
      setText('saved', `${values.length} conta(s) verificadas · ${values.filter((v) => v.status === 'pass').length} aprovada(s)`);
      const estimated = estimate(record, values);
      setText('prediction', estimated ? `📊 Custo-benefício estimado: ${estimated.value.toFixed(1)}/5 (${estimated.samples} avaliações suas)` : '📊 Dê notas a pelo menos 2 outras contas para estimar custo-benefício.');
      if (!el('overlay').hidden) renderHistory();
    }

    function makeEntry(record, all) {
      const item = document.createElement('article');
      item.className = 'entry';
      const link = document.createElement('a');
      link.href = record.url || `${location.origin}/pw187/details/${encodeURIComponent(record.id)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${record.name || `Personagem ${record.id}`} (ID ${record.id})`;
      item.append(link);

      const details = document.createElement('div');
      details.className = 'muted';
      const t = record.totals || {};
      details.textContent = `${record.price} TCC · Céu ${record.celestial || '?'} · Runas ${record.runes?.count ?? '?'} · Nível de Ataque ${record.weapon?.attackLevel ?? '?'} · Relíquias ${t.arma ?? '?'}/${t.armadura ?? '?'}/${t.artefato ?? '?'} · Cartas ${record.cards ? `${record.cards.count}/${CARD_NAMES.length}` : '?'}`;
      item.append(details);

      const predicted = estimate(record, all);
      if (predicted) {
        const estimateLabel = document.createElement('div');
        estimateLabel.className = 'muted';
        estimateLabel.textContent = `Custo-benefício estimado: ${predicted.value.toFixed(1)}/5 (${predicted.samples} notas)`;
        item.append(estimateLabel);
      }
      const ratingRow = document.createElement('div');
      ratingRow.className = 'rating';
      const label = document.createElement('span');
      label.textContent = 'Sua nota:';
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Sua nota para ${record.name || record.id}`);
      select.dataset.id = record.id;
      for (const [value, title] of [['', 'Sem nota'], ['1', '1 — Péssimo'], ['2', '2 — Ruim'], ['3', '3 — Regular'], ['4', '4 — Bom'], ['5', '5 — Excelente']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        select.append(option);
      }
      select.value = record.rating ? String(record.rating) : '';
      ratingRow.append(label, select);
      item.append(ratingRow);
      return item;
    }

    function renderHistory() {
      const records = Object.values(getSaved()).filter((r) => r.status === 'pass' || r.status === 'fail');
      const ratedCount = records.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5).length;
      setText('learning', `${ratedCount} conta(s) avaliadas. A estimativa compara preço, quantidade de relíquias e combo de cartas; é apenas uma referência.`);
      for (const [status, countId, listId] of [
        ['pass', 'passedCount', 'passedList'], ['fail', 'failedCount', 'failedList'],
      ]) {
        const chosen = records.filter((r) => r.status === status)
          .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        setText(countId, String(chosen.length));
        const list = el(listId);
        list.replaceChildren();
        if (!chosen.length) {
          const empty = document.createElement('div');
          empty.className = 'muted';
          empty.textContent = 'Nenhuma conta nesta categoria ainda.';
          list.append(empty);
        } else {
          for (const record of chosen) list.append(makeEntry(record, records));
        }
      }
    }

    el('rescan').addEventListener('click', render);
    el('openUrl').addEventListener('click', () => {
      const input = el('targetUrl');
      const url = detailUrl(input.value.trim());
      if (!url) {
        setText('notice', 'Use somente links de personagens do Marketplace PW 1.8.7.');
        return;
      }
      navigateSafely(url, (message) => setText('notice', message));
    });
    el('targetUrl').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); el('openUrl').click(); }
    });
    el('history').addEventListener('click', () => {
      renderHistory();
      el('overlay').hidden = false;
    });
    el('close').addEventListener('click', () => { el('overlay').hidden = true; });
    el('overlay').addEventListener('click', (event) => {
      if (event.target === el('overlay')) el('overlay').hidden = true;
    });
    el('overlay').addEventListener('change', (event) => {
      const id = event.target?.dataset?.id;
      if (!id) return;
      const value = event.target.value;
      saveRating(id, value ? Number(value) : null);
      renderHistory();
      const current = readRecord();
      const predicted = estimate(current, Object.values(getSaved()));
      setText('prediction', predicted ? `📊 Custo-benefício estimado: ${predicted.value.toFixed(1)}/5 (${predicted.samples} avaliações suas)` : '📊 Dê notas a pelo menos 2 outras contas para estimar custo-benefício.');
    });
    window.addEventListener('storage', (event) => {
      if (event.key === KEY) {
        const records = Object.values(getSaved());
        setText('saved', `${records.length} conta(s) verificadas · ${records.filter((r) => r.status === 'pass').length} aprovada(s)`);
        if (!el('overlay').hidden) renderHistory();
      }
    });
    el('toggle').addEventListener('click', () => {
      const body = el('body');
      body.hidden = !body.hidden;
      el('toggle').textContent = body.hidden ? '+' : '−';
    });
    el('copy').addEventListener('click', async () => {
      const lines = Object.values(getSaved()).filter((v) => v.status === 'pass')
        .sort((a, b) => a.price - b.price)
        .map((v) => `${v.name || v.id} | ${v.price} TCC | Céu ${v.celestial || '?'} | Runas ${v.runes?.count ?? '?'} | Arma Atq ${v.weapon?.attackLevel ?? '?'} | Relíquias ${v.totals.arma}/${v.totals.armadura}/${v.totals.artefato} | Cartas ${v.cards?.count ?? '?'}/${CARD_NAMES.length} | ${v.url}`);
      if (!lines.length) { setText('notice', 'Nenhuma conta aprovada ainda.'); return; }
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        setText('notice', `${lines.length} link(s) copiado(s).`);
      } catch { setText('notice', 'Cópia bloqueada pelo navegador.'); }
    });
    document.body.append(root);
    function guardLink(event) {
      const middleClick = event.type === 'auxclick' && event.button === 1;
      const modifiedClick = event.type === 'click' && event.button === 0 && (event.ctrlKey || event.metaKey);
      if (!middleClick && !modifiedClick) return;
      if (!safeModeEnabled()) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const url = anchor ? detailUrl(anchor.href) : null;
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      navigateSafely(url, (message) => setText('notice', message));
    }
    document.addEventListener('auxclick', guardLink, true);
    document.addEventListener('click', guardLink, true);
    render();
  }

  if (document.body) createPanel();
  else addEventListener('DOMContentLoaded', createPanel, { once: true });
})();
