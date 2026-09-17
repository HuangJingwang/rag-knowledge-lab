(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const list = (value) => Array.isArray(value) ? value : [];
  const numberFormat = new Intl.NumberFormat('zh-CN');
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const relationLabels = { RESPONSIBLE_FOR: '负责', DEPENDS_ON: '依赖', BELONGS_TO: '隶属', DELIVERS: '交付', SUPPORTS: '支撑', VERIFIES: '验证', BASED_ON: '依据', SPECIFIED_BY: '规定于', CONFIRMED_IN: '确认于', USES: '使用', ABOUT: '围绕', SUPERSEDES: '替代', PARTIALLY_OVERRIDES: '部分覆盖', APPLIES_TO: '适用于', EXCERPT_OF: '摘自', MANAGES: '管理', MENTIONS: '提及', PARTICIPATED_IN: '参与' };
  const scenarioHints = new Map([['支付结果查询接口延期，会影响哪些任务？', '看任务怎么连'], ['为什么支付接入方案改成了统一支付网关？', '看结论依据'], ['谁负责支付回调改造？', '看人与任务的关系']]);
  let temporalLoaded = false;
  let temporalVersion = 0;
  let projectionDetails = [];

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }
  function displayDate(value, fallback = '未提供') { if (!value) return fallback; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date); }
  function displayScore(value) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '未提供'; }
  function message(id, text, error = false) { byId(id).textContent = text; byId(id).classList.toggle('error', error); }
  function emptyState(title, description, loading = false) {
    const state = node('div', 'empty-state');
    if (loading) { const mark = node('div', 'loading-mark'); mark.setAttribute('aria-hidden', 'true'); state.append(mark); }
    state.append(node('strong', '', title), node('p', '', description));
    return state;
  }
  function createSourceLabel(ids = []) {
    const sourceNumbers = new Map();
    function label(id) { const key = String(id); if (!sourceNumbers.has(key)) sourceNumbers.set(key, sourceNumbers.size + 1); return '证据 ' + String(sourceNumbers.get(key)).padStart(2, '0'); }
    ids.filter((id) => id !== undefined && id !== null && id !== '').forEach(label);
    return label;
  }
  function sourceLinks(values, sourceLabel, prefix = '', raw = false) {
    const group = node('span', 'source-links', prefix);
    const ids = list(values).filter((value) => value !== null && value !== undefined && value !== '');
    if (!ids.length) group.append(document.createTextNode('未提供来源'));
    ids.forEach((id, index) => {
      if (index) group.append(document.createTextNode('、'));
      const link = node('a', '', raw ? id : sourceLabel(id));
      link.href = '/sources/' + encodeURIComponent(String(id));
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.title = '查看原文 · ' + id;
      link.setAttribute('aria-label', (raw ? '查看原文' : sourceLabel(id)) + '，来源 ID：' + id + '，在新标签页打开');
      group.append(link);
    });
    return group;
  }
  function itemSources(item) { return item.source_id ? [item.source_id] : list(item.source_ids); }
  function entityTerms(graph) {
    const names = graph.flatMap((item) => [...list(item.entities).map((entity) => typeof entity === 'string' ? entity : entity && entity.name), ...list(item.relations).flatMap((relation) => [relation.from, relation.to])]);
    return [...new Set(names.filter((name) => typeof name === 'string' && name.length > 1))].sort((a, b) => b.length - a.length);
  }
  function highlightLiteral(content, terms) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (cursor < content.length) {
      let start = content.length; let matched = '';
      terms.forEach((term) => { const index = content.indexOf(term, cursor); if (index >= 0 && (index < start || (index === start && term.length > matched.length))) { start = index; matched = term; } });
      if (!matched) { fragment.append(document.createTextNode(content.slice(cursor))); break; }
      if (start > cursor) fragment.append(document.createTextNode(content.slice(cursor, start)));
      fragment.append(node('mark', '', matched));
      cursor = start + matched.length;
    }
    return fragment;
  }
  function excerpt(item, terms) {
    const wrapper = node('div', 'excerpt');
    const paragraph = node('p', 'excerpt-text');
    paragraph.append(highlightLiteral(String(item.text || '未提供原文'), terms));
    wrapper.append(paragraph);
    return wrapper;
  }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json', ...options.headers } });
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('本地服务未返回有效 JSON，请检查服务日志。'); }
      if (!payload || typeof payload !== 'object') throw new Error('本地服务返回的数据格式不正确。');
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : '查询失败（HTTP ' + response.status + '）。');
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('查询超过 90 秒，请检查数据库和嵌入模型是否已就绪。');
      if (error instanceof TypeError) throw new Error('无法连接本地服务，请检查演示服务是否已启动。');
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  async function loadStatus() {
    byId('status-retry').hidden = true;
    byId('status-line').classList.remove('error');
    byId('connection-badge').dataset.state = 'loading';
    byId('connection-label').textContent = '正在连接';
    byId('status-message').textContent = '正在读取数据库状态…';
    try {
      const data = await request('/api/status');
      const metrics = [['milvus-rows', 'milvus_rows'], ['graph-nodes', 'graph_nodes'], ['graph-relationships', 'graph_relationships']];
      if (metrics.some((pair) => typeof data[pair[1]] !== 'number' || !Number.isFinite(data[pair[1]]))) throw new Error('状态接口缺少数据库计数，请检查服务日志。');
      metrics.forEach(([id, key]) => { byId(id).textContent = numberFormat.format(data[key]); });
      byId('embedding-info').textContent = data.embedding_model || '未提供模型名称';
      byId('embedding-dimensions').textContent = data.embedding_dimensions ?? '未知';
      byId('connection-badge').dataset.state = 'connected';
      byId('connection-label').textContent = '本地已响应';
      byId('status-message').textContent = '读取于 ' + new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' · 指标来自本地数据库';
    } catch (error) {
      byId('connection-badge').dataset.state = 'error';
      byId('connection-label').textContent = '连接待检查';
      byId('status-message').textContent = error.message;
      byId('status-line').classList.add('error');
      byId('embedding-info').textContent = '模型信息暂不可用';
      byId('status-retry').hidden = false;
    }
  }
  function relationList(items, sourceLabel) {
    const result = node('ul', 'relation-list');
    result.setAttribute('aria-label', '全部返回关系与证据来源');
    items.forEach((relation) => {
      const entry = node('li');
      const path = node('p', 'relation-path');
      const label = node('span', 'relation-type', '→ ' + (Object.hasOwn(relationLabels, relation.type) ? relationLabels[relation.type] : relation.type || '关联') + ' →');
      label.title = relation.type || '未提供关系类型';
      path.append(node('span', '', relation.from || '未命名实体'), label, node('span', '', relation.to || '未命名实体'));
      const source = node('p', 'source'); source.append(sourceLinks(relation.source_ids, sourceLabel));
      entry.append(path, source); result.append(entry);
    });
    return result;
  }
  function parameters(item, sourceLabel) {
    const details = node('details', 'technical');
    details.append(node('summary', '', '记录与检索参数'), node('p', '', '原始分数：' + displayScore(item.score)));
    const source = node('p'); source.append(sourceLinks(itemSources(item), sourceLabel, '来源 ID：', true)); details.append(source);
    if (item.status) details.append(node('p', '', '原始记录状态：' + item.status));
    if (item.valid_from || item.valid_to) details.append(node('p', '', '记录适用时间：' + displayDate(item.valid_from) + ' 至 ' + displayDate(item.valid_to, '未设结束时间')));
    return details;
  }
  function renderResults(type, items, terms, sourceLabel) {
    const container = byId(type + '-results'); container.replaceChildren();
    byId(type + '-count').textContent = items.length + ' 条命中';
    if (!items.length) { container.append(emptyState('没有召回结果', '可以换一种表述再查询。')); return; }
    items.forEach((item, index) => {
      const result = node('details', 'result'); result.open = index === 0;
      const summary = node('summary');
      const title = node('span', 'result-summary-text'); title.append(node('span', 'result-title', item.title || '未命名文本'));
      if (item.status) { const status = node('span', 'record-status', item.status === '当前快照' ? '语料最新快照' : item.status); status.title = '原始记录状态：' + item.status; title.append(status); }
      const indicator = node('span', 'expand-indicator', '›'); indicator.setAttribute('aria-hidden', 'true');
      summary.append(node('span', 'rank', String(index + 1).padStart(2, '0')), title, indicator);
      const body = node('div', 'result-body');
      const meta = node('div', 'metadata'); meta.append(sourceLinks(itemSources(item), sourceLabel, '原文：'));
      body.append(meta, excerpt(item, terms));
      if (type === 'graph') {
        const names = list(item.entities).map((entity) => typeof entity === 'string' ? entity : entity && entity.name).filter(Boolean);
        if (names.length) { const entities = node('div', 'entities'); entities.setAttribute('aria-label', '全部返回实体'); names.forEach((name) => entities.append(node('span', 'entity', name))); body.append(entities); }
        if (list(item.relations).length) body.append(relationList(item.relations, sourceLabel));
        else body.append(node('p', 'source', '本条命中未返回扩展关系。'));
      }
      body.append(parameters(item, sourceLabel));
      result.append(summary, body); container.append(result);
    });
  }
  function resultCounts(data) {
    const texts = new Set([...data.milvus, ...data.graph].map((item) => JSON.stringify([item.source_id ?? '', item.title ?? '', item.text ?? ''])));
    const relations = new Set(data.graph.flatMap((item) => list(item.relations)).map((relation) => JSON.stringify([relation.from ?? '', relation.type ?? '', relation.to ?? ''])));
    return { texts: texts.size, relations: relations.size };
  }
  function syncExamples() {
    const query = byId('query').value.trim();
    document.querySelectorAll('.example').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.query === query)));
    byId('scenario-hint').textContent = scenarioHints.get(query) || '';
    byId('scenario-hint').hidden = !scenarioHints.has(query);
  }
  async function search(event) {
    if (event) event.preventDefault();
    if (byId('comparison').getAttribute('aria-busy') === 'true') return;
    const query = byId('query').value.trim();
    if (!query || query.length > 500) { byId('query').focus(); message('search-message', '请输入 1 至 500 字的检索问题。', true); return; }
    syncExamples();
    const controls = [byId('search-button'), byId('search-retry'), ...document.querySelectorAll('.example')];
    controls.forEach((control) => { control.disabled = true; });
    byId('search-retry').hidden = true; byId('result-toolbar').hidden = true; byId('highlight-note').hidden = true; byId('graph-details').open = false;
    byId('comparison').setAttribute('aria-busy', 'true');
    message('search-message', '正在运行本地向量检索与图查询…');
    byId('graph-stage').replaceChildren(emptyState('正在展开关系', '图中将只使用本次实际返回的数据。', true));
    for (const type of ['milvus', 'graph']) { byId(type + '-results').replaceChildren(emptyState('正在读取证据', '首次查询可能需要加载模型。', true)); byId(type + '-count').textContent = '查询中'; }
    try {
      const data = await request('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, k: 3 }) });
      if (!Array.isArray(data.milvus) || !Array.isArray(data.graph)) throw new Error('响应缺少 Milvus 或图查询结果，请检查服务日志。');
      const ids = [...data.milvus.flatMap(itemSources), ...data.graph.flatMap((item) => [...itemSources(item), ...list(item.relations).flatMap((relation) => list(relation.source_ids))])];
      const sourceLabel = createSourceLabel(ids); const terms = entityTerms(data.graph);
      renderResults('milvus', data.milvus, terms, sourceLabel); renderResults('graph', data.graph, terms, sourceLabel);
      byId('highlight-note').hidden = !byId('milvus-results').querySelector('mark');
      const counts = resultCounts(data);
      byId('result-query').textContent = '本次查询：' + (data.query || query);
      byId('result-texts').textContent = numberFormat.format(counts.texts); byId('result-relations').textContent = numberFormat.format(counts.relations);
      byId('result-time').textContent = typeof data.elapsed_ms === 'number' && Number.isFinite(data.elapsed_ms) ? numberFormat.format(Math.round(data.elapsed_ms)) : '未提供';
      byId('result-toolbar').hidden = false;
      try {
        if (!window.RagGraphStage || typeof window.RagGraphStage.render !== 'function') throw new Error('图模块未加载');
        await window.RagGraphStage.render(byId('graph-stage'), data.graph, { query: data.query || query, sourceLabel });
      } catch (_) {
        byId('graph-stage').replaceChildren(emptyState('关系图暂时无法显示', '下方保留了本次所有图检索命中和关系，可展开核对。'));
        byId('graph-details').open = true;
      }
      message('search-message', '检索完成 · 原文完整展示，证据可点开核对。');
    } catch (error) {
      message('search-message', error.message, true); byId('search-retry').hidden = false;
      byId('graph-stage').replaceChildren(emptyState('本次查询未完成', '检查服务后点击「重新检索」。'));
      for (const type of ['milvus', 'graph']) { byId(type + '-results').replaceChildren(emptyState('本次查询未完成', '检查服务后点击「重新检索」。')); byId(type + '-count').textContent = '查询失败'; }
    } finally { controls.forEach((control) => { control.disabled = false; }); byId('comparison').setAttribute('aria-busy', 'false'); }
  }
  function syncTimeSteps() { document.querySelectorAll('.time-step').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.at === byId('at').value))); }
  async function loadTemporal(event) {
    if (event) event.preventDefault(); temporalLoaded = true;
    const version = ++temporalVersion; const at = byId('at').value; const scope = byId('scope').value; syncTimeSteps();
    const container = byId('temporal-results'); byId('temporal-button').disabled = true; container.setAttribute('aria-busy', 'true');
    container.replaceChildren(emptyState('正在核对适用条件', '按选定时间和客户范围查询。', true));
    message('temporal-message', '正在查询 ' + displayDate(at) + ' 的有效决策…');
    try {
      const data = await request('/api/temporal?' + new URLSearchParams({ at, scope }));
      if (version !== temporalVersion) return;
      if (!Array.isArray(data.decisions)) throw new Error('时序响应缺少决策数据，请检查服务日志。');
      container.replaceChildren();
      const sourceLabel = createSourceLabel(data.decisions.flatMap((decision) => list(decision.source_ids)));
      message('temporal-message', '查询完成 · ' + data.decisions.length + ' 项符合适用时间与范围的决策');
      if (!data.decisions.length) container.append(emptyState('这个时点没有有效决策', '在 ' + displayDate(data.at || at) + '，未找到适用于「' + (data.scope || scope) + '」的记录。可以切换时间或范围继续核对。'));
      data.decisions.forEach((decision) => {
        const article = node('article', 'decision'); article.append(node('p', 'decision-label', '适用于 ' + (data.scope || scope)), node('h3', '', decision.name || '未命名决策'), node('p', 'decision-context', '查询时点：' + displayDate(data.at || at)));
        const details = node('div', 'decision-details');
        for (const [label, value] of [['生效时间', displayDate(decision.valid_from)], ['结束时间', displayDate(decision.valid_to, '未设结束时间')]]) { const field = node('dl'); field.append(node('dt', '', label), node('dd', '', value)); details.append(field); }
        const source = node('p', 'source'); source.append(sourceLinks(decision.source_ids, sourceLabel, '原文依据：'));
        article.append(details, source); container.append(article);
      });
    } catch (error) {
      if (version === temporalVersion) { message('temporal-message', error.message, true); container.replaceChildren(emptyState('决策查询未完成', '检查服务后点击「查询有效决策」重试。')); }
    } finally { if (version === temporalVersion) { byId('temporal-button').disabled = false; container.setAttribute('aria-busy', 'false'); } }
  }
  function selectView(view, focusTab = false) {
    for (const name of ['search', 'temporal']) { const selected = name === view; const tab = byId(name + '-tab'); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; byId(name + '-view').hidden = !selected; }
    if (focusTab) byId(view + '-tab').focus();
    if (view === 'temporal' && !temporalLoaded) loadTemporal();
    if (view === 'search') window.dispatchEvent(new Event('resize'));
  }
  function setProjection(enabled) {
    document.body.classList.toggle('is-presenting', enabled);
    document.body.classList.toggle('presentation-mode', enabled);
    const button = byId('projection-toggle'); button.setAttribute('aria-pressed', String(enabled)); button.textContent = enabled ? '退出投屏' : '投屏模式';
    if (enabled) { projectionDetails = [...document.querySelectorAll('.technical[open], .menu-details[open]')]; projectionDetails.forEach((details) => { details.open = false; }); }
    else { projectionDetails.filter((details) => details.isConnected && !details.classList.contains('menu-details')).forEach((details) => { details.open = true; }); projectionDetails = []; }
    window.dispatchEvent(new Event('resize'));
  }
  const tabs = [byId('search-tab'), byId('temporal-tab')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectView(index === 0 ? 'search' : 'temporal'));
    tab.addEventListener('keydown', (event) => { let next; if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % tabs.length; if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next === undefined) return; event.preventDefault(); selectView(next === 0 ? 'search' : 'temporal', true); });
  });
  byId('projection-toggle').addEventListener('click', () => setProjection(!document.body.classList.contains('is-presenting')));
  document.querySelectorAll('.menu-details').forEach((details) => details.addEventListener('toggle', () => { if (details.open) document.querySelectorAll('.menu-details').forEach((other) => { if (other !== details) other.open = false; }); }));
  document.addEventListener('click', (event) => { if (!event.target.closest('.menu-details')) document.querySelectorAll('.menu-details').forEach((details) => { details.open = false; }); });
  document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; const menu = document.querySelector('.menu-details[open]'); if (menu) { menu.open = false; menu.querySelector('summary').focus(); } else if (document.body.classList.contains('is-presenting')) { setProjection(false); byId('projection-toggle').focus(); } });
  byId('search-form').addEventListener('submit', search);
  byId('query').addEventListener('input', syncExamples);
  document.querySelectorAll('.example').forEach((button) => { button.title = button.dataset.query; button.addEventListener('click', () => { byId('query').value = button.dataset.query; search(); }); });
  byId('search-retry').addEventListener('click', search); byId('status-retry').addEventListener('click', loadStatus);
  byId('temporal-form').addEventListener('submit', loadTemporal); byId('at').addEventListener('change', loadTemporal); byId('scope').addEventListener('change', loadTemporal);
  document.querySelectorAll('.time-step').forEach((button) => button.addEventListener('click', () => { byId('at').value = button.dataset.at; loadTemporal(); }));
  function followAnchor() { if (['#temporal-heading', '#temporal-view', '#temporal-form', '#at', '#scope'].includes(window.location.hash)) selectView('temporal'); else if (['#search-heading', '#search-view', '#query', '#comparison'].includes(window.location.hash)) selectView('search'); }
  window.addEventListener('hashchange', followAnchor);
  followAnchor(); syncExamples(); loadStatus(); search();
})();
