const socket = io();
let students = {};
let anonymous = false;
let pickedKey = null;
let history = [];
let lastSummary = null;
let questions = [];
let reactions = [];
let currentMode = 'buttons';
let currentButtonSet = 'understanding';
let currentKeywords = [];
let currentQuizOptions = [];
let currentQuizCorrect = null;

// Материал урока
let lessonMaterial = null;
let materialIndex = 0;

// Класс урока
let lessonClass = null;
let classPanelOpen = false;

// Теория
let theoryPanelOpen = false;

let currentLessonId = null;

socket.emit('teacher_join', { code: CODE });

// ============================================
// НАБОРЫ СЧЁТЧИКОВ
// ============================================
const COUNTER_SETS = {
  understanding: {
    g: { emoji: '✅', label: 'Понял' },
    y: { emoji: '🤔', label: 'Почти' },
    r: { emoji: '💥', label: 'Потерялся' },
    n: { emoji: '⏳', label: 'Ждём' },
  },
  yesno: {
    g: { emoji: '✅', label: 'Да' },
    y: { emoji: '🤔', label: 'Нет' },
    r: { emoji: '💥', label: 'Не знаю' },
    n: { emoji: '⏳', label: 'Ждём' },
  },
  quiz: {
    g: { emoji: '🎯', label: 'Верно' },
    y: { emoji: '❌', label: 'Неверно' },
    r: { emoji: '❓', label: 'Без ответа' },
    n: { emoji: '⏳', label: 'Ждём' },
  },
  text: {
    g: { emoji: '✅', label: 'Ответили' },
    y: { emoji: '⏳', label: 'Ждём' },
    r: { emoji: '', label: '' },
    n: { emoji: '', label: '' },
  },
};

function applyCounters(mode, buttonSet) {
  let set;
  if (mode === 'quiz') set = COUNTER_SETS.quiz;
  else if (mode === 'text') set = COUNTER_SETS.text;
  else set = COUNTER_SETS[buttonSet] || COUNTER_SETS.understanding;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText('stat-g-emoji', set.g.emoji);
  setText('stat-g-label', set.g.label);
  setText('stat-y-emoji', set.y.emoji);
  setText('stat-y-label', set.y.label);
  setText('stat-r-emoji', set.r.emoji);
  setText('stat-r-label', set.r.label);
  setText('stat-n-emoji', set.n.emoji);
  setText('stat-n-label', set.n.label);

  const rPill = document.getElementById('stat-r-pill');
  const nPill = document.getElementById('stat-n-pill');

  if (mode === 'text') {
    if (rPill) rPill.style.display = 'none';
    if (nPill) nPill.style.display = 'none';
  } else {
    if (rPill) rPill.style.display = '';
    if (nPill) nPill.style.display = '';
  }
}

// ============================================
// РЕЖИМЫ И НАБОР КНОПОК (выпадашки)
// ============================================
function toggleDD(trigger, e) {
  e.stopPropagation();
  const dd = trigger.closest('.dropdown');
  const wasOpen = dd.classList.contains('open');
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  if (!wasOpen) dd.classList.add('open');
}

document.querySelectorAll('.dropdown-menu').forEach(menu => {
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    e.stopPropagation();
    const dd = menu.closest('.dropdown');
    const text = item.textContent.replace('✓', '').trim();
    dd.querySelector('.dropdown-trigger span:first-child').textContent = text;
    menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    dd.classList.remove('open');

    const type = menu.dataset.dd;
    const value = item.dataset.value;

    if (type === 'mode') {
      socket.emit('set_mode', { code: CODE, mode: value });
      currentMode = value;
      updateModeButtons();
      applyMode(value);
      applyCounters(value, currentButtonSet);
    } else if (type === 'set') {
      socket.emit('set_button_set', { code: CODE, button_set: value });
      currentButtonSet = value;
      updateButtonSetButtons(value);
      applyCounters(currentMode, value);
    }
    // material и class — обрабатываются отдельно (см. ниже)
  });
});

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});

function applyMode(mode) {
  const buttonSetField = document.getElementById('button-set-field');
  const quizBuilder = document.getElementById('quiz-builder');
  const keywordsRow = document.getElementById('keywords-row');

  if (mode === 'buttons' || mode === 'both') {
    buttonSetField.classList.remove('hidden');
  } else {
    buttonSetField.classList.add('hidden');
  }

  if (mode === 'quiz') {
    quizBuilder.classList.remove('hidden');
  } else {
    quizBuilder.classList.add('hidden');
  }

  if (mode === 'text' || mode === 'both') {
    keywordsRow.classList.remove('hidden');
  } else {
    keywordsRow.classList.add('hidden');
  }
}

function updateModeButtons() {
  // Обновляем выпадашку режима
  const modeLabels = {
    buttons: '🎨 Кнопки',
    text: '✍️ Текст',
    both: '🎨+✍️ Оба',
    quiz: '🎲 Квиз',
  };
  const el = document.getElementById('mode-trigger-label');
  if (el) el.textContent = modeLabels[currentMode] || '🎨 Кнопки';

  const menu = document.querySelector('.dropdown-menu[data-dd="mode"]');
  if (menu) {
    menu.querySelectorAll('.dropdown-item').forEach(i => {
      i.classList.toggle('selected', i.dataset.value === currentMode);
    });
  }
}

function updateButtonSetButtons(set) {
  const labels = {
    understanding: '🧠 Понял / Почти / Потерялся',
    yesno: '✅ Да / Нет / Не знаю',
  };
  const el = document.getElementById('button-set-label');
  if (el) el.textContent = labels[set] || labels.understanding;

  const menu = document.querySelector('.dropdown-menu[data-dd="set"]');
  if (menu) {
    menu.querySelectorAll('.dropdown-item').forEach(i => {
      i.classList.toggle('selected', i.dataset.value === set);
    });
  }
}

// ============================================
// МАТЕРИАЛ УРОКА
// ============================================
socket.on('lesson_material_update', (material) => {
  if (!material || !material.material_id || !material.questions || !material.questions.length) {
    lessonMaterial = null;
    updateMaterialDropdown();
    updateTheoryButton(material);
    return;
  }
  lessonMaterial = material;
  materialIndex = 0;
  updateMaterialDropdown();
  updateTheoryButton(material);
});

async function loadLessonMaterialOnStart() {
  try {
    const res = await fetch('/api/get-lesson-material');
    const material = await res.json();
    if (material && material.material_id) {
      if (!lessonMaterial || lessonMaterial.material_id !== material.material_id) {
        lessonMaterial = material;
        materialIndex = 0;
        updateMaterialDropdown();
      }
      updateTheoryButton(material);
      if (theoryPanelOpen) renderTheoryDrawer(material);
    } else {
      lessonMaterial = null;
      updateMaterialDropdown();
      updateTheoryButton(null);
    }
  } catch (e) {
    console.error('[Материал] Ошибка загрузки:', e);
  }
}
setTimeout(loadLessonMaterialOnStart, 500);

function updateMaterialDropdown() {
  const menu = document.getElementById('material-dropdown');
  const label = document.getElementById('material-trigger-label');
  const shortTitle = document.getElementById('mp-title-short');
  const shortCounter = document.getElementById('mp-counter-short');

  if (!lessonMaterial) {
    if (menu) menu.innerHTML = '<div class="dropdown-item" style="color:#6a7290;">Материал не загружен</div>';
    if (label) label.textContent = '📁 Материал не выбран';
    if (shortTitle) shortTitle.textContent = 'Материал';
    if (shortCounter) shortCounter.textContent = '0 из 0';
    return;
  }

  if (label) label.textContent = '📁 ' + lessonMaterial.title;
  if (shortTitle) shortTitle.textContent = lessonMaterial.title;
  if (shortCounter) shortCounter.textContent = `${materialIndex + 1} из ${lessonMaterial.questions.length}`;

  if (!menu) return;
  menu.innerHTML = '';
  lessonMaterial.questions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'dropdown-item' + (i === materialIndex ? ' selected' : '');
    const preview = (q.text || '').slice(0, 60) + ((q.text || '').length > 60 ? '…' : '');
    item.innerHTML = `<span>📖 ${escapeHtml(preview)}</span><span class="check">✓</span>`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      materialIndex = i;
      updateMaterialDropdown();
      materialAsk();
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    });
    menu.appendChild(item);
  });
}

function materialAsk() {
  if (!lessonMaterial) return;
  const q = lessonMaterial.questions[materialIndex];
  if (!q) return;

  if (q.mode && q.mode !== currentMode) {
    socket.emit('set_mode', { code: CODE, mode: q.mode });
    currentMode = q.mode;
    updateModeButtons();
    applyMode(q.mode);
  }

  if (q.mode === 'text' && q.keywords) {
    const kws = q.keywords.split(',').map(s => s.trim()).filter(Boolean);
    socket.emit('set_keywords', { code: CODE, keywords: kws });
    document.getElementById('keywords-input').value = kws.join(', ');
  }

  if (q.mode === 'quiz' && q.quiz_options) {
    try {
      const opts = JSON.parse(q.quiz_options);
      for (let i = 0; i < 4; i++) {
        const el = document.getElementById('quiz-opt-' + i);
        if (el) el.value = opts[i] || '';
      }
      const corrEl = document.getElementById('quiz-correct-select');
      if (corrEl) {
        corrEl.value = (q.quiz_correct !== null && q.quiz_correct !== undefined)
          ? String(q.quiz_correct) : '0';
      }
    } catch (e) {}
  }

  document.getElementById('question').value = q.text || '';
  if (q.timer) {
    document.getElementById('timer-select').value = String(q.timer);
  }
  ask();
}

// ============================================
// КЛАСС УРОКА
// ============================================
socket.on('lesson_class_update', (cls) => {
  if (!cls || !cls.class_id || !cls.students || !cls.students.length) {
    lessonClass = null;
    updateClassDropdown();
    return;
  }
  lessonClass = cls;
  updateClassDropdown();
});

async function loadLessonClassOnStart() {
  try {
    const res = await fetch('/api/get-lesson-class');
    const cls = await res.json();
    if (cls && cls.class_id && cls.students && cls.students.length) {
      lessonClass = cls;
      updateClassDropdown();
    } else {
      lessonClass = null;
      updateClassDropdown();
    }
  } catch (e) {}
}
setTimeout(loadLessonClassOnStart, 500);

function updateClassDropdown() {
  const menu = document.getElementById('class-dropdown');
  const label = document.getElementById('class-trigger-label');

  if (!lessonClass) {
    if (menu) menu.innerHTML = '<div class="dropdown-item" style="color:#6a7290;">Класс не загружен</div>';
    if (label) label.textContent = '👥 Класс не выбран';
    return;
  }

  if (label) label.textContent = '👥 ' + lessonClass.title;

  const classStudents = lessonClass.students || [];
  const enteredNames = Object.values(students)
    .filter(s => !s.__skip)
    .map(s => (s.name || '').trim().toLowerCase());

  const present = [];
  const absent = [];
  classStudents.forEach(name => {
    const norm = name.trim().toLowerCase();
    if (enteredNames.includes(norm)) present.push(name);
    else absent.push(name);
  });

  if (!menu) return;
  menu.innerHTML = '';
  const presentTitle = document.createElement('div');
  presentTitle.className = 'class-col-title class-col-present';
  presentTitle.textContent = `✅ Зашли (${present.length})`;
  menu.appendChild(presentTitle);
  present.forEach(n => {
    const el = document.createElement('div');
    el.className = 'class-student-item present';
    el.textContent = '✅ ' + n;
    menu.appendChild(el);
  });
  const absentTitle = document.createElement('div');
  absentTitle.className = 'class-col-title class-col-absent';
  absentTitle.textContent = `⏳ Не зашли (${absent.length})`;
  menu.appendChild(absentTitle);
  absent.forEach(n => {
    const el = document.createElement('div');
    el.className = 'class-student-item absent';
    el.textContent = '⏳ ' + n;
    menu.appendChild(el);
  });
}

// ============================================
// ОСНОВНАЯ ЛОГИКА
// ============================================
function ask() {
  const q = document.getElementById('question').value.trim();
  if (!q) return;
  const timer = parseInt(document.getElementById('timer-select').value) || 0;

  let quiz_options = [];
  let quiz_correct = null;
  if (currentMode === 'quiz') {
    for (let i = 0; i < 4; i++) {
      const v = (document.getElementById('quiz-opt-' + i).value || '').trim();
      if (v) quiz_options.push(v);
    }
    const corr = document.getElementById('quiz-correct-select').value;
    if (corr !== '') quiz_correct = parseInt(corr);
    if (quiz_options.length < 2) {
      alert('Заполни хотя бы 2 варианта ответа');
      return;
    }
    if (quiz_correct === null || isNaN(quiz_correct)) {
      alert('Укажи правильный ответ для квиза');
      return;
    }
  }
  if (currentMode === 'text' || currentMode === 'both') {
    const kwInput = document.getElementById('keywords-input');
    if (kwInput) {
      const kws = kwInput.value.split(',').map(s => s.trim()).filter(Boolean);
      socket.emit('set_keywords', { code: CODE, keywords: kws });
    }
  }

  socket.emit('new_question', {
    code: CODE, question: q, timer: timer,
    mode: currentMode,
    quiz_options: quiz_options,
    quiz_correct: quiz_correct
  });
  document.getElementById('question').value = '';
  clearPicked();
}

document.getElementById('question').addEventListener('keydown', e => {
  if (e.key === 'Enter') ask();
});

socket.on('question', d => {
  const currentQ = document.getElementById('current-q');
  if (currentQ) {
    currentQ.textContent = '📣 ' + d.question;
    currentQ.style.display = 'block';
  }
  currentQuizOptions = d.quiz_options || [];
  currentQuizCorrect = (d.quiz_correct !== undefined && d.quiz_correct !== null)
    ? parseInt(d.quiz_correct)
    : null;
  if (currentMode === 'quiz' && currentQuizOptions.length) {
    document.getElementById('quiz-results').style.display = 'block';
  } else {
    document.getElementById('quiz-results').style.display = 'none';
  }
});

socket.on('student_list', data => {
  students = data;
  render();
  renderQuizBars();
  updateClassDropdown();
});

socket.on('history_update', data => {
  history = data;
  renderHistory();
});

socket.on('invited_update', d => {
  document.getElementById('invited-count').textContent = d.invited_count;
});

socket.on('questions_update', data => {
  questions = data;
  renderQuestions();
});

socket.on('reactions_update', data => {
  reactions = data;
  renderReactions();
});

socket.on('mode_update', d => {
  currentMode = d.mode || 'buttons';
  currentKeywords = d.keywords || [];
  if (d && d.button_set) currentButtonSet = d.button_set;
  updateModeButtons();
  updateButtonSetButtons(currentButtonSet);
  applyMode(currentMode);
  applyCounters(currentMode, currentButtonSet);

  const kwInput = document.getElementById('keywords-input');
  if (kwInput && document.activeElement !== kwInput) {
    kwInput.value = currentKeywords.join(', ');
  }
  const vb = document.getElementById('voice-check');
  if (vb) vb.checked = !!d.voice_enabled;
});

window.sendMode = function(mode) {
  socket.emit('set_mode', { code: CODE, mode: mode });
};
window.sendKeywords = function(kws) {
  socket.emit('set_keywords', { code: CODE, keywords: kws });
};
window.sendVoiceEnabled = function(enabled) {
  socket.emit('set_voice_enabled', { code: CODE, enabled: enabled });
};

function render() {
  const map = document.getElementById('map');
  if (!map) return;
  map.innerHTML = '';
  let g=0, y=0, r=0, none=0;
  let present = 0, hands = 0, unfocused = 0;
  const total = Object.keys(students).length;
  const showText = (currentMode === 'text' || currentMode === 'both');
  const showQuiz = (currentMode === 'quiz');

  // Для квиза — считаем правильно/неправильно
  let quizCorrect = 0, quizWrong = 0, quizNoAnswer = 0;

  for (const [key, s] of Object.entries(students)) {
    if (key.startsWith('__')) continue;
    const c = s.color || 'none';
    if (showQuiz) {
      if (s.quiz_choice === null || s.quiz_choice === undefined) {
        quizNoAnswer++;
      } else if (currentQuizCorrect !== null && s.quiz_choice === currentQuizCorrect) {
        quizCorrect++;
      } else {
        quizWrong++;
      }
    } else {
      if (c==='green') g++; else if (c==='yellow') y++; else if (c==='red') r++; else none++;
    }
    if (s.focused !== false) present++;
    else unfocused++;
    if (s.hand) hands++;

    const el = document.createElement('div');
    el.className = 'student ' + c;
    if (key === pickedKey) el.classList.add('picked');
    if (s.hand) el.classList.add('hand-raised');
    if (s.focused === false) el.classList.add('unfocused');
    if (lessonClass && s.in_class === false) el.classList.add('not-from-class');

    // Имя
    let nameText = anonymous ? 'Ученик ' + s.anon_num : s.name;
    if (s.hand) nameText += ' ✋';
    if (s.focused === false) nameText += ' 👀';
    el.textContent = nameText;

    map.appendChild(el);
  }

  // Обновляем счётчики
  if (showQuiz) {
    document.getElementById('stat-g-num').textContent = quizCorrect;
    document.getElementById('stat-y-num').textContent = quizWrong;
    document.getElementById('stat-r-num').textContent = quizNoAnswer;
    document.getElementById('stat-n-num').textContent = 0;
  } else if (currentMode === 'text') {
    const answered = total - none;
    document.getElementById('stat-g-num').textContent = answered;
    document.getElementById('stat-y-num').textContent = none;
    document.getElementById('stat-r-num').textContent = 0;
    document.getElementById('stat-n-num').textContent = 0;
  } else {
    document.getElementById('stat-g-num').textContent = g;
    document.getElementById('stat-y-num').textContent = y;
    document.getElementById('stat-r-num').textContent = r;
    document.getElementById('stat-n-num').textContent = none;
  }

  document.getElementById('present-count').textContent = present;
  document.getElementById('total-count').textContent = total;
  document.getElementById('hand-count').textContent = hands;
  document.getElementById('unfocused-count').textContent = unfocused;
  updateAdvice(g, y, r, none);
}

function renderQuizBars() {
  if (currentMode !== 'quiz' || !currentQuizOptions.length) return;
  const bars = document.getElementById('quiz-bars');
  const letters = ['A', 'B', 'C', 'D'];
  const counts = [0, 0, 0, 0];
  let total = 0;
  for (const [key, s] of Object.entries(students)) {
    if (key.startsWith('__')) continue;
    if (s.quiz_choice !== null && s.quiz_choice !== undefined) {
      counts[s.quiz_choice] = (counts[s.quiz_choice] || 0) + 1;
      total++;
    }
  }
  bars.innerHTML = '';
  currentQuizOptions.forEach((opt, i) => {
    const cnt = counts[i] || 0;
    const pct = total > 0 ? Math.round(100 * cnt / total) : 0;
    const isCorrect = (currentQuizCorrect !== null && i === currentQuizCorrect);
    const row = document.createElement('div');
    row.className = 'quiz-bar-row' + (isCorrect ? ' correct' : '');
    row.innerHTML = `
      <span class="quiz-bar-letter">${letters[i]}</span>
      <span class="quiz-bar-text">${escapeHtml(opt)}</span>
      <span class="quiz-bar-track"><span class="quiz-bar-fill" style="width:${pct}%"></span></span>
      <span class="quiz-bar-count">${cnt}</span>
    `;
    bars.appendChild(row);
  });
}

function highlightKeywords(text, keywords) {
  if (!keywords || !keywords.length) return escapeHtml(text);
  let result = escapeHtml(text);
  keywords.forEach(kw => {
    if (!kw) return;
    const re = new RegExp('(' + escapeRegex(kw) + ')', 'gi');
    result = result.replace(re, '<mark>$1</mark>');
  });
  return result;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateAdvice(g, y, r, none) {
  const total = g + y + r;
  const advice = document.getElementById('advice');
  if (!advice) return;
  if (total === 0) { advice.textContent = 'Ждём ответов…'; return; }
  if (r / total > 0.3) {
    advice.textContent = '💥 Больше трети потерялись. Стоп. Объясни ещё раз через бытовой пример.';
  } else if (y / total > 0.4) {
    advice.textContent = '🤔 Много «почти». Дай контрпример.';
  } else if (g / total > 0.8) {
    advice.textContent = '✅ Класс понял. Можно усложнять.';
  } else {
    advice.textContent = '👍 Ситуация под контролем.';
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!history.length) {
    list.innerHTML = '<p class="sub">Задай первый вопрос — здесь появится статистика.</p>';
    return;
  }
  list.innerHTML = '';
  history.forEach((h, i) => {
    const total = h.total_answered || 1;
    const pct = Math.round(100 * h.green / total);
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <span class="history-num">#${i + 1}</span>
      <span class="history-q">${escapeHtml(h.question)}</span>
      <span class="history-bar">
        <span class="history-fill" style="width:${pct}%"></span>
      </span>
      <span class="history-stats">✅${h.green} 🤔${h.yellow} 💥${h.red}</span>
      <span class="history-pct">${pct}%</span>
    `;
    list.appendChild(row);
  });
}

function renderQuestions() {
  const list = document.getElementById('questions-list');
  const badge = document.getElementById('questions-tab-badge');
  if (!list) return;

  const unread = questions.filter(q => !q.answered).length;
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'inline-flex' : 'none';
  }

  if (!questions.length) {
    list.innerHTML = '<p class="sub">Здесь появятся вопросы от учеников.</p>';
    return;
  }
  list.innerHTML = '';
  questions.slice().reverse().forEach(q => {
    const el = document.createElement('div');
    el.className = 'question-item' + (q.answered ? ' answered' : '');
    const who = q.anonymous ? 'Ученик ' + q.anon_num : q.name;
    el.innerHTML = `
      <div class="question-meta">
        <span class="question-who">${escapeHtml(who)}</span>
        <span class="question-actions">
          <button class="q-act" onclick="markQuestion('${q.id}', 'answered')">
            ${q.answered ? '↩' : '✓'}
          </button>
          <button class="q-act q-act-del" onclick="markQuestion('${q.id}', 'delete')">✕</button>
        </span>
      </div>
      <div class="question-text">${escapeHtml(q.text)}</div>
    `;
    list.appendChild(el);
  });
}

window.markQuestion = function(id, action) {
  socket.emit('mark_question', { code: CODE, id: id, action: action });
};

function renderReactions() {
  const list = document.getElementById('reactions-list');
  if (!list) return;
  const recent = reactions.slice(-20);
  const now = Math.floor(Date.now() / 1000);
  const visible = recent.filter(r => now - r.ts < 15);
  if (!visible.length) {
    list.innerHTML = '<span class="reactions-empty">тихо…</span>';
    return;
  }
  const counts = {};
  visible.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
  list.innerHTML = '';
  Object.entries(counts).forEach(([emoji, count]) => {
    const el = document.createElement('span');
    el.className = 'reaction-item';
    el.innerHTML = `${emoji}<span class="reaction-count">${count}</span>`;
    list.appendChild(el);
  });
}

setInterval(renderReactions, 2000);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function pickRandom(mode) {
  socket.emit('pick_random', { code: CODE, mode: mode });
}

socket.on('picked_student', d => {
  pickedKey = d.key;
  const box = document.getElementById('picked-box');
  const nameEl = document.getElementById('picked-name');
  nameEl.textContent = d.anonymous ? 'Ученик ' + d.anon_num : d.name;
  box.style.display = 'flex';
  render();
});

socket.on('picked_none', () => {
  const box = document.getElementById('picked-box');
  const nameEl = document.getElementById('picked-name');
  nameEl.textContent = 'Пока никто не ответил';
  box.style.display = 'flex';
  setTimeout(() => { box.style.display = 'none'; }, 2500);
});

socket.on('picked_clear', () => clearPicked());

function clearPicked() {
  pickedKey = null;
  const box = document.getElementById('picked-box');
  if (box) box.style.display = 'none';
  render();
}

function resetColors() {
  socket.emit('reset', { code: CODE });
  clearPicked();
}

window.setAnonymousMode = function(value) {
  anonymous = value;
  socket.emit('toggle_anonymous', { code: CODE, value: value });
  render();
};

function finishLesson() {
  socket.emit('finish_lesson', { code: CODE });
}

socket.on('lesson_summary', s => {
  lastSummary = s;
  const modal = document.getElementById('summary-modal');
  const stats = document.getElementById('summary-stats');
  const chart = document.getElementById('summary-chart');

  stats.innerHTML = `
    <div class="stat">
      <div class="stat-num">${s.total_questions}</div>
      <div class="stat-label">вопросов</div>
    </div>
    <div class="stat">
      <div class="stat-num">${s.total_answered}</div>
      <div class="stat-label">ответов</div>
    </div>
    <div class="stat">
      <div class="stat-num">${s.avg_green_pct}%</div>
      <div class="stat-label">в среднем поняли</div>
    </div>
    <div class="stat">
      <div class="stat-num">${s.questions_count || 0}</div>
      <div class="stat-label">вопросов от учеников</div>
    </div>
    <div class="stat">
      <div class="stat-num">${s.reactions_count || 0}</div>
      <div class="stat-label">реакций</div>
    </div>
  `;

  chart.innerHTML = '';
  if (!s.history.length) {
    chart.innerHTML = '<p class="sub">Нет данных.</p>';
  } else {
    s.history.forEach((h, i) => {
      const total = h.total_answered || 1;
      const pct = Math.round(100 * h.green / total);
      const row = document.createElement('div');
      row.className = 'chart-row';
      row.innerHTML = `
        <span class="chart-label">#${i + 1}</span>
        <span class="chart-bar">
          <span class="chart-fill" style="width:${pct}%"></span>
        </span>
        <span class="chart-pct">${pct}%</span>
      `;
      chart.appendChild(row);
    });
  }
  saveLessonAndGrades(s);

  modal.style.display = 'flex';
  clearTimeout(window.__autoCloseLessonTimeout);
  window.__autoCloseLessonTimeout = setTimeout(() => {
    if (window.closeSummaryAndTeacher) window.closeSummaryAndTeacher();
  }, 15000);
});

function downloadCsv() {
  if (!lastSummary) return;
  let csv = 'Вопрос,Поняли,Почти,Потерялись,Всего ответов,Процент зелёных,Ответы\n';
  lastSummary.history.forEach((h, i) => {
    const total = h.total_answered || 1;
    const pct = Math.round(100 * h.green / total);
    const q = '"' + String(h.question).replace(/"/g, '""') + '"';
    let textsStr = '';
    if (h.texts) {
      const entries = Object.entries(h.texts)
        .filter(([k, v]) => v && v.trim())
        .map(([k, v]) => {
          const nm = h.names ? h.names[k] : k;
          return `${nm}: ${v}`;
        });
      textsStr = entries.join(' | ');
    }
    const textsEsc = '"' + textsStr.replace(/"/g, '""') + '"';
    csv += `${i + 1},${q},${h.green},${h.yellow},${h.red},${h.total_answered},${pct}%,${textsEsc}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lumen-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

socket.on('state', d => {
  if (d && typeof d.anonymous === 'boolean') {
    anonymous = d.anonymous;
    const cb = document.getElementById('anon-check');
    if (cb) cb.checked = anonymous;
  }
  if (d && d.mode) {
    currentMode = d.mode;
    updateModeButtons();
    applyMode(currentMode);
  }
  if (d && d.button_set) {
    currentButtonSet = d.button_set;
    updateButtonSetButtons(currentButtonSet);
  }
  applyCounters(currentMode, currentButtonSet);
  if (d && Array.isArray(d.keywords)) {
    currentKeywords = d.keywords;
    const kwInput = document.getElementById('keywords-input');
    if (kwInput) kwInput.value = currentKeywords.join(', ');
  }
  if (d && typeof d.voice_enabled === 'boolean') {
    const vb = document.getElementById('voice-check');
    if (vb) vb.checked = d.voice_enabled;
  }
});

// ============================================
// ТЕОРИЯ
// ============================================
function updateTheoryButton(material) {
  const btn = document.getElementById('theory-toggle-btn');
  if (!btn) return;
  if (material && material.theory && material.theory.length) {
    btn.style.display = 'inline-flex';
    btn.textContent = '📖 Теория (' + material.theory.length + ')';
  } else {
    btn.style.display = 'none';
  }
}

function toggleTheoryPanel() {
  theoryPanelOpen = !theoryPanelOpen;
  document.getElementById('theory-drawer').classList.toggle('open', theoryPanelOpen);
  document.getElementById('theory-drawer-backdrop').classList.toggle('show', theoryPanelOpen);
  if (theoryPanelOpen) {
    loadLessonMaterialOnStart().then(() => {
      renderTheoryDrawer(lessonMaterial);
    });
  }
}

function closeTheoryPanel() {
  theoryPanelOpen = false;
  document.getElementById('theory-drawer').classList.remove('open');
  document.getElementById('theory-drawer-backdrop').classList.remove('show');
}

function renderTheoryDrawer(material) {
  const content = document.getElementById('theory-drawer-content');
  if (!material || !material.theory || !material.theory.length) {
    content.innerHTML = '<p class="sub">Теория не добавлена</p>';
    return;
  }
  content.innerHTML = '';
  material.theory.forEach(item => {
    const el = document.createElement('div');
    el.className = 'theory-drawer-item';
    let body = '';
    if (item.type === 'note') {
      body = `<div class="theory-content">${renderMarkdownSimple(item.content || '')}</div>`;
    } else if (item.type === 'link') {
      body = `<a class="theory-link-url" onclick="window.open('${escapeHtml(item.content)}', '_blank')">${escapeHtml(item.content)}</a>`;
    } else if (item.type === 'image') {
      body = `<img class="theory-image-preview" src="/theory-file/${item.content}" alt="${escapeHtml(item.title)}" loading="lazy">`;
    } else if (item.type === 'file') {
      const sizeStr = (function(bytes) {
        if (!bytes) return '0 Б';
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' КБ';
        return (bytes/(1024*1024)).toFixed(1) + ' МБ';
      })(item.size || 0);
      body = `<a class="theory-file-info" href="/theory-file/${item.content}" target="_blank">
        <span class="theory-file-icon">📎</span>
        <div class="theory-file-info-text">
          <div class="theory-file-name">${escapeHtml(item.original_name || item.title)}</div>
          <div class="theory-file-size">${sizeStr}</div>
        </div>
      </a>`;
    }
    el.innerHTML = `
      <div class="theory-drawer-title">${escapeHtml(item.title || 'Без названия')}</div>
      ${body}
    `;
    content.appendChild(el);
  });
}

function renderMarkdownSimple(text) {
  if (!text) return '';
  let html = String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = html.split('\n');
  const result = [];
  let inUl = false;
  for (let line of lines) {
    const ulMatch = line.match(/^[\-\*] (.+)/);
    if (ulMatch) {
      if (!inUl) { result.push('<ul>'); inUl = true; }
      result.push('<li>' + ulMatch[1] + '</li>');
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (line.trim()) result.push('<p>' + line + '</p>');
    }
  }
  if (inUl) result.push('</ul>');
  return result.join('');
}

// ============================================
// ВКЛАДКИ
// ============================================
window.switchTab = function(tab) {
  document.querySelectorAll('.tabs .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.teacher-tab-content').forEach(c => {
    c.classList.toggle('active', c.id === 'tab-' + tab);
  });
  if (tab === 'grades') renderGradesTable();
};

// ============================================
// ТАБЛИЦА ОЦЕНОК
// ============================================
const gradeCache = {};

window.renderGradesTable = function() {
  const tbody = document.getElementById('grades-tbody');
  const summary = document.getElementById('grades-summary');
  if (!tbody) return;

  let list = [];
  if (lessonClass && lessonClass.students) {
    list = lessonClass.students;
  } else {
    list = Object.values(students)
      .filter(s => !s.__skip && !s.name.startsWith('__'))
      .map(s => s.name);
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sub" style="text-align:center; padding:24px;">Нет учеников — выберите класс.</td></tr>';
    if (summary) summary.textContent = '';
    return;
  }

  tbody.innerHTML = '';
  list.forEach((name) => {
    const key = name.trim().toLowerCase();
    const cache = gradeCache[key] || {};

    let studentData = null;
    for (const [k, s] of Object.entries(students)) {
      if (k.startsWith('__')) continue;
      if ((s.name || '').trim().toLowerCase() === key) {
        studentData = s;
        break;
      }
    }

    let quizGrade = null;
    if (studentData && studentData.quiz_choice !== null && studentData.quiz_choice !== undefined) {
      if (currentQuizCorrect !== null && currentQuizCorrect !== undefined) {
        quizGrade = (studentData.quiz_choice === currentQuizCorrect) ? 5 : 3;
      }
    }

    const activityGrade = cache.activity || null;
    const journalGrade = cache.journal || null;

    let itog = null;
    const grades = [activityGrade, quizGrade].filter(g => g !== null);
    if (grades.length) {
      itog = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${escapeHtml(name)}</b></td>
      <td>
        <div class="grade-buttons">
          <button class="grade-btn ${activityGrade === 5 ? 'active' : ''}" onclick="setActivityGrade('${key}', 5)">5</button>
          <button class="grade-btn ${activityGrade === 4 ? 'active' : ''}" onclick="setActivityGrade('${key}', 4)">4</button>
          <button class="grade-btn ${activityGrade === 3 ? 'active' : ''}" onclick="setActivityGrade('${key}', 3)">3</button>
        </div>
      </td>
      <td>${quizGrade !== null ? `<span class="grade-badge g${quizGrade}">${quizGrade}</span>` : '<span class="grade-badge gnone">—</span>'}</td>
      <td>${itog !== null ? `<span class="grade-badge g${itog}">${itog}</span>` : '<span class="grade-badge gnone">—</span>'}</td>
      <td>${journalGrade !== null ? `<span class="grade-badge g${journalGrade}">${journalGrade}</span>` : '<span class="grade-badge gnone">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summary) {
    const withGrades = Object.values(gradeCache).filter(c => c.activity || c.journal).length;
    summary.textContent = `Оценено: ${withGrades} / ${list.length}`;
  }
};

window.setActivityGrade = function(key, grade) {
  if (!gradeCache[key]) gradeCache[key] = {};
  gradeCache[key].activity = grade;
  gradeCache[key].journal = grade;
  renderGradesTable();
};

window.exportGradesCsv = function() {
  let csv = 'Ученик,Активность,Тест,Итог,В журнал\n';
  const tbody = document.getElementById('grades-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 5) return;
      const name = cells[0].textContent.trim();
      const activity = cells[1].querySelector('.grade-btn.active')?.textContent.trim() || '';
      const test = cells[2].textContent.trim();
      const itog = cells[3].textContent.trim();
      const journal = cells[4].textContent.trim();
      csv += `"${name}","${activity}","${test}","${itog}","${journal}"\n`;
    });
  }
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lumen-grades.csv';
  a.click();
  URL.revokeObjectURL(url);
};

const origRender = render;
render = function() {
  origRender();
  if (document.getElementById('tab-grades')?.classList.contains('active')) {
    renderGradesTable();
  }
};

// ============================================
// НАСТРОЙКИ (тема + диагностика)
// ============================================
window.setTheme = function(theme) {
  const darkBtn = document.getElementById('theme-dark-btn');
  const lightBtn = document.getElementById('theme-light-btn');
  if (theme === 'light') {
    document.body.classList.add('light');
    localStorage.setItem('theme', 'light');
    if (darkBtn) darkBtn.classList.remove('theme-btn-active');
    if (lightBtn) lightBtn.classList.add('theme-btn-active');
  } else {
    document.body.classList.remove('light');
    localStorage.setItem('theme', 'dark');
    if (lightBtn) lightBtn.classList.remove('theme-btn-active');
    if (darkBtn) darkBtn.classList.add('theme-btn-active');
  }
};

window.openSettings = function() {
  document.getElementById('settings-modal').style.display = 'flex';
  const isLight = document.body.classList.contains('light');
  const darkBtn = document.getElementById('theme-dark-btn');
  const lightBtn = document.getElementById('theme-light-btn');
  if (darkBtn) darkBtn.classList.toggle('theme-btn-active', !isLight);
  if (lightBtn) lightBtn.classList.toggle('theme-btn-active', isLight);
  loadDiagnostics();
};

window.closeSettings = function() {
  document.getElementById('settings-modal').style.display = 'none';
};

async function loadDiagnostics() {
  const content = document.getElementById('diagnostics-content');
  if (!content) return;
  content.innerHTML = '<p class="sub">Загрузка…</p>';
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    let html = '';
    if (data.addresses && data.addresses.length) {
      data.addresses.forEach(addr => {
        const icon = addr.available ? '✅' : '❌';
        const url = addr.url || '—';
        html += `
          <div style="margin-bottom: 8px;">
            ${icon} <b>${escapeHtml(addr.label)}:</b>
            <span style="font-family: Consolas, monospace; color: ${addr.available ? '#7dffb0' : '#6a7290'};">
              ${escapeHtml(url)}
            </span>
            ${addr.note ? `<div style="font-size: 11px; color: #6a7290; margin-left: 20px;">${escapeHtml(addr.note)}</div>` : ''}
          </div>
        `;
      });
    } else {
      html = '<p class="sub">Нет данных</p>';
    }
    const ts = data.ts ? new Date(data.ts * 1000).toLocaleTimeString() : '—';
    html += `<div style="margin-top:10px; font-size:12px; color:#9aa0b4;">Обновлено: ${ts}</div>`;
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = '<p class="sub">Не удалось загрузить диагностику</p>';
  }
}

// ============================================
// ЗАКРЫТИЕ ПАНЕЛИ ПОСЛЕ УРОКА
// ============================================
window.closeSummaryAndTeacher = function() {
  const modal = document.getElementById('summary-modal');
  if (modal) modal.style.display = 'none';
  clearTimeout(window.__autoCloseLessonTimeout);

  if (window.api && window.api.closeTeacher) {
    window.api.closeTeacher();
  } else {
    window.close();
  }
};

// ============================================
// ЗАВЕРШЕНИЕ ВОПРОСА
// ============================================
window.clearQuestion = function() {
  socket.emit('clear_question', { code: CODE });
};

socket.on('question_cleared', () => {
  const currentQ = document.getElementById('current-q');
  if (currentQ) { currentQ.textContent = ''; currentQ.style.display = 'none'; }
  const quizResults = document.getElementById('quiz-results');
  if (quizResults) quizResults.style.display = 'none';
  clearPicked();
});

// ============================================
// СОХРАНЕНИЕ УРОКА И ОЦЕНОК В БД
// ============================================
async function saveLessonAndGrades(summary) {
  if (!window.api || !window.api.createLesson) {
    console.warn('[Save] window.api недоступен — пропускаем сохранение');
    return;
  }
  try {
    const lesson = await window.api.createLesson({
      title: summary.material_title || 'Урок',
      code: CODE,
      material_id: summary.material_id || null,
      class_id: summary.class_id || null,
    });
    currentLessonId = lesson?.id || null;
    if (currentLessonId) {
      await window.api.finishLesson(currentLessonId, {
        total_questions: summary.total_questions || 0,
        total_answers: summary.total_answered || 0,
        avg_green_pct: summary.avg_green_pct || 0,
      });
    }
    if (currentLessonId && Object.keys(gradeCache).length > 0) {
      const gradesMap = {};
      Object.entries(gradeCache).forEach(([key, cache]) => {
        let fullName = key;
        if (lessonClass && lessonClass.students) {
          const found = lessonClass.students.find(n => n.trim().toLowerCase() === key);
          if (found) fullName = found;
        }
        gradesMap[fullName] = {
          activity: cache.activity ?? null,
          test: cache.test ?? null,
          itog: cache.itog ?? null,
          journal: cache.journal ?? null,
        };
      });
      await window.api.saveGradesBulk(currentLessonId, gradesMap);
    }
  } catch (e) {
    console.error('[Save] Ошибка сохранения:', e);
  }
}
// Заполнить ссылку-приглашение (CloudPub или локальная)
function updateInviteLink() {
  const linkEl = document.getElementById('invite-link');
  if (!linkEl) return;
  const base = (typeof CLOUDPUB_URL !== 'undefined' && CLOUDPUB_URL)
    ? CLOUDPUB_URL
    : window.location.origin;
  linkEl.textContent = base + '/join/' + INVITE_TOKEN;
}

// При загрузке
document.addEventListener('DOMContentLoaded', updateInviteLink);

// При обновлении CloudPub URL (если сервер пришлёт событие)
socket.on('cloudpub_update', (data) => {
  if (data && data.url) {
    window.CLOUDPUB_URL = data.url;
    updateInviteLink();
  }
});
function copyInvite() {
  const linkEl = document.getElementById('invite-link');
  const text = linkEl ? linkEl.textContent : '';
  if (!text || text === '—') return;

  navigator.clipboard.writeText(text).then(() => {
    // Анимация кнопки
    const btn = document.getElementById('copy-invite-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅';
      btn.style.background = 'rgba(74, 222, 128, 0.2)';
      btn.style.borderColor = 'rgba(74, 222, 128, 0.6)';
      btn.style.color = '#4ade80';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 1500);
    }
    // Toast
    showCopyToast('✅ Ссылка скопирована!');
  }).catch(() => prompt('Скопируй вручную:', text));
}

// Универсальный toast для копирования
function showCopyToast(message) {
  // Удалить старый, если есть
  const old = document.getElementById('copy-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'copy-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: linear-gradient(135deg, #7c5cff, #4a7dff);
    color: #fff;
    padding: 14px 28px;
    border-radius: 14px;
    font-weight: 700;
    font-size: 14px;
    box-shadow: 0 12px 40px rgba(124, 92, 255, 0.5);
    z-index: 3000;
    opacity: 0;
    transition: opacity 0.3s, transform 0.3s;
    pointer-events: none;
  `;
  document.body.appendChild(toast);

  // Анимация появления
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Исчезновение через 2 сек
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
window.toggleInviteQr = function() {
  const box = document.getElementById('invite-qr-box');
  const img = document.getElementById('invite-qr-img');
  if (!box || !img) {
    console.warn('[QR] Элементы #invite-qr-box или #invite-qr-img не найдены');
    return;
  }
  if (box.style.display === 'none' || box.style.display === '') {
    img.src = '/qr-join/' + INVITE_TOKEN + '?t=' + Date.now();
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
};
window.applyKeywords = function() {
  const kwInput = document.getElementById('keywords-input');
  if (!kwInput) return;
  const kws = kwInput.value.split(',').map(s => s.trim()).filter(Boolean);
  socket.emit('set_keywords', { code: CODE, keywords: kws });
  // Визуальный отклик
  const btn = event && event.target;
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ Применено';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  }
};

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
applyMode('buttons');
applyCounters('buttons', 'understanding');
// Отправка ключевых слов при вводе (Enter или потеря фокуса)
const kwInput = document.getElementById('keywords-input');
if (kwInput) {
  const sendKws = () => {
    const kws = kwInput.value.split(',').map(s => s.trim()).filter(Boolean);
    socket.emit('set_keywords', { code: CODE, keywords: kws });
  };
  kwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendKws(); }
  });
  kwInput.addEventListener('blur', sendKws);
}
// В конце файла, после applyCounters
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light');
  const lightBtn = document.getElementById('theme-light-btn');
  if (lightBtn) lightBtn.classList.add('theme-btn-active');
  const darkBtn = document.getElementById('theme-dark-btn');
  if (darkBtn) darkBtn.classList.remove('theme-btn-active');
}
