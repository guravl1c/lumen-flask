const socket = io();
let KEY = null;
let ANON_NUM = null;
let isAnon = false;
let timerInterval = null;
let handRaised = false;
let currentMode = 'buttons';
let voiceEnabled = false;
let currentQuizOptions = [];
let quizAnswered = false;
let currentScreen = 'waiting';
let toastTimeout = null;

// Теория
let showTheory = false;
let theoryOpen = false;
let theoryLoaded = false;
let pendingQuestion = null; // новый вопрос, пока панель теории открыта

// Голос
let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let recordingStart = 0;
let recordingTimerInterval = null;

const DRAFT_KEY = 'bd_draft_answer';

socket.emit('student_join', { code: CODE, name: NAME });

// ============================================
// СОСТОЯНИЯ ЭКРАНА
// ============================================
function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.st-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// ============================================
// СОБЫТИЯ
// ============================================
socket.on('joined', d => {
  KEY = d.key;
  ANON_NUM = d.anon_num;
  isAnon = d.anonymous;
  currentMode = d.mode || 'buttons';
  voiceEnabled = !!d.voice_enabled;
  showTheory = !!d.show_theory;
  updateGreeting();
  applyMode();
  restoreDraft();

  // Показываем кнопки теории, если учитель разрешил
  if (showTheory) {
    document.getElementById('btn-theory-top').style.display = 'inline-flex';
    document.getElementById('btn-theory-bottom').style.display = 'flex';
  }
  if (d && d.button_set) applyButtonSet(d.button_set);
});

socket.on('question', d => {
  document.getElementById('question-text').textContent = d.question;
  currentMode = d.mode || 'buttons';
  currentQuizOptions = d.quiz_options || [];
  quizAnswered = false;
  document.getElementById('quiz-feedback').textContent = '';

  clearAnswerSelection();
  hidePickedBanner();
  handRaised = false;
  updateHandButtons();
  applyMode();

  // Если панель теории открыта — показываем баннер
  if (theoryOpen) {
    pendingQuestion = d.question;
    showNewQuestionBanner(d.question);
  } else {
    showScreen('question');
  }

  if (d.timer && d.timer > 0) {
    startTimer(d.timer);
  } else {
    stopTimer();
    hideTimer();
  }
  if (d && d.button_set) applyButtonSet(d.button_set);
});

socket.on('mode_update', d => {
  currentMode = d.mode || 'buttons';
  voiceEnabled = !!d.voice_enabled;
  applyMode();
  if (d && d.button_set) applyButtonSet(d.button_set);
});

socket.on('quiz_result', d => {
  const fb = document.getElementById('quiz-feedback');
  if (d.correct) {
    fb.textContent = '✅ Верно!';
    fb.className = 'st-quiz-feedback correct';
  } else {
    fb.textContent = '❌ Неверно';
    fb.className = 'st-quiz-feedback wrong';
  }
});

socket.on('anonymous_mode', d => {
  isAnon = d.anonymous;
  updateGreeting();
});

socket.on('picked_student', d => {
  if (d.key === KEY) showPickedBanner();
  else hidePickedBanner();
});

socket.on('picked_clear', () => hidePickedBanner());

// ============================================
// РЕЖИМЫ
// ============================================
function applyMode() {
  const btnBlock = document.getElementById('answers-buttons');
  const txtBlock = document.getElementById('answers-text');
  const quizBlock = document.getElementById('answers-quiz');

  btnBlock.style.display = 'none';
  txtBlock.style.display = 'none';
  quizBlock.style.display = 'none';

  if (currentMode === 'buttons') {
    btnBlock.style.display = 'flex';
  } else if (currentMode === 'text') {
    txtBlock.style.display = 'block';
  } else if (currentMode === 'both') {
    btnBlock.style.display = 'flex';
    txtBlock.style.display = 'block';
  } else if (currentMode === 'quiz') {
    renderQuizOptions();
    quizBlock.style.display = 'block';
  }

  const voiceBlock = document.getElementById('voice-block');
  if (voiceBlock) {
    const showVoice = (currentMode === 'text' || currentMode === 'both') && voiceEnabled;
    voiceBlock.style.display = showVoice ? 'block' : 'none';
  }
}

function renderQuizOptions() {
  const opts = document.getElementById('quiz-options');
  opts.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  currentQuizOptions.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'st-quiz-option';
    btn.dataset.idx = i;
    btn.innerHTML = `<span class="st-quiz-letter">${letters[i]}</span><span class="st-quiz-text">${escapeHtml(text)}</span>`;
    btn.onclick = () => chooseQuiz(i);
    opts.appendChild(btn);
  });
}

function chooseQuiz(idx) {
  if (!KEY) return;
  socket.emit('answer_quiz', { code: CODE, key: KEY, choice: idx });
  document.querySelectorAll('.st-quiz-option').forEach(b => {
    b.classList.toggle('chosen', parseInt(b.dataset.idx) === idx);
  });
  quizAnswered = true;

  const letters = ['A', 'B', 'C', 'D'];
  const letter = letters[idx] || '?';
  const optionText = (currentQuizOptions[idx] || '').toString();

  showToast('🎲 Ответ отправлен', 'success');
  setTimeout(() => {
    showAnsweredScreen(
      '🎲',
      'Ответ отправлен!',
      'Ты выбрал вариант ' + letter + '. ' + optionText,
      'Ответ нельзя изменить'
    );
  }, 500);
}

// ============================================
// ОТВЕТЫ КНОПКАМИ
// ============================================
function send(color) {
  if (!KEY) return;
  socket.emit('answer', { code: CODE, key: KEY, color });
  markAnswerSelected(color);

  const colorText = {
    understanding: { green: 'Понял', yellow: 'Почти', red: 'Потерялся' },
    yesno:         { green: 'Да',    yellow: 'Нет',   red: 'Не знаю' },
  };
  const set = colorText[currentButtonSet] || colorText.understanding;
  const label = set[color] || color;
  const icon = { green: '✅', yellow: '🤔', red: '💥' }[color] || '✅';

  showToast(icon + ' Отправлено', 'success');
  setTimeout(() => {
    showAnsweredScreen(icon, 'Ответ отправлен!', 'Ты выбрал: ' + label, 'Ответ нельзя изменить');
  }, 400);
}

function markAnswerSelected(color) {
  ['green', 'yellow', 'red'].forEach(c => {
    const btn = document.getElementById('btn-' + c);
    if (!btn) return;
    btn.classList.toggle('selected', c === color);
    btn.classList.toggle('not-selected', c !== color);
  });
}

function clearAnswerSelection() {
  ['green', 'yellow', 'red'].forEach(c => {
    const btn = document.getElementById('btn-' + c);
    if (!btn) return;
    btn.classList.remove('selected', 'not-selected');
  });
}

// ============================================
// ТЕКСТ
// ============================================
function saveDraft() {
  const ta = document.getElementById('answer-text');
  if (!ta) return;
  localStorage.setItem(DRAFT_KEY, ta.value);
  updateCharCount();
}

function restoreDraft() {
  const ta = document.getElementById('answer-text');
  if (!ta) return;
  const saved = localStorage.getItem(DRAFT_KEY);
  if (saved) ta.value = saved;
  updateCharCount();
}

function updateCharCount() {
  const ta = document.getElementById('answer-text');
  const el = document.getElementById('char-count');
  if (!ta || !el) return;
  el.textContent = `${ta.value.length} / 2000`;
}

setTimeout(() => {
  const ta = document.getElementById('answer-text');
  if (ta && !ta._bound) {
    ta._bound = true;
    ta.addEventListener('input', saveDraft);
    restoreDraft();
  }
}, 200);

function sendText() {
  if (!KEY) return;
  const ta = document.getElementById('answer-text');
  const text = ta ? ta.value.trim() : '';
  if (!text) {
    document.getElementById('text-hint').textContent = 'Напиши что-нибудь';
    return;
  }
  socket.emit('answer_text', { code: CODE, key: KEY, text: text });
  document.getElementById('text-hint').textContent = 'Можно дополнить и отправить ещё раз';
  ta.classList.add('sent');
  setTimeout(() => ta.classList.remove('sent'), 1500);
    showToast('📝 Ответ отправлен учителю', 'success');
  document.getElementById('text-hint').textContent = '✅ Ответ отправлен. Можно дополнить.';
}

// ============================================
// ГОЛОС
// ============================================
async function toggleRecording() {
  const btn = document.getElementById('btn-voice-rec');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    recordedBlob = null;
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(recordedBlob);
      const preview = document.getElementById('voice-preview');
      preview.src = audioUrl;
      preview.style.display = 'block';
      document.getElementById('btn-voice-send').style.display = 'block';
      btn.textContent = '🎤 Перезаписать';
      btn.classList.remove('recording');
      document.getElementById('voice-status').textContent = 'Готово. Прослушай и отправь.';
      stopRecordingTimer();
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    recordingStart = Date.now();
    btn.textContent = '⏹ Остановить';
    btn.classList.add('recording');
    document.getElementById('voice-status').textContent = 'Идёт запись…';
    startRecordingTimer();
  } catch (e) {
    document.getElementById('voice-status').textContent = 'Ошибка доступа к микрофону: ' + e.message;
  }
}

function startRecordingTimer() {
  stopRecordingTimer();
  recordingTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - recordingStart) / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    document.getElementById('voice-timer').textContent = `${mm}:${ss}`;
    if (s >= 60) {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }
  }, 200);
}

function stopRecordingTimer() {
  if (recordingTimerInterval) { clearInterval(recordingTimerInterval); recordingTimerInterval = null; }
}

function sendVoice() {
  if (!recordedBlob || !KEY) return;
  const duration = Math.floor((Date.now() - recordingStart) / 1000);
  const reader = new FileReader();
  reader.onloadend = () => {
    socket.emit('answer_voice', { code: CODE, key: KEY, voice: reader.result, duration: duration });
    document.getElementById('voice-status').textContent = '✓ Голосовой отправлен';
    document.getElementById('btn-voice-send').style.display = 'none';
    showToast('📤 Голосовой отправлен', 'success');
  };
  reader.readAsDataURL(recordedBlob);
}

// ============================================
// РУКА
// ============================================
function toggleHand() {
  if (!KEY) return;
  handRaised = !handRaised;
  socket.emit('raise_hand', { code: CODE, key: KEY });
  updateHandButtons();
  if (handRaised) showToast('✋ Рука поднята', 'success');
  else showToast('✋ Рука опущена', '');
}

function updateHandButtons() {
  const btnWaiting = document.getElementById('btn-hand-waiting');
  const btnBottom = document.getElementById('btn-hand-bottom');
  if (btnWaiting) {
    if (handRaised) {
      btnWaiting.classList.add('raised');
      btnWaiting.querySelector('.st-hand-text').textContent = 'Рука поднята';
    } else {
      btnWaiting.classList.remove('raised');
      btnWaiting.querySelector('.st-hand-text').textContent = 'Поднять руку';
    }
  }
  if (btnBottom) {
    btnBottom.classList.toggle('active', handRaised);
    btnBottom.querySelector('.st-nav-label').textContent = handRaised ? 'Опустить' : 'Рука';
  }
}

// ============================================
// ПАНЕЛИ
// ============================================
function togglePanel(name) {
  const panel = document.getElementById('panel-' + name);
  const backdrop = document.getElementById('panel-backdrop');
  if (!panel) return;

  const isOpen = panel.classList.contains('open');
  closePanels();

  if (!isOpen) {
    panel.classList.add('open');
    backdrop.classList.add('show');
    document.querySelectorAll('.st-nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === name);
    });
    if (name === 'theory') {
      theoryOpen = true;
      loadTheory();
    }
  }
}

function closePanels() {
  document.querySelectorAll('.st-panel').forEach(p => p.classList.remove('open'));
  document.getElementById('panel-backdrop').classList.remove('show');
  document.querySelectorAll('.st-nav-btn').forEach(b => {
    if (b.dataset.panel !== 'hand') b.classList.remove('active');
  });
  if (theoryOpen) {
    theoryOpen = false;
    // Если был новый вопрос — переключаемся на него
    if (pendingQuestion) {
      showScreen('question');
      pendingQuestion = null;
      hideNewQuestionBanner();
    }
  }
}

// ============================================
// ТЕОРИЯ
// ============================================
function toggleTheoryPanel() {
  togglePanel('theory');
}

async function loadTheory() {
  const content = document.getElementById('theory-content');
  content.innerHTML = '<p class="st-hint-small">Загрузка…</p>';
  try {
    const res = await fetch('/api/get-lesson-material');
    const material = await res.json();
    if (!material || !material.theory || !material.theory.length) {
      content.innerHTML = '<p class="st-hint-small">Теория пока не добавлена</p>';
      return;
    }
    renderTheory(content, material.theory);
    theoryLoaded = true;
  } catch (e) {
    content.innerHTML = '<p class="st-hint-small">Ошибка загрузки теории</p>';
  }
}

function renderTheory(container, theory) {
  container.innerHTML = '';
  theory.forEach(item => {
    const el = document.createElement('div');
    el.className = 'st-theory-item';

    let body = '';
    if (item.type === 'note') {
      body = `<div class="st-theory-md">${renderMarkdownSimple(item.content || '')}</div>`;
    } else if (item.type === 'link') {
      body = `<a class="st-theory-link" href="${escapeHtml(item.content)}" target="_blank">${escapeHtml(item.content)}</a>`;
    } else if (item.type === 'image') {
      body = `<img class="st-theory-image" src="/theory-file/${item.content}" alt="${escapeHtml(item.title)}" loading="lazy">`;
    } else if (item.type === 'file') {
      const sizeStr = (function(bytes) {
        if (!bytes) return '0 Б';
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' КБ';
        return (bytes/(1024*1024)).toFixed(1) + ' МБ';
      })(item.size || 0);
      body = `<a class="st-theory-file" href="/theory-file/${item.content}" target="_blank">
        <span class="st-theory-file-icon">📎</span>
        <div>
          <div class="st-theory-file-name">${escapeHtml(item.original_name || item.title)}</div>
          <div class="st-theory-file-size">${sizeStr}</div>
        </div>
      </a>`;
    }

    el.innerHTML = `
      <div class="st-theory-title">${escapeHtml(item.title || '')}</div>
      ${body}
    `;
    container.appendChild(el);
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
// БАННЕР «НОВЫЙ ВОПРОС»
// ============================================
function showNewQuestionBanner(questionText) {
  const banner = document.getElementById('new-question-banner');
  document.getElementById('nqb-question').textContent = questionText;
  banner.style.display = 'flex';
}

function hideNewQuestionBanner() {
  document.getElementById('new-question-banner').style.display = 'none';
}

function goToQuestion() {
  hideNewQuestionBanner();
  closePanels();
  pendingQuestion = null;
  showScreen('question');
}

// ============================================
// ВОПРОС УЧИТЕЛЮ
// ============================================
function sendQuestion() {
  const input = document.getElementById('student-q-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('student_question', { code: CODE, key: KEY, text: text });
  input.value = '';
  const st = document.getElementById('q-status');
  st.textContent = '✓ Вопрос отправлен анонимно';
  showToast('💬 Вопрос отправлен', 'success');
  setTimeout(() => {
    st.textContent = '';
    closePanels();
  }, 1500);
}

const sq = document.getElementById('student-q-input');
if (sq) sq.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendQuestion();
});

// ============================================
// РЕАКЦИИ
// ============================================
function sendReaction(emoji) {
  if (!KEY) return;
  socket.emit('reaction', { code: CODE, key: KEY, emoji: emoji });
  const btn = document.querySelector(`.st-reaction-btn[onclick="sendReaction('${emoji}')"]`);
  if (btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 300);
  }
  showToast(emoji + ' Отправлено', 'success');
}

// ============================================
// ТАЙМЕР
// ============================================
function startTimer(seconds) {
  stopTimer();
  const box = document.getElementById('timer-display');
  const num = document.getElementById('timer-num');
  box.style.display = 'inline-flex';
  box.classList.remove('expired', 'warning');
  let left = seconds;
  num.textContent = left;

  timerInterval = setInterval(() => {
    left--;
    if (left <= 0) {
      box.classList.add('expired');
      num.textContent = '💥';
      setButtonsEnabled(false);
      stopTimer();
    } else {
      num.textContent = left;
      if (left <= 5) box.classList.add('warning');
      else box.classList.remove('warning');
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function hideTimer() {
  const box = document.getElementById('timer-display');
  if (box) { box.style.display = 'none'; box.classList.remove('expired', 'warning'); }
}

function setButtonsEnabled(enabled) {
  ['btn-green', 'btn-yellow', 'btn-red'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// ============================================
// БАННЕР «ТЫ ОТВЕЧАЕШЬ»
// ============================================
function showPickedBanner() {
  const b = document.getElementById('picked-banner');
  if (b) b.style.display = 'block';
}
function hidePickedBanner() {
  const b = document.getElementById('picked-banner');
  if (b) b.style.display = 'none';
}

// ============================================
// ПРИВЕТСТВИЕ
// ============================================
function updateGreeting() {
  const el = document.getElementById('greeting');
  if (!el) return;
  if (isAnon && ANON_NUM !== null) {
    el.textContent = 'Ученик ' + ANON_NUM;
  } else {
    el.textContent = NAME;
  }
}

// ============================================
// TOAST
// ============================================
function showToast(text, type) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  if (!toast || !toastText) return;
  toastText.textContent = text;
  toast.className = 'st-toast show' + (type ? ' ' + type : '');
  toast.style.display = 'flex';
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 2500);
}

// ============================================
// ФОКУС / УХОД
// ============================================
document.addEventListener('visibilitychange', () => {
  if (!KEY) return;
  socket.emit('focus_change', { code: CODE, key: KEY, focused: !document.hidden });
});

window.addEventListener('beforeunload', () => {
  if (!KEY) return;
  socket.emit('student_left', { code: CODE, key: KEY });
});

// ============================================
// УТИЛИТЫ
// ============================================
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
// ============================================
// ВОЗВРАТ НА ЭКРАН ОЖИДАНИЯ (после завершения вопроса)
// ============================================
socket.on('question_cleared', () => {
  // Скрыть все экраны
  document.querySelectorAll('.st-screen').forEach(s => s.classList.remove('active'));
  // Показать экран ожидания
  const waiting = document.getElementById('screen-waiting');
  if (waiting) waiting.classList.add('active');

  // Сбросить текст вопроса
  const qText = document.getElementById('question-text');
  if (qText) qText.textContent = '—';

  // Сбросить выбранные ответы
  document.querySelectorAll('.st-answer').forEach(a => {
    a.classList.remove('selected', 'not-selected');
    a.disabled = false;
  });

  // Сбросить quiz
  document.querySelectorAll('.st-quiz-option').forEach(o => {
    o.classList.remove('chosen');
  });
  const feedback = document.getElementById('quiz-feedback');
  if (feedback) {
    feedback.textContent = '';
    feedback.classList.remove('correct', 'wrong');
  }

  // Скрыть баннер "Ты отвечаешь"
  const banner = document.getElementById('picked-banner');
  if (banner) banner.style.display = 'none';

  // Сбросить timer
  const timerDisplay = document.getElementById('timer-display');
  if (timerDisplay) timerDisplay.style.display = 'none';

  // Сбросить text-блок
  const textBlock = document.getElementById('answers-text');
  if (textBlock) textBlock.style.display = 'none';
  const textArea = document.getElementById('answer-text');
  if (textArea) {
    textArea.value = '';
    textArea.classList.remove('sent');
  }

  // Сбросить кнопки ответов — скрыть их
  const answerButtons = document.getElementById('answers-buttons');
  if (answerButtons) answerButtons.style.display = 'none';
});
function showAnsweredScreen(icon, title, sub, hint) {
  document.querySelectorAll('.st-screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-answered');
  if (!screen) return;
  screen.classList.add('active');

  const iconEl = document.getElementById('answered-icon');
  const titleEl = document.getElementById('answered-title');
  const subEl = document.getElementById('answered-text');
  const hintEl = document.getElementById('answered-hint');

  if (iconEl) iconEl.textContent = icon || '✅';
  if (titleEl) titleEl.textContent = title || 'Ответ отправлен!';
  if (subEl) subEl.textContent = sub || '';
  if (hintEl) hintEl.textContent = hint || '';
}
let currentButtonSet = 'understanding';

function applyButtonSet(buttonSet) {
  currentButtonSet = buttonSet || 'understanding';
  const labels = {
    understanding: {
      green:  { emoji: '✅', text: 'Понял' },
      yellow: { emoji: '🤔', text: 'Почти' },
      red:    { emoji: '💥', text: 'Потерялся' },
    },
    yesno: {
      green:  { emoji: '✅', text: 'Да' },
      yellow: { emoji: '🤔', text: 'Нет' },
      red:    { emoji: '💥', text: 'Не знаю' },
    },
  };
  const set = labels[currentButtonSet] || labels.understanding;
  ['green', 'yellow', 'red'].forEach(color => {
    const emojiEl = document.getElementById('btn-' + color + '-emoji');
    const textEl = document.getElementById('btn-' + color + '-text');
    if (emojiEl) emojiEl.textContent = set[color].emoji;
    if (textEl) textEl.textContent = set[color].text;
  });
}