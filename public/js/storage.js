/**
 * Hybrid API + Static (GitHub Pages) storage client for Speciality 세특 수집 웹앱
 * - Automatically detects Node.js backend (/api/health)
 * - Falls back seamlessly to localStorage + compact URL-encoded course config on GitHub Pages
 * - Renders crisp QR codes locally via self-hosted qrcode.mjs (zero external CDN dependency)
 */

import {
  cloneDefaultFields,
  createCourseObject,
  DEFAULT_AI_SETTINGS,
  DEFAULT_FIELDS,
} from './defaults.js';
import { generateSeteuk } from './generator.js';
import qrcode from './vendor/qrcode.mjs';

const LS_COURSES_KEY = 'speciality_v1_courses';
const LS_SUBS_KEY = 'speciality_v1_submissions';
const LS_AI_SETTINGS_KEY = 'speciality_v1_ai_settings';

const DEFAULT_DESCRIPTION =
  '한 학기 동안의 수업과 탐구 활동을 돌아보며 아래 항목을 성실하게 작성해 주세요.';

let backendAvailable = null;

async function checkBackend() {
  if (backendAvailable !== null) return backendAvailable;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      backendAvailable = Boolean(data?.ok);
      return backendAvailable;
    }
  } catch {
    // Static host fallback
  }
  backendAvailable = false;
  return false;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data?.error ? data.error : `요청 실패 (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ============================================================================
// Built-in AI Settings persistence
// ============================================================================

export function getAiSettings() {
  try {
    const raw = localStorage.getItem(LS_AI_SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_AI_SETTINGS };
}

export function saveAiSettings(settings) {
  const merged = { ...DEFAULT_AI_SETTINGS, ...(settings || {}) };
  localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// ============================================================================
// LocalStorage helpers (GitHub Pages / static fallback)
// ============================================================================

function readLocalCourses() {
  try {
    const raw = localStorage.getItem(LS_COURSES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  const initial = [
    createCourseObject({
      id: 'sci_lab_01',
      title: '과학탐구실험',
      description:
        '한 학기 동안의 수업과 탐구 활동을 돌아보며 아래 항목을 성실하게 작성해 주세요. 제출 내용은 수업 기록 참고 자료로 활용됩니다.',
      isJointCurriculum: false,
      isOpen: true,
      fields: cloneDefaultFields(),
    }),
  ];
  localStorage.setItem(LS_COURSES_KEY, JSON.stringify(initial));
  return initial;
}

function writeLocalCourses(courses) {
  localStorage.setItem(LS_COURSES_KEY, JSON.stringify(courses));
}

function readLocalSubs() {
  try {
    const raw = localStorage.getItem(LS_SUBS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function writeLocalSubs(subs) {
  localStorage.setItem(LS_SUBS_KEY, JSON.stringify(subs));
}

// ============================================================================
// Compact UTF-8 base64url encoder/decoder for low-density QR URLs
// ============================================================================

function isUsingDefaultFields(fields = []) {
  if (!Array.isArray(fields) || fields.length !== DEFAULT_FIELDS.length) return false;
  return fields.every((f, idx) => {
    const d = DEFAULT_FIELDS[idx];
    return (
      f.id === d.id &&
      f.label === d.label &&
      f.type === d.type &&
      f.role === d.role &&
      Boolean(f.required) === Boolean(d.required)
    );
  });
}

export function encodeCourseConfig(course) {
  const minimal = {
    t: course.title,
    j: course.isJointCurriculum ? 1 : 0,
  };
  if (course.isOpen === false) minimal.o = 0;
  if (course.description && course.description.trim() !== DEFAULT_DESCRIPTION) {
    minimal.d = course.description.trim();
  }
  // Only include fields in QR URL if teacher customized them (keeps QR URL ultra-short!)
  if (!isUsingDefaultFields(course.fields)) {
    minimal.f = (course.fields || []).map((f) => {
      const item = {
        i: f.id,
        l: f.label,
        y: f.type || 'textarea',
        r: f.role || 'custom',
        q: f.required ? 1 : 0,
      };
      if (f.options && f.options.length > 0) item.o = f.options;
      return item;
    });
  }

  const json = JSON.stringify(minimal);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCourseConfig(encoded, fallbackId = 'course') {
  try {
    const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const m = JSON.parse(json);

    const defaultById = new Map(DEFAULT_FIELDS.map((d) => [d.id, d]));

    return {
      id: m.id || fallbackId,
      title: m.t || '수집 과목',
      description: m.d !== undefined ? m.d : DEFAULT_DESCRIPTION,
      isJointCurriculum: Boolean(m.j),
      isOpen: m.o !== 0,
      fields: Array.isArray(m.f)
        ? m.f.map((f) => ({
            id: f.i,
            label: f.l,
            placeholder: f.p || defaultById.get(f.i)?.placeholder || '',
            type: f.y || 'textarea',
            role: f.r || 'custom',
            required: Boolean(f.q),
            options: Array.isArray(f.o) ? f.o : [],
          }))
        : cloneDefaultFields(),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Self-hosted Browser QR Code PNG Data URL Generator (Zero CDN)
// ============================================================================

function renderLocalQrDataUrl(text) {
  // Use error correction 'M' for short URLs, 'L' for longer URLs so QR always fits cleanly
  const ecLevel = text.length > 260 ? 'L' : 'M';
  const qr = qrcode(0, ecLevel);
  qr.addData(text, 'Byte');
  qr.make();

  const moduleCount = qr.getModuleCount();
  const quietZone = 3;
  const totalModules = moduleCount + quietZone * 2;
  const targetSize = 512;
  const cellSize = Math.max(4, Math.floor(targetSize / totalModules));
  const canvasSize = totalModules * cellSize;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      ctx.fillStyle = '#142927';
      for (let r = 0; r < moduleCount; r += 1) {
        for (let c = 0; c < moduleCount; c += 1) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quietZone) * cellSize, (r + quietZone) * cellSize, cellSize, cellSize);
          }
        }
      }
      return canvas.toDataURL('image/png');
    }
  }

  return qr.createDataURL(6, 12);
}

export const api = {
  async isStaticMode() {
    const hasBackend = await checkBackend();
    return !hasBackend;
  },

  async listCourses() {
    if (await checkBackend()) {
      const { courses } = await request('/api/courses');
      return courses;
    }
    const courses = readLocalCourses();
    const subs = readLocalSubs();
    return courses.map((c) => ({
      ...c,
      submissionCount: subs.filter((s) => s.courseId === c.id).length,
    }));
  },

  async getCourse(courseId, cfgParam = null) {
    if (await checkBackend()) {
      const { course } = await request(`/api/courses/${encodeURIComponent(courseId)}`);
      return course;
    }
    const local = readLocalCourses().find((c) => c.id === courseId);
    if (local) return local;
    if (cfgParam) {
      const decoded = decodeCourseConfig(cfgParam, courseId);
      if (decoded) return decoded;
    }
    throw new Error('존재하지 않는 과목입니다. 선생님께 새 QR코드를 요청해 주세요.');
  },

  async createCourse(payload) {
    if (await checkBackend()) {
      const { course } = await request('/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return course;
    }
    const courses = readLocalCourses();
    const course = createCourseObject(payload);
    courses.unshift(course);
    writeLocalCourses(courses);
    return { ...course, submissionCount: 0 };
  },

  async updateCourse(courseId, payload) {
    if (await checkBackend()) {
      const { course } = await request(`/api/courses/${encodeURIComponent(courseId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return course;
    }
    const courses = readLocalCourses();
    const idx = courses.findIndex((c) => c.id === courseId);
    if (idx === -1) throw new Error('과목을 찾을 수 없습니다.');
    courses[idx] = { ...courses[idx], ...payload, id: courseId, updatedAt: new Date().toISOString() };
    writeLocalCourses(courses);
    return courses[idx];
  },

  async deleteCourse(courseId) {
    if (await checkBackend()) {
      return request(`/api/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
    }
    writeLocalCourses(readLocalCourses().filter((c) => c.id !== courseId));
    writeLocalSubs(readLocalSubs().filter((s) => s.courseId !== courseId));
    return { deleted: true };
  },

  async listSubmissions(courseId) {
    if (await checkBackend()) {
      const { submissions } = await request(`/api/courses/${encodeURIComponent(courseId)}/submissions`);
      return submissions;
    }
    return readLocalSubs().filter((s) => s.courseId === courseId);
  },

  async submitStudentResponse(courseId, payload, courseFallback = null) {
    if (await checkBackend()) {
      return request(`/api/courses/${encodeURIComponent(courseId)}/submissions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    const course = readLocalCourses().find((c) => c.id === courseId) || courseFallback;
    if (!course) throw new Error('과목 정보를 찾을 수 없습니다.');
    if (!course.isOpen) throw new Error('현재 제출이 마감된 과목입니다.');

    const aiSettings = getAiSettings();
    const now = new Date().toISOString();
    const autoText = generateSeteuk({
      answers: payload.answers || {},
      fields: course.fields || [],
      course,
      style: aiSettings.defaultStyle,
      aiSettings,
    });

    const subs = readLocalSubs();
    subs.unshift({
      id: `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      courseId,
      studentId: String(payload.studentId || '').trim(),
      studentName: String(payload.studentName || '').trim(),
      school: course.isJointCurriculum ? String(payload.school || '').trim() : '',
      answers: payload.answers || {},
      generatedText: autoText,
      style: aiSettings.defaultStyle || 'inquiry',
      status: 'auto',
      createdAt: now,
      updatedAt: now,
    });
    writeLocalSubs(subs);
    return { ok: true, submittedAt: now };
  },

  async updateSubmission(submissionId, payload) {
    if (await checkBackend()) {
      const { submission } = await request(`/api/submissions/${encodeURIComponent(submissionId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return submission;
    }
    const subs = readLocalSubs();
    const idx = subs.findIndex((s) => s.id === submissionId);
    if (idx === -1) throw new Error('제출 기록을 찾을 수 없습니다.');
    subs[idx] = { ...subs[idx], ...payload, id: submissionId, updatedAt: new Date().toISOString() };
    writeLocalSubs(subs);
    return subs[idx];
  },

  async deleteSubmission(submissionId) {
    if (await checkBackend()) {
      return request(`/api/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' });
    }
    writeLocalSubs(readLocalSubs().filter((s) => s.id !== submissionId));
    return { deleted: true };
  },

  async bulkUpdateSubmissions(updates) {
    if (await checkBackend()) {
      return request('/api/submissions/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ updates }),
      });
    }
    const map = new Map(updates.map((u) => [u.id, u]));
    const now = new Date().toISOString();
    const subs = readLocalSubs().map((s) =>
      map.has(s.id) ? { ...s, ...map.get(s.id), id: s.id, updatedAt: now } : s
    );
    writeLocalSubs(subs);
    return { ok: true };
  },

  async renderQrDataUrl(targetUrl) {
    // Always works locally in browser (GitHub Pages & Node.js) with zero external network dependency!
    try {
      return renderLocalQrDataUrl(targetUrl);
    } catch (err) {
      console.error('Local QR generation failed, falling back to /api/qr:', err);
      if (await checkBackend()) {
        return `/api/qr?format=png&text=${encodeURIComponent(targetUrl)}`;
      }
      throw err;
    }
  },
};
