// ==UserScript==
// @name         PW 1.8.7 - Scanner de Reliquias
// @namespace    local.pw187.reliquias
// @version      1.9.0
// @description  Visão compacta: histórico, relíquias, combos, bônus das pedras e filtros personalizáveis.
// @match        https://marketplace.theclassic.games/pw187*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ruankbk-design/Repository/main/pw187-reliquias.user.js
// @downloadURL  https://raw.githubusercontent.com/ruankbk-design/Repository/main/pw187-reliquias.user.js
// ==/UserScript==

/*
 * Leitor LOCAL de paginas que voce mesmo abre.
 * Nao faz fetch, requests, navegacao automatica, cliques em anuncios ou compras.
 * Requisitos: 40 a 100 TCC e >=30 em cada uma das 3 reliquias,
 * somando Inventario e Banco (e a aba Cartas, se houver reliquias la).
 * Atualizações vêm do arquivo público do repositório GitHub configurado acima.
 */
(() => {
  'use strict';

  const PREFIX = 'pw187_relic_scan_v1';
  const KEY = `${PREFIX}_results`;
  const FILTER_KEY = `${PREFIX}_filters_v2`;
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
  const DEFAULT_FILTERS = {
    price: true, relics: true, celestial: false, runes: false,
    cards: false, attack: false, draconic: false, stones: false,
    minPrice: 40, maxPrice: 100, minRelics: 30, minRunes: 1,
    celestialText: '', minAttack: 1, minDraconic: 1, minStones: 1,
    cardCombo: 'either',
  };

  function getFilters() {
    try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') }; }
    catch { return { ...DEFAULT_FILTERS }; }
  }

  function saveFilters(filters) {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* Persistência opcional. */ }
  }

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

  function classify(record, settings = getFilters()) {
    const failures = [];
    const unknown = [];
    const check = (enabled, known, condition, message) => {
      if (!enabled) return;
      if (!known) unknown.push(message);
      else if (!condition) failures.push(message);
    };
    const totals = record.totals;
    const qualified = ITEMS.filter((i) => totals?.[i.key] >= settings.minRelics).length;
    check(settings.price, Number.isFinite(record.price), record.price >= settings.minPrice && record.price <= settings.maxPrice,
      `Preço fora de ${settings.minPrice}–${settings.maxPrice} TCC`);
    check(settings.relics, !!totals && ITEMS.every((i) => Number.isFinite(totals[i.key])), qualified === 3,
      `Relíquias: ${qualified}/3 tipos com pelo menos ${settings.minRelics}`);
    check(settings.celestial, !!record.celestial, normalize(record.celestial).includes(normalize(settings.celestialText)),
      `Céu não corresponde a "${settings.celestialText}"`);
    check(settings.runes, !!record.runes, (record.runes?.count || 0) >= settings.minRunes,
      `Menos de ${settings.minRunes} runa(s) equipada(s)`);
    const cardGroups = record.cards?.groups || [];
    const comboOk = settings.cardCombo === 'both' ? cardGroups.length === 2 && cardGroups.every((g) => g.complete)
      : settings.cardCombo === 'first' ? !!cardGroups[0]?.complete
        : settings.cardCombo === 'second' ? !!cardGroups[1]?.complete : cardGroups.some((g) => g.complete);
    check(settings.cards, !!record.cards, comboOk, 'Combo de cartas incompleto');
    check(settings.attack, record.weapon?.attackLevel !== null && record.weapon?.attackLevel !== undefined,
      (record.weapon?.attackLevel || 0) >= settings.minAttack, `Arma com menos de +${settings.minAttack} níveis de ataque`);
    check(settings.draconic, record.draconic?.count !== null && record.draconic?.count !== undefined,
      (record.draconic?.count || 0) >= settings.minDraconic, `Essência Dracônica abaixo de ${settings.minDraconic}`);
    check(settings.stones, !!record.stones,
      (record.stones?.total || 0) >= settings.minStones, `Menos de ${settings.minStones} pedra(s) equipadas`);
    return { qualified, status: failures.length ? 'fail' : unknown.length ? 'unknown' : 'pass',
      reason: failures.length ? failures.join(' · ') : unknown.length ? `Não identificado: ${unknown.join(', ')}` : 'Todos os filtros ativos foram atendidos.' };
  }

  const normalize = (s) => String(s ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

  function tooltipText(html) {
    return new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?\s*>/gi, '\n'), 'text/html').body.textContent || '';
  }

  function cardRebirth(node) {
    const img = node.querySelector('[data-pw187-tooltip]') || node;
    const text = tooltipText(img.getAttribute('data-pw187-tooltip'));
    const match = text.match(/(?:renascimentos?|renascid[ao]s?|rebirths?|reawakenings?)\s*[:+]?\s*(\d+)/i)
      || text.match(/(\d+)\s*(?:renascimentos?|rebirths?)/i);
    if (match) return Number(match[1]);
    for (const key of ['reborn_times', 'rebirth', 'rebirth_count', 'reincarnation']) {
      const raw = img.getAttribute(`data-${key.replace(/_/g, '-')}`) || node.getAttribute(`data-${key.replace(/_/g, '-')}`);
      if (raw !== null && /^\d+$/.test(raw)) return Number(raw);
    }
    return null;
  }

  function readStones() {
    const upper = document.querySelector('[data-pw187-panel="inventory"] .pw187-detail-inventory-upper');
    if (!upper) return null;
    const equipment = [...upper.querySelectorAll('li[data-item]')].map((slot) => {
      let data;
      try { data = JSON.parse(slot.getAttribute('data-item')); } catch { return null; }
      const ids = data.decoded?.slots?.slotStones;
      if (!Array.isArray(ids)) return null;
      const stones = ids.filter((id) => Number(id) > 0);
      if (!stones.length) return { name: data.item_name || data.name || 'Equipamento', stones: [] };
      const html = slot.querySelector('[data-pw187-tooltip]')?.getAttribute('data-pw187-tooltip') || '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const names = [...doc.querySelectorAll('span')].filter((span) => span.querySelector('img[src]'))
        .map((span) => ({ id: Number(span.querySelector('img').getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]),
          name: span.textContent.trim() }));
      return { name: data.item_name || data.name || 'Equipamento', stones: stones.map((id, i) => ({
        id: Number(id), name: names[i]?.id === Number(id) ? names[i].name : `Pedra ID ${id}`,
        bonus: stoneBonus(names[i]?.id === Number(id) ? names[i].name : ''),
      })) };
    }).filter(Boolean);
    return { total: equipment.reduce((sum, item) => sum + item.stones.length, 0), equipment };
  }

  function stoneBonus(description) {
    const text = String(description || '').replace(/\s+/g, ' ');
    const matched = text.match(/(?:N[ií]v(?:el)?\.?\s*(?:de\s*)?)(Ataque|Defesa|Guarda)\s*\+\s*(\d+)/i)
      || text.match(/\+\s*(\d+)\s*(?:N[ií]v(?:el)?\.?)\s*(?:de\s*)?(Ataque|Defesa|Guarda)/i);
    if (!matched) return null;
    const stat = /^\d+$/.test(matched[1]) ? matched[2] : matched[1];
    const value = /^\d+$/.test(matched[1]) ? matched[1] : matched[2];
    return `+${value} Nível de ${stat}`;
  }

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
    const equippedDetails = [...(equippedContainer?.querySelectorAll('.pw187-equipped-card.is-filled') || [])]
      .map((node) => ({ name: node.getAttribute('title') || node.querySelector('img')?.alt || '', rebirth: cardRebirth(node) }));
    const storedDetails = [...(collection?.querySelectorAll('li[data-item]') || [])].map((element) => {
      try {
        const item = JSON.parse(element.getAttribute('data-item'));
        const rebirth = ['reborn_times', 'rebirth', 'rebirth_count'].map((key) => item[key] ?? item.decoded?.[key])
          .find((value) => Number.isSafeInteger(value) && value >= 0);
        return { name: item.item_name || item.name || item.title || '', rebirth: rebirth ?? cardRebirth(element) };
      } catch { return { name: '', rebirth: null }; }
    });
    const equippedFound = CARD_NAMES.filter((name) => equippedDetails.some((card) => normalize(card.name).startsWith(normalize(name))));
    const found = CARD_NAMES.filter((name) => [...equippedDetails, ...storedDetails]
      .some((card) => normalize(card.name).startsWith(normalize(name))));
    const details = [...equippedDetails, ...storedDetails];
    const rebirths = CARD_NAMES.map((name) => ({ name, owned: found.includes(name),
      values: details.filter((card) => normalize(card.name).startsWith(normalize(name))).map((card) => card.rebirth) }));
    const groups = CARD_GROUPS.map((group) => {
      const owned = group.names.filter((name) => found.includes(name));
      return { label: group.label, found: owned, count: owned.length, complete: owned.length === group.names.length };
    });
    return { found, count: found.length, complete: found.length === CARD_NAMES.length,
      equippedCount: equippedFound.length, fromCollection: found.length > equippedFound.length, groups, rebirths };
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
    let draconic = 0;
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
        if (!target && name !== normalize('Essência Dracônica')) continue;

        const count = Number(data.count);
        if (!Number.isSafeInteger(count) || count < 1) { invalid++; continue; }
        if (target) { totals[target.key] += count; byTab[tab][target.key] += count; }
        else draconic += count;
      }
    }
    // Outras bolsas podem guardar Essência Dracônica; não contam para relíquias.
    for (const container of document.querySelectorAll('[data-pw187-panel="inventory"] [data-pw187-subpanel]')) {
      if (['bag', 'bank', 'cards'].includes(container.getAttribute('data-pw187-subpanel'))) continue;
      for (const element of container.querySelectorAll('li[data-item]')) {
        try {
          const data = JSON.parse(element.getAttribute('data-item'));
          if (normalize(data.item_name || data.name || data.title) !== normalize('Essência Dracônica')) continue;
          const count = Number(data.count);
          if (Number.isSafeInteger(count) && count > 0) draconic += count;
          else invalid++;
        } catch { /* Aba complementar sem dados reconhecíveis. */ }
      }
    }
    if (invalid) return { error: `${invalid} item(ns) com dados inválidos. Conferir manualmente.` };
    if (!slots) return { error: 'Nenhum item estruturado foi encontrado nas três abas.' };
    return { totals, slots, byTab, draconic };
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
    const stones = readStones();
    const draconic = { count: bag.error ? null : bag.draconic };
    if (!id || price === null || bag.error) {
      return { id, name, price, cards, celestial, runes, weapon, stones, draconic,
        totals: bag.totals || null, status: 'unknown', reason: bag.error || 'ID ou preço não encontrado.' };
    }
    const record = {
      id, name, price, cards, celestial, runes, weapon, stones, draconic,
      totals: bag.totals, slots: bag.slots, byTab: bag.byTab,
      url: location.origin + location.pathname,
      time: new Date().toISOString(),
    };
    return { ...record, ...classify(record) };
  }

  function getSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      // Reclassifica o histórico quando os filtros são ajustados.
      for (const record of Object.values(value)) {
        if (record && typeof record === 'object') Object.assign(record, classify(record));
      }
      return value;
    } catch { return {}; }
  }

  function save(record) {
    if (!record.id || !record.totals || !Number.isFinite(record.price)) return;
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
        button.dangerButton { background:#451e2b; border-color:#9f3b4b; color:#fecaca; }
        button.dangerButton:hover { background:#6c293b; }
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
        .filterRow { display:grid; grid-template-columns:18px minmax(0,1fr) 102px; gap:7px; align-items:center;
          padding:7px 0; border-bottom:1px solid #29394d; }
        .filterRow:last-child { border:0; }
        .filterRow input[type="checkbox"] { accent-color:#22c55e; }
        .filterRow input:not([type="checkbox"]), .filterRow select { width:100%; box-sizing:border-box;
          background:#1e293b; color:white; border:1px solid #52657e; border-radius:6px; padding:5px; min-width:0; }
        .filterRow input:disabled, .filterRow select:disabled { opacity:.42; }
        .filterLabel { font-size:12px; color:#e2e8f0; }
        .filterDouble { display:flex; align-items:center; gap:3px; }
        .filterDouble input { width:45%!important; }
        .stoneLine { margin:5px 0; overflow-wrap:anywhere; }
        .topHistory { display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:10px; margin-top:10px; border-radius:10px; background:#1c2b40; border:1px solid #37506b; }
        .topHistory button { flex-shrink:0; }
        .compactSection { background:#172438; border:1px solid #30435d; border-radius:10px;
          padding:10px; margin-top:9px; }
        .compactSection h3 { margin:0 0 6px; font-size:13px; color:#e2e8f0; }
        .compactSection .item { margin:3px 0; }
        .smallSummary { color:#bfccdd; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
        .bonus { color:#93c5fd; font-weight:bold; }
        @media(max-width:670px) { .columns { grid-template-columns:1fr; } }
        [hidden] { display:none!important; }
      </style>
      <aside class="panel" aria-label="Scanner de Personagens">
        <div class="head"><b>✦ PW Scanner <span class="version">v1.9</span></b><button id="toggle" title="Minimizar">−</button></div>
        <div id="body">
          <div class="identity" id="identity"></div>
          <div id="status" class="status unknown">Analisando…</div>
          <div class="topHistory">
            <div><b>📋 Histórico</b><div class="muted" id="saved"></div></div>
            <button id="history">Ver contas e notas</button>
          </div>
          <section class="compactSection" id="relicSection">
            <h3>⚔️ Relíquias · 3/3</h3>
            <div id="items"></div>
            <details><summary class="muted">Detalhes das origens</summary><div class="muted" id="sourceBreakdown"></div></details>
            <div class="muted" id="reason"></div>
          </section>
          <section class="compactSection" id="comboSection">
            <h3>🃏 Combo de cartas <span class="muted" id="cardsSummary"></span></h3>
            <div id="cardGroups"></div>
          </section>
          <section class="compactSection" id="stoneSection">
            <h3>💎 Pedras <span class="muted" id="stonesTotal"></span></h3>
            <div id="stonesList"></div>
          </section>
          <details class="sectionDetails" id="extraDetails">
            <summary>Outros atributos da conta</summary>
            <div class="smallSummary">Céu: <b id="celestial">—</b> · Runas: <b id="runeCount">—</b></div>
            <div class="smallSummary">Arma (nível de ataque): <b id="attackLevel">—</b> <span id="weaponName"></span></div>
            <div class="smallSummary">Essência Dracônica: <b id="draconic">—</b></div>
            <div class="chips" id="runeList"></div>
          </details>
          <details class="sectionDetails">
            <summary>⚙️ Filtros de classificação</summary>
            <div class="muted">Somente as opções marcadas afetam a aprovação.</div>
            <div id="filterSettings"></div>
            <div class="actions"><button id="resetFilters">Restaurar filtros padrão</button></div>
          </details>
          <div class="subtleLine"></div>
          <div class="muted" id="prediction"></div>
          <div class="actions">
            <button id="rescan">Reanalisar</button>
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
          <div class="modalhead"><b>📋 Contas analisadas</b><div class="actions"><button class="dangerButton" id="clearHistory">Apagar histórico</button><button id="close">Fechar ✕</button></div></div>
          <div class="muted">Filtros ativos determinam a classificação. Sua nota de 1 a 5 mede custo-benefício, sem alterar os filtros.</div>
          <div class="muted" id="learning"></div>
          <div class="columns">
            <section class="column"><h3>✅ Classificadas (<span id="passedCount">0</span>)</h3><div id="passedList"></div></section>
            <section class="column"><h3>❌ Desclassificadas (<span id="failedCount">0</span>)</h3><div id="failedList"></div></section>
          </div>
          <section class="column" style="margin-top:12px"><h3>⚠️ Dados pendentes (<span id="unknownCount">0</span>)</h3><div id="unknownList"></div></section>
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
    const filterDefs = [
      ['price', 'Preço (TCC)', 'range', 'minPrice', 'maxPrice'],
      ['relics', 'Relíquias (3/3)', 'number', 'minRelics'],
      ['celestial', 'Reino celestial contém', 'text', 'celestialText'],
      ['runes', 'Runas equipadas (mínimo)', 'number', 'minRunes'],
      ['cards', 'Combo de cartas completo', 'select', 'cardCombo'],
      ['attack', 'Nível de ataque da arma', 'number', 'minAttack'],
      ['draconic', 'Essência Dracônica', 'number', 'minDraconic'],
      ['stones', 'Pedras equipadas', 'number', 'minStones'],
    ];
    let filters = getFilters();
    function showFilters() {
      const container = el('filterSettings');
      container.replaceChildren();
      for (const [key, label, type, prop, prop2] of filterDefs) {
        const row = document.createElement('label');
        row.className = 'filterRow';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = !!filters[key];
        toggle.dataset.filter = key;
        const caption = document.createElement('span');
        caption.className = 'filterLabel';
        caption.textContent = label;
        let field;
        if (type === 'select') {
          field = document.createElement('select');
          for (const [value, name] of [['either', 'Combo 1 ou 2'], ['first', 'Combo 1'], ['second', 'Combo 2'], ['both', 'Ambos']]) {
            field.add(new Option(name, value));
          }
        } else if (type === 'range') {
          field = document.createElement('div');
          field.className = 'filterDouble';
          for (const name of [prop, prop2]) {
            const num = document.createElement('input');
            num.type = 'number'; num.min = '0'; num.max = '100000'; num.step = '1';
            num.dataset.setting = name; num.value = filters[name]; num.disabled = !filters[key];
            field.append(num);
          }
        } else {
          field = document.createElement('input');
          field.type = type;
          if (type === 'number') { field.min = '0'; field.max = '100000'; field.step = '1'; }
        }
        if (type !== 'range') { field.dataset.setting = prop; field.value = filters[prop]; field.disabled = !filters[key]; }
        row.append(toggle, caption, field);
        container.append(row);
      }
    }
    showFilters();
    el('filterSettings').addEventListener('change', (event) => {
      const field = event.target;
      if (field.dataset.filter) filters[field.dataset.filter] = field.checked;
      if (field.dataset.setting) {
        const name = field.dataset.setting;
        filters[name] = field.type === 'number' ? Math.max(0, Math.min(100000, Number(field.value) || 0)) : field.value;
      }
      saveFilters(filters);
      showFilters();
      render();
    });
    el('resetFilters').addEventListener('click', () => {
      filters = { ...DEFAULT_FILTERS };
      saveFilters(filters); showFilters(); render();
      setText('notice', 'Filtros padrão restaurados: 40–100 TCC e 3/3 relíquias (30+ cada).');
    });
    el('safeMode').checked = safeModeEnabled();
    el('safeMode').addEventListener('change', () => {
      try { localStorage.setItem(SAFE_MODE_KEY, el('safeMode').checked ? 'on' : 'off'); }
      catch { /* Modo funciona na aba atual, mas pode não persistir. */ }
      setText('notice', el('safeMode').checked ? 'Modo seguro ativado.' : 'Modo seguro desativado: novos cliques podem abrir várias abas.');
    });

    function render() {
      const record = readRecord();
      save(record);
      const onDetail = !!record.id;
      for (const id of ['relicSection', 'comboSection', 'stoneSection', 'extraDetails']) el(id).hidden = !onDetail;
      setText('identity', `${record.name} · ID ${record.id || '?'} · ${record.price === null ? 'Preço desconhecido' : `${record.price} TCC`}`);
      const status = el('status');
      status.className = `status ${record.status}`;
      status.textContent = !onDetail ? 'Abra um anúncio para analisar a conta.' : record.status === 'pass' ? '✅ APROVADA' : record.status === 'fail' ? '❌ REPROVADA' : '⚠️ DADOS INSUFICIENTES';

      setText('celestial', record.celestial || '—');
      setText('runeCount', record.runes ? `${record.runes.count}` : '—');
      const runeList = el('runeList');
      runeList.replaceChildren();
      if (record.runes?.count) {
        for (const rune of record.runes.list) addChip(runeList, `${rune.name} · ${rune.level === null ? 'Nv. ?' : `Nv. ${rune.level}`}`);
      } else if (record.runes) addChip(runeList, 'Nenhuma runa equipada', 'missing');

      const groups = el('cardGroups');
      groups.replaceChildren();
      setText('cardsSummary', record.cards ? `· ${record.cards.count}/${CARD_NAMES.length}` : '· —');
      if (!record.cards) {
        groups.textContent = 'Cartas não disponíveis nesta página.';
      }
      for (const group of record.cards ? CARD_GROUPS : []) {
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
        for (const name of group.names.filter((name) => found.includes(name))) {
          const item = record.cards?.rebirths?.find((entry) => entry.name === name);
          const known = item?.values?.filter((value) => value !== null && Number.isFinite(value)) || [];
          const value = known.length ? ` · R${Math.max(...known)}` : ' · R?';
          addChip(chips, `${name}${value}`, 'found');
        }
        if (chips.childNodes.length) box.append(chips);
        groups.append(box);
      }
      setText('attackLevel', record.weapon?.attackLevel === null || !record.weapon ? '—'
        : `+${record.weapon.attackLevel} níveis`);
      setText('weaponName', record.weapon?.name ? `· ${record.weapon.name}` : '');
      setText('draconic', record.draconic?.count === null || record.draconic?.count === undefined
        ? '—' : `${record.draconic.count}`);
      setText('stonesTotal', record.stones ? `· ${record.stones.total} encaixadas` : '· —');
      const stonesList = el('stonesList');
      stonesList.replaceChildren();
      if (record.stones) {
        for (const equip of record.stones.equipment.filter((entry) => entry.stones.length)) {
          const line = document.createElement('div');
          line.className = 'stoneLine';
          const heading = document.createElement('b');
          heading.textContent = `${equip.name} (${equip.stones.length})`;
          line.append(heading);
          const counts = new Map();
          for (const stone of equip.stones) {
            const key = `${stone.id}|${stone.bonus || ''}`;
            if (!counts.has(key)) counts.set(key, { ...stone, count: 0 });
            counts.get(key).count++;
          }
          for (const stone of counts.values()) {
            const desc = document.createElement('div');
            desc.className = 'muted';
            const baseName = stone.bonus
              ? stone.name.replace(/(?:N[ií]v(?:el)?\.?\s*(?:de\s*)?)(?:Ataque|Defesa|Guarda)\s*\+\s*\d+/i, '').trim()
              : stone.name;
            desc.append(document.createTextNode(`${stone.count}× ${baseName}`));
            if (stone.bonus) {
              const bonus = document.createElement('span');
              bonus.className = 'bonus';
              bonus.textContent = ` · ${stone.bonus}`;
              desc.append(bonus);
            }
            line.append(desc);
          }
          stonesList.append(line);
        }
        if (!record.stones.total) stonesList.textContent = 'Nenhuma pedra encaixada.';
      } else stonesList.textContent = 'Sem dados das pedras.';

      const items = el('items');
      items.replaceChildren();
      for (const item of ITEMS) {
        const count = record.totals?.[item.key];
        const line = document.createElement('div');
        line.className = 'item';
        const label = document.createElement('span');
        label.textContent = `${item.icon} ${item.name.replace('Relíquia Maravilha: ', '')}`;
        const amount = document.createElement('b');
        amount.className = count >= filters.minRelics ? 'ok' : 'bad';
        amount.textContent = `${count ?? '?'} / ${filters.minRelics}`;
        line.append(label, amount);
        items.append(line);
      }
      const sources = record.byTab;
      setText('sourceBreakdown', sources
        ? `Origem: Inventário (${ITEMS.map((i) => sources.bag[i.key]).join('/')}) · Banco (${ITEMS.map((i) => sources.bank[i.key]).join('/')}) · Cartas (${ITEMS.map((i) => sources.cards[i.key]).join('/')}) — ordem Arma/Armadura/Artefato`
        : 'Origem: não disponível para esta análise');
      setText('reason', record.status === 'pass' ? '' : record.reason);
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
      details.textContent = `${record.price} TCC · Céu ${record.celestial || '?'} · Runas ${record.runes?.count ?? '?'} · Nível de Ataque ${record.weapon?.attackLevel ?? '?'} · Relíquias ${t.arma ?? '?'}/${t.armadura ?? '?'}/${t.artefato ?? '?'} · Essência ${record.draconic?.count ?? '?'} · Pedras ${record.stones?.total ?? '?'} · Cartas ${record.cards ? `${record.cards.count}/${CARD_NAMES.length}` : '?'}`;
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
      const records = Object.values(getSaved()).filter((r) => r.status === 'pass' || r.status === 'fail' || r.status === 'unknown');
      const ratedCount = records.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5).length;
      setText('learning', `${ratedCount} conta(s) avaliadas. A estimativa compara preço, quantidade de relíquias e combo de cartas; é apenas uma referência.`);
      for (const [status, countId, listId] of [
        ['pass', 'passedCount', 'passedList'], ['fail', 'failedCount', 'failedList'], ['unknown', 'unknownCount', 'unknownList'],
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
    el('clearHistory').addEventListener('click', () => {
      const count = Object.keys(getSaved()).length;
      if (!count) { setText('learning', 'O histórico já está vazio.'); return; }
      const confirmed = window.confirm(`Apagar definitivamente ${count} conta(s) analisada(s), incluindo as notas de 1 a 5? Esta ação não pode ser desfeita.`);
      if (!confirmed) return;
      try { localStorage.removeItem(KEY); }
      catch { setText('learning', 'Não foi possível apagar os dados locais.'); return; }
      renderHistory();
      setText('saved', '0 contas verificadas · 0 aprovadas');
      setText('prediction', '📊 Histórico apagado. Avalie novas contas para recalibrar o custo-benefício.');
      setText('notice', 'Histórico e notas apagados. A conta aberta poderá ser registrada novamente ao reanalisar.');
    });
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
        .map((v) => `${v.name || v.id} | ${v.price} TCC | Céu ${v.celestial || '?'} | Runas ${v.runes?.count ?? '?'} | Arma Atq ${v.weapon?.attackLevel ?? '?'} | Relíquias ${v.totals.arma}/${v.totals.armadura}/${v.totals.artefato} | Essência ${v.draconic?.count ?? '?'} | Pedras ${v.stones?.total ?? '?'} | Cartas ${v.cards?.count ?? '?'}/${CARD_NAMES.length} | ${v.url}`);
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
