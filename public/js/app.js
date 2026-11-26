import {
  AI_CLOSING_TEMPLATES,
  AI_DETAIL_LEVELS,
  AI_ENDING_TONES,
  CLAUDE_MODELS,
  cloneDefaultFields,
  DEFAULT_AI_SETTINGS,
  FIELD_ROLES,
  GEMINI_MODELS,
  GENERATION_STYLES,
  WEBLLM_MODELS,
} from './defaults.js';
import {
  buildAiPrompt,
  calcNeisBytes,
  generateSeteuk,
  getWebLlmState,
  loadWebLlmModel,
  NEIS_BYTE_LIMIT,
  refineWithClaude,
  refineWithGemini,
  refineWithWebLlm,
  unloadWebLlm,
} from './generator.js';
import {
  api,
  buildGasUrlFromId,
  encodeCourseConfig,
  extractGasScriptId,
  getAiSettings,
  getGasUrl,
  saveAiSettings,
  setGasUrl,
  setRuntimeGasUrl,
  testGasConnection,
} from './storage.js';

// ============================================================================
// Utilities
// ============================================================================

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'default') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'opacity 180ms ease, transform 180ms ease';
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function getGeminiKey() {
  return localStorage.getItem('speciality_gemini_api_key') || '';
}

function setGeminiKey(key) {
  const trimmed = key.trim();
  if (trimmed) {
    localStorage.setItem('speciality_gemini_api_key', trimmed);
  } else {
    localStorage.removeItem('speciality_gemini_api_key');
  }
}

function getClaudeKey() {
  return localStorage.getItem('speciality_claude_api_key') || '';
}

function setClaudeKey(key) {
  const trimmed = key.trim();
  if (trimmed) {
    localStorage.setItem('speciality_claude_api_key', trimmed);
  } else {
    localStorage.removeItem('speciality_claude_api_key');
  }
}

function getDefaultBaseUrl() {
  if (
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
    getGasUrl()
  ) {
    return 'https://aks-sci-lab.github.io/speciality';
  }
  const path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '');
  return `${window.location.origin}${path}`;
}

function getPreferredOrigin() {
  return localStorage.getItem('speciality_qr_origin') || getDefaultBaseUrl();
}

function setPreferredOrigin(origin) {
  const clean = origin.trim().replace(/\/+$/, '');
  if (clean) {
    localStorage.setItem('speciality_qr_origin', clean);
  } else {
    localStorage.removeItem('speciality_qr_origin');
  }
}

function buildStudentUrl(course, customOrigin, includeCfg = false) {
  const base = (customOrigin || getPreferredOrigin()).replace(/\/+$/, '');
  const courseId = typeof course === 'string' ? course : course.id;
  let url = `${base}/?course=${encodeURIComponent(courseId)}`;
  const gasScriptId = extractGasScriptId(getGasUrl());
  if (gasScriptId) {
    url += `&gs=${encodeURIComponent(gasScriptId)}`;
  } else if (includeCfg && typeof course === 'object') {
    url += `&cfg=${encodeURIComponent(encodeCourseConfig(course))}`;
  }
  return url;
}

// ============================================================================
// Application Entry Router
// ============================================================================

const params = new URLSearchParams(window.location.search);
const studentCourseId = params.get('course');
const studentCfgParam = params.get('cfg');
const studentGsParam = params.get('gs');

if (studentCourseId) {
  if (studentGsParam) {
    setRuntimeGasUrl(buildGasUrlFromId(studentGsParam));
  }
  initStudentApp(studentCourseId, studentCfgParam);
} else {
  initTeacherApp();
}

// ============================================================================
// 1. STUDENT QR ENTRY APP (No 세특 preview, No teacher UI)
// ============================================================================

async function initStudentApp(courseId, cfgParam) {
  try {
    const course = await api.getCourse(courseId, cfgParam);
    document.title = `${course.title} · 학습 활동 기록`;
    renderStudentForm(course);
  } catch (err) {
    document.title = '과목을 찾을 수 없습니다';
    appRoot.innerHTML = `
      <main class="student-page">
        <div class="student-container">
          <div class="student-done-card">
            <h1>접속할 수 없는 페이지입니다</h1>
            <p>${escapeHtml(err.message || '올바른 QR코드인지 선생님께 확인해 주세요.')}</p>
          </div>
        </div>
      </main>
    `;
  }
}

function renderStudentForm(course) {
  if (!course.isOpen) {
    appRoot.innerHTML = `
      <main class="student-page">
        <div class="student-container">
          <div class="student-header-card">
            <div>
              ${course.isJointCurriculum ? '<span class="badge badge-amber">공동교육과정</span>' : ''}
              <span class="badge badge-muted">제출 마감</span>
            </div>
            <h1>${escapeHtml(course.title)}</h1>
            <p>현재 이 과목의 응답 수집이 마감되었습니다. 추가 제출이 필요한 경우 담당 선생님께 문의해 주세요.</p>
          </div>
        </div>
      </main>
    `;
    return;
  }

  const fieldsHtml = course.fields
    .map((field, idx) => {
      const reqMark = field.required ? '<span class="req-star" aria-label="필수">*</span>' : '';
      const reqAttr = field.required ? 'required' : '';
      let inputHtml = '';

      if (field.type === 'text') {
        inputHtml = `<input
          id="field-${escapeHtml(field.id)}"
          name="${escapeHtml(field.id)}"
          type="text"
          class="input"
          placeholder="${escapeHtml(field.placeholder || '')}"
          ${reqAttr}
        />`;
      } else if (field.type === 'select') {
        const opts = (field.options || [])
          .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
          .join('');
        inputHtml = `<select id="field-${escapeHtml(field.id)}" name="${escapeHtml(field.id)}" class="select" ${reqAttr}>
          <option value="">선택해 주세요</option>
          ${opts}
        </select>`;
      } else {
        inputHtml = `<textarea
          id="field-${escapeHtml(field.id)}"
          name="${escapeHtml(field.id)}"
          class="textarea"
          rows="3"
          placeholder="${escapeHtml(field.placeholder || '')}"
          ${reqAttr}
        ></textarea>`;
      }

      return `
        <div class="student-question">
          <label class="student-question-label" for="field-${escapeHtml(field.id)}">
            <span class="q-num">${String(idx + 1).padStart(2, '0')}</span>
            <span>${escapeHtml(field.label)}</span>
            ${reqMark}
          </label>
          ${inputHtml}
        </div>
      `;
    })
    .join('');

  appRoot.innerHTML = `
    <main class="student-page">
      <div class="student-container">
        <header class="student-header-card">
          <div>
            ${course.isJointCurriculum ? '<span class="badge badge-amber">공동교육과정</span>' : ''}
            <span class="badge badge-primary">학생 활동 입력</span>
          </div>
          <h1>${escapeHtml(course.title)}</h1>
          ${course.description ? `<p>${escapeHtml(course.description)}</p>` : ''}
        </header>

        <form id="student-form" class="student-form-card">
          <div class="student-section-title">기본 정보</div>
          <div class="form-grid-2">
            <div class="field-group">
              <label for="student-id">학번 <span class="req-star">*</span></label>
              <input id="student-id" name="studentId" type="text" class="input" placeholder="예: 20315" required autocomplete="off" />
            </div>
            <div class="field-group">
              <label for="student-name">이름 <span class="req-star">*</span></label>
              <input id="student-name" name="studentName" type="text" class="input" placeholder="예: 김과학" required autocomplete="name" />
            </div>
          </div>
          ${
            course.isJointCurriculum
              ? `
            <div class="field-group">
              <label for="student-school">학교 <span class="req-star">*</span></label>
              <input id="student-school" name="school" type="text" class="input" placeholder="소속 고등학교명을 입력해 주세요 (예: OO고등학교)" required />
            </div>
          `
              : ''
          }

          <div class="student-section-title">학습 및 탐구 활동 내용</div>
          ${fieldsHtml}

          <div class="student-submit-wrap">
            <button id="student-submit-btn" type="submit" class="btn btn-primary btn-lg">
              제출하기
            </button>
          </div>
        </form>
      </div>
    </main>
  `;

  const form = document.getElementById('student-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('student-submit-btn');
    const formData = new FormData(form);

    const studentId = String(formData.get('studentId') || '').trim();
    const studentName = String(formData.get('studentName') || '').trim();
    const school = course.isJointCurriculum ? String(formData.get('school') || '').trim() : '';

    const answers = {};
    for (const field of course.fields) {
      answers[field.id] = String(formData.get(field.id) || '').trim();
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중...';

    try {
      await api.submitStudentResponse(
        course.id,
        {
          studentId,
          studentName,
          school,
          answers,
        },
        course
      );

      appRoot.innerHTML = `
        <main class="student-page">
          <div class="student-container">
            <div class="student-done-card">
              <div class="done-icon" aria-hidden="true">✓</div>
              <h1>제출이 완료되었습니다</h1>
              <p><strong>${escapeHtml(course.title)}</strong> 활동 기록이 정상적으로 접수되었습니다.<br/>성실하게 작성해 주어 감사합니다.</p>
              <button id="resubmit-btn" type="button" class="btn btn-secondary" style="margin-top:8px;">
                다른 응답 작성하기
              </button>
            </div>
          </div>
        </main>
      `;

      document.getElementById('resubmit-btn')?.addEventListener('click', () => {
        renderStudentForm(course);
      });
    } catch (err) {
      showToast(err.message || '제출에 실패했습니다. 다시 시도해 주세요.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = '제출하기';
    }
  });
}

// ============================================================================
// 2. TEACHER WORKSPACE APP
// ============================================================================

const state = {
  courses: [],
  activeCourseId: null,
  activeTab: 'submissions', // 'submissions' | 'builder'
  submissions: [],
  selectedSubmissionId: null,
  searchQuery: '',
  bulkStyle: 'inquiry',
  // Local draft for builder tab
  builderDraft: null,
  isGeneratingAi: false,
  aiProgressLabel: '',
  storageMode: 'local', // 'sheets' | 'server' | 'local'
  cliStatus: {
    available: false,
    providers: {
      claude: { installed: false },
      gemini: { installed: false },
      codex: { installed: false },
    },
  },
};

function getActiveCourse() {
  return state.courses.find((c) => c.id === state.activeCourseId) || null;
}

function getSelectedSubmission() {
  return state.submissions.find((s) => s.id === state.selectedSubmissionId) || null;
}

async function initTeacherApp() {
  try {
    const [storageMode, cliStatus, courses] = await Promise.all([
      api.getStorageMode(),
      api.getCliStatus(),
      api.listCourses(),
    ]);
    state.storageMode = storageMode;
    state.cliStatus = cliStatus;
    state.courses = courses;
    if (courses.length > 0) {
      await selectCourse(courses[0].id);
    } else {
      renderTeacherApp();
    }
  } catch (err) {
    showToast(err.message || '데이터를 불러오지 못했습니다.', 'error');
    renderTeacherApp();
  }
}

async function selectCourse(courseId, keepTab = false) {
  state.activeCourseId = courseId;
  if (!keepTab) {
    state.activeTab = 'submissions';
  }
  state.searchQuery = '';
  const course = getActiveCourse();
  state.builderDraft = course ? structuredClone(course) : null;

  try {
    const submissions = await api.listSubmissions(courseId);
    state.submissions = submissions;
    state.selectedSubmissionId = submissions.length > 0 ? submissions[0].id : null;
  } catch (err) {
    state.submissions = [];
    state.selectedSubmissionId = null;
    showToast(err.message || '제출 목록을 불러오지 못했습니다.', 'error');
  }

  renderTeacherApp();
}

function renderTeacherApp() {
  const course = getActiveCourse();
  const isSheetsConnected = Boolean(getGasUrl());

  const courseListHtml = state.courses
    .map((c) => {
      const active = c.id === state.activeCourseId ? ' active' : '';
      return `
        <button type="button" class="course-item${active}" data-select-course="${escapeHtml(c.id)}">
          <div class="course-item-top">
            <span class="course-item-title">${escapeHtml(c.title)}</span>
            <span class="course-count">${c.submissionCount ?? 0}</span>
          </div>
          <div class="course-item-meta">
            <span>${c.isOpen ? '수집 중' : '마감됨'}</span>
            ${c.isJointCurriculum ? '<span>· 공동교육과정</span>' : ''}
          </div>
        </button>
      `;
    })
    .join('');

  appRoot.innerHTML = `
    <div class="teacher-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">세</div>
          <div class="brand-text">
            <span class="brand-title">세특 수집기</span>
            <span class="brand-sub">Speciality · ${
              isSheetsConnected ? 'Google 시트 연동됨' : state.cliStatus.available ? '로컬 서버' : '교사 관리'
            }</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button id="open-sheets-modal-btn" type="button" class="btn ${
            isSheetsConnected ? 'btn-soft' : 'btn-secondary'
          } btn-sm">
            Google 시트${isSheetsConnected ? ' ●' : ' 연동'}
          </button>
          <button id="open-ai-settings-btn" type="button" class="btn btn-secondary btn-sm">
            AI · CLI 설정
          </button>
          <button id="open-new-course-btn" type="button" class="btn btn-primary btn-sm">
            + 새 과목 만들기
          </button>
        </div>
      </header>

      <div class="workspace-body">
        <aside class="sidebar" aria-label="과목 목록">
          <div class="sidebar-head">
            <h2>수집 과목 (${state.courses.length})</h2>
          </div>
          <div class="course-list">
            ${
              courseListHtml ||
              '<p style="padding:12px 6px;font-size:13px;color:var(--text-muted);">과목을 먼저 생성해 주세요.</p>'
            }
          </div>
        </aside>

        <main class="main-content">
          ${course ? renderCourseMainHtml(course) : renderNoCourseHtml()}
        </main>
      </div>
    </div>
  `;

  bindTeacherEvents();
}

function renderNoCourseHtml() {
  return `
    <div class="panel empty-state">
      <h3>생성된 수집 과목이 없습니다</h3>
      <p>과목을 생성하면 학생이 접속할 수 있는 전용 QR코드가 발급되며, 응답을 토대로 세부능력 특기사항이 자동 작성됩니다.</p>
      <button id="empty-new-course-btn" type="button" class="btn btn-primary" style="margin-top:8px;">
        + 첫 과목 만들기
      </button>
    </div>
  `;
}

function renderCourseMainHtml(course) {
  return `
    <section class="course-header">
      <div class="course-header-left">
        <div class="course-title-row">
          <h1>${escapeHtml(course.title)}</h1>
          <span class="badge ${course.isOpen ? 'badge-success' : 'badge-muted'}">
            ${course.isOpen ? '수집 진행 중' : '수집 마감'}
          </span>
          ${course.isJointCurriculum ? '<span class="badge badge-amber">공동교육과정 (학교 포함)</span>' : ''}
        </div>
        ${course.description ? `<p class="course-desc">${escapeHtml(course.description)}</p>` : ''}
      </div>

      <div class="course-header-actions">
        <button id="toggle-open-btn" type="button" class="btn btn-secondary btn-sm">
          ${course.isOpen ? '수집 마감하기' : '수집 다시 열기'}
        </button>
        <button id="open-qr-modal-btn" type="button" class="btn btn-primary">
          QR코드 생성 · 공유
        </button>
      </div>
    </section>

    <nav class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="tab-btn${state.activeTab === 'submissions' ? ' active' : ''}"
        data-tab="submissions"
      >
        제출 현황 &amp; 세특 자동 작성 (${state.submissions.length})
      </button>
      <button
        type="button"
        role="tab"
        class="tab-btn${state.activeTab === 'builder' ? ' active' : ''}"
        data-tab="builder"
      >
        학생 입력 항목 설정 (${course.fields.length}항목)
      </button>
    </nav>

    ${state.activeTab === 'submissions' ? renderSubmissionsTabHtml(course) : renderBuilderTabHtml()}
  `;
}

function renderSubmissionsTabHtml(course) {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.submissions.filter((sub) => {
    if (!q) return true;
    return (
      sub.studentId.toLowerCase().includes(q) ||
      sub.studentName.toLowerCase().includes(q) ||
      (sub.school || '').toLowerCase().includes(q)
    );
  });

  const selected =
    filtered.find((s) => s.id === state.selectedSubmissionId) || filtered[0] || null;
  if (selected && selected.id !== state.selectedSubmissionId) {
    state.selectedSubmissionId = selected.id;
  }

  const listHtml = filtered
    .map((sub) => {
      const bytes = calcNeisBytes(sub.generatedText || '');
      const isActive = selected && sub.id === selected.id;
      const statusBadge =
        sub.status === 'reviewed'
          ? '<span class="badge badge-success">검토 완료</span>'
          : '<span class="badge badge-primary">자동 입력됨</span>';
      return `
        <button type="button" class="student-row${isActive ? ' active' : ''}" data-select-sub="${escapeHtml(sub.id)}">
          <div class="student-row-top">
            <div class="student-ident">
              <span class="student-id-code">${escapeHtml(sub.studentId)}</span>
              <span class="student-name">${escapeHtml(sub.studentName)}</span>
            </div>
            ${statusBadge}
          </div>
          <div class="student-row-sub">
            <span>${sub.school ? escapeHtml(sub.school) : formatDateTime(sub.createdAt)}</span>
            <span class="byte-count-mono${bytes > NEIS_BYTE_LIMIT ? ' over' : ''}">${bytes}B</span>
          </div>
        </button>
      `;
    })
    .join('');

  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <input
          id="submission-search"
          type="search"
          class="input search-input"
          placeholder="학번, 이름${course.isJointCurriculum ? ', 학교' : ''} 검색..."
          value="${escapeHtml(state.searchQuery)}"
        />
        <button id="refresh-subs-btn" type="button" class="btn btn-secondary btn-sm">
          새로고침
        </button>
      </div>
      <div class="toolbar-right">
        <button id="add-sample-sub-btn" type="button" class="btn btn-ghost btn-sm">
          + 테스트 응답 추가
        </button>
        <button
          id="bulk-regen-btn"
          type="button"
          class="btn btn-soft btn-sm"
          ${state.submissions.length === 0 ? 'disabled' : ''}
        >
          전체 세특 다시 생성
        </button>
        <button
          id="export-csv-btn"
          type="button"
          class="btn btn-secondary btn-sm"
          ${state.submissions.length === 0 ? 'disabled' : ''}
        >
          엑셀(CSV) 다운로드
        </button>
      </div>
    </div>

    ${
      state.submissions.length === 0
        ? `
      <div class="panel empty-state">
        <h3>아직 제출된 학생 응답이 없습니다</h3>
        <p>우측 상단의 <strong>QR코드 생성 · 공유</strong> 버튼을 눌러 학생들에게 QR코드를 보여주세요. 학생이 제출하면 1~7번 응답을 토대로 세부능력 특기사항이 자동으로 입력됩니다.</p>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
          <button id="empty-open-qr-btn" type="button" class="btn btn-primary">QR코드 띄우기</button>
          <button id="empty-sample-btn" type="button" class="btn btn-secondary">테스트 응답으로 미리보기</button>
        </div>
      </div>
    `
        : `
      <div class="split-view">
        <div class="panel student-list-panel">
          <div class="student-list-header">
            <span>제출 학생 (${filtered.length}명)</span>
            <span>NEIS Bytes</span>
          </div>
          <div class="student-list">
            ${
              listHtml ||
              '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13.5px;">검색 결과가 없습니다.</div>'
            }
          </div>
        </div>

        <div class="detail-stack">
          ${selected ? renderSubmissionDetailHtml(course, selected) : ''}
        </div>
      </div>
    `
    }
  `;
}

function renderSubmissionDetailHtml(course, sub) {
  const text = sub.generatedText || '';
  const bytes = calcNeisBytes(text);
  const chars = text.length;
  const pct = Math.min(100, Math.round((bytes / NEIS_BYTE_LIMIT) * 100));
  const meterClass = bytes > NEIS_BYTE_LIMIT ? ' over' : bytes > 1350 ? ' warn' : '';

  const stylePillsHtml = GENERATION_STYLES.map(
    (st) => `
      <button
        type="button"
        class="style-pill${(sub.style || 'inquiry') === st.id ? ' active' : ''}"
        data-apply-style="${st.id}"
        title="${escapeHtml(st.description)}"
      >
        ${escapeHtml(st.label)}
      </button>
    `
  ).join('');

  const answersHtml = course.fields
    .map((field, idx) => {
      const val = (sub.answers && sub.answers[field.id]) || '';
      return `
        <div class="answer-item">
          <span class="answer-label">${idx + 1}. ${escapeHtml(field.label)}</span>
          <div class="answer-value">${
            val ? escapeHtml(val) : '<span class="answer-empty">(미입력)</span>'
          }</div>
        </div>
      `;
    })
    .join('');

  const aiSettings = getAiSettings();
  const provider = aiSettings.activeAiProvider || 'gemini';
  const cliProviders = state.cliStatus?.providers || {};
  const labelMap = {
    cli_claude: 'Claude CLI 다듬기',
    cli_gemini: 'Gemini CLI 다듬기',
    cli_codex: 'Codex CLI 다듬기',
    webllm: 'WebLLM 다듬기',
    claude: 'Claude 다듬기',
    gemini: 'Gemini 다듬기',
  };
  const aiBtnLabel = state.isGeneratingAi
    ? state.aiProgressLabel || 'AI 다듬는 중...'
    : labelMap[provider] || 'AI 다듬기';

  return `
    <article class="panel seteuk-card">
      <div class="seteuk-card-head">
        <div class="seteuk-student-meta">
          <h3>
            <span class="student-id-code" style="font-size:15px;">${escapeHtml(sub.studentId)}</span>
            <span>${escapeHtml(sub.studentName)}</span>
            ${sub.school ? `<span class="badge badge-amber">${escapeHtml(sub.school)}</span>` : ''}
          </h3>
          <p>제출 시각: ${formatDateTime(sub.createdAt)} · 학생 페이지에는 이 세특 항목이 보이지 않습니다.</p>
        </div>
        <div class="style-pills" aria-label="세특 문체 선택">
          ${stylePillsHtml}
        </div>
      </div>

      <textarea
        id="seteuk-textarea"
        class="textarea seteuk-editor"
        aria-label="세부능력 및 특기사항"
      >${escapeHtml(text)}</textarea>

      <div class="byte-meter">
        <div class="byte-meter-top">
          <span>NEIS 세부능력 및 특기사항 기준 (1,500 Bytes)</span>
          <span id="byte-count-label" class="byte-count-mono${meterClass}">
            ${bytes.toLocaleString()} / ${NEIS_BYTE_LIMIT.toLocaleString()} Bytes · ${chars}자
          </span>
        </div>
        <div class="byte-bar-track">
          <div id="byte-bar-fill" class="byte-bar-fill${meterClass}" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="seteuk-actions">
        <div class="seteuk-actions-left">
          <button id="regen-one-btn" type="button" class="btn btn-soft btn-sm">
            내장 엔진 재작성
          </button>
          <select id="ai-provider-select" class="select" style="width:auto;padding:5px 10px;font-size:13px;" aria-label="생성형 AI 선택">
            ${
              state.cliStatus?.available
                ? `
              <optgroup label="로컬 CLI (구독 로그인)">
                <option value="cli_claude"${provider === 'cli_claude' ? ' selected' : ''}>Claude Code CLI${
                    cliProviders.claude?.installed ? '' : ' (미설치)'
                  }</option>
                <option value="cli_gemini"${provider === 'cli_gemini' ? ' selected' : ''}>Gemini CLI${
                    cliProviders.gemini?.installed ? '' : ' (미설치)'
                  }</option>
                <option value="cli_codex"${provider === 'cli_codex' ? ' selected' : ''}>GPT Codex CLI${
                    cliProviders.codex?.installed ? '' : ' (미설치)'
                  }</option>
              </optgroup>
            `
                : ''
            }
            <optgroup label="브라우저 · API">
              <option value="webllm"${provider === 'webllm' ? ' selected' : ''}>WebLLM (로컬)</option>
              <option value="gemini"${provider === 'gemini' ? ' selected' : ''}>Gemini API</option>
              <option value="claude"${provider === 'claude' ? ' selected' : ''}>Claude API</option>
            </optgroup>
          </select>
          <button id="ai-refine-btn" type="button" class="btn btn-secondary btn-sm" ${
            state.isGeneratingAi ? 'disabled' : ''
          }>
            ${escapeHtml(aiBtnLabel)}
          </button>
          <button id="delete-sub-btn" type="button" class="btn btn-danger-soft btn-sm">
            삭제
          </button>
        </div>
        <div class="seteuk-actions-right">
          <button id="copy-seteuk-btn" type="button" class="btn btn-secondary btn-sm">
            세특 복사
          </button>
          <button id="save-seteuk-btn" type="button" class="btn btn-primary btn-sm">
            검토 완료 저장
          </button>
        </div>
      </div>
    </article>

    <article class="panel answers-card">
      <h4>학생 제출 원문 (1~${course.fields.length}번 항목)</h4>
      <div class="answers-grid">
        ${answersHtml}
      </div>
    </article>
  `;
}

function renderBuilderTabHtml() {
  const draft = state.builderDraft;
  if (!draft) return '';

  const fieldsHtml = draft.fields
    .map((field, idx) => {
      const roleOptions = FIELD_ROLES.map(
        (r) =>
          `<option value="${r.value}"${field.role === r.value ? ' selected' : ''}>${escapeHtml(
            r.label
          )}</option>`
      ).join('');

      return `
        <div class="field-editor-item" data-field-index="${idx}">
          <div class="field-editor-top">
            <span class="field-num-badge">항목 ${idx + 1}</span>
            <div class="field-editor-controls">
              <label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;margin-right:8px;cursor:pointer;">
                <input type="checkbox" data-f-prop="required" ${field.required ? 'checked' : ''} />
                필수
              </label>
              <button type="button" class="btn btn-ghost btn-icon" data-f-move="-1" title="위로 이동" ${
                idx === 0 ? 'disabled' : ''
              }>▲</button>
              <button type="button" class="btn btn-ghost btn-icon" data-f-move="1" title="아래로 이동" ${
                idx === draft.fields.length - 1 ? 'disabled' : ''
              }>▼</button>
              <button type="button" class="btn btn-danger-soft btn-icon" data-f-delete="1" title="항목 삭제">✕</button>
            </div>
          </div>

          <div class="field-editor-grid">
            <div class="field-group">
              <label>질문 제목</label>
              <input type="text" class="input" data-f-prop="label" value="${escapeHtml(field.label)}" placeholder="예: 새로 알게 된 개념" />
            </div>
            <div class="field-group">
              <label>입력 형태</label>
              <select class="select" data-f-prop="type">
                <option value="textarea"${field.type === 'textarea' ? ' selected' : ''}>서술형 (여러 줄)</option>
                <option value="text"${field.type === 'text' ? ' selected' : ''}>단답형 (한 줄)</option>
                <option value="select"${field.type === 'select' ? ' selected' : ''}>선택형 (드롭다운)</option>
              </select>
            </div>
            <div class="field-group">
              <label>세특 자동 반영 역할</label>
              <select class="select" data-f-prop="role">
                ${roleOptions}
              </select>
            </div>
          </div>

          <div class="field-group">
            <label>작성 안내 문구 (Placeholder)</label>
            <input type="text" class="input" data-f-prop="placeholder" value="${escapeHtml(field.placeholder || '')}" placeholder="학생 입력란에 표시될 도움말" />
          </div>

          ${
            field.type === 'select'
              ? `
            <div class="field-group">
              <label>선택지 목록 (쉼표로 구분)</label>
              <input type="text" class="input" data-f-prop="options" value="${escapeHtml((field.options || []).join(', '))}" placeholder="예: 매우 높음, 높음, 보통" />
            </div>
          `
              : ''
          }
        </div>
      `;
    })
    .join('');

  return `
    <div class="builder-layout">
      <section class="panel builder-card">
        <div class="builder-card-head">
          <div>
            <h3>과목 기본 설정</h3>
            <p>학생이 QR코드로 접속했을 때 표시되는 과목 정보와 기본 수집 항목을 설정합니다.</p>
          </div>
        </div>

        <div class="field-group">
          <label for="cfg-title">과목명</label>
          <input id="cfg-title" type="text" class="input" value="${escapeHtml(draft.title)}" />
        </div>

        <div class="field-group">
          <label for="cfg-desc">학생 안내 문구</label>
          <textarea id="cfg-desc" class="textarea" rows="2">${escapeHtml(draft.description || '')}</textarea>
        </div>

        <div class="switch-row">
          <div class="switch-label">
            <strong>공동교육과정 과목 (학교 입력란 표시)</strong>
            <span>활성화하면 학생 접속 페이지 기본 정보에 학번·이름과 함께 '학교' 입력란이 추가됩니다.</span>
          </div>
          <label class="switch">
            <input id="cfg-joint" type="checkbox" ${draft.isJointCurriculum ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="switch-row">
          <div class="switch-label">
            <strong>응답 수집 활성화</strong>
            <span>끄면 학생이 QR코드로 접속해도 '제출 마감' 안내만 표시됩니다.</span>
          </div>
          <label class="switch">
            <input id="cfg-open" type="checkbox" ${draft.isOpen ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </section>

      <section class="panel builder-card">
        <div class="builder-card-head">
          <div>
            <h3>학생 입력 항목 지정</h3>
            <p>학생이 작성할 질문을 자유롭게 추가·수정·순서 변경할 수 있습니다. 각 항목은 세특 자동 생성에 반영됩니다.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="restore-defaults-btn" type="button" class="btn btn-ghost btn-sm">기본 7항목 복원</button>
            <button id="add-field-btn" type="button" class="btn btn-soft btn-sm">+ 입력 항목 추가</button>
          </div>
        </div>

        <div class="field-editor-list">
          ${fieldsHtml}
        </div>

        <div class="builder-footer">
          <button id="delete-course-btn" type="button" class="btn btn-danger-soft btn-sm">
            이 과목 삭제
          </button>
          <button id="save-builder-btn" type="button" class="btn btn-primary">
            설정 저장하기
          </button>
        </div>
      </section>
    </div>
  `;
}

// ============================================================================
// Event Binding (Teacher Workspace)
// ============================================================================

function bindTeacherEvents() {
  // Topbar actions
  document.getElementById('open-new-course-btn')?.addEventListener('click', openNewCourseModal);
  document.getElementById('empty-new-course-btn')?.addEventListener('click', openNewCourseModal);
  document.getElementById('open-ai-settings-btn')?.addEventListener('click', () => openAiSettingsModal('builtin'));
  document.getElementById('open-sheets-modal-btn')?.addEventListener('click', openSheetsModal);

  // Course sidebar switching
  document.querySelectorAll('[data-select-course]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-select-course');
      if (id && id !== state.activeCourseId) {
        selectCourse(id);
      }
    });
  });

  // Course header actions
  document.getElementById('open-qr-modal-btn')?.addEventListener('click', () => {
    const course = getActiveCourse();
    if (course) openQrModal(course);
  });
  document.getElementById('empty-open-qr-btn')?.addEventListener('click', () => {
    const course = getActiveCourse();
    if (course) openQrModal(course);
  });

  document.getElementById('toggle-open-btn')?.addEventListener('click', async () => {
    const course = getActiveCourse();
    if (!course) return;
    try {
      const updated = await api.updateCourse(course.id, { isOpen: !course.isOpen });
      updateLocalCourse(updated);
      showToast(updated.isOpen ? '응답 수집을 다시 열었습니다.' : '응답 수집을 마감했습니다.');
      renderTeacherApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Tabs
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab === state.activeTab) return;
      state.activeTab = tab;
      if (tab === 'builder') {
        const course = getActiveCourse();
        state.builderDraft = course ? structuredClone(course) : null;
      }
      renderTeacherApp();
    });
  });

  if (state.activeTab === 'submissions') {
    bindSubmissionsEvents();
  } else {
    bindBuilderEvents();
  }
}

function updateLocalCourse(updated) {
  state.courses = state.courses.map((c) =>
    c.id === updated.id ? { ...updated, submissionCount: c.submissionCount ?? state.submissions.length } : c
  );
  if (state.builderDraft && state.builderDraft.id === updated.id) {
    state.builderDraft = structuredClone(updated);
  }
}

function bindSubmissionsEvents() {
  const course = getActiveCourse();
  if (!course) return;

  const searchEl = document.getElementById('submission-search');
  searchEl?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTeacherApp();
    const nextSearch = document.getElementById('submission-search');
    if (nextSearch) {
      nextSearch.focus();
      nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
    }
  });

  document.getElementById('refresh-subs-btn')?.addEventListener('click', async () => {
    await selectCourse(course.id, true);
    showToast('제출 목록을 새로고침했습니다.');
  });

  document.getElementById('add-sample-sub-btn')?.addEventListener('click', () => addSampleSubmission(course));
  document.getElementById('empty-sample-btn')?.addEventListener('click', () => addSampleSubmission(course));

  document.getElementById('bulk-regen-btn')?.addEventListener('click', async () => {
    if (!confirm('현재 과목의 모든 학생 세특을 자동 생성 문구로 다시 작성할까요?')) return;
    try {
      const aiSettings = getAiSettings();
      const updates = state.submissions.map((sub) => {
        const style = sub.style || aiSettings.defaultStyle || 'inquiry';
        const generatedText = generateSeteuk({
          answers: sub.answers,
          fields: course.fields,
          course,
          style,
          aiSettings,
        });
        return { id: sub.id, generatedText, style, status: 'auto' };
      });
      await api.bulkUpdateSubmissions(updates);
      await selectCourse(course.id, true);
      showToast(`${updates.length}명의 세특을 현재 내장 AI 설정으로 다시 생성했습니다.`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportCourseCsv(course));

  // Select student row
  document.querySelectorAll('[data-select-sub]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedSubmissionId = btn.getAttribute('data-select-sub');
      renderTeacherApp();
    });
  });

  // Detail editor bindings
  const sub = getSelectedSubmission();
  if (!sub) return;

  const textarea = document.getElementById('seteuk-textarea');
  const byteLabel = document.getElementById('byte-count-label');
  const byteBar = document.getElementById('byte-bar-fill');

  textarea?.addEventListener('input', (e) => {
    const val = e.target.value;
    sub.generatedText = val;
    const bytes = calcNeisBytes(val);
    const pct = Math.min(100, Math.round((bytes / NEIS_BYTE_LIMIT) * 100));
    const cls = bytes > NEIS_BYTE_LIMIT ? ' over' : bytes > 1350 ? ' warn' : '';
    if (byteLabel) {
      byteLabel.textContent = `${bytes.toLocaleString()} / ${NEIS_BYTE_LIMIT.toLocaleString()} Bytes · ${val.length}자`;
      byteLabel.className = `byte-count-mono${cls}`;
    }
    if (byteBar) {
      byteBar.style.width = `${pct}%`;
      byteBar.className = `byte-bar-fill${cls}`;
    }
  });

  // Style pills
  document.querySelectorAll('[data-apply-style]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const style = btn.getAttribute('data-apply-style');
      const nextText = generateSeteuk({
        answers: sub.answers,
        fields: course.fields,
        course,
        style,
        aiSettings: getAiSettings(),
      });
      try {
        const updated = await api.updateSubmission(sub.id, {
          generatedText: nextText,
          style,
          status: 'auto',
        });
        replaceLocalSubmission(updated);
        renderTeacherApp();
        showToast('선택한 문체로 세특을 자동 생성했습니다.');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Regenerate single
  document.getElementById('regen-one-btn')?.addEventListener('click', async () => {
    const aiSettings = getAiSettings();
    const style = sub.style || aiSettings.defaultStyle || 'inquiry';
    const nextText = generateSeteuk({
      answers: sub.answers,
      fields: course.fields,
      course,
      style,
      aiSettings,
    });
    try {
      const updated = await api.updateSubmission(sub.id, {
        generatedText: nextText,
        style,
        status: 'auto',
      });
      replaceLocalSubmission(updated);
      renderTeacherApp();
      showToast('현재 내장 AI 설정으로 세특 초안을 다시 생성했습니다.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // AI Provider quick switcher
  document.getElementById('ai-provider-select')?.addEventListener('change', (e) => {
    const nextProvider = e.target.value;
    const cur = getAiSettings();
    saveAiSettings({ ...cur, activeAiProvider: nextProvider });
    renderTeacherApp();
  });

  // Generative AI refine (WebLLM / Gemini / Claude)
  document.getElementById('ai-refine-btn')?.addEventListener('click', async () => {
    const aiSettings = getAiSettings();
    const provider = aiSettings.activeAiProvider || 'gemini';
    const style = sub.style || aiSettings.defaultStyle || 'inquiry';

    if (provider.startsWith('cli_')) {
      const cliName = provider.replace('cli_', '');
      if (!state.cliStatus?.available) {
        showToast('로컬 CLI는 내 PC에서 npm start로 실행했을 때 사용할 수 있습니다.', 'error');
        openAiSettingsModal('cli');
        return;
      }
      if (!state.cliStatus.providers?.[cliName]?.installed) {
        showToast(`${cliName} CLI가 이 PC에 설치되어 있지 않습니다.`, 'error');
        openAiSettingsModal('cli');
        return;
      }
    }
    if (provider === 'gemini' && !getGeminiKey()) {
      showToast('Gemini API 키를 먼저 입력해 주세요.', 'error');
      openAiSettingsModal('api');
      return;
    }
    if (provider === 'claude' && !getClaudeKey()) {
      showToast('Claude API 키를 먼저 입력해 주세요.', 'error');
      openAiSettingsModal('api');
      return;
    }

    state.isGeneratingAi = true;
    state.aiProgressLabel =
      provider === 'cli_claude'
        ? 'Claude CLI 작성 중...'
        : provider === 'cli_gemini'
        ? 'Gemini CLI 작성 중...'
        : provider === 'cli_codex'
        ? 'Codex CLI 작성 중...'
        : provider === 'webllm'
        ? 'WebLLM 준비 중...'
        : provider === 'claude'
        ? 'Claude 생성 중...'
        : 'Gemini 생성 중...';
    renderTeacherApp();

    try {
      let refined = '';
      if (provider.startsWith('cli_')) {
        const cliName = provider.replace('cli_', '');
        const prompt = buildAiPrompt({
          course,
          answers: sub.answers,
          fields: course.fields,
          style,
          aiSettings,
        });
        refined = await api.refineWithLocalCli({ provider: cliName, prompt });
      } else if (provider === 'webllm') {
        refined = await refineWithWebLlm({
          course,
          answers: sub.answers,
          fields: course.fields,
          style,
          aiSettings,
          onProgress: ({ progress }) => {
            state.aiProgressLabel = progress < 100 ? `WebLLM 로딩 ${progress}%` : 'WebLLM 작성 중...';
            const btn = document.getElementById('ai-refine-btn');
            if (btn) btn.textContent = state.aiProgressLabel;
          },
        });
      } else if (provider === 'claude') {
        refined = await refineWithClaude({
          apiKey: getClaudeKey(),
          course,
          answers: sub.answers,
          fields: course.fields,
          style,
          aiSettings,
        });
      } else {
        refined = await refineWithGemini({
          apiKey: getGeminiKey(),
          course,
          answers: sub.answers,
          fields: course.fields,
          style,
          aiSettings,
        });
      }

      const updated = await api.updateSubmission(sub.id, {
        generatedText: refined,
        status: 'auto',
      });
      replaceLocalSubmission(updated);
      const doneLabels = {
        cli_claude: 'Claude Code CLI',
        cli_gemini: 'Gemini CLI',
        cli_codex: 'Codex CLI',
        webllm: 'WebLLM',
        claude: 'Claude API',
        gemini: 'Gemini API',
      };
      showToast(`${doneLabels[provider] || 'AI'}로 세특 문장을 자연스럽게 다듬었습니다.`);
    } catch (err) {
      showToast(err.message || 'AI 다듬기에 실패했습니다.', 'error');
    } finally {
      state.isGeneratingAi = false;
      state.aiProgressLabel = '';
      renderTeacherApp();
    }
  });

  // Copy 세특
  document.getElementById('copy-seteuk-btn')?.addEventListener('click', async () => {
    const val = document.getElementById('seteuk-textarea')?.value || '';
    try {
      await navigator.clipboard.writeText(val);
      showToast('세부능력 특기사항을 클립보드에 복사했습니다.');
    } catch {
      showToast('복사에 실패했습니다. 직접 선택하여 복사해 주세요.', 'error');
    }
  });

  // Save reviewed
  document.getElementById('save-seteuk-btn')?.addEventListener('click', async () => {
    const val = document.getElementById('seteuk-textarea')?.value || '';
    try {
      const updated = await api.updateSubmission(sub.id, {
        generatedText: val,
        status: 'reviewed',
      });
      replaceLocalSubmission(updated);
      renderTeacherApp();
      showToast('세특을 저장하고 검토 완료로 표시했습니다.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Delete submission
  document.getElementById('delete-sub-btn')?.addEventListener('click', async () => {
    if (!confirm(`${sub.studentId} ${sub.studentName} 학생의 응답을 삭제할까요?`)) return;
    try {
      await api.deleteSubmission(sub.id);
      state.submissions = state.submissions.filter((s) => s.id !== sub.id);
      state.selectedSubmissionId = state.submissions[0]?.id || null;
      const activeCourse = getActiveCourse();
      if (activeCourse) activeCourse.submissionCount = state.submissions.length;
      renderTeacherApp();
      showToast('제출 기록을 삭제했습니다.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function replaceLocalSubmission(updated) {
  state.submissions = state.submissions.map((s) => (s.id === updated.id ? updated : s));
}

function bindBuilderEvents() {
  const draft = state.builderDraft;
  if (!draft) return;

  document.getElementById('cfg-title')?.addEventListener('input', (e) => {
    draft.title = e.target.value;
  });
  document.getElementById('cfg-desc')?.addEventListener('input', (e) => {
    draft.description = e.target.value;
  });
  document.getElementById('cfg-joint')?.addEventListener('change', (e) => {
    draft.isJointCurriculum = e.target.checked;
  });
  document.getElementById('cfg-open')?.addEventListener('change', (e) => {
    draft.isOpen = e.target.checked;
  });

  // Field item bindings
  document.querySelectorAll('.field-editor-item').forEach((row) => {
    const idx = Number(row.getAttribute('data-field-index'));
    const field = draft.fields[idx];
    if (!field) return;

    row.querySelectorAll('[data-f-prop]').forEach((input) => {
      const prop = input.getAttribute('data-f-prop');
      const evt = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(evt, (e) => {
        if (prop === 'required') {
          field.required = e.target.checked;
        } else if (prop === 'options') {
          field.options = e.target.value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
        } else {
          field[prop] = e.target.value;
          if (prop === 'type') {
            renderTeacherApp();
          }
        }
      });
    });

    row.querySelectorAll('[data-f-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.getAttribute('data-f-move'));
        const target = idx + delta;
        if (target < 0 || target >= draft.fields.length) return;
        const [moved] = draft.fields.splice(idx, 1);
        draft.fields.splice(target, 0, moved);
        renderTeacherApp();
      });
    });

    row.querySelector('[data-f-delete]')?.addEventListener('click', () => {
      if (draft.fields.length <= 1) {
        showToast('최소 1개 이상의 입력 항목이 필요합니다.', 'error');
        return;
      }
      draft.fields.splice(idx, 1);
      renderTeacherApp();
    });
  });

  document.getElementById('add-field-btn')?.addEventListener('click', () => {
    draft.fields.push({
      id: `custom_${Date.now().toString(36)}`,
      label: '새 질문 항목',
      placeholder: '학생이 작성할 안내 문구를 입력해 주세요.',
      type: 'textarea',
      role: 'custom',
      required: false,
      options: [],
    });
    renderTeacherApp();
  });

  document.getElementById('restore-defaults-btn')?.addEventListener('click', () => {
    if (!confirm('입력 항목을 기본 7개 항목으로 되돌릴까요?')) return;
    draft.fields = cloneDefaultFields();
    renderTeacherApp();
  });

  document.getElementById('save-builder-btn')?.addEventListener('click', async () => {
    if (!draft.title.trim()) {
      showToast('과목명을 입력해 주세요.', 'error');
      return;
    }
    const invalidField = draft.fields.find((f) => !f.label.trim());
    if (invalidField) {
      showToast('비어 있는 질문 제목이 있습니다. 제목을 입력해 주세요.', 'error');
      return;
    }
    try {
      const updated = await api.updateCourse(draft.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        isJointCurriculum: draft.isJointCurriculum,
        isOpen: draft.isOpen,
        fields: draft.fields,
      });
      updateLocalCourse(updated);
      showToast('과목 설정과 학생 입력 항목을 저장했습니다.');
      renderTeacherApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('delete-course-btn')?.addEventListener('click', async () => {
    if (
      !confirm(
        `'${draft.title}' 과목과 해당 과목의 모든 제출 기록(${state.submissions.length}건)을 삭제할까요?`
      )
    ) {
      return;
    }
    try {
      await api.deleteCourse(draft.id);
      state.courses = state.courses.filter((c) => c.id !== draft.id);
      if (state.courses.length > 0) {
        await selectCourse(state.courses[0].id);
      } else {
        state.activeCourseId = null;
        state.submissions = [];
        state.selectedSubmissionId = null;
        state.builderDraft = null;
        renderTeacherApp();
      }
      showToast('과목을 삭제했습니다.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ============================================================================
// Sample Data & CSV Export Helpers
// ============================================================================

async function addSampleSubmission(course) {
  const sampleAnswers = {};
  const sampleByRole = {
    newConcept: '빛의 간섭과 회절 현상 및 단일 슬릿·이중 슬릿 조건',
    refinedConcept: '질량과 무게의 차이, 그리고 마찰력이 접촉 면적보다 수직항력에 비례한다는 원리',
    activity1: '레이저를 이용한 이중 슬릿 간섭 무늬 측정 실험',
    reason1: '이론식으로 계산한 파장과 실제 스크린에 나타난 무늬 간격을 직접 비교하며 오차 원인을 분석할 수 있었기 때문입니다',
    activity2: '일상 속 센서 데이터 수집 및 그래프 분석 프로젝트',
    reason2: '스마트폰 가속도 센서로 단진자 운동 데이터를 추출해 주기 공식을 직접 검증해 보았습니다',
    developedAbility: '실험 변인 통제 능력과 측정 데이터의 오차를 과학적으로 해석하는 탐구 역량',
  };

  for (const f of course.fields) {
    sampleAnswers[f.id] =
      sampleByRole[f.role] || `${f.label}에 대해 수업 중 적극적으로 탐구하고 핵심 내용을 정리함`;
  }

  const num = 10 + state.submissions.length + 1;
  try {
    await api.submitStudentResponse(course.id, {
      studentId: `203${String(num).padStart(2, '0')}`,
      studentName: `김탐구${state.submissions.length + 1}`,
      school: course.isJointCurriculum ? '한국과학고등학교' : '',
      answers: sampleAnswers,
    });
    const updatedCourses = await api.listCourses();
    state.courses = updatedCourses;
    await selectCourse(course.id, true);
    showToast('테스트 학생 응답을 추가하고 세특을 자동 입력했습니다.');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportCourseCsv(course) {
  const headers = ['학번', '이름'];
  if (course.isJointCurriculum) headers.push('학교');
  for (const f of course.fields) {
    headers.push(f.label);
  }
  headers.push('세부능력 및 특기사항', 'NEIS 바이트', '상태', '제출 시각');

  const escapeCsv = (val) => {
    const str = String(val ?? '').replace(/\r?\n/g, ' ');
    if (/[",]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [headers.map(escapeCsv).join(',')];
  for (const sub of state.submissions) {
    const row = [sub.studentId, sub.studentName];
    if (course.isJointCurriculum) row.push(sub.school || '');
    for (const f of course.fields) {
      row.push((sub.answers && sub.answers[f.id]) || '');
    }
    const text = sub.generatedText || '';
    row.push(
      text,
      calcNeisBytes(text),
      sub.status === 'reviewed' ? '검토 완료' : '자동 입력됨',
      formatDateTime(sub.createdAt)
    );
    rows.push(row.map(escapeCsv).join(','));
  }

  const bom = '\uFEFF';
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${course.title}_세특수집_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('엑셀(CSV) 파일을 다운로드했습니다.');
}

// ============================================================================
// Modals: New Course, QR Code, AI Settings
// ============================================================================

function closeModal() {
  modalRoot.innerHTML = '';
}

function openNewCourseModal() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="new-course-title">
        <div class="modal-head">
          <h3 id="new-course-title">새 수집 과목 만들기</h3>
          <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn">✕</button>
        </div>
        <form id="new-course-form">
          <div class="modal-body">
            <div class="field-group">
              <label for="nc-title">과목명 <span class="req-star">*</span></label>
              <input id="nc-title" type="text" class="input" placeholder="예: 물리학 실험, 고급 화학 (공동교육과정)" required autofocus />
            </div>
            <div class="field-group">
              <label for="nc-desc">학생 안내 문구</label>
              <textarea id="nc-desc" class="textarea" rows="2">한 학기 동안의 수업과 탐구 활동을 돌아보며 아래 항목을 성실하게 작성해 주세요.</textarea>
            </div>
            <div class="switch-row">
              <div class="switch-label">
                <strong>공동교육과정 과목</strong>
                <span>학생 입력 페이지에 '학교' 입력란을 함께 표시합니다.</span>
              </div>
              <label class="switch">
                <input id="nc-joint" type="checkbox" />
                <span class="switch-slider"></span>
              </label>
            </div>
            <p style="font-size:12.5px;color:var(--text-muted);">
              생성 시 기본 7개 항목(새로 알게 된 개념 ~ 내가 발전시킨 능력)이 자동 구성되며, 생성 후 언제든 자유롭게 수정할 수 있습니다.
            </p>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" id="modal-cancel-btn">취소</button>
            <button type="submit" class="btn btn-primary">과목 생성 및 QR코드 보기</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  document.getElementById('new-course-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('nc-title').value.trim();
    const description = document.getElementById('nc-desc').value.trim();
    const isJointCurriculum = document.getElementById('nc-joint').checked;
    if (!title) return;

    try {
      const created = await api.createCourse({
        title,
        description,
        isJointCurriculum,
        isOpen: true,
        fields: cloneDefaultFields(),
      });
      state.courses.unshift(created);
      closeModal();
      await selectCourse(created.id);
      showToast(`'${created.title}' 과목이 생성되었습니다.`);
      openQrModal(created);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function openQrModal(course, fullscreen = false) {
  let currentOrigin = getPreferredOrigin();
  const isStatic = await api.isStaticMode();
  let studentUrl = buildStudentUrl(course, currentOrigin, isStatic);

  const renderModal = async () => {
    studentUrl = buildStudentUrl(course, currentOrigin, isStatic);
    const qrSrc = await api.renderQrDataUrl(studentUrl);
    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-dialog${fullscreen ? ' qr-fullscreen' : ''}" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title">
          <div class="modal-head">
            <h3 id="qr-modal-title">${escapeHtml(course.title)} · 학생 접속 QR코드</h3>
            <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn">✕</button>
          </div>
          <div class="modal-body">
            <div class="qr-showcase">
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;">
                <span class="badge badge-primary">${escapeHtml(course.title)}</span>
                ${course.isJointCurriculum ? '<span class="badge badge-amber">공동교육과정</span>' : ''}
              </div>
              <div class="qr-frame">
                <img id="qr-svg-img" src="${qrSrc}" alt="${escapeHtml(course.title)} 접속 QR코드" />
              </div>
              <p style="font-size:13.5px;color:var(--text-secondary);text-align:center;">
                학생이 스마트폰 카메라로 QR코드를 스캔하면 <strong>${escapeHtml(course.title)}</strong> 입력 페이지로 바로 접속됩니다.<br/>
                <span style="color:var(--text-muted);font-size:12.5px;">(학생 화면에는 세부능력 특기사항 항목과 교사 메뉴가 전혀 보이지 않습니다)</span>
              </p>
              <div class="qr-url-box" id="qr-url-display">${escapeHtml(studentUrl)}</div>
            </div>

            ${
              fullscreen
                ? ''
                : `
              <div class="field-group">
                <label for="qr-origin-input" style="font-size:12.5px;color:var(--text-secondary);">
                  접속 도메인 / 서버 주소 (교실 와이파이 IP나 배포 주소로 변경 가능)
                </label>
                <div style="display:flex;gap:8px;">
                  <input id="qr-origin-input" type="url" class="input" value="${escapeHtml(currentOrigin)}" placeholder="https://example.com 또는 http://192.168.0.10:3000" />
                  <button type="button" id="apply-origin-btn" class="btn btn-secondary btn-sm">적용</button>
                </div>
              </div>
            `
            }

            <div class="qr-actions-grid">
              <button type="button" id="copy-student-url-btn" class="btn btn-primary">
                학생 접속 링크 복사
              </button>
              <a
                href="${qrSrc}"
                download="${escapeHtml(course.title)}_QR코드.png"
                class="btn btn-secondary"
                style="text-decoration:none;"
              >
                QR 이미지 저장 (PNG)
              </a>
              <button type="button" id="toggle-qr-size-btn" class="btn btn-soft">
                ${fullscreen ? '기본 크기로 보기' : '교실 화면 크게 보기'}
              </button>
              <a
                href="${escapeHtml(studentUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-secondary"
                style="text-decoration:none;"
              >
                학생 화면 새 창으로 열기
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });

    document.getElementById('apply-origin-btn')?.addEventListener('click', () => {
      const val = document.getElementById('qr-origin-input')?.value.trim();
      if (!val) return;
      currentOrigin = val.replace(/\/+$/, '');
      setPreferredOrigin(currentOrigin);
      renderModal();
      showToast('QR코드 접속 주소를 변경했습니다.');
    });

    document.getElementById('copy-student-url-btn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(studentUrl);
        showToast('학생 접속 링크를 복사했습니다.');
      } catch {
        showToast('복사에 실패했습니다.', 'error');
      }
    });

    document.getElementById('toggle-qr-size-btn')?.addEventListener('click', () => {
      fullscreen = !fullscreen;
      renderModal();
    });
  };

  renderModal();
}

function openAiSettingsModal(initialTab = 'builtin') {
  let activeTab = initialTab === 'gemini' ? 'api' : initialTab;
  let draft = getAiSettings();
  let geminiKey = getGeminiKey();
  let claudeKey = getClaudeKey();
  let applyToAll = false;

  const activeCourse = getActiveCourse();
  const sampleCourse = activeCourse || { title: '물리학 실험', fields: cloneDefaultFields() };
  const sampleAnswers = {
    new_concept: '빛의 간섭과 회절 원리',
    refined_concept: '마찰력이 접촉 면적이 아니라 수직항력에 비례한다는 개념',
    activity_1: '이중 슬릿 간섭 무늬 측정 실험',
    reason_1: '이론 파장과 실제 측정값을 비교하며 오차 원인을 분석할 수 있었기 때문입니다',
    activity_2: '센서 기반 단진자 주기 측정 탐구',
    reason_2: '측정 데이터를 그래프로 정리해 주기 공식을 직접 검증해 보았습니다',
    developed_ability: '변인 통제 및 실험 데이터 해석 역량',
  };

  const renderPreviewText = () =>
    generateSeteuk({
      answers: sampleAnswers,
      fields: cloneDefaultFields(),
      course: sampleCourse,
      style: draft.defaultStyle,
      aiSettings: draft,
    });

  const renderModal = () => {
    const preview = renderPreviewText();
    const previewBytes = calcNeisBytes(preview);
    const webllm = getWebLlmState();

    const styleOptions = GENERATION_STYLES.map(
      (s) =>
        `<option value="${s.id}"${draft.defaultStyle === s.id ? ' selected' : ''}>${escapeHtml(
          s.label
        )} — ${escapeHtml(s.description)}</option>`
    ).join('');

    const detailOptions = AI_DETAIL_LEVELS.map(
      (d) =>
        `<option value="${d.id}"${draft.detailLevel === d.id ? ' selected' : ''}>${escapeHtml(
          d.label
        )} (${escapeHtml(d.description)})</option>`
    ).join('');

    const toneOptions = AI_ENDING_TONES.map(
      (t) =>
        `<option value="${t.id}"${draft.endingTone === t.id ? ' selected' : ''}>${escapeHtml(
          t.label
        )}</option>`
    ).join('');

    const closingOptions = AI_CLOSING_TEMPLATES.map(
      (c) =>
        `<option value="${c.id}"${draft.closingTemplate === c.id ? ' selected' : ''}>${escapeHtml(
          c.label
        )}</option>`
    ).join('');

    const webllmModelOptions = WEBLLM_MODELS.map(
      (m) =>
        `<option value="${m.id}"${draft.webllmModel === m.id ? ' selected' : ''}>${escapeHtml(
          m.label
        )}</option>`
    ).join('');

    const geminiModelOptions = GEMINI_MODELS.map(
      (m) =>
        `<option value="${m.id}"${draft.geminiModel === m.id ? ' selected' : ''}>${escapeHtml(
          m.label
        )}</option>`
    ).join('');

    const claudeModelOptions = CLAUDE_MODELS.map(
      (m) =>
        `<option value="${m.id}"${draft.claudeModel === m.id ? ' selected' : ''}>${escapeHtml(
          m.label
        )}</option>`
    ).join('');

    const apiDot = geminiKey.trim() || claudeKey.trim() ? ' ●' : '';
    const webllmDot = webllm.loadedModel ? ' ●' : '';

    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-dialog ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
          <div class="modal-head">
            <h3 id="ai-modal-title">AI 및 세특 자동 작성 설정</h3>
            <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn">✕</button>
          </div>

          <div class="modal-tabs" role="tablist">
            <button type="button" class="modal-tab-btn${activeTab === 'builtin' ? ' active' : ''}" data-ai-tab="builtin">
              내장 규칙 엔진
            </button>
            <button type="button" class="modal-tab-btn${activeTab === 'cli' ? ' active' : ''}" data-ai-tab="cli">
              로컬 CLI (구독)${state.cliStatus?.available ? ' ●' : ''}
            </button>
            <button type="button" class="modal-tab-btn${activeTab === 'webllm' ? ' active' : ''}" data-ai-tab="webllm">
              WebLLM (로컬)${webllmDot}
            </button>
            <button type="button" class="modal-tab-btn${activeTab === 'api' ? ' active' : ''}" data-ai-tab="api">
              Claude · Gemini API${apiDot}
            </button>
          </div>

          <form id="ai-settings-form">
            <div class="modal-body">
              ${
                activeTab === 'builtin'
                  ? `
                <div class="field-group">
                  <label for="ai-default-style">기본 문체 스타일</label>
                  <select id="ai-default-style" class="select">${styleOptions}</select>
                </div>

                <div class="form-grid-2">
                  <div class="field-group">
                    <label for="ai-detail-level">서술 분량 · 상세도</label>
                    <select id="ai-detail-level" class="select">${detailOptions}</select>
                  </div>
                  <div class="field-group">
                    <label for="ai-ending-tone">종결 어미 톤</label>
                    <select id="ai-ending-tone" class="select">${toneOptions}</select>
                  </div>
                </div>

                <div class="form-grid-2">
                  <div class="field-group">
                    <label for="ai-closing-template">마무리 문장 스타일</label>
                    <select id="ai-closing-template" class="select">${closingOptions}</select>
                  </div>
                  <div class="field-group">
                    <label for="ai-focus-keywords">교사 강조 키워드 (쉼표 구분)</label>
                    <input id="ai-focus-keywords" type="text" class="input" value="${escapeHtml(
                      draft.focusKeywords || ''
                    )}" placeholder="예: 자기주도적 탐구, 과학적 의사소통" />
                  </div>
                </div>

                <div class="switch-row">
                  <div class="switch-label">
                    <strong>과목명 서두 포함</strong>
                    <span>문장 시작에 '${escapeHtml(sampleCourse.title)} 수업에서...' 형태로 과목명을 포함합니다.</span>
                  </div>
                  <label class="switch">
                    <input id="ai-include-course" type="checkbox" ${draft.includeCourseTitle ? 'checked' : ''} />
                    <span class="switch-slider"></span>
                  </label>
                </div>

                <div class="switch-row">
                  <div class="switch-label">
                    <strong>오개념 교정(2번 항목) 대비 강조</strong>
                    <span>'기존에 막연히 알던 개념 → 과학적 근거로 재정립' 흐름을 부각합니다.</span>
                  </div>
                  <label class="switch">
                    <input id="ai-emphasize-misconception" type="checkbox" ${
                      draft.emphasizeMisconception ? 'checked' : ''
                    } />
                    <span class="switch-slider"></span>
                  </label>
                </div>

                <div class="switch-row">
                  <div class="switch-label">
                    <strong>NEIS 1,500 Bytes 초과 시 자동 압축</strong>
                    <span>생성된 세특이 1,500 Bytes를 넘으면 자동으로 간결 문체로 조절합니다.</span>
                  </div>
                  <label class="switch">
                    <input id="ai-auto-fit" type="checkbox" ${draft.autoFitNeisLimit ? 'checked' : ''} />
                    <span class="switch-slider"></span>
                  </label>
                </div>

                <div class="ai-preview-box">
                  <div class="ai-preview-head">
                    <span>실시간 내장 엔진 생성 미리보기</span>
                    <span id="ai-preview-bytes" class="byte-count-mono${
                      previewBytes > NEIS_BYTE_LIMIT ? ' over' : ''
                    }">${previewBytes.toLocaleString()} / ${NEIS_BYTE_LIMIT.toLocaleString()} Bytes · ${
                      preview.length
                    }자</span>
                  </div>
                  <div id="ai-preview-text" class="ai-preview-text">${escapeHtml(preview)}</div>
                </div>

                ${
                  state.submissions.length > 0
                    ? `
                  <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
                    <input id="ai-apply-all" type="checkbox" ${applyToAll ? 'checked' : ''} />
                    <span>저장 시 현재 과목의 기존 제출 응답(${state.submissions.length}명) 세특에도 즉시 재적용</span>
                  </label>
                `
                    : ''
                }
              `
                  : activeTab === 'cli'
                  ? `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  <p style="font-size:13.5px;color:var(--text-secondary);flex:1;">
                    내 PC에서 <code>npm start</code>로 실행한 상태에서, 이미 구독·로그인된 <strong>Claude Code / Gemini CLI / Codex CLI</strong>를 추가 API 비용 없이 바로 호출합니다.
                  </p>
                  <span class="badge ${state.cliStatus?.available ? 'badge-success' : 'badge-muted'}">
                    ${state.cliStatus?.available ? '로컬 서버 연결됨' : '정적 웹 모드 (GitHub Pages)'}
                  </span>
                </div>

                <div class="cli-cards-grid">
                  ${[
                    { key: 'claude', provider: 'cli_claude', name: 'Claude Code', cmd: 'claude', hint: 'Claude Pro/Max 구독' },
                    { key: 'gemini', provider: 'cli_gemini', name: 'Gemini CLI', cmd: 'gemini', hint: 'Google 계정 로그인' },
                    { key: 'codex', provider: 'cli_codex', name: 'GPT (Codex)', cmd: 'codex', hint: 'ChatGPT Plus/Pro 구독' },
                  ]
                    .map((item) => {
                      const info = state.cliStatus?.providers?.[item.key];
                      const ready = Boolean(state.cliStatus?.available && info?.installed);
                      const isSelected = draft.activeAiProvider === item.provider;
                      return `
                        <div class="cli-card${ready ? ' ready' : ''}">
                          <div class="cli-card-title">${item.name}</div>
                          <div class="cli-card-sub">
                            ${
                              ready
                                ? '설치 확인됨 · 사용 가능'
                                : state.cliStatus?.available
                                ? `미설치 (${item.cmd} CLI 필요)`
                                : item.hint
                            }
                          </div>
                          <button
                            type="button"
                            class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'} btn-sm"
                            data-select-cli="${item.provider}"
                            ${ready ? '' : 'disabled'}
                          >
                            ${isSelected ? '기본 AI 선택됨' : '기본 AI로 사용'}
                          </button>
                        </div>
                      `;
                    })
                    .join('')}
                </div>

                <div class="ai-preview-box">
                  <div class="ai-preview-head">
                    <span>로컬 PC 실행 및 Google Drive 연동 흐름</span>
                  </div>
                  <ol class="setup-steps">
                    <li>내 PC에서 저장소를 내려받고 터미널에서 <code>npm install && npm start</code>를 실행합니다.</li>
                    <li>상단 <strong>Google 시트 연동</strong>을 연결해 두면, 학생들은 GitHub Pages QR코드로 스마트폰에서 제출하고, 교사는 내 PC 로컬 CLI(무료/구독)로 세특을 작성해 구글 드라이브 시트에 자동 저장합니다.</li>
                    <li>집·학교 어느 PC에서도 Google Drive에서 해당 구글 시트를 열면 최신 세특을 바로 확인할 수 있습니다.</li>
                  </ol>
                </div>

                <div class="field-group">
                  <label for="ai-instruction">추가 작성 지침 (로컬 CLI · WebLLM · API 공통)</label>
                  <textarea id="ai-instruction" class="textarea" rows="2" placeholder="예: 실험 과정의 오차 분석과 과학적 탐구 태도를 자연스럽게 강조해 주세요.">${escapeHtml(
                    draft.geminiInstruction || ''
                  )}</textarea>
                </div>
              `
                  : activeTab === 'webllm'
                  ? `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  <p style="font-size:13.5px;color:var(--text-secondary);flex:1;">
                    외부 API 키 없이 내 브라우저의 GPU(WebGPU)로 오픈소스 LLM을 직접 실행합니다. 학생 응답이 외부로 전송되지 않습니다.
                  </p>
                  <span class="badge ${webllm.supported ? 'badge-success' : 'badge-danger'}">
                    ${webllm.supported ? 'WebGPU 지원됨' : 'WebGPU 미지원'}
                  </span>
                </div>

                <div class="field-group">
                  <label for="webllm-model-select">WebLLM 모델 선택 (목록)</label>
                  <select id="webllm-model-select" class="select">${webllmModelOptions}</select>
                </div>

                <div class="ai-preview-box">
                  <div class="ai-preview-head">
                    <span>모델 상태</span>
                    <span id="webllm-status-badge" class="badge ${
                      webllm.loadedModel ? 'badge-success' : 'badge-muted'
                    }">
                      ${webllm.loadedModel ? `준비됨 (${webllm.loadedModel})` : '미로드'}
                    </span>
                  </div>
                  <div id="webllm-progress-text" style="font-size:12.5px;color:var(--text-secondary);">
                    ${escapeHtml(
                      webllm.progressText ||
                        '처음 1회 모델 다운로드(1~4.5GB) 후 브라우저에 캐시되어 빠르게 실행됩니다.'
                    )}
                  </div>
                  <div class="byte-bar-track">
                    <div id="webllm-progress-bar" class="byte-bar-fill" style="width:${webllm.progressPct || 0}%"></div>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
                    <button type="button" id="webllm-load-btn" class="btn btn-soft btn-sm" ${
                      !webllm.supported || webllm.loading ? 'disabled' : ''
                    }>
                      ${webllm.loading ? '불러오는 중...' : '선택 모델 미리 불러오기'}
                    </button>
                    ${
                      webllm.loadedModel
                        ? '<button type="button" id="webllm-unload-btn" class="btn btn-ghost btn-sm">메모리 해제</button>'
                        : ''
                    }
                  </div>
                </div>

                <div class="field-group">
                  <label for="ai-temp-range">문장 다양성 (Temperature: <span id="ai-temp-val">${Number(
                    draft.geminiTemperature ?? 0.5
                  ).toFixed(1)}</span>)</label>
                  <div class="range-row">
                    <span style="font-size:12px;color:var(--text-muted);">차분</span>
                    <input id="ai-temp-range" type="range" min="0.1" max="1.0" step="0.1" value="${Number(
                      draft.geminiTemperature ?? 0.5
                    )}" />
                    <span style="font-size:12px;color:var(--text-muted);">풍부</span>
                  </div>
                </div>

                <div class="field-group">
                  <label for="ai-instruction">추가 작성 지침 (WebLLM · API 공통)</label>
                  <textarea id="ai-instruction" class="textarea" rows="2" placeholder="예: 실험 과정의 오차 분석과 과학적 탐구 태도를 자연스럽게 강조해 주세요.">${escapeHtml(
                    draft.geminiInstruction || ''
                  )}</textarea>
                </div>
              `
                  : `
                <div class="field-group">
                  <label for="ai-active-provider">기본 생성형 AI 공급자 (상세 화면 기본 선택)</label>
                  <select id="ai-active-provider" class="select">
                    <option value="webllm"${draft.activeAiProvider === 'webllm' ? ' selected' : ''}>WebLLM (브라우저 로컬 AI · 무료)</option>
                    <option value="gemini"${draft.activeAiProvider === 'gemini' ? ' selected' : ''}>Google Gemini API</option>
                    <option value="claude"${draft.activeAiProvider === 'claude' ? ' selected' : ''}>Anthropic Claude API</option>
                  </select>
                </div>

                <div class="ai-preview-box">
                  <div class="ai-preview-head">
                    <span>Google Gemini API</span>
                    <span class="badge ${geminiKey.trim() ? 'badge-success' : 'badge-muted'}">
                      ${geminiKey.trim() ? '키 등록됨' : '미등록'}
                    </span>
                  </div>
                  <div class="form-grid-2">
                    <div class="field-group">
                      <label for="gemini-key-input">Gemini API Key</label>
                      <input id="gemini-key-input" type="password" class="input" value="${escapeHtml(
                        geminiKey
                      )}" placeholder="AIza..." autocomplete="off" />
                    </div>
                    <div class="field-group">
                      <label for="gemini-model-select">Gemini 모델 선택</label>
                      <select id="gemini-model-select" class="select">${geminiModelOptions}</select>
                    </div>
                  </div>
                </div>

                <div class="ai-preview-box">
                  <div class="ai-preview-head">
                    <span>Anthropic Claude API</span>
                    <span class="badge ${claudeKey.trim() ? 'badge-success' : 'badge-muted'}">
                      ${claudeKey.trim() ? '키 등록됨' : '미등록'}
                    </span>
                  </div>
                  <div class="form-grid-2">
                    <div class="field-group">
                      <label for="claude-key-input">Claude API Key</label>
                      <input id="claude-key-input" type="password" class="input" value="${escapeHtml(
                        claudeKey
                      )}" placeholder="sk-ant-..." autocomplete="off" />
                    </div>
                    <div class="field-group">
                      <label for="claude-model-select">Claude 모델 선택</label>
                      <select id="claude-model-select" class="select">${claudeModelOptions}</select>
                    </div>
                  </div>
                </div>

                <div class="field-group">
                  <label for="ai-temp-range">문장 다양성 (Temperature: <span id="ai-temp-val">${Number(
                    draft.geminiTemperature ?? 0.5
                  ).toFixed(1)}</span>)</label>
                  <div class="range-row">
                    <span style="font-size:12px;color:var(--text-muted);">차분</span>
                    <input id="ai-temp-range" type="range" min="0.1" max="1.0" step="0.1" value="${Number(
                      draft.geminiTemperature ?? 0.5
                    )}" />
                    <span style="font-size:12px;color:var(--text-muted);">풍부</span>
                  </div>
                </div>

                <div class="field-group">
                  <label for="ai-instruction">추가 작성 지침 (WebLLM · API 공통)</label>
                  <textarea id="ai-instruction" class="textarea" rows="2" placeholder="예: 실험 과정의 오차 분석과 협력적 태도를 자연스럽게 강조해 주세요.">${escapeHtml(
                    draft.geminiInstruction || ''
                  )}</textarea>
                </div>

                <p style="font-size:12px;color:var(--text-muted);">
                  * 모든 API 키는 서버로 전송되지 않고 현재 사용 중인 교사 브라우저(localStorage)에만 안전하게 보관됩니다.
                </p>
              `
              }
            </div>

            <div class="modal-foot" style="justify-content:space-between;">
              <button type="button" class="btn btn-ghost btn-sm" id="ai-reset-btn">기본값 복원</button>
              <div style="display:flex;gap:8px;">
                <button type="button" class="btn btn-secondary" id="modal-cancel-btn">취소</button>
                <button type="submit" class="btn btn-primary">설정 저장</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    const updateLivePreview = () => {
      const next = renderPreviewText();
      const bytes = calcNeisBytes(next);
      const textEl = document.getElementById('ai-preview-text');
      const bytesEl = document.getElementById('ai-preview-bytes');
      if (textEl) textEl.textContent = next;
      if (bytesEl) {
        bytesEl.textContent = `${bytes.toLocaleString()} / ${NEIS_BYTE_LIMIT.toLocaleString()} Bytes · ${next.length}자`;
        bytesEl.className = `byte-count-mono${bytes > NEIS_BYTE_LIMIT ? ' over' : ''}`;
      }
    };

    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn')?.addEventListener('click', closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });

    document.querySelectorAll('[data-ai-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-ai-tab');
        renderModal();
      });
    });

    document.getElementById('ai-reset-btn')?.addEventListener('click', () => {
      draft = { ...DEFAULT_AI_SETTINGS };
      renderModal();
      showToast('AI 설정을 기본값으로 되돌렸습니다.');
    });

    // Built-in tab bindings
    document.getElementById('ai-default-style')?.addEventListener('change', (e) => {
      draft.defaultStyle = e.target.value;
      updateLivePreview();
    });
    document.getElementById('ai-detail-level')?.addEventListener('change', (e) => {
      draft.detailLevel = e.target.value;
      updateLivePreview();
    });
    document.getElementById('ai-ending-tone')?.addEventListener('change', (e) => {
      draft.endingTone = e.target.value;
      updateLivePreview();
    });
    document.getElementById('ai-closing-template')?.addEventListener('change', (e) => {
      draft.closingTemplate = e.target.value;
      updateLivePreview();
    });
    document.getElementById('ai-focus-keywords')?.addEventListener('input', (e) => {
      draft.focusKeywords = e.target.value;
      updateLivePreview();
    });
    document.getElementById('ai-include-course')?.addEventListener('change', (e) => {
      draft.includeCourseTitle = e.target.checked;
      updateLivePreview();
    });
    document.getElementById('ai-emphasize-misconception')?.addEventListener('change', (e) => {
      draft.emphasizeMisconception = e.target.checked;
      updateLivePreview();
    });
    document.getElementById('ai-auto-fit')?.addEventListener('change', (e) => {
      draft.autoFitNeisLimit = e.target.checked;
      updateLivePreview();
    });
    document.getElementById('ai-apply-all')?.addEventListener('change', (e) => {
      applyToAll = e.target.checked;
    });

    // WebLLM tab bindings
    document.getElementById('webllm-model-select')?.addEventListener('change', (e) => {
      draft.webllmModel = e.target.value;
    });
    document.getElementById('webllm-load-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('webllm-load-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '불러오는 중...';
      }
      try {
        await loadWebLlmModel(draft.webllmModel, ({ progress, text }) => {
          const textEl = document.getElementById('webllm-progress-text');
          const barEl = document.getElementById('webllm-progress-bar');
          if (textEl) textEl.textContent = text;
          if (barEl) barEl.style.width = `${progress}%`;
        });
        draft.activeAiProvider = 'webllm';
        saveAiSettings(draft);
        showToast('WebLLM 모델 준비가 완료되었습니다!');
        renderModal();
      } catch (err) {
        showToast(err.message || 'WebLLM 모델 로드에 실패했습니다.', 'error');
        renderModal();
      }
    });
    document.getElementById('webllm-unload-btn')?.addEventListener('click', async () => {
      await unloadWebLlm();
      showToast('WebLLM 모델 메모리를 해제했습니다.');
      renderModal();
    });

    // API tab bindings
    document.getElementById('ai-active-provider')?.addEventListener('change', (e) => {
      draft.activeAiProvider = e.target.value;
    });
    document.getElementById('gemini-key-input')?.addEventListener('input', (e) => {
      geminiKey = e.target.value;
    });
    document.getElementById('gemini-model-select')?.addEventListener('change', (e) => {
      draft.geminiModel = e.target.value;
    });
    document.getElementById('claude-key-input')?.addEventListener('input', (e) => {
      claudeKey = e.target.value;
    });
    document.getElementById('claude-model-select')?.addEventListener('change', (e) => {
      draft.claudeModel = e.target.value;
    });

    // Local CLI tab bindings
    document.querySelectorAll('[data-select-cli]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.activeAiProvider = btn.getAttribute('data-select-cli');
        renderModal();
        showToast('기본 생성형 AI를 선택한 로컬 CLI로 지정했습니다.');
      });
    });

    // Shared Temperature & Instruction bindings
    document.getElementById('ai-temp-range')?.addEventListener('input', (e) => {
      draft.geminiTemperature = Number(e.target.value);
      const valEl = document.getElementById('ai-temp-val');
      if (valEl) valEl.textContent = draft.geminiTemperature.toFixed(1);
    });
    document.getElementById('ai-instruction')?.addEventListener('input', (e) => {
      draft.geminiInstruction = e.target.value;
    });

    document.getElementById('ai-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveAiSettings(draft);
      setGeminiKey(geminiKey);
      setClaudeKey(claudeKey);
      closeModal();

      if (applyToAll && activeCourse && state.submissions.length > 0) {
        try {
          const updates = state.submissions.map((sub) => {
            const generatedText = generateSeteuk({
              answers: sub.answers,
              fields: activeCourse.fields,
              course: activeCourse,
              style: draft.defaultStyle,
              aiSettings: draft,
            });
            return { id: sub.id, generatedText, style: draft.defaultStyle, status: 'auto' };
          });
          await api.bulkUpdateSubmissions(updates);
          await selectCourse(activeCourse.id, true);
          showToast(`AI 설정을 저장하고 ${updates.length}명의 세특에 즉시 적용했습니다.`);
          return;
        } catch (err) {
          showToast(err.message, 'error');
        }
      }

      renderTeacherApp();
      showToast('AI 설정을 저장했습니다.');
    });
  };

  renderModal();
}

function openSheetsModal() {
  const currentUrl = getGasUrl();
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-dialog ai-modal" role="dialog" aria-modal="true" aria-labelledby="sheets-modal-title">
        <div class="modal-head">
          <h3 id="sheets-modal-title">Google 드라이브(스프레드시트) 실시간 연동</h3>
          <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn">✕</button>
        </div>
        <form id="sheets-settings-form">
          <div class="modal-body">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <p style="font-size:13.5px;color:var(--text-secondary);flex:1;">
                교사의 Google 드라이브 스프레드시트를 연동하면 <strong>학생 스마트폰 QR 제출 → 구글 시트 실시간 수집 → 교사 PC(로컬 CLI/AI) 세특 자동 작성 → 구글 시트 저장</strong>이 연결되어 어느 PC에서도 구글 로그인만으로 결과를 확인할 수 있습니다.
              </p>
              <span class="badge ${currentUrl ? 'badge-success' : 'badge-muted'}">
                ${currentUrl ? '연동됨' : '미연동'}
              </span>
            </div>

            <div class="ai-preview-box">
              <div class="ai-preview-head">
                <span>3단계 초기 설정 (최초 1회만 진행)</span>
                <button type="button" id="copy-gas-code-btn" class="btn btn-soft btn-sm">
                  Apps Script 코드 복사
                </button>
              </div>
              <ol class="setup-steps">
                <li><strong>Google Drive</strong>에서 새 <strong>Google 스프레드시트</strong>를 만든 뒤, 상단 메뉴 <code>확장 프로그램 → Apps Script</code>를 엽니다.</li>
                <li>기존 코드를 모두 지우고 위 <strong>Apps Script 코드 복사</strong> 버튼으로 복사한 코드를 붙여넣고 저장(<code>Ctrl+S</code>)합니다.</li>
                <li>우측 상단 <code>배포 → 새 배포 → 유형: 웹 앱</code>에서 <strong>액세스 권한: 모든 사용자</strong>로 배포한 뒤 생성된 <code>https://script.google.com/macros/s/.../exec</code> URL을 아래에 붙여넣으세요.</li>
              </ol>
            </div>

            <div class="field-group">
              <label for="gas-url-input">Google Apps Script 웹 앱 URL</label>
              <input
                id="gas-url-input"
                type="url"
                class="input"
                value="${escapeHtml(currentUrl)}"
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                autocomplete="off"
              />
            </div>

            <p style="font-size:12px;color:var(--text-muted);">
              * 연동 후 생성하는 QR코드에는 시트 ID(<code>?gs=...</code>)가 자동으로 포함되어 학생들이 스마트폰(LTE/5G)으로 바로 구글 시트에 제출할 수 있습니다. 과목별 읽기 전용 탭도 시트 안에 자동 정리됩니다.
            </p>
          </div>
          <div class="modal-foot" style="justify-content:space-between;">
            ${
              currentUrl
                ? '<button type="button" class="btn btn-danger-soft btn-sm" id="disconnect-gas-btn">연동 해제</button>'
                : '<span></span>'
            }
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-secondary" id="modal-cancel-btn">취소</button>
              <button type="submit" id="save-gas-btn" class="btn btn-primary">연결 테스트 및 저장</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  document.getElementById('copy-gas-code-btn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('./apps-script-code.txt');
      if (!res.ok) throw new Error('코드 파일을 불러오지 못했습니다.');
      const code = await res.text();
      await navigator.clipboard.writeText(code);
      showToast('Apps Script 코드(Code.gs)를 클립보드에 복사했습니다.');
    } catch (err) {
      showToast(err.message || '복사에 실패했습니다.', 'error');
    }
  });

  document.getElementById('disconnect-gas-btn')?.addEventListener('click', async () => {
    setGasUrl('');
    closeModal();
    await initTeacherApp();
    showToast('Google 시트 연동을 해제했습니다.');
  });

  document.getElementById('sheets-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('gas-url-input').value.trim();
    const saveBtn = document.getElementById('save-gas-btn');
    if (!url) {
      setGasUrl('');
      closeModal();
      await initTeacherApp();
      showToast('Google 시트 연동을 해제했습니다.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '연결 확인 중...';
    try {
      const result = await testGasConnection(url);
      setGasUrl(url);
      closeModal();
      await initTeacherApp();
      showToast(`'${result.spreadsheetName || 'Google 시트'}'와 성공적으로 연동되었습니다!`);
    } catch (err) {
      showToast(err.message || '연결에 실패했습니다. 웹 앱 권한(모든 사용자)을 확인해 주세요.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '연결 테스트 및 저장';
    }
  });
}
