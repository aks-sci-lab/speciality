import {
  cloneDefaultFields,
  FIELD_ROLES,
  GENERATION_STYLES,
} from './defaults.js';
import {
  calcNeisBytes,
  generateSeteuk,
  NEIS_BYTE_LIMIT,
  refineWithGemini,
} from './generator.js';
import { api, encodeCourseConfig } from './storage.js';

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

function getDefaultBaseUrl() {
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
  if (includeCfg && typeof course === 'object') {
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

if (studentCourseId) {
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
};

function getActiveCourse() {
  return state.courses.find((c) => c.id === state.activeCourseId) || null;
}

function getSelectedSubmission() {
  return state.submissions.find((s) => s.id === state.selectedSubmissionId) || null;
}

async function initTeacherApp() {
  try {
    const courses = await api.listCourses();
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
            <span class="brand-sub">Speciality · 교사 관리</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button id="open-ai-settings-btn" type="button" class="btn btn-ghost btn-sm">
            AI 설정${getGeminiKey() ? ' ●' : ''}
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

  const hasGemini = Boolean(getGeminiKey());

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
            자동 다시 생성
          </button>
          ${
            hasGemini
              ? `<button id="ai-refine-btn" type="button" class="btn btn-secondary btn-sm" ${
                  state.isGeneratingAi ? 'disabled' : ''
                }>
                  ${state.isGeneratingAi ? 'AI 다듬는 중...' : 'AI로 다듬기'}
                </button>`
              : ''
          }
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
  document.getElementById('open-ai-settings-btn')?.addEventListener('click', openAiSettingsModal);

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
      const updates = state.submissions.map((sub) => {
        const style = sub.style || 'inquiry';
        const generatedText = generateSeteuk({
          answers: sub.answers,
          fields: course.fields,
          course,
          style,
        });
        return { id: sub.id, generatedText, style, status: 'auto' };
      });
      await api.bulkUpdateSubmissions(updates);
      await selectCourse(course.id, true);
      showToast(`${updates.length}명의 세특을 일괄 다시 생성했습니다.`);
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
    const style = sub.style || 'inquiry';
    const nextText = generateSeteuk({
      answers: sub.answers,
      fields: course.fields,
      course,
      style,
    });
    try {
      const updated = await api.updateSubmission(sub.id, {
        generatedText: nextText,
        style,
        status: 'auto',
      });
      replaceLocalSubmission(updated);
      renderTeacherApp();
      showToast('세특 초안을 다시 생성했습니다.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Optional Gemini AI refine
  document.getElementById('ai-refine-btn')?.addEventListener('click', async () => {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      openAiSettingsModal();
      return;
    }
    state.isGeneratingAi = true;
    renderTeacherApp();
    try {
      const refined = await refineWithGemini({
        apiKey,
        course,
        student: sub,
        answers: sub.answers,
        fields: course.fields,
        style: sub.style || 'inquiry',
      });
      const updated = await api.updateSubmission(sub.id, {
        generatedText: refined,
        status: 'auto',
      });
      replaceLocalSubmission(updated);
      showToast('AI로 세특 문장을 자연스럽게 다듬었습니다.');
    } catch (err) {
      showToast(err.message || 'AI 다듬기에 실패했습니다.', 'error');
    } finally {
      state.isGeneratingAi = false;
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

function openAiSettingsModal() {
  const existingKey = getGeminiKey();
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
        <div class="modal-head">
          <h3 id="ai-modal-title">AI 세특 다듬기 설정 (선택 사항)</h3>
          <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn">✕</button>
        </div>
        <form id="ai-settings-form">
          <div class="modal-body">
            <p style="font-size:13.5px;color:var(--text-secondary);">
              기본 내장 엔진만으로도 1~7번 항목을 토대로 NEIS 문체 세특이 즉시 자동 작성됩니다.<br/>
              추가로 <strong>Gemini API 키</strong>를 입력해 두면, 개별 학생 세특을 AI로 한 번 더 자연스럽게 다듬는 버튼을 사용할 수 있습니다.
            </p>
            <div class="field-group">
              <label for="gemini-key-input">Gemini API Key (이 브라우저에만 저장됨)</label>
              <input id="gemini-key-input" type="password" class="input" value="${escapeHtml(existingKey)}" placeholder="AIza..." autocomplete="off" />
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" id="modal-cancel-btn">취소</button>
            <button type="submit" class="btn btn-primary">저장</button>
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

  document.getElementById('ai-settings-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = document.getElementById('gemini-key-input').value;
    setGeminiKey(key);
    closeModal();
    renderTeacherApp();
    showToast(key.trim() ? 'Gemini API 키를 저장했습니다.' : 'API 키를 삭제했습니다.');
  });
}
