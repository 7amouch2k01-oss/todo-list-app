(() => {
  const STORAGE_KEY = 'todo-app-state-v2';
  const THEME_KEY = 'todo-list-theme';

  const defaultState = () => ({
    lists: [{ id: 'default', name: 'My Tasks', tasks: [] }],
    activeListId: 'default',
    filter: 'all',
    sort: 'manual',
    search: '',
    history: [],
  });

  let state = loadState();
  let undoBuffer = null;
  let undoTimer = null;
  let dragId = null;
  let selected = new Set();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch { return defaultState(); }
  }
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const activeList = () => state.lists.find(l => l.id === state.activeListId) || state.lists[0];

  const $ = id => document.getElementById(id);
  const form = $('todo-form');
  const input = $('todo-input');
  const prioritySel = $('todo-priority');
  const dueInput = $('todo-due');
  const recurringSel = $('todo-recurring');
  const tagsInput = $('todo-tags');
  const list = $('todo-list');
  const todoCount = $('todo-count');
  const clearBtn = $('clear-completed');
  const themeBtn = $('theme-toggle');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const searchInput = $('search-input');
  const sortSel = $('sort-select');
  const sidebar = $('sidebar');
  const sidebarToggle = $('sidebar-toggle');
  const listsNav = $('lists-nav');
  const newListBtn = $('new-list-btn');
  const statsBtn = $('stats-btn');
  const exportBtn = $('export-btn');
  const importFile = $('import-file');
  const listTitle = $('list-title');
  const toast = $('toast');
  const toastMsg = $('toast-msg');
  const toastAction = $('toast-action');
  const modal = $('modal');
  const modalBody = $('modal-body');
  const bulkBar = $('bulk-bar');
  const bulkCount = $('bulk-count');

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    localStorage.setItem(THEME_KEY, t);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');

  function parseSmartDate(text) {
    const lower = text.toLowerCase();
    const now = new Date(); now.setHours(0,0,0,0);
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const patterns = [
      { re: /\b(today)\b/, fn: () => now },
      { re: /\b(tomorrow|tmrw)\b/, fn: () => new Date(now.getTime() + 86400000) },
      { re: /\bin (\d+) days?\b/, fn: m => new Date(now.getTime() + +m[1]*86400000) },
      { re: /\bnext (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, fn: m => {
        const target = days.indexOf(m[1]);
        const diff = ((target - now.getDay() + 7) % 7) || 7;
        return new Date(now.getTime() + diff * 86400000);
      }},
      { re: /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, fn: m => {
        const target = days.indexOf(m[1]);
        const diff = ((target - now.getDay() + 7) % 7) || 7;
        return new Date(now.getTime() + diff * 86400000);
      }},
    ];
    for (const { re, fn } of patterns) {
      const m = lower.match(re);
      if (m) {
        const d = fn(m);
        const cleaned = text.replace(re, '').replace(/\s+/g,' ').trim();
        return { date: d.toISOString().slice(0,10), text: cleaned };
      }
    }
    return null;
  }

  function renderMarkdown(text) {
    const escape = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    let s = escape(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

  function addTask(rawText, priority, due, recurring, tagsStr) {
    let text = rawText;
    if (!due) {
      const parsed = parseSmartDate(text);
      if (parsed) { due = parsed.date; text = parsed.text || text; }
    }
    const tags = tagsStr.split(/[,\s]+/).map(t => t.replace(/^#/,'').trim()).filter(Boolean);
    activeList().tasks.push({
      id: makeId(), text, priority,
      due: due || null, recurring: recurring || null,
      tags, completed: false, subtasks: [], createdAt: Date.now(),
      expanded: false,
    });
    save(); render();
    scheduleNotifications();
  }

  function findTask(id) {
    for (const l of state.lists) {
      const t = l.tasks.find(t => t.id === id);
      if (t) return { task: t, list: l };
    }
    return null;
  }

  function updateTask(id, patch) {
    const f = findTask(id); if (!f) return;
    Object.assign(f.task, patch);
    save(); render();
  }

  function toggleTask(id) {
    const f = findTask(id); if (!f) return;
    const t = f.task;
    t.completed = !t.completed;
    if (t.completed) {
      state.history.push({ when: Date.now() });
      if (t.recurring) {
        const nextDue = computeNextDue(t.due, t.recurring);
        f.list.tasks.push({
          ...t, id: makeId(), completed: false,
          due: nextDue, createdAt: Date.now(),
          subtasks: t.subtasks.map(s => ({ ...s, completed: false })),
        });
      }
      checkAllCompleted();
    }
    save(); render();
  }

  function computeNextDue(due, recurring) {
    const base = due ? new Date(due) : new Date();
    if (recurring === 'daily') base.setDate(base.getDate() + 1);
    else if (recurring === 'weekly') base.setDate(base.getDate() + 7);
    else if (recurring === 'monthly') base.setMonth(base.getMonth() + 1);
    return base.toISOString().slice(0,10);
  }

  function deleteTask(id) {
    const f = findTask(id); if (!f) return;
    const idx = f.list.tasks.findIndex(t => t.id === id);
    const [removed] = f.list.tasks.splice(idx, 1);
    queueUndo('Task deleted', () => { f.list.tasks.splice(idx, 0, removed); save(); render(); });
    save(); render();
  }

  function clearCompleted() {
    const l = activeList();
    const removed = l.tasks.filter(t => t.completed);
    if (!removed.length) return;
    l.tasks = l.tasks.filter(t => !t.completed);
    queueUndo(`${removed.length} task${removed.length>1?'s':''} cleared`, () => {
      l.tasks.push(...removed); save(); render();
    });
    save(); render();
  }

  function checkAllCompleted() {
    const l = activeList();
    const active = l.tasks.filter(t => !t.completed);
    if (l.tasks.length > 0 && active.length === 0) launchConfetti();
  }

  function addSubtask(taskId, text) {
    const f = findTask(taskId); if (!f || !text.trim()) return;
    f.task.subtasks.push({ id: makeId(), text: text.trim(), completed: false });
    save(); render();
  }
  function toggleSubtask(taskId, subId) {
    const f = findTask(taskId); if (!f) return;
    const s = f.task.subtasks.find(s => s.id === subId);
    if (s) { s.completed = !s.completed; save(); render(); }
  }
  function deleteSubtask(taskId, subId) {
    const f = findTask(taskId); if (!f) return;
    f.task.subtasks = f.task.subtasks.filter(s => s.id !== subId);
    save(); render();
  }

  function addList(name) {
    const id = makeId();
    state.lists.push({ id, name, tasks: [] });
    state.activeListId = id;
    save(); render();
  }
  function deleteList(id) {
    if (state.lists.length <= 1) return;
    state.lists = state.lists.filter(l => l.id !== id);
    if (state.activeListId === id) state.activeListId = state.lists[0].id;
    save(); render();
  }
  function switchList(id) {
    state.activeListId = id;
    selected.clear();
    save(); render();
    sidebar.classList.remove('open');
  }

  function getVisibleTasks() {
    let arr = [...activeList().tasks];
    if (state.filter === 'active') arr = arr.filter(t => !t.completed);
    else if (state.filter === 'completed') arr = arr.filter(t => t.completed);
    const q = state.search.trim().toLowerCase();
    if (q) arr = arr.filter(t =>
      t.text.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
    if (state.sort === 'due') arr.sort((a,b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
    else if (state.sort === 'priority') {
      const order = { high: 0, medium: 1, low: 2 };
      arr.sort((a,b) => order[a.priority] - order[b.priority]);
    } else if (state.sort === 'created') arr.sort((a,b) => b.createdAt - a.createdAt);
    return arr;
  }

  function queueUndo(msg, undoFn) {
    if (undoTimer) clearTimeout(undoTimer);
    undoBuffer = undoFn;
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    undoTimer = setTimeout(() => {
      toast.classList.add('hidden');
      undoBuffer = null;
    }, 5000);
  }
  toastAction.addEventListener('click', () => {
    if (undoBuffer) undoBuffer();
    toast.classList.add('hidden');
    clearTimeout(undoTimer); undoBuffer = null;
  });

  function launchConfetti() {
    const root = $('confetti-root');
    const colors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#ec4899'];
    for (let i = 0; i < 50; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.top = '-10px';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.3) + 's';
      c.style.animationDuration = (1.5 + Math.random()) + 's';
      root.appendChild(c);
      setTimeout(() => c.remove(), 2500);
    }
  }

  let notifyTimers = [];
  async function scheduleNotifications() {
    notifyTimers.forEach(clearTimeout);
    notifyTimers = [];
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }
    if (Notification.permission !== 'granted') return;
    const now = Date.now();
    for (const l of state.lists) for (const t of l.tasks) {
      if (t.completed || !t.due) continue;
      const due = new Date(t.due).getTime();
      const delay = due - now;
      if (delay > 0 && delay < 7 * 86400000) {
        notifyTimers.push(setTimeout(() => {
          new Notification('Task due', { body: t.text });
        }, delay));
      }
    }
  }

  function showStats() {
    const allTasks = state.lists.flatMap(l => l.tasks);
    const total = allTasks.length;
    const completed = allTasks.filter(t => t.completed).length;
    const rate = total ? Math.round(completed/total*100) : 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const todayCompletions = state.history.filter(h => h.when >= today.getTime()).length;
    const streak = computeStreak();
    modalBody.innerHTML = `
      <h2>📊 Statistics</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="num">${total}</div><div class="lbl">Total tasks</div></div>
        <div class="stat-card"><div class="num">${completed}</div><div class="lbl">Completed</div></div>
        <div class="stat-card"><div class="num">${rate}%</div><div class="lbl">Completion rate</div></div>
        <div class="stat-card"><div class="num">${todayCompletions}</div><div class="lbl">Done today</div></div>
        <div class="stat-card"><div class="num">${streak}</div><div class="lbl">Day streak 🔥</div></div>
        <div class="stat-card"><div class="num">${state.lists.length}</div><div class="lbl">Lists</div></div>
      </div>
    `;
    modal.classList.remove('hidden');
  }
  function computeStreak() {
    if (!state.history.length) return 0;
    const days = new Set(state.history.map(h => new Date(h.when).toDateString()));
    let streak = 0;
    const d = new Date(); d.setHours(0,0,0,0);
    while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate()-1); }
    return streak;
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `todo-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  importFile.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!imported.lists) throw new Error('Invalid format');
      state = { ...defaultState(), ...imported };
      save(); render();
    } catch (err) { alert('Import failed: ' + err.message); }
    e.target.value = '';
  });

  function isOverdue(due, completed) {
    if (!due || completed) return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(due) < today;
  }
  function formatDate(d) {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderLists() {
    listsNav.innerHTML = '';
    state.lists.forEach(l => {
      const li = document.createElement('li');
      li.className = l.id === state.activeListId ? 'active' : '';
      li.dataset.id = l.id;
      const remaining = l.tasks.filter(t => !t.completed).length;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = l.name;
      const cnt = document.createElement('span');
      cnt.className = 'list-count';
      cnt.textContent = remaining;
      li.append(nameSpan, cnt);
      if (state.lists.length > 1) {
        li.title = 'Click to switch · Right-click to delete';
        li.addEventListener('contextmenu', e => {
          e.preventDefault();
          if (confirm(`Delete list "${l.name}" and all its tasks?`)) deleteList(l.id);
        });
      }
      li.addEventListener('click', () => switchList(l.id));
      listsNav.appendChild(li);
    });
  }

  function renderFilters() {
    const tasks = activeList().tasks;
    const counts = {
      all: tasks.length,
      active: tasks.filter(t => !t.completed).length,
      completed: tasks.filter(t => t.completed).length,
    };
    filterBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.filter === state.filter);
      b.querySelector('.count').textContent = counts[b.dataset.filter];
    });
  }

  function buildTaskEl(task) {
    const li = document.createElement('li');
    li.className = `todo-item ${task.completed ? 'completed' : ''} ${selected.has(task.id) ? 'selected' : ''}`;
    li.dataset.id = task.id;
    li.dataset.priority = task.priority;
    li.draggable = state.sort === 'manual';

    const handle = document.createElement('span');
    handle.className = 'todo-item__handle';
    handle.textContent = '⋮⋮';
    handle.style.visibility = state.sort === 'manual' ? 'visible' : 'hidden';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', 'Mark complete');

    const body = document.createElement('div');
    body.className = 'todo-item__body';

    const textEl = document.createElement('div');
    textEl.className = 'todo-item__text';
    textEl.innerHTML = renderMarkdown(task.text);
    textEl.title = 'Double-click to edit';
    body.appendChild(textEl);

    const meta = document.createElement('div');
    meta.className = 'todo-item__meta';
    if (task.due) {
      const dueEl = document.createElement('span');
      dueEl.className = 'todo-item__due' + (isOverdue(task.due, task.completed) ? ' overdue' : '');
      dueEl.textContent = '📅 ' + formatDate(task.due);
      meta.appendChild(dueEl);
    }
    if (task.recurring) {
      const r = document.createElement('span');
      r.className = 'todo-item__recurring';
      r.textContent = '🔁 ' + task.recurring;
      meta.appendChild(r);
    }
    task.tags?.forEach(tag => {
      const t = document.createElement('span');
      t.className = 'todo-item__tag';
      t.textContent = '#' + tag;
      meta.appendChild(t);
    });
    if (task.subtasks?.length) {
      const done = task.subtasks.filter(s => s.completed).length;
      const p = document.createElement('span');
      p.className = 'todo-item__progress';
      p.textContent = `${done}/${task.subtasks.length}`;
      meta.appendChild(p);
    }
    const exp = document.createElement('button');
    exp.className = 'todo-item__expand';
    exp.textContent = task.expanded ? '▾' : (task.subtasks?.length ? '▸' : '+ subtask');
    exp.dataset.action = 'expand';
    meta.appendChild(exp);
    body.appendChild(meta);

    if (task.expanded) {
      const sl = document.createElement('ul');
      sl.className = 'subtasks';
      task.subtasks.forEach(s => {
        const sli = document.createElement('li');
        sli.className = 'subtask' + (s.completed ? ' completed' : '');
        sli.dataset.subId = s.id;
        sli.innerHTML = `<input type="checkbox" ${s.completed?'checked':''}/><span></span><button data-action="del-sub">✕</button>`;
        sli.querySelector('span').textContent = s.text;
        sl.appendChild(sli);
      });
      const add = document.createElement('div');
      add.className = 'subtask-add';
      add.innerHTML = `<input type="text" placeholder="Add subtask..." maxlength="100"/><button class="btn-secondary" data-action="add-sub">+</button>`;
      sl.appendChild(add);
      body.appendChild(sl);
    }

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'todo-item__delete';
    del.setAttribute('aria-label', 'Delete'); del.textContent = '✕';

    li.append(handle, checkbox, body, del);
    return li;
  }

  function render() {
    renderLists();
    renderFilters();
    listTitle.textContent = activeList().name;

    const visible = getVisibleTasks();
    list.innerHTML = '';
    if (visible.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = state.search ? 'No tasks match your search.' :
        activeList().tasks.length === 0 ? 'No tasks yet. Add one above!' :
        `No ${state.filter} tasks.`;
      list.appendChild(li);
    } else {
      const frag = document.createDocumentFragment();
      visible.forEach(t => frag.appendChild(buildTaskEl(t)));
      list.appendChild(frag);
    }

    const remaining = activeList().tasks.filter(t => !t.completed).length;
    todoCount.textContent = `${remaining} task${remaining !== 1 ? 's' : ''} left`;

    bulkBar.classList.toggle('hidden', selected.size === 0);
    bulkCount.textContent = `${selected.size} selected`;
  }

  function startEdit(textEl, id) {
    const f = findTask(id); if (!f) return;
    const editor = document.createElement('input');
    editor.type = 'text'; editor.className = 'todo-item__edit';
    editor.value = f.task.text; editor.maxLength = 200;
    textEl.replaceWith(editor); editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    const finish = commit => {
      const v = editor.value.trim();
      if (commit && v) updateTask(id, { text: v });
      else render();
    };
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
    });
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addTask(text, prioritySel.value, dueInput.value, recurringSel.value, tagsInput.value);
    form.reset(); prioritySel.value = 'medium'; input.focus();
  });

  list.addEventListener('click', e => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;

    if (e.target.matches('.subtask input[type="checkbox"]')) {
      toggleSubtask(id, e.target.closest('.subtask').dataset.subId);
    } else if (e.target.dataset.action === 'del-sub') {
      deleteSubtask(id, e.target.closest('.subtask').dataset.subId);
    } else if (e.target.dataset.action === 'add-sub') {
      const inp = e.target.previousElementSibling;
      if (inp.value.trim()) addSubtask(id, inp.value.trim());
    } else if (e.target.dataset.action === 'expand') {
      updateTask(id, { expanded: !findTask(id).task.expanded });
    } else if (e.target.matches('input[type="checkbox"]')) {
      toggleTask(id);
    } else if (e.target.matches('.todo-item__delete')) {
      deleteTask(id);
    } else if (e.shiftKey) {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
    }
  });

  list.addEventListener('keydown', e => {
    if (e.target.matches('.subtask-add input') && e.key === 'Enter') {
      e.preventDefault();
      const item = e.target.closest('.todo-item');
      if (item && e.target.value.trim()) addSubtask(item.dataset.id, e.target.value.trim());
    }
  });

  list.addEventListener('dblclick', e => {
    const textEl = e.target.closest('.todo-item__text');
    if (!textEl) return;
    startEdit(textEl, textEl.closest('.todo-item').dataset.id);
  });

  list.addEventListener('dragstart', e => {
    const item = e.target.closest('.todo-item');
    if (!item || state.sort !== 'manual') return;
    dragId = item.dataset.id;
    item.classList.add('dragging');
  });
  list.addEventListener('dragend', e => {
    e.target.closest('.todo-item')?.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const item = e.target.closest('.todo-item');
    if (!item || item.dataset.id === dragId) return;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.todo-item');
    const tasks = activeList().tasks;
    if (!target || !dragId || target.dataset.id === dragId) return;
    const fromIdx = tasks.findIndex(t => t.id === dragId);
    const toIdx = tasks.findIndex(t => t.id === target.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const [m] = tasks.splice(fromIdx, 1);
    tasks.splice(toIdx, 0, m);
    dragId = null; save(); render();
  });

  clearBtn.addEventListener('click', clearCompleted);

  filterBtns.forEach(b => b.addEventListener('click', () => {
    state.filter = b.dataset.filter; save(); render();
  }));

  searchInput.addEventListener('input', e => {
    state.search = e.target.value; render();
  });

  sortSel.addEventListener('change', e => {
    state.sort = e.target.value; save(); render();
  });

  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  newListBtn.addEventListener('click', () => {
    const name = prompt('List name:');
    if (name?.trim()) addList(name.trim());
  });

  statsBtn.addEventListener('click', showStats);
  exportBtn.addEventListener('click', exportJSON);

  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.classList.contains('modal__close')) {
      modal.classList.add('hidden');
    }
  });

  sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  $('bulk-complete').addEventListener('click', () => {
    selected.forEach(id => {
      const f = findTask(id);
      if (f && !f.task.completed) toggleTask(id);
    });
    selected.clear(); render();
  });
  $('bulk-delete').addEventListener('click', () => {
    if (!confirm(`Delete ${selected.size} task${selected.size>1?'s':''}?`)) return;
    selected.forEach(id => deleteTask(id));
    selected.clear(); render();
  });
  $('bulk-cancel').addEventListener('click', () => { selected.clear(); render(); });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) {
      if (e.key === 'Escape' && e.target === searchInput) { searchInput.value=''; state.search=''; render(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === '/') { e.preventDefault(); searchInput.focus(); }
    else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); input.focus(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); themeBtn.click(); }
    else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportJSON(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); clearCompleted(); }
    else if (e.key === 'Escape') {
      modal.classList.add('hidden');
      sidebar.classList.remove('open');
      selected.clear(); render();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
  }

  render();
  scheduleNotifications();
  setTimeout(() => input.focus(), 100);
})();
