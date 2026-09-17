(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const asList = (value) => Array.isArray(value) ? value : [];
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const shortDateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const typeNames = { meeting: '会议纪要', task: '任务记录', document: '项目文档' };
  const relationLabels = { INVALIDATES: '前提失效', LEAVES: '调离', RESPONSIBLE_FOR: '负责', DEPENDS_ON: '依赖', BELONGS_TO: '隶属', DELIVERS: '交付', SUPPORTS: '支撑', VERIFIES: '验证', BASED_ON: '依据', SPECIFIED_BY: '规定于', CONFIRMED_IN: '确认于', USES: '使用', ABOUT: '围绕', SUPERSEDES: '替代', PARTIALLY_OVERRIDES: '部分覆盖', APPLIES_TO: '适用于', EXCERPT_OF: '摘自', MANAGES: '管理', MENTIONS: '提及', PARTICIPATED_IN: '参与' };
  const state = { articles: {}, documents: [], records: new Map(), groups: [], groupMap: new Map(), chunkNumbers: new Map(), chunkElements: new Map(), selectedSource: null, documentsReady: false, documentsLoading: false, searchBusy: false, latestSearch: null, modalVersion: 0, lastModalTrigger: null, sourceGraphs: new Map() };
  const narrowLayout = window.matchMedia('(max-width: 1099px)');

  function node(tag, className, value) { const element = document.createElement(tag); if (className) element.className = className; if (value !== undefined && value !== null) element.textContent = String(value); return element; }
  function emptyState(title, text) { const wrapper = node('div', 'reader-empty'); wrapper.append(node('strong', '', title), node('p', '', text)); return wrapper; }
  function dateValue(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
  function formatDate(value, short = false) { const date = dateValue(value); return date ? (short ? shortDateFormat : dateFormat).format(date) : value ? String(value) : '未提供时间'; }
  function recordTime(record) { return record.created_at || record.time || ''; }
  function recordStatus(status) { return status === '当前快照' ? '语料最新快照' : status || '未提供状态'; }
  function chunkLabel(id) { return '分块 ' + String(state.chunkNumbers.get(String(id)) ?? '未知').padStart(2, '0'); }
  function setQuestionState(text, error = false) { byId('question-state').textContent = text; byId('question-state').classList.toggle('error', error); }
  function fullSourceLink(id, label) { const link = node('a', '', label || id); link.href = '/sources/' + encodeURIComponent(String(id)); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = '来源 ID：' + id; return link; }
  function sourceLinks(ids) { const group = node('span'); asList(ids).forEach((id, index) => { if (index) group.append(document.createTextNode('、')); group.append(fullSourceLink(id, '证据 ' + String(index + 1).padStart(2, '0'))); }); if (!asList(ids).length) group.append(document.createTextNode('未返回来源')); return group; }
  async function request(url, options = {}, timeoutMs = 90000) {
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json', ...options.headers } });
      let data; try { data = await response.json(); } catch (_) { throw new Error('本地服务未返回有效 JSON，请检查服务日志。'); }
      if (!data || typeof data !== 'object') throw new Error('本地服务返回的数据格式不正确。');
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '请求失败（HTTP ' + response.status + '）。');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请检查本地服务和数据库后重试。');
      if (error instanceof TypeError) throw new Error('无法连接本地服务，请确认演示服务已启动。');
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  function groupName(group) {
    const first = group.records[0];
    if (first.source_type === 'meeting') return (dateValue(recordTime(first)) ? formatDate(recordTime(first), true) + ' · ' : '') + '会议摘录';
    if (group.records.length > 1 && first.source_type === 'task') {
      const titles = group.records.map((record) => String(record.title || '').split(/[：:]/).pop());
      let common = titles[0]; titles.slice(1).forEach((title) => { while (common && !title.startsWith(common)) common = common.slice(0, -1); });
      if (common.length >= 4) return common;
    }
    return first.title || group.id;
  }
  function buildGroups(records) {
    const groups = new Map();
    records.forEach((record, index) => { state.records.set(String(record.id), record); state.chunkNumbers.set(String(record.id), String(record.id).match(/:chunk:(\d+)$/)?.[1] || index + 1); if (!groups.has(record.source_id)) groups.set(record.source_id, { id: record.source_id, type: record.source_type || 'document', records: [] }); groups.get(record.source_id).records.push(record); });
    groups.forEach((group) => { group.records.sort((a, b) => (dateValue(recordTime(a))?.getTime() || 0) - (dateValue(recordTime(b))?.getTime() || 0)); group.name = groupName(group); });
    state.groups = [...groups.values()]; state.groupMap = groups;
  }
  function renderLibrary() {
    const container = byId('source-list'); container.replaceChildren();
    const filter = byId('source-filter').value.trim().toLocaleLowerCase();
    const groups = state.groups.filter((group) => [group.name, group.id, ...group.records.map((record) => record.title || '')].join(' ').toLocaleLowerCase().includes(filter));
    const types = [...new Set(['meeting', 'task', 'document', ...groups.map((group) => group.type)])];
    types.forEach((type) => {
      const matching = groups.filter((group) => group.type === type); if (!matching.length) return;
      container.append(node('h3', 'source-category', (typeNames[type] || '其他来源') + ' · ' + matching.length));
      matching.forEach((group) => {
        const button = node('button', 'source-button'); button.type = 'button'; button.setAttribute('aria-current', String(group.id === state.selectedSource)); button.setAttribute('aria-controls', 'original-pane'); button.title = group.name + '\n来源 ID：' + group.id;
        const dates = [...new Set(group.records.map((record) => formatDate(recordTime(record), true)))];
        const dateText = dates.length > 1 ? dates[0] + ' 至 ' + dates[dates.length - 1] : dates[0];
        button.append(node('span', 'source-name', group.name), node('span', 'source-meta', group.records.length + ' 个片段 · ' + dateText));
        button.addEventListener('click', () => { selectSource(group.id); clearChunkUrl(); if (narrowLayout.matches) byId('library-details').open = false; byId('document-title').focus({ preventScroll: true }); });
        container.append(button);
      });
    });
    if (!groups.length) container.append(emptyState('没有匹配来源', '试试来源名称中的其他关键词。'));
  }
  function renderInlineChunk(record, index) {
    const text = node('mark', 'article-chunk article-chunk-' + (index % 2), record.text);
    text.tabIndex = -1;
    text.id = 'reader-chunk-' + state.chunkNumbers.get(String(record.id));
    text.dataset.chunkId = record.id;
    text.title = chunkLabel(record.id) + ' · ' + record.title + '\n' + formatDate(recordTime(record)) + ' · ' + recordStatus(record.status);
    state.chunkElements.set(String(record.id), text);
    return text;
  }
  function renderArticle(group) {
    const article = node('article', 'continuous-article');
    const content = state.articles[group.id];
    const paragraphs = content?.paragraphs || [group.records.map((record) => ({ chunk_id: record.id }))];
    let chunkIndex = 0;
    paragraphs.forEach((runs) => {
      const paragraph = node('p', 'article-paragraph');
      runs.forEach((run) => {
        if (typeof run === 'string') paragraph.append(document.createTextNode(run));
        else {
          const record = state.records.get(run.chunk_id);
          if (record && record.source_id === group.id) paragraph.append(renderInlineChunk(record, chunkIndex++));
        }
      });
      article.append(paragraph);
    });
    return article;
  }
  function renderArticleRecords(group) {
    const details = node('details', 'article-records');
    details.append(node('summary', '', '分块记录与来源 · ' + group.records.length + ' 个已入库片段'));
    details.append(node('p', 'article-records-note', '正文按文章语义分段，分块边界只标在文字上。标注片段与数据库原文逐字一致；其余文字为本次整理补写的背景与衔接，未纳入检索。'));
    group.records.forEach((record) => {
      const entry = node('section', 'article-record');
      const title = node('button', 'article-record-locate', chunkLabel(record.id) + ' · ' + record.title);
      title.type = 'button'; title.addEventListener('click', () => locateChunk(record.id));
      const info = node('p', 'article-record-info', formatDate(recordTime(record)) + ' · ' + recordStatus(record.status));
      const raw = node('details', 'chunk-metadata');
      raw.append(node('summary', '', '查看分块 ID 与实际记录'), node('pre', '', JSON.stringify(record, null, 2)));
      entry.append(title, info, fullSourceLink(record.id, '打开独立原文 ↗'), raw);
      details.append(entry);
    });
    return details;
  }
  function selectSource(sourceId, options = {}) {
    const group = state.groupMap.get(sourceId); if (!group) return false;
    state.selectedSource = sourceId; state.chunkElements.clear();
    document.querySelectorAll('.evidence-hit.is-located').forEach((card) => card.classList.remove('is-located'));
    byId('reader-location').textContent = typeNames[group.type] || '原文摘录';
    byId('document-kind').textContent = (group.records[0].project || '本地语料') + ' / ' + (typeNames[group.type] || '原文摘录');
    byId('document-title').textContent = state.articles[group.id]?.title || group.name;
    const firstTime = recordTime(group.records[0]); const lastTime = recordTime(group.records[group.records.length - 1]);
    byId('document-info').textContent = state.articles[group.id]?.subtitle || formatDate(firstTime, true) + (firstTime !== lastTime && formatDate(firstTime, true) !== formatDate(lastTime, true) ? ' 至 ' + formatDate(lastTime, true) : '');
    byId('document-chunks').replaceChildren(renderArticle(group));
    byId('reader-feedback').textContent = '';
    byId('reader-source-footer').replaceChildren(renderArticleRecords(group), node('p', 'article-source-id', '来源 ID：' + group.id)); byId('reader-source-footer').hidden = false;
    byId('source-graph').disabled = false;
    renderLibrary();
    if (!options.keepScroll) byId('original-scroll').scrollTop = 0;
    return true;
  }
  function clearChunkUrl() { const url = new URL(window.location.href); if (url.searchParams.has('chunk')) { url.searchParams.delete('chunk'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); } }
  function locateChunk(chunkId, options = {}) {
    const id = String(chunkId); const record = state.records.get(id);
    if (!record) { byId('reader-feedback').textContent = '当前语料中没有找到这个分块 ID。'; return false; }
    if (state.selectedSource !== record.source_id) selectSource(record.source_id);
    state.chunkElements.forEach((element) => element.classList.remove('is-target'));
    const target = state.chunkElements.get(id); target.classList.add('is-target');
    document.querySelectorAll('.evidence-hit').forEach((card) => card.classList.toggle('is-located', card.dataset.chunkId === id));
    byId('reader-feedback').textContent = '已定位到 ' + chunkLabel(id) + ' · ' + record.title;
    const url = new URL(window.location.href); url.searchParams.set('chunk', id); window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (narrowLayout.matches) byId('library-details').open = false;
    if (options.scroll !== false) window.requestAnimationFrame(() => { target.scrollIntoView({ block: 'center', behavior: 'auto' }); if (options.focus !== false) target.focus({ preventScroll: true }); });
    return true;
  }
  function enableQuestions() {
    byId('question-input').disabled = !state.documentsReady;
    byId('question-submit').disabled = !state.documentsReady || state.searchBusy;
    document.querySelectorAll('.preset-button').forEach((button) => { button.disabled = !state.documentsReady || state.searchBusy; });
  }
  async function loadDocuments() {
    if (state.documentsLoading) return; state.documentsLoading = true;
    byId('documents-retry').hidden = true; byId('library-state').classList.remove('error'); byId('library-state').textContent = '正在读取本地语料…'; byId('original-pane').setAttribute('aria-busy', 'true');
    try {
      const data = await request('/api/documents', {}, 30000);
      if (!Array.isArray(data.documents) || data.documents.some((record) => !record || typeof record.id !== 'string' || typeof record.source_id !== 'string' || typeof record.text !== 'string')) throw new Error('文档响应缺少稳定 ID、来源或原文，请检查服务日志。');
      if (new Set(data.documents.map((record) => record.id)).size !== data.documents.length) throw new Error('文档响应包含重复分块 ID，无法精确定位。');
      state.articles = data.articles || {}; state.documents = data.documents; state.records.clear(); state.chunkNumbers.clear(); buildGroups(data.documents);
      if (data.source_titles && typeof data.source_titles === 'object') state.groups.forEach((group) => { const title = data.source_titles[group.id]; if (typeof title === 'string' && title.trim()) group.name = title; });
      state.documentsReady = true; byId('library-count').textContent = String(state.groups.length); byId('library-state').textContent = state.groups.length + ' 个来源 · ' + state.documents.length + ' 个分块';
      byId('source-filter').disabled = false; byId('chunk-toggle').disabled = false; byId('compose-scope').textContent = '全部语料 · ' + state.documents.length + ' 个分块';
      const requestedId = new URLSearchParams(window.location.search).get('chunk'); const requestedRecord = requestedId ? state.records.get(requestedId) : null;
      const source = requestedRecord?.source_id || (state.groupMap.has('demo:meeting:0907') ? 'demo:meeting:0907' : state.groups[0]?.id);
      if (source) { selectSource(source); if (requestedRecord) locateChunk(requestedId, { focus: false }); else if (requestedId) byId('reader-feedback').textContent = '链接中的分块 ID 不在当前语料里，已打开默认来源。'; }
      else { byId('document-title').textContent = '暂时没有原文'; byId('document-chunks').replaceChildren(emptyState('语料为空', '当前接口没有返回原文记录。')); byId('source-graph').disabled = true; }
      enableQuestions(); setQuestionState('每个问题独立检索。Enter 提交，Shift + Enter 换行。');
    } catch (error) {
      byId('library-state').textContent = error.message; byId('library-state').classList.add('error'); byId('documents-retry').hidden = false;
      byId('document-title').textContent = '原文暂时未能载入'; byId('document-chunks').replaceChildren(emptyState('无法读取文档', '点击左侧「重新读取文档」重试。')); setQuestionState('原文载入后即可提问和精确定位。', true);
    } finally { state.documentsLoading = false; byId('original-pane').setAttribute('aria-busy', 'false'); }
  }
  function resolveChunkId(hit) {
    if (hit.id !== undefined && state.records.has(String(hit.id))) return String(hit.id);
    const matches = state.documents.filter((record) => record.source_id === hit.source_id && record.text === hit.text);
    return matches.length === 1 ? matches[0].id : null;
  }
  function scoreText(score) { return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(4) : '未提供'; }
  function groupEvidence(result) {
    const groups = []; const known = new Map();
    for (const [engine, hits] of [['Milvus', result.milvus], ['Neo4j', result.graph]]) {
      hits.forEach((hit, index) => {
        const id = typeof hit.id === 'string' && state.records.has(hit.id) ? hit.id : null;
        let group = id ? known.get(id) : null;
        if (!group) { group = { id, entries: [] }; groups.push(group); if (id) known.set(id, group); }
        group.entries.push({ hit, engine, rank: index + 1 });
      });
    }
    return groups;
  }
  function renderHitReturn(hit, engine, rank) {
    const section = node('section', 'hit-channel-return'); const chunkId = resolveChunkId(hit);
    section.append(node('h5', 'hit-channel-heading', engine + ' · 第 ' + rank + ' 条返回'), node('p', 'hit-parameter', '返回标题：' + (hit.title || '未命名命中')), node('p', 'hit-fulltext', typeof hit.text === 'string' ? hit.text : '未返回原文'), node('p', 'hit-parameter', '原始分数：' + scoreText(hit.score)), node('p', 'hit-parameter', '返回分块 ID：' + (hit.id ?? '未提供')));
    if (chunkId && !hit.id) section.append(node('p', 'hit-parameter', '通过来源 ID 与完整原文唯一匹配到：' + chunkId));
    if (hit.status) section.append(node('p', 'hit-parameter', '原始记录状态：' + hit.status));
    if (hit.source_id) { const source = node('p', 'hit-parameter', '来源：'); source.append(fullSourceLink(hit.source_id, hit.source_id)); section.append(source); }
    if (hit.valid_from || hit.valid_to) section.append(node('p', 'hit-parameter', '记录适用时间：' + formatDate(hit.valid_from) + ' 至 ' + (hit.valid_to ? formatDate(hit.valid_to) : '未设结束时间')));
    if (asList(hit.entities).length) section.append(node('p', 'hit-parameter', '返回实体：' + hit.entities.map((entity) => typeof entity === 'string' ? entity : entity?.name || '未命名实体').join('、')));
    if (asList(hit.relations).length) {
      const relations = node('ul', 'hit-relations');
      hit.relations.forEach((relation) => { const entry = node('li'); const type = Object.hasOwn(relationLabels, relation.type) ? relationLabels[relation.type] : relation.type || '关联'; const path = node('p', '', (relation.from || '未命名实体') + ' → ' + type + ' → ' + (relation.to || '未命名实体')); path.title = relation.type || ''; entry.append(path, sourceLinks(relation.source_ids)); relations.append(entry); });
      section.append(relations);
    }
    const raw = node('details', 'hit-raw'); raw.append(node('summary', '', '原始返回 JSON'), node('pre', '', JSON.stringify(hit, null, 2))); section.append(raw);
    return section;
  }
  function renderHit(group) {
    const { hit } = group.entries[0]; const card = node('article', 'evidence-hit'); const chunkId = group.id || resolveChunkId(hit); const sourceRecord = chunkId ? state.records.get(chunkId) : null;
    if (chunkId) card.dataset.chunkId = chunkId;
    const channels = node('div', 'hit-channels'); channels.setAttribute('aria-label', '召回通道');
    [...new Set(group.entries.map((entry) => entry.engine))].forEach((engine) => channels.append(node('span', 'hit-channel', engine)));
    card.append(channels, node('h4', 'hit-title', hit.title || '未命名命中'));
    const text = typeof hit.text === 'string' ? hit.text : '';
    if (text) card.append(node('p', 'hit-snippet', text.slice(0, 90) + (text.length > 90 ? '…' : '')));
    const actions = node('div', 'hit-actions'); const locate = node('button', 'locate-button', chunkId ? '定位原文 · ' + chunkLabel(chunkId) : '无法定位此片段'); locate.type = 'button'; locate.disabled = !chunkId;
    locate.title = chunkId ? '在阅读区定位 ' + chunkId : '该命中没有可精确匹配的分块 ID';
    if (chunkId) locate.addEventListener('click', () => locateChunk(chunkId));
    actions.append(locate); if (hit.status || sourceRecord?.status) actions.append(node('span', 'hit-status', recordStatus(hit.status || sourceRecord.status)));
    card.append(actions);
    const details = node('details', 'hit-details'); details.append(node('summary', '', '完整返回文本与参数 · ' + group.entries.length + ' 条原始命中'));
    group.entries.forEach((entry) => details.append(renderHitReturn(entry.hit, entry.engine, entry.rank)));
    card.append(details); return card;
  }
  function scrollConversation() { const scroll = byId('conversation-scroll'); scroll.scrollTop = scroll.scrollHeight; }
  function scrollToAssistant(assistant) { const scroll = byId('conversation-scroll'); scroll.scrollTop += assistant.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10; }
  function closeToConversationEnd() { const scroll = byId('conversation-scroll'); return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100; }
  function buildAssistantResponse(container, result, query) {
    container.replaceChildren();
    const heading = node('div', 'message-heading'); heading.append(node('strong', '', '检索证据'), node('span', '', typeof result.elapsed_ms === 'number' ? Math.round(result.elapsed_ms) + ' ms' : '耗时未提供'));
    container.append(heading, node('p', 'message-explanation', '独立检索全部语料。以下是原文与关系证据，未生成答案。'));
    if (!result.milvus.length && !result.graph.length) { container.append(emptyState('没有返回证据', '可以换一种表述重新检索。')); return; }
    const groups = groupEvidence(result);
    container.append(node('h3', 'hit-group-title', groups.length + ' 项证据 · Milvus ' + result.milvus.length + ' 条 / Neo4j ' + result.graph.length + ' 条原始命中'));
    groups.forEach((group) => container.append(renderHit(group)));
    if (result.graph.length) { const graph = node('button', 'reader-button quiet-button turn-graph-button', '查看这些证据的关系图'); graph.type = 'button'; graph.addEventListener('click', () => showSearchGraph({ result, query }, graph)); container.append(graph); }
    container.append(node('p', 'message-explanation', '召回排序不代表当前状态或事实正确率，请结合原文时间与适用范围核对。'));
  }
  async function submitQuestion(query, retryContainer = null) {
    if (state.searchBusy || !state.documentsReady) return;
    const text = String(query || '').trim(); if (!text || text.length > 500) { setQuestionState('请输入 1 至 500 字的问题。', true); byId('question-input').focus(); return; }
    state.searchBusy = true; enableQuestions(); byId('conversation-welcome').hidden = true;
    let assistant = retryContainer;
    if (!assistant) { const turn = node('section', 'chat-turn'); const user = node('p', 'user-message', text); user.setAttribute('aria-label', '你的问题'); assistant = node('div', 'evidence-message'); turn.append(user, assistant); byId('conversation-messages').append(turn); byId('question-input').value = ''; }
    assistant.replaceChildren(node('p', 'message-explanation', '正在检索全部语料，首次查询可能需要加载嵌入模型…')); assistant.setAttribute('aria-busy', 'true');
    setQuestionState('正在运行真实向量检索与图查询…'); scrollConversation();
    try {
      const result = await request('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: text, k: 3 }) });
      if (!Array.isArray(result.milvus) || !Array.isArray(result.graph)) throw new Error('检索响应缺少文本或图检索结果，请检查服务日志。');
      const shouldScroll = closeToConversationEnd(); buildAssistantResponse(assistant, result, text);
      state.latestSearch = { result, query: result.query || text }; byId('latest-graph').disabled = false;
      setQuestionState('检索完成。点击「定位原文」查看完整片段。'); if (shouldScroll) scrollToAssistant(assistant);
    } catch (error) {
      const shouldScroll = closeToConversationEnd(); assistant.replaceChildren(node('p', 'message-explanation error', error.message));
      const retry = node('button', 'reader-button quiet-button retry-search', '重试这个问题'); retry.type = 'button'; retry.addEventListener('click', () => submitQuestion(text, assistant)); assistant.append(retry); setQuestionState('本次查询未完成，可在记录中重试。', true); if (shouldScroll) scrollConversation();
    } finally { assistant.setAttribute('aria-busy', 'false'); state.searchBusy = false; enableQuestions(); }
  }
  function graphSourceLabel(rows) { const ids = [...new Set(rows.flatMap((row) => asList(row.relations).flatMap((relation) => asList(relation.source_ids))))]; return (id) => { const known = state.records.get(String(id)); return known ? chunkLabel(id) : '证据 ' + String(Math.max(0, ids.indexOf(id)) + 1).padStart(2, '0'); }; }
  function prepareGraphDialog(title, caption, query, trigger) {
    const dialog = byId('reader-graph-dialog'); state.modalVersion += 1; state.lastModalTrigger = trigger || document.activeElement;
    byId('reader-graph-title').textContent = title; byId('reader-graph-caption').textContent = caption; byId('reader-graph-query').textContent = query;
    byId('reader-graph-stage').replaceChildren(emptyState('正在读取关系', '仅展示实际返回且有来源的关系。'));
    if (!dialog.open) dialog.showModal();
    return state.modalVersion;
  }
  function renderGraph(rows, query, emptyText) {
    const container = byId('reader-graph-stage');
    const count = rows.reduce((total, row) => total + asList(row.relations).length, 0);
    if (!count) { container.replaceChildren(emptyState('没有可展示的业务关系', emptyText || '本次图检索没有返回关系，可查看原文证据或换一个问题。')); return; }
    if (!window.RagGraphStage || typeof window.RagGraphStage.render !== 'function') { container.replaceChildren(emptyState('关系图模块暂不可用', '可以打开完整关系图工作台，或在检索记录中展开全部关系。')); return; }
    window.RagGraphStage.render(container, rows, { query, sourceLabel: graphSourceLabel(rows) });
  }
  function showSearchGraph(turn, trigger) {
    if (!turn) return; prepareGraphDialog('检索证据的关联路径', '本次检索返回 · 预先整理并入库', turn.query, trigger);
    try { renderGraph(turn.result.graph, turn.query); } catch (_) { byId('reader-graph-stage').replaceChildren(emptyState('关系图暂时无法显示', '完整关系仍保留在提问记录的「完整返回文本与参数」中。')); }
  }
  async function showSourceGraph() {
    const group = state.groupMap.get(state.selectedSource); if (!group) return;
    const version = prepareGraphDialog('本文关系图', '本文片段支持的关系 · 预先整理并入库', group.name, byId('source-graph'));
    try {
      let data = state.sourceGraphs.get(group.id);
      if (!data) { data = await request('/api/source-graph?' + new URLSearchParams({ source_id: group.id }), {}, 30000); if (!Array.isArray(data.graph)) throw new Error('来源图响应缺少关系数据。'); state.sourceGraphs.set(group.id, data); }
      if (version !== state.modalVersion || !byId('reader-graph-dialog').open) return;
      const graphQuery = group.id === 'demo:meeting:0907' ? '为什么支付接入方案改成了统一支付网关？' : group.records.map((record) => record.title || '').join(' ');
      renderGraph(data.graph, graphQuery, '这份资料尚未配置有来源的业务关系，可到检索对比查看邻近实体关系。');
    } catch (error) {
      if (version !== state.modalVersion || !byId('reader-graph-dialog').open) return;
      const container = byId('reader-graph-stage'); container.replaceChildren(emptyState('本文关系图未能载入', error.message));
      const retry = node('button', 'reader-button quiet-button', '重试本文关系图'); retry.type = 'button'; retry.addEventListener('click', showSourceGraph); container.append(retry);
    }
  }
  function closeGraphDialog() { byId('reader-graph-dialog').close(); }
  byId('reader-graph-dialog').addEventListener('close', () => { state.modalVersion += 1; if (state.lastModalTrigger?.isConnected) state.lastModalTrigger.focus({ preventScroll: true }); });
  byId('close-reader-graph').addEventListener('click', closeGraphDialog);
  byId('reader-graph-dialog').addEventListener('click', (event) => { const rect = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeGraphDialog(); });
  byId('source-graph').addEventListener('click', showSourceGraph);
  byId('latest-graph').addEventListener('click', () => showSearchGraph(state.latestSearch, byId('latest-graph')));
  byId('documents-retry').addEventListener('click', loadDocuments);
  byId('source-filter').addEventListener('input', renderLibrary);
  byId('chunk-toggle').addEventListener('click', () => { const enabled = byId('chunk-toggle').getAttribute('aria-pressed') !== 'true'; byId('chunk-toggle').setAttribute('aria-pressed', String(enabled)); byId('original-pane').classList.toggle('chunks-off', !enabled); });
  byId('question-form').addEventListener('submit', (event) => { event.preventDefault(); submitQuestion(byId('question-input').value); });
  byId('question-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitQuestion(event.currentTarget.value); } });
  document.querySelectorAll('.preset-button').forEach((button) => { button.title = button.dataset.query; button.addEventListener('click', () => submitQuestion(button.dataset.query)); });
  byId('reader-projection').addEventListener('click', () => { const enabled = byId('reader-projection').getAttribute('aria-pressed') !== 'true'; byId('reader-projection').setAttribute('aria-pressed', String(enabled)); byId('reader-projection').textContent = enabled ? '退出投屏' : '投屏模式'; document.body.classList.toggle('presentation-mode', enabled); document.body.classList.toggle('is-presenting', enabled); window.dispatchEvent(new Event('resize')); });
  function syncLibraryLayout() { byId('library-details').open = !narrowLayout.matches; }
  syncLibraryLayout(); narrowLayout.addEventListener('change', syncLibraryLayout);
  loadDocuments();
})();
