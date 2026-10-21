(() => {
  'use strict';

  const DATA = Array.isArray(window.STORY_DATA) ? window.STORY_DATA : [];
  const PEOPLE = Array.isArray(window.PEOPLE_DATA) ? window.PEOPLE_DATA : [];
  const peopleById = new Map(PEOPLE.map(p => [p.id, p]));
  const byId = new Map(DATA.map(n => [n.id, n]));
  const children = new Map();
  DATA.forEach(n => {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
  });

  const el = id => document.getElementById(id);
  const treeEl = el('tree');
  const peopleListEl = el('peopleList');
  const reader = el('reader');
  const hero = el('hero');
  const empty = el('emptyState');
  const searchInput = el('searchInput');
  const gallery = el('gallery');
  const dropZone = el('dropZone');
  const imageInput = el('imageInput');
  const toast = el('toast');

  let currentId = null;
  let currentPersonId = null;
  let currentKey = null;
  let lastStoryId = null;
  let searchTerm = '';
  const objectUrls = new Map();
  const defaultDropZoneMarkup = dropZone.innerHTML;
  const PEOPLE_IMAGE_URLS = window.PEOPLE_IMAGE_URLS || {}; 

  const DB_NAME = 'community-history-site';
  const DB_VERSION = 1;
  const STORE = 'images';
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function getImages(nodeId) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.filter(x => x.nodeId === nodeId).sort((a,b) => a.createdAt - b.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function putImage(item) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteImage(id) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function highlight(text) {
    if (!searchTerm) return escapeHtml(text);
    const safe = escapeHtml(text);
    const escapedTerm = escapeHtml(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escapedTerm})`, 'gi'), '<mark class="tree-match">$1</mark>');
  }

  function renderTitleMarkup(node, withSearch = false) {
    const title = node.title || '';
    const label = node.optionalLabel || '';
    if (!label || !title.endsWith(label)) return withSearch ? highlight(title) : escapeHtml(title);
    const base = title.slice(0, -label.length).trimEnd();
    const baseMarkup = withSearch ? highlight(base) : escapeHtml(base);
    return `${baseMarkup} <span class="optional-label">${escapeHtml(label)}</span>`;
  }

  function renderReaderTitle(node) {
    el('readerTitle').innerHTML = renderTitleMarkup(node, false);
  }

  function nodeVisible(node) {
    if (!searchTerm) return true;
    const hay = `${node.title} ${node.subtitle || ''} ${node.paragraphs.join(' ')}`.toLowerCase();
    if (hay.includes(searchTerm.toLowerCase())) return true;
    return (children.get(node.id) || []).some(nodeVisible);
  }

  function renderTree() {
    treeEl.innerHTML = '';
    const roots = children.get('root') || [];
    roots.forEach(group => {
      if (!nodeVisible(group)) return;
      const wrap = document.createElement('div');
      wrap.className = 'tree-group';
      const row = makeTreeRow(group, true);
      wrap.appendChild(row);
      const kids = children.get(group.id) || [];
      if (kids.length) {
        const childWrap = document.createElement('div');
        childWrap.className = 'tree-children';
        kids.forEach(child => {
          if (nodeVisible(child)) childWrap.appendChild(makeTreeRow(child, false));
        });
        wrap.appendChild(childWrap);
      }
      treeEl.appendChild(wrap);
    });
  }

  function makeTreeRow(node, isGroup) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-row${isGroup ? ' group' : ''}${currentId === node.id ? ' active' : ''}`;
    row.innerHTML = `<span class="tree-icon">${isGroup ? '◆' : '└'}</span><span class="tree-title">${renderTitleMarkup(node, true)}</span>`;
    row.addEventListener('click', () => {
      if (node.kind === 'group') {
        const first = (children.get(node.id) || [])[0];
        if (first) selectNode(first.id);
        return;
      }
      selectNode(node.id);
    });
    return row;
  }

  function buildBreadcrumb(node) {
    const parts = [];
    let cur = node;
    while (cur) {
      parts.unshift(cur.title);
      cur = byId.get(cur.parent);
      if (cur?.id === 'root') break;
    }
    return parts.slice(-2).map((p,i) => i === parts.length-2 ? escapeHtml(p) : `<b>${escapeHtml(p)}</b>`).join(' <span>›</span> ');
  }

  function numberedMatch(text) {
    return text.match(/^((?:\d+\.)*\d+)[\).]?\s*/);
  }

  function isNumbered(text) {
    return /^((?:\d+\.)*\d+)[\).]\s/.test(text) || /^\d+\)\s/.test(text);
  }

  function listIndex(text) {
    const m = numberedMatch(text);
    return m ? m[1] : '';
  }

  const personNames = PEOPLE.map(p => p.name).sort((a, b) => b.length - a.length);
  const personPattern = personNames.length
    ? new RegExp(`(${personNames.map(x => x.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')})(?![\\w])`, 'g')
    : null;

  function renderPeopleLinks(text) {
    const escaped = escapeHtml(text);
    if (!personPattern) return escaped;
    return escaped.replace(personPattern, match => {
      const person = PEOPLE.find(p => p.name === match);
      if (!person) return match;
      return `<a class="person-link" href="#person/${encodeURIComponent(person.id)}" data-person-id="${escapeHtml(person.id)}" title="Открыть профиль ${escapeHtml(person.name)}">${escapeHtml(match)}</a>`;
    });
  }

  function renderPeopleList() {
    peopleListEl.innerHTML = '';
    const term = searchTerm.toLowerCase();
    PEOPLE.filter(p => !term || `${p.name} ${p.bio}`.toLowerCase().includes(term)).forEach(person => {
      const a = document.createElement('a');
      a.className = `person-nav-row${currentPersonId === person.id ? ' active' : ''}`;
      a.href = `#person/${encodeURIComponent(person.id)}`;
      const avatarUrl = String(PEOPLE_IMAGE_URLS[person.id] || 'images/participants/placeholder.png').trim() || 'images/participants/placeholder.png';
      a.innerHTML = `<img class="person-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='images/participants/placeholder.png'"><span>${escapeHtml(person.name)}</span>`;
      peopleListEl.appendChild(a);
    });
  }

  function showStoryReaderState() {
    el('backToStory').classList.add('hidden');
    el('uploadBtn').classList.remove('hidden');
    dropZone.classList.remove('static-person-image');
    dropZone.innerHTML = defaultDropZoneMarkup;
    dropZone.style.display = '';
    gallery.style.display = '';
    el('imageInput').disabled = false;
    document.querySelector('.media-head h3').textContent = 'Изображения этого пункта';
    document.querySelector('.media-head .section-label').textContent = 'МЕДИА';
  }

  function showPersonReaderState(person) {
    el('backToStory').classList.remove('hidden');
    el('uploadBtn').classList.add('hidden');
    el('imageInput').disabled = true;
    gallery.style.display = 'none';
    document.querySelector('.media-head h3').textContent = 'Изображение участника';
    document.querySelector('.media-head .section-label').textContent = 'УЧАСТНИК';
    dropZone.classList.add('static-person-image');
    const imageUrl = String(PEOPLE_IMAGE_URLS[person.id] || '').trim();
    dropZone.innerHTML = imageUrl
      ? `<img class="participant-fixed-image" src="${escapeHtml(imageUrl)}" alt="Изображение участника ${escapeHtml(person.name)}" loading="lazy">`
      : `<div class="participant-image-placeholder"><strong>Изображение участника</strong><span>В people-data.js вставьте ссылку для ${escapeHtml(person.name)} в PEOPLE_IMAGE_URLS.</span></div>`;
    el('imageCount').textContent = imageUrl ? '1' : '0';
  }

  function renderBody(paragraphs) {
    const container = el('chapterBody');
    container.innerHTML = '';
    let list = null;
    paragraphs.forEach(text => {
      if (isNumbered(text)) {
        if (!list) {
          list = document.createElement('div');
          list.className = 'inline-list';
          container.appendChild(list);
        }
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `<span class="list-index">${escapeHtml(listIndex(text))}</span>${renderPeopleLinks(text.replace(/^((?:\d+\.)*\d+)[\).]?\s*/, ''))}`;
        list.appendChild(item);
      } else {
        list = null;
        const p = document.createElement('p');
        if (/^«.*»$/.test(text) || text.startsWith('«')) p.className = 'quote';
        p.innerHTML = renderPeopleLinks(text);
        container.appendChild(p);
      }
    });
  }

  async function selectNode(id, updateHash = true) {
    const node = byId.get(id);
    if (!node || node.kind === 'group') return;
    currentId = id;
    currentPersonId = null;
    lastStoryId = id;
    currentKey = id;
    if (updateHash) window.location.hash = encodeURIComponent(id);

    hero.classList.add('hidden');
    empty.style.display = 'none';
    reader.classList.remove('hidden');
    showStoryReaderState();
    el('readerLabel').textContent = node.id.startsWith('prologue') ? 'ПРОЛОГ' : (node.id.startsWith('private') ? 'ЧАСТНОЕ НАПРАВЛЕНИЕ' : 'ПРОДОЛЖЕНИЕ');
    renderReaderTitle(node);
    el('readerSubtitle').textContent = node.subtitle || '';
    el('breadcrumbs').innerHTML = buildBreadcrumb(node);
    renderBody(node.paragraphs);
    renderTree();
    renderPeopleList();
    await renderGallery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileSidebar();
  }

  async function selectPerson(id, updateHash = true) {
    const person = peopleById.get(id);
    if (!person) return;
    currentId = null;
    currentPersonId = id;
    currentKey = `person:${id}`;
    if (updateHash) window.location.hash = `person/${encodeURIComponent(id)}`;

    hero.classList.add('hidden');
    empty.style.display = 'none';
    reader.classList.remove('hidden');
    showPersonReaderState(person);
    el('readerLabel').textContent = 'ПРОФИЛЬ УЧАСТНИКА';
    el('readerTitle').innerHTML = `<span class="person-title-mark">${escapeHtml(person.name)}</span>`;
    el('readerSubtitle').textContent = 'Информация из файла «Характеристика.docx»';
    el('breadcrumbs').innerHTML = `<b>Участники</b> <span>›</span> ${escapeHtml(person.name)}`;
    const body = el('chapterBody');
    body.innerHTML = `
      <article class="person-profile">
        <div class="person-profile-avatar">
          <img src="${escapeHtml(String(PEOPLE_IMAGE_URLS[person.id] || 'images/participants/placeholder.png').trim())}" alt="Аватар ${escapeHtml(person.name)}" onerror="this.onerror=null;this.src='images/participants/placeholder.png'">
        </div>
        <div class="person-profile-copy">
          <div class="section-label">ХАРАКТЕРИСТИКА</div>
          <p>${renderPeopleLinks(person.bio)}</p>
        </div>
      </article>
      <div class="person-source-note">Данные приведены по файлу «Характеристика.docx» без добавления сторонних сведений.</div>
    `;
    renderTree();
    renderPeopleList();
    await renderGallery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileSidebar();
  }

  async function renderGallery() {
    gallery.innerHTML = '';
    if (currentPersonId) return;
    const images = await getImages(currentKey);
    el('imageCount').textContent = images.length;
    if (!images.length) {
      const x = document.createElement('div');
      x.className = 'image-empty';
      x.textContent = 'Пока нет изображений. Добавьте визуальные материалы для этого этапа истории.';
      gallery.appendChild(x);
      return;
    }
    images.forEach(item => {
      const card = document.createElement('div');
      card.className = 'image-card';
      const img = document.createElement('img');
      const url = URL.createObjectURL(item.blob);
      objectUrls.set(item.id, url);
      img.src = url;
      img.alt = item.name || 'Изображение истории';
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Удалить изображение';
      del.textContent = '×';
      del.addEventListener('click', async (event) => {
        event.stopPropagation();
        await deleteImage(item.id);
        URL.revokeObjectURL(url);
        objectUrls.delete(item.id);
        showToast('Изображение удалено');
        renderGallery();
      });
      card.append(img, del);
      card.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      gallery.appendChild(card);
    });
  }

  async function addFiles(files) {
    if (!currentKey || !files?.length) return;
    const accepted = [...files].filter(f => f.type.startsWith('image/'));
    if (!accepted.length) return showToast('Нужны файлы изображений');
    for (const file of accepted) {
      const id = `${currentKey}:${crypto.randomUUID()}`;
      await putImage({ id, nodeId: currentKey, name: file.name, type: file.type, blob: file, createdAt: Date.now() });
    }
    showToast(`Добавлено изображений: ${accepted.length}`);
    await renderGallery();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1900);
  }

  function openMobileSidebar() { el('sidebar').classList.add('open'); }
  function closeMobileSidebar() { el('sidebar').classList.remove('open'); }

  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim();
    renderTree();
    renderPeopleList();
    const count = DATA.filter(n => nodeVisible(n) && n.kind !== 'group').length + PEOPLE.filter(p => `${p.name} ${p.bio}`.toLowerCase().includes(searchTerm.toLowerCase())).length;
    if (searchTerm && !count) {
      reader.classList.add('hidden');
      hero.classList.add('hidden');
      empty.style.display = 'block';
    } else if (!searchTerm && !currentId) {
      empty.style.display = 'none';
      hero.classList.remove('hidden');
    }
  });

  el('focusSearch').addEventListener('click', () => searchInput.focus());
  el('printBtn').addEventListener('click', () => window.print());
  el('mobileOpen').addEventListener('click', openMobileSidebar);
  el('mobileClose').addEventListener('click', closeMobileSidebar);
  el('backToStory').addEventListener('click', () => {
    const target = lastStoryId || DATA.find(n => n.kind === 'chapter')?.id;
    if (target) selectNode(target);
  });
  el('uploadBtn').addEventListener('click', () => imageInput.click());
  dropZone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => addFiles(imageInput.files));
  ['dragenter','dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.focus(); }
    if (e.key === 'Escape' && document.activeElement === searchInput) { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); }
  });

  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    el('progressBar').style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  });

  function updateCounts() {
    const chapters = DATA.filter(n => n.kind === 'chapter').length;
    el('nodeCount').textContent = `${chapters} пунктов`;
    el('heroNodes').textContent = chapters;
    el('peopleCount').textContent = PEOPLE.length;
  }

  async function boot() {
    updateCounts();
    renderTree();
    renderPeopleList();
    const rawHash = location.hash.slice(1);
    if (rawHash.startsWith('person/')) {
      const id = decodeURIComponent(rawHash.slice('person/'.length));
      if (peopleById.has(id)) return selectPerson(id, false);
    }
    const hash = decodeURIComponent(rawHash);
    if (hash && byId.has(hash)) await selectNode(hash, false);
  }

  window.addEventListener('hashchange', () => {
    const rawHash = location.hash.slice(1);
    if (rawHash.startsWith('person/')) {
      const id = decodeURIComponent(rawHash.slice('person/'.length));
      if (peopleById.has(id)) { selectPerson(id, false); return; }
    }
    const hash = decodeURIComponent(rawHash);
    if (byId.has(hash)) selectNode(hash, false);
  });

  boot().catch(err => {
    console.error(err);
    showToast('Не удалось открыть локальное хранилище изображений');
  });
})();
