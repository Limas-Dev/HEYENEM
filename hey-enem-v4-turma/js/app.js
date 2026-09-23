import { TOTAL_QUESTIONS, LETTERS } from './examConfig.js';
import {
  compareAnswers,
  calculateStudentResult,
  buildClassStatistics,
  parseAnswerKeyText,
  makeStudentId
} from './correctionEngine.js';
import { analyzeSheet } from './gemini.js';

const $ = id => document.getElementById(id);

const state = {
  answerKey: [],
  queue: [],
  students: [],
  activeStudentId: null,
  activeTab: 'class',
  busy: false,
  classStats: null
};

let objectUrls = new Map();
let toastTimer = null;

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  loadPersistedState();
  renderKeyGrid();
  renderQueue();
  bindEvents();
  updateKeyCounter();
  updateProcessButton();
  renderAll();
  setStep(0);
  closeLoading();
});

function cacheDom() {
  const ids = [
    'apiKey','saveApiKey','apiStatus',
    'keyCounter','keyGrid','keyPaste','keyError','fillExample','clearKey',
    'fileInput','dropzone','fileQueue','queueCount','clearFiles','processBatch',
    'batchProgress','batchProgressText','batchProgressPercent','batchProgressBar',
    'loading','loadingText','loadingBar',
    'toast','toastMessage','clearAll','brandHome',
    'resultsSection','tabClass','tabStudents','classDashboard','studentsDashboard',
    'classMeta','classStudents','classAverage','classCorrectAvg','classConfidence',
    'scoreDistribution','classResponseProfile',
    'easyQuestions','mediumQuestions','hardQuestions','noDataQuestions',
    'questionDifficulty','studentsTableBody','studentDashboard','printClass'
  ];

  ids.forEach(id => { window.__dom = window.__dom || {}; window.__dom[id] = $(id); });
}

const dom = new Proxy({}, {
  get(_, prop) {
    return window.__dom?.[prop];
  }
});

/* ============================================================
   PERSISTÊNCIA
   ============================================================ */

function loadPersistedState() {
  try {
    const saved = localStorage.getItem('hey-enem-class-v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.answerKey) && parsed.answerKey.length === TOTAL_QUESTIONS) {
        state.answerKey = parsed.answerKey;
      }
      if (Array.isArray(parsed.students)) {
        state.students = parsed.students;
      }
    }

    const key = localStorage.getItem('hey-enem-gemini-key');
    if (key && dom.apiKey) {
      dom.apiKey.value = key;
      setApiStatus(true);
    }
  } catch (error) {
    console.warn('Falha ao restaurar dados:', error);
  }
}

function persistState() {
  try {
    localStorage.setItem('hey-enem-class-v1', JSON.stringify({
      answerKey: state.answerKey,
      students: state.students
    }));
  } catch (error) {
    console.warn('Falha ao persistir dados:', error);
  }
}

/* ============================================================
   EVENTOS
   ============================================================ */

function bindEvents() {
  dom.saveApiKey?.addEventListener('click', saveApiKey);
  dom.apiKey?.addEventListener('input', () => setApiStatus(false));

  dom.keyGrid?.addEventListener('change', event => {
    if (!event.target.matches('select[data-question]')) return;
    state.answerKey = readGridAnswers();
    syncKeyText();
    updateKeyCounter();
    updateProcessButton();
    persistState();
  });

  dom.keyPaste?.addEventListener('input', event => {
    const parsed = parseAnswerKeyText(event.target.value);
    if (parsed.length === TOTAL_QUESTIONS && parsed.every(Boolean)) {
      state.answerKey = parsed;
      renderKeyGrid();
      updateKeyCounter();
      updateProcessButton();
      persistState();
    }
  });

  dom.fillExample?.addEventListener('click', () => {
    state.answerKey = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => LETTERS[i % LETTERS.length]);
    renderKeyGrid();
    updateKeyCounter();
    updateProcessButton();
    persistState();
    showToast('Exemplo de gabarito preenchido.', 'success');
  });

  dom.clearKey?.addEventListener('click', () => {
    state.answerKey = [];
    renderKeyGrid();
    updateKeyCounter();
    updateProcessButton();
    persistState();
  });

  dom.fileInput?.addEventListener('change', event => {
    addFiles([...event.target.files]);
    event.target.value = '';
  });

  dom.dropzone?.addEventListener('click', () => dom.fileInput?.click());
  dom.dropzone?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dom.fileInput?.click();
    }
  });
  dom.dropzone?.addEventListener('dragover', event => {
    event.preventDefault();
    dom.dropzone.classList.add('drag');
  });
  dom.dropzone?.addEventListener('dragleave', () => dom.dropzone.classList.remove('drag'));
  dom.dropzone?.addEventListener('drop', event => {
    event.preventDefault();
    dom.dropzone.classList.remove('drag');
    addFiles([...event.dataTransfer.files]);
  });

  dom.clearFiles?.addEventListener('click', clearFiles);
  dom.processBatch?.addEventListener('click', processBatch);
  dom.clearAll?.addEventListener('click', clearAllData);
  dom.printClass?.addEventListener('click', () => window.print());

  dom.tabClass?.addEventListener('click', () => showTab('class'));
  dom.tabStudents?.addEventListener('click', () => showTab('students'));

  dom.brandHome?.addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ============================================================
   API KEY
   ============================================================ */

function getApiKey() {
  const field = String(dom.apiKey?.value || '').trim();
  if (field) return field;
  try { return String(localStorage.getItem('hey-enem-gemini-key') || '').trim(); }
  catch { return ''; }
}

function saveApiKey() {
  const key = String(dom.apiKey?.value || '').trim();
  if (!key) {
    setApiStatus(false, 'Cole uma API Key primeiro.');
    return;
  }

  try {
    localStorage.setItem('hey-enem-gemini-key', key);
    setApiStatus(true);
    showToast('API Key salva neste navegador.', 'success');
  } catch {
    setApiStatus(false, 'Não foi possível salvar a chave.');
  }
}

function setApiStatus(ok, message = '') {
  if (!dom.apiStatus) return;
  dom.apiStatus.classList.toggle('ok', ok);
  dom.apiStatus.textContent = ok ? '✓ API Key configurada' : (message || '🔐 API Key não validada');
}

/* ============================================================
   GABARITO
   ============================================================ */

function renderKeyGrid() {
  dom.keyGrid.innerHTML = '';

  for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
    const item = document.createElement('div');
    item.className = 'key-item';
    item.innerHTML = `
      <label>${String(i).padStart(2, '0')}</label>
      <select data-question="${i}" aria-label="Gabarito questão ${i}">
        <option value="">—</option>
        ${LETTERS.map(letter => `<option value="${letter}">${letter}</option>`).join('')}
      </select>
    `;

    const answer = state.answerKey[i - 1];
    if (answer) item.querySelector('select').value = answer;
    dom.keyGrid.appendChild(item);
  }

  syncKeyText();
}

function readGridAnswers() {
  return [...dom.keyGrid.querySelectorAll('select[data-question]')]
    .sort((a, b) => Number(a.dataset.question) - Number(b.dataset.question))
    .map(select => LETTERS.includes(select.value) ? select.value : null);
}

function syncKeyText() {
  if (!dom.keyPaste) return;
  if (state.answerKey.length === TOTAL_QUESTIONS && state.answerKey.every(Boolean)) {
    dom.keyPaste.value = state.answerKey.join(' ');
  }
}

function updateKeyCounter() {
  const filled = state.answerKey.filter(Boolean).length;
  if (dom.keyCounter) dom.keyCounter.textContent = `${filled}/90 preenchidas`;
  if (dom.keyError) dom.keyError.hidden = filled === TOTAL_QUESTIONS;
}

/* ============================================================
   FILES
   ============================================================ */

function isValidImage(file) {
  if (!file) return false;
  return file.type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name || '');
}

function addFiles(files) {
  const images = files.filter(isValidImage);
  if (!images.length) {
    showToast('Nenhuma imagem válida foi selecionada.', 'error');
    return;
  }

  images.forEach(file => {
    state.queue.push({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      status: 'pending',
      error: ''
    });
  });

  renderQueue();
  updateProcessButton();
  showToast(`${images.length} cartão${images.length === 1 ? '' : 'ões'} adicionado${images.length === 1 ? '' : 's'}.`, 'success');
}

function renderQueue() {
  if (dom.queueCount) dom.queueCount.textContent = state.queue.length;
  if (!dom.fileQueue) return;

  dom.fileQueue.innerHTML = '';

  if (!state.queue.length) {
    dom.fileQueue.innerHTML = '<div class="empty-queue">Nenhum cartão selecionado.</div>';
    return;
  }

  state.queue.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `
      <div class="file-index">${index + 1}</div>
      <div class="file-info">
        <b>${escapeHtml(item.name)}</b>
        <span>${formatBytes(item.size)}</span>
        ${item.error ? `<small class="file-error">${escapeHtml(item.error)}</small>` : ''}
      </div>
      <div class="file-status ${item.status}">${queueStatus(item.status)}</div>
    `;
    dom.fileQueue.appendChild(row);
  });
}

function queueStatus(status) {
  return {
    pending: 'Aguardando',
    processing: 'Processando',
    done: 'Concluído',
    error: 'Erro'
  }[status] || status;
}

function clearFiles() {
  if (state.busy) return;
  state.queue = [];
  renderQueue();
  updateProcessButton();
}

/* ============================================================
   PROCESSAMENTO
   ============================================================ */

function updateProcessButton() {
  if (!dom.processBatch) return;
  const keyReady = state.answerKey.length === TOTAL_QUESTIONS && state.answerKey.every(Boolean);
  const filesReady = state.queue.some(item => item.status === 'pending' || item.status === 'error');
  dom.processBatch.disabled = state.busy || !keyReady || !filesReady;
  dom.processBatch.textContent = state.busy ? 'PROCESSANDO...' : 'PROCESSAR GABARITOS';
}

async function processBatch() {
  if (state.busy) return;

  if (!state.answerKey.length || state.answerKey.length !== TOTAL_QUESTIONS || !state.answerKey.every(Boolean)) {
    dom.keyError.hidden = false;
    dom.keyError.textContent = 'O gabarito precisa ter exatamente 90 respostas.';
    showToast('Preencha as 90 respostas do gabarito.', 'error');
    return;
  }

  if (!getApiKey()) {
    showToast('Configure a Gemini API Key antes de processar.', 'error');
    dom.apiKey?.focus();
    return;
  }

  const targets = state.queue.filter(item => item.status === 'pending' || item.status === 'error');
  if (!targets.length) return;

  state.busy = true;
  showBatchProgress(targets.length);
  setStep(2);

  let processed = 0;

  try {
    for (const item of targets) {
      item.status = 'processing';
      item.error = '';
      renderQueue();

      setLoading(true, `Analisando cartão ${processed + 1} de ${targets.length}...`, ((processed / targets.length) * 100));

      try {
        const vision = await analyzeSheet(item.file);
        const answers = vision.questions.map(q => q.answer);
        const confidence = vision.questions.map(q => q.confidence);
        const items = compareAnswers(state.answerKey, answers, confidence);
        const stats = calculateStudentResult(items);

        const student = buildStudentRecord(item, vision, items, stats);
        upsertStudent(student);
        item.status = 'done';
      } catch (error) {
        console.error(error);
        item.status = 'error';
        item.error = error?.message || 'Não foi possível processar este cartão.';
      }

      processed++;
      updateBatchProgress(processed, targets.length);
      renderQueue();
      renderAll();
      persistState();
    }

    showTab('class');
    showToast('Todos os cartões da fila foram processados.', 'success');
  } finally {
    state.busy = false;
    setLoading(false, '', 100);
    updateProcessButton();
    renderAll();
    persistState();
  }
}

function buildStudentRecord(item, vision, items, stats) {
  const name = String(vision.student?.name || '').trim() || 'Aluno não identificado';
  const document = String(vision.student?.document || '').trim() || 'Não identificado';
  const registration = String(vision.student?.registration || '').trim() || 'Não identificada';

  const id = makeStudentId({
    name,
    document,
    sourceFile: item.name
  });

  return {
    id,
    name,
    document,
    registration,
    sourceFile: item.name,
    sheetQuality: vision.sheetQuality || 'acceptable',
    notes: vision.notes || '',
    correct: stats.correct,
    wrong: stats.wrong,
    blank: stats.blank,
    ambiguous: stats.ambiguous,
    identified: stats.identified,
    confidence: stats.confidence,
    percentage: stats.percentage,
    items
  };
}

function upsertStudent(student) {
  const index = state.students.findIndex(existing => existing.id === student.id);
  if (index >= 0) state.students[index] = student;
  else state.students.push(student);
}

/* ============================================================
   PROGRESSO
   ============================================================ */

function showBatchProgress(total) {
  dom.batchProgress.hidden = false;
  updateBatchProgress(0, total);
}

function updateBatchProgress(done, total) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  dom.batchProgressText.textContent = `${done}/${total} processados`;
  dom.batchProgressPercent.textContent = `${percent}%`;
  dom.batchProgressBar.style.width = `${percent}%`;
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderAll() {
  state.classStats = buildClassStatistics(state.students, state.answerKey);
  renderClassDashboard();
  renderStudentsTable();

  if (state.activeStudentId) {
    renderStudentDashboard(state.activeStudentId);
  }

  if (state.activeTab === 'class') showTab('class');
  else showTab('students');

  const hasStudents = state.students.length > 0;
  dom.resultsSection.hidden = !hasStudents;
}

function renderClassDashboard() {
  const stats = state.classStats;
  if (!stats) return;

  dom.classStudents.textContent = stats.students;
  dom.classAverage.textContent = `${formatNumber(stats.average)}%`;
  dom.classCorrectAvg.textContent = formatNumber(stats.averageCorrect);
  dom.classConfidence.textContent = `${formatNumber(stats.averageConfidence * 100)}%`;
  dom.classMeta.textContent = `${stats.students} aluno${stats.students === 1 ? '' : 's'} processado${stats.students === 1 ? '' : 's'} • 90 questões • dificuldade baseada em acertos × erros`;

  renderScoreDistribution(stats);
  renderResponseProfile(stats);
  renderQuestionDifficulty(stats);
}

function renderScoreDistribution(stats) {
  dom.scoreDistribution.innerHTML = stats.distribution.map(bucket => `
    <div class="score-row">
      <label>${bucket.label}</label>
      <div><i style="width:${stats.students ? (bucket.count / stats.students) * 100 : 0}%"></i></div>
      <span>${bucket.count}</span>
    </div>
  `).join('');
}

function renderResponseProfile(stats) {
  const n = stats.students || 1;
  dom.classResponseProfile.innerHTML = `
    <div class="profile-card"><span>ACERTOS</span><b>${formatNumber(stats.totalCorrect / n)}</b></div>
    <div class="profile-card"><span>ERROS</span><b>${formatNumber(stats.totalWrong / n)}</b></div>
    <div class="profile-card"><span>BRANCOS</span><b>${formatNumber(stats.totalBlank / n)}</b></div>
    <div class="profile-card"><span>INCERTAS</span><b>${formatNumber(stats.totalAmbiguous / n)}</b></div>
  `;
}

function renderQuestionDifficulty(stats) {
  const counts = stats.difficultyCounts;

  dom.easyQuestions.textContent = counts.easy;
  dom.mediumQuestions.textContent = counts.medium;
  dom.hardQuestions.textContent = counts.hard;
  dom.noDataQuestions.textContent = counts.none;

  dom.questionDifficulty.innerHTML = stats.questions.map(q => `
    <article class="difficulty-item ${q.difficulty}">
      <div class="dq-number">Q${String(q.question).padStart(2, '0')}</div>
      <div class="dq-main">
        <b>${difficultyLabel(q.difficulty)}</b>
        <span>${q.correct} acerto${q.correct === 1 ? '' : 's'} • ${q.wrong} erro${q.wrong === 1 ? '' : 's'} • ${q.blank + q.ambiguous} sem leitura válida</span>
      </div>
      <div class="dq-rate">
        <b>${formatNumber(q.correctRate)}%</b>
        <span>${q.answered} respondidas</span>
      </div>
    </article>
  `).join('');
}

function renderStudentsTable() {
  const students = [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  dom.studentsTableBody.innerHTML = students.map((student, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        <button class="student-name-button" data-student-id="${escapeAttr(student.id)}" type="button">
          ${escapeHtml(student.name)}
        </button>
      </td>
      <td>${escapeHtml(student.document)}</td>
      <td>${escapeHtml(student.registration)}</td>
      <td class="student-score">${formatNumber(student.percentage)}%</td>
      <td>${student.correct}</td>
      <td>${student.wrong}</td>
    </tr>
  `).join('');

  dom.studentsTableBody.querySelectorAll('[data-student-id]').forEach(button => {
    button.addEventListener('click', () => openStudent(button.dataset.studentId));
  });
}

function openStudent(id) {
  state.activeStudentId = id;
  state.activeTab = 'students';
  showTab('students');
  renderStudentDashboard(id);
  dom.studentDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStudentDashboard(id) {
  const student = state.students.find(item => item.id === id);
  if (!student) {
    dom.studentDashboard.hidden = true;
    return;
  }

  dom.studentDashboard.hidden = false;

  const scoreDeg = `${student.percentage * 3.6}deg`;

  dom.studentDashboard.innerHTML = `
    <div class="student-top">
      <div class="student-avatar" style="--student-score:${scoreDeg}">
        <div class="student-avatar-content">
          <b>${formatNumber(student.percentage)}%</b>
          <span>NOTA NA PROVA</span>
        </div>
      </div>

      <div class="student-info">
        <small>DASHBOARD INDIVIDUAL</small>
        <h3>${escapeHtml(student.name)}</h3>
        <p>Documento: <strong>${escapeHtml(student.document)}</strong></p>
        <p>Matrícula: <strong>${escapeHtml(student.registration)}</strong></p>
        <p>Cartão: <strong>${escapeHtml(student.sourceFile)}</strong></p>
      </div>
    </div>

    <div class="student-stats">
      <div class="student-stat"><small>MÉDIA NA PROVA</small><b>${formatNumber(student.percentage)}%</b></div>
      <div class="student-stat"><small>ACERTOS</small><b>${student.correct}</b></div>
      <div class="student-stat"><small>ERROS</small><b>${student.wrong}</b></div>
      <div class="student-stat"><small>CONFIANÇA</small><b>${formatNumber(student.confidence * 100)}%</b></div>
    </div>

    <article class="panel individual-map">
      <div class="panel-head">
        <div>
          <small>MAPA INDIVIDUAL</small>
          <h3>90 questões do aluno</h3>
          <p>A dificuldade mostrada em cada questão é a dificuldade calculada pela turma.</p>
        </div>
      </div>

      <div class="individual-question-grid">
        ${student.items.map(item => {
          const classQuestion = state.classStats?.questions?.[item.question - 1];
          return `
            <article class="individual-question ${item.status}">
              <div class="iq-top">
                <span class="iq-number">Q${String(item.question).padStart(2, '0')}</span>
                <span class="iq-status">${statusSymbol(item.status)}</span>
              </div>
              <div class="iq-answer">${item.answer || '—'}</div>
              <div class="iq-key">Gabarito: ${item.key || '—'}</div>
              <div class="iq-confidence">${classQuestion ? difficultyLabel(classQuestion.difficulty) : '—'} • ${Math.round(item.confidence * 100)}%</div>
            </article>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

/* ============================================================
   TABS
   ============================================================ */

function showTab(tab) {
  state.activeTab = tab;

  const classMode = tab === 'class';
  dom.tabClass.classList.toggle('active', classMode);
  dom.tabStudents.classList.toggle('active', !classMode);
  dom.classDashboard.hidden = !classMode;
  dom.studentsDashboard.hidden = classMode;
}

/* ============================================================
   RESET
   ============================================================ */

function clearAllData() {
  if (state.busy) return;

  const confirmed = window.confirm('Limpar gabarito, alunos e resultados da turma?');
  if (!confirmed) return;

  state.answerKey = [];
  state.queue = [];
  state.students = [];
  state.activeStudentId = null;
  state.classStats = null;

  try {
    localStorage.removeItem('hey-enem-class-v1');
  } catch {}

  renderKeyGrid();
  renderQueue();
  renderAll();
  updateKeyCounter();
  updateProcessButton();
  showTab('class');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   UI AUXILIAR
   ============================================================ */

function setStep(step) {
  document.querySelectorAll('.step').forEach((el, index) => {
    el.classList.toggle('active', index <= step);
    el.classList.toggle('current', index === step);
  });
}

function setLoading(show, text = '', progress = 0) {
  dom.loading.hidden = !show;
  if (text) dom.loadingText.textContent = text;
  dom.loadingBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function closeLoading() {
  if (dom.loading) dom.loading.hidden = true;
}

function statusSymbol(status) {
  return {
    correct: '✓',
    wrong: '×',
    blank: '—',
    ambiguous: '?'
  }[status] || '•';
}

function difficultyLabel(value) {
  return {
    easy: 'Fácil',
    medium: 'Média',
    hard: 'Difícil',
    none: 'Sem dados'
  }[value] || 'Sem dados';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function showToast(message, type = 'info') {
  if (!dom.toast) return;
  dom.toastMessage.textContent = message;
  dom.toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.className = 'toast';
  }, 3600);
}

/* ============================================================
   DEBUG
   ============================================================ */

window.HEY_ENEM = {
  state,
  processBatch,
  renderAll,
  openStudent,
  buildClassStatistics: () => buildClassStatistics(state.students, state.answerKey)
};
