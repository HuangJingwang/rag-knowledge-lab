(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const LABELS = Object.freeze({ INVALIDATES: '前提失效', LEAVES: '调离', RESPONSIBLE_FOR: '负责', DEPENDS_ON: '依赖', BELONGS_TO: '隶属', DELIVERS: '交付', SUPPORTS: '支撑', VERIFIES: '验证', BASED_ON: '依据', SPECIFIED_BY: '规定于', CONFIRMED_IN: '确认于', USES: '使用', ABOUT: '围绕', SUPERSEDES: '替代', PARTIALLY_OVERRIDES: '部分覆盖', APPLIES_TO: '适用于', EXCERPT_OF: '摘自', MANAGES: '管理', MENTIONS: '提及', PARTICIPATED_IN: '参与' });
  let instance = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attributes, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function label(type) { return Object.hasOwn(LABELS, type) ? LABELS[type] : type; }
  function relationText(edge) { return `${edge.from} → ${label(edge.type)} → ${edge.to}`; }

  function edgeLabel(type) {
    const value = label(type);
    const text = Array.from(value).length > 9 ? Array.from(value).slice(0, 8).join('') + '…' : value;
    const width = Math.max(42, Array.from(text).reduce((sum, char) => sum + (/[\u0000-\u007f]/.test(char) ? 9 : 16), 0) + 12);
    return { text, width };
  }

  function aggregate(input) {
    const collected = new Map();
    const hits = Array.isArray(input) ? input : [];
    hits.forEach(hit => {
      if (!hit || !Array.isArray(hit.relations)) return;
      hit.relations.forEach(raw => {
        if (!raw || typeof raw.from !== 'string' || typeof raw.to !== 'string' || typeof raw.type !== 'string') return;
        const from = raw.from.trim(), to = raw.to.trim(), type = raw.type.trim();
        if (!from || !to || !type) return;
        const key = JSON.stringify([from, type, to]);
        if (!collected.has(key)) collected.set(key, { key, from, type, to, source_ids: [], order: collected.size });
        const edge = collected.get(key);
        const sources = Array.isArray(raw.source_ids) ? raw.source_ids : typeof raw.source_ids === 'string' ? [raw.source_ids] : [];
        sources.forEach(id => {
          if (typeof id === 'string' && id.trim() && !edge.source_ids.includes(id.trim())) edge.source_ids.push(id.trim());
        });
      });
    });
    return [...collected.values()];
  }

  function plan(all, query) {
    const names = [...new Set(all.flatMap(edge => [edge.from, edge.to]))];
    const matched = new Set(names.filter(name => query.includes(name)));
    let preferred, reason;
    if (/负责人|谁|负责/.test(query)) {
      preferred = ['RESPONSIBLE_FOR']; reason = '按问题中的实体与“负责”关系优先展示';
    } else if (/依赖|影响|延期|阻塞|前置/.test(query)) {
      preferred = ['DEPENDS_ON']; reason = '按问题中的实体与依赖路径优先展示';
    } else if (/依据|为什么|为何|方案|设计|约定/.test(query)) {
      preferred = ['BASED_ON', 'SPECIFIED_BY', 'CONFIRMED_IN', 'USES']; reason = '按问题中的实体与依据关系优先展示';
    } else {
      preferred = []; reason = matched.size ? '优先展示问题提及实体周围的关系' : '未找到字面实体匹配，展示返回关系中的相连路径';
    }
    if (!matched.size && preferred.length) reason = '未找到字面实体匹配，按问题的关系词优先展示返回路径';
    const distance = new Map([...matched].map(name => [name, 0]));
    for (let step = 0; step < 3; step += 1) {
      all.forEach(edge => {
        const a = distance.get(edge.from), b = distance.get(edge.to);
        if (a !== undefined && (b === undefined || b > a + 1)) distance.set(edge.to, a + 1);
        if (b !== undefined && (a === undefined || a > b + 1)) distance.set(edge.from, b + 1);
      });
    }
    function score(edge) {
      const near = Math.min(distance.get(edge.from) ?? 9, distance.get(edge.to) ?? 9);
      return (preferred.includes(edge.type) ? 90 : 0) + (matched.has(edge.from) || matched.has(edge.to) ? 45 : 0) + Math.max(0, 24 - near * 8) - edge.order / 1000;
    }
    const ranked = [...all].sort((a, b) => score(b) - score(a));
    const primary = preferred.length ? ranked.filter(edge => preferred.includes(edge.type)) : ranked;
    if (preferred.length && !primary.length) reason = '返回结果未包含所优先的关系类型，展示已返回的相连关系';
    const candidates = primary.length ? primary : ranked;
    let best = { edges: [], nodes: [], score: -Infinity };

    // Only follow actual directed edges. A query anchor at the end lets a dependency
    // chain remain A -> B -> queried C, rather than inventing C -> impacts -> A.
    function walk(node, path, seen) {
      if (path.length) {
        const anchored = seen.some(name => matched.has(name));
        const value = (anchored ? 600 : 0) + (matched.has(node) ? 100 : 0) + path.length * 32 + path.reduce((sum, edge) => sum + score(edge), 0) / path.length;
        if (value > best.score) best = { edges: [...path], nodes: [...seen], score: value };
      }
      if (path.length === 3) return;
      candidates.filter(edge => edge.from === node && !seen.includes(edge.to)).forEach(edge => walk(edge.to, [...path, edge], [...seen, edge.to]));
    }
    [...new Set(candidates.flatMap(edge => [edge.from, edge.to]))].forEach(name => walk(name, [], [name]));
    if (!best.edges.length && ranked.length) best = { edges: [ranked[0]], nodes: [...new Set([ranked[0].from, ranked[0].to])] };
    const selected = [...best.edges];
    const selectedKeys = new Set(selected.map(edge => edge.key));
    const included = new Set(best.nodes);
    const append = edge => {
      if (!selectedKeys.has(edge.key)) {
        selected.push(edge); selectedKeys.add(edge.key); included.add(edge.from); included.add(edge.to);
      }
    };
    // A small number of responsible-person branches adds context to dependency
    // questions without turning the stage into a complete network.
    if (preferred.includes('DEPENDS_ON')) ranked.filter(edge => edge.type === 'RESPONSIBLE_FOR' && included.has(edge.to)).slice(0, 2).forEach(append);
    // Keep an explicitly returned replacement visible when tracing a decision.
    // Two decisions confirmed in the same meeting must not look equivalent merely
    // because their shared meeting outranks the edge that connects them.
    if (preferred.includes('BASED_ON')) {
      const replacement = ranked.find(edge => edge.type === 'SUPERSEDES' && included.has(edge.from));
      if (replacement) append(replacement);
    }
    while (selected.length < Math.min(4, all.length)) {
      const next = ranked.find(edge => !selectedKeys.has(edge.key) && (included.has(edge.from) || included.has(edge.to))) || ranked.find(edge => !selectedKeys.has(edge.key));
      if (!next) break;
      append(next);
    }
    return { selected: selected.slice(0, 7), path: best.nodes, matched, reason, ranked };
  }

  function layout(model) {
    const points = new Map(), occupied = new Set();
    const place = (name, col, row) => {
      points.set(name, { name, col, row, x: 102 + col * 244, y: 50 + row * 116 });
      occupied.add(`${col}:${row}`);
    };
    model.path.forEach((name, index) => place(name, index, 1));
    const pending = new Set(model.selected.flatMap(edge => [edge.from, edge.to]).filter(name => !points.has(name)));
    for (let pass = 0; pending.size && pass < 14; pass += 1) {
      [...pending].forEach(name => {
        const link = model.selected.find(edge => (edge.from === name && points.has(edge.to)) || (edge.to === name && points.has(edge.from)));
        const neighbor = link && points.get(link.from === name ? link.to : link.from);
        if (!neighbor && pass === 0) return;
        const base = neighbor ? neighbor.col : points.size;
        const slots = [[base, 0], [base, 2], [base + 1, 0], [Math.max(0, base - 1), 0], [base + 1, 2]];
        let slot = slots.find(([col, row]) => !occupied.has(`${col}:${row}`));
        if (!slot) slot = [Math.max(0, ...[...points.values()].map(point => point.col)) + 1, 1];
        place(name, slot[0], slot[1]); pending.delete(name);
      });
    }
    const nodes = [...points.values()];
    const minY = Math.min(...nodes.map(point => point.y));
    // Keep the common three-node dependency chain compact; no empty branch rows.
    nodes.forEach(point => { point.y -= minY - 50; });
    // Reserve space for labels outside a bypass lane, including parallel edges.
    const pairCounts = new Map();
    let leftPadding = 0;
    model.selected.forEach(edge => {
      const from = points.get(edge.from), to = points.get(edge.to);
      const pair = JSON.stringify([edge.from, edge.to]);
      const offset = (pairCounts.get(pair) || 0) * 28;
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      if (from.col === to.col && Math.abs(from.row - to.row) > 1) {
        const labelLeft = from.x - 142 - offset - edgeLabel(edge.type).width;
        leftPadding = Math.max(leftPadding, 16 - labelLeft);
      }
    });
    if (leftPadding) nodes.forEach(point => { point.x += leftPadding; });
    return { points, width: Math.max(440, Math.max(...nodes.map(point => point.x)) + 102), height: Math.max(140, Math.max(...nodes.map(point => point.y)) + 54) };
  }

  function wrapped(value, budget, limit) {
    const lines = []; let line = '', units = 0;
    for (const char of Array.from(value)) {
      const width = /[\u0000-\u007f]/.test(char) ? 0.57 : 1;
      if (units + width > budget && line) { lines.push(line); line = ''; units = 0; }
      line += char; units += width;
    }
    if (line) lines.push(line);
    if (lines.length > limit) { lines.length = limit; lines[limit - 1] = lines[limit - 1].slice(0, -1) + '…'; }
    return lines;
  }

  function edgeGeometry(from, to, offset, labelWidth) {
    if (from === to) return { d: `M ${from.x + 90} ${from.y - 18} C ${from.x + 168} ${from.y - 48}, ${from.x + 168} ${from.y + 48}, ${from.x + 94} ${from.y + 18}`, x: from.x + 137, y: from.y };
    if (from.col === to.col) {
      const sign = to.y > from.y ? 1 : -1;
      if (Math.abs(from.row - to.row) > 1) {
        const laneX = from.x - 132 - offset;
        return { d: `M ${from.x - 90} ${from.y} H ${laneX + 16} Q ${laneX} ${from.y}, ${laneX} ${from.y + sign * 16} V ${to.y - sign * 16} Q ${laneX} ${to.y}, ${laneX + 16} ${to.y} H ${to.x - 94}`, x: laneX - 10 - labelWidth / 2, y: (from.y + to.y) / 2 };
      }
      return { d: `M ${from.x} ${from.y + sign * 35} L ${to.x} ${to.y - sign * 39}`, x: from.x + 30 + offset, y: (from.y + to.y) / 2 };
    }
    const sign = to.x > from.x ? 1 : -1;
    const start = { x: from.x + sign * 90, y: from.y }, end = { x: to.x - sign * 94, y: to.y };
    if (from.row === to.row && Math.abs(from.col - to.col) === 1 && !offset) return { d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, x: (start.x + end.x) / 2, y: start.y - 17 };
    const bend = from.row === to.row ? from.y - 63 - offset : (from.y + to.y) / 2 - 12 - offset;
    return { d: `M ${start.x} ${start.y} C ${start.x + sign * 38} ${bend}, ${end.x - sign * 38} ${bend}, ${end.x} ${end.y}`, x: (start.x + end.x) / 2, y: (start.y + 6 * bend + end.y) / 8 - 13 };
  }

  function render(container, input, options) {
    if (!container || typeof container.replaceChildren !== 'function') return null;
    const opts = options && typeof options === 'object' ? options : {};
    const query = typeof opts.query === 'string' ? opts.query.trim() : '';
    const all = aggregate(input);
    const root = element('section', 'rg-root');
    container.replaceChildren(root);
    const heading = element('div', 'rg-heading');
    heading.append(element('strong', 'rg-heading-title', '知识关系'), element('span', 'rg-count', all.length ? '' : '0 条关系'));
    root.append(heading);
    if (!all.length) {
      const empty = element('div', 'rg-empty');
      empty.append(element('strong', '', '本次结果没有可展示的关系'), element('p', '', '可以查看命中文本与来源，或换一个包含具体实体的问题。'));
      root.append(empty);
      return { relationCount: 0, shownRelationCount: 0, relations: [], shownRelations: [] };
    }
    const model = plan(all, query), graphLayout = layout(model), serial = ++instance;
    heading.lastChild.textContent = `重点展示 ${model.selected.length} / 返回 ${all.length} 条关系`;
    const reset = element('button', 'rg-reset', '取消节点聚焦');
    reset.type = 'button'; reset.hidden = true;
    heading.append(reset);
    const guide = element('p', 'rg-guide', '箭头表示关系方向 · 点选关系查证据，点选节点聚焦');
    guide.title = model.reason;
    root.append(guide);
    const viewport = element('div', 'rg-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '知识关系图，可横向滚动；Tab 键选择节点和关系');
    const diagram = svgElement('svg', { class: 'rg-diagram', viewBox: `0 0 ${graphLayout.width} ${graphLayout.height}`, width: graphLayout.width, height: graphLayout.height, role: 'group', 'aria-label': '实际检索返回的知识关系，箭头从源实体指向目标实体' });
    diagram.style.setProperty('--rg-diagram-width', `${graphLayout.width}px`);
    diagram.style.setProperty('--rg-diagram-height', `${graphLayout.height}px`);
    const defs = svgElement('defs');
    const marker = svgElement('marker', { id: `rg-arrow-${serial}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'rg-arrow' })); defs.append(marker); diagram.append(defs);
    const detail = element('div', 'rg-detail');
    detail.setAttribute('aria-live', 'polite'); detail.setAttribute('aria-atomic', 'true');
    const edgeElements = new Map(), nodeElements = new Map(), listButtons = new Map();
    const sourceOrder = new Map();
    all.forEach(edge => edge.source_ids.forEach(id => { if (!sourceOrder.has(id)) sourceOrder.set(id, sourceOrder.size + 1); }));
    let selectedKey = model.selected[0].key, focusedNode = null;

    function sourceLink(id) {
      let text = `证据 ${String(sourceOrder.get(id) || 1).padStart(2, '0')}`;
      if (typeof opts.sourceLabel === 'function') {
        try { const custom = opts.sourceLabel(id); if (typeof custom === 'string' && custom.trim()) text = custom; } catch (_) { /* Keep the readable local label when a host callback fails. */ }
      }
      const link = element('a', 'rg-source-link', text);
      link.setAttribute('href', `/sources/${encodeURIComponent(id)}`); link.setAttribute('title', id);
      link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
      return link;
    }

    function updateStates() {
      all.forEach(edge => {
        const group = edgeElements.get(edge.key), button = listButtons.get(edge.key);
        const connected = !focusedNode || edge.from === focusedNode || edge.to === focusedNode;
        if (group) {
          group.classList.toggle('rg-is-selected', edge.key === selectedKey);
          group.classList.toggle('rg-is-muted', !connected);
          group.setAttribute('aria-pressed', String(edge.key === selectedKey));
        }
        if (button) button.setAttribute('aria-pressed', String(edge.key === selectedKey));
      });
      nodeElements.forEach((group, name) => {
        group.classList.toggle('rg-is-focused', name === focusedNode);
        group.setAttribute('aria-pressed', String(name === focusedNode));
      });
      reset.hidden = !focusedNode;
    }

    function selectEdge(edge) {
      selectedKey = edge.key;
      const title = element('p', 'rg-detail-path', relationText(edge));
      const sources = element('div', 'rg-sources');
      sources.append(element('span', 'rg-source-caption', '关系来源'));
      if (edge.source_ids.length) edge.source_ids.forEach(id => sources.append(sourceLink(id)));
      else sources.append(element('span', 'rg-source-missing', '本次返回未附来源'));
      detail.replaceChildren(title, sources);
      detail.title = `${edge.type} · ${model.selected.some(item => item.key === edge.key) ? '图中关系' : '全部列表中的关系'}`;
      updateStates();
    }

    function activate(node, handler) {
      node.addEventListener('click', handler);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handler(); }
        if (event.key === 'Escape') { focusedNode = null; updateStates(); }
      });
    }

    const pairCounts = new Map();
    model.selected.forEach(edge => {
      const pair = JSON.stringify([edge.from, edge.to]);
      const pairIndex = pairCounts.get(pair) || 0; pairCounts.set(pair, pairIndex + 1);
      const annotation = edgeLabel(edge.type);
      const shape = edgeGeometry(graphLayout.points.get(edge.from), graphLayout.points.get(edge.to), pairIndex * 28, annotation.width);
      const group = svgElement('g', { class: 'rg-edge', role: 'button', tabindex: 0, 'aria-label': `${relationText(edge)}，${edge.source_ids.length} 个来源`, 'aria-pressed': 'false' });
      group.append(svgElement('title', {}, `${relationText(edge)} (${edge.type})`));
      group.append(svgElement('path', { class: 'rg-edge-hit', d: shape.d }));
      group.append(svgElement('path', { class: 'rg-edge-line', d: shape.d, 'marker-end': `url(#rg-arrow-${serial})` }));
      group.append(svgElement('rect', { class: 'rg-edge-label-bg', x: shape.x - annotation.width / 2, y: shape.y - 14, width: annotation.width, height: 25, rx: 4 }));
      group.append(svgElement('text', { class: 'rg-edge-label', x: shape.x, y: shape.y + 4, 'text-anchor': 'middle' }, annotation.text));
      activate(group, () => { focusedNode = null; selectEdge(edge); });
      edgeElements.set(edge.key, group); diagram.append(group);
    });
    graphLayout.points.forEach((point, name) => {
      const group = svgElement('g', { class: `rg-node${model.matched.has(name) ? ' rg-node-match' : ''}`, role: 'button', tabindex: 0, 'aria-label': `${name}${model.matched.has(name) ? '，问题提及实体' : ''}，聚焦相连关系`, 'aria-pressed': 'false' });
      group.append(svgElement('title', {}, name));
      group.append(svgElement('rect', { class: 'rg-node-box', x: point.x - 90, y: point.y - 35, width: 180, height: 70, rx: 9 }));
      const lines = wrapped(name, 8.7, 3);
      const text = svgElement('text', { class: 'rg-node-label', x: point.x, y: point.y - (lines.length - 1) * 10 + 5, 'text-anchor': 'middle' });
      lines.forEach((line, index) => text.append(svgElement('tspan', { x: point.x, dy: index ? 20 : 0 }, line)));
      group.append(text);
      activate(group, () => {
        focusedNode = focusedNode === name ? null : name;
        const related = model.selected.find(edge => edge.from === name || edge.to === name);
        if (focusedNode && related) selectEdge(related); else updateStates();
      });
      nodeElements.set(name, group); diagram.append(group);
    });
    reset.addEventListener('click', () => { focusedNode = null; updateStates(); });
    viewport.append(diagram); root.append(viewport);
    const hint = element('p', 'rg-scroll-hint', '图较宽时可在图内左右滚动；全部关系也可在下方逐条查看。');
    root.append(hint, detail);
    const disclosure = element('details', 'rg-all');
    disclosure.append(element('summary', 'rg-all-summary', `查看全部 ${all.length} 条关系`));
    const explanation = element('p', 'rg-selection-note', `${model.reason}。关系方向来自本次返回，不表示已确认影响或当前状态。`);
    const list = element('ul', 'rg-all-list');
    all.forEach(edge => {
      const item = element('li', 'rg-all-item');
      const button = element('button', 'rg-all-relation', relationText(edge));
      button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.title = edge.type;
      button.addEventListener('click', () => { focusedNode = null; selectEdge(edge); });
      listButtons.set(edge.key, button);
      const links = element('div', 'rg-all-sources');
      edge.source_ids.forEach(id => links.append(sourceLink(id)));
      if (!edge.source_ids.length) links.append(element('span', 'rg-source-missing', '未附来源'));
      item.append(button, links); list.append(item);
    });
    disclosure.append(explanation, list); root.append(disclosure);
    selectEdge(model.selected[0]);
    return { relationCount: all.length, shownRelationCount: model.selected.length, relations: all.map(({ from, type, to, source_ids }) => ({ from, type, to, source_ids: [...source_ids] })), shownRelations: model.selected.map(({ from, type, to, source_ids }) => ({ from, type, to, source_ids: [...source_ids] })) };
  }

  window.RagGraphStage = Object.freeze({ render });
})();
