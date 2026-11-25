/**
 * Hybrid API + Static (GitHub Pages) storage client for Speciality 세특 수집 웹앱
 * - Automatically detects Node.js backend (/api/health)
 * - Falls back seamlessly to localStorage + URL-encoded course config on static hosts (GitHub Pages)
 */

import { cloneDefaultFields, createCourseObject } from './defaults.js';
import { generateSeteuk } from './generator.js';

const LS_COURSES_KEY = 'speciality_v1_courses';
const LS_SUBS_KEY = 'speciality_v1_submissions';

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

// UTF-8 safe base64url encode/decode for QR course config sharing in static mode
export function encodeCourseConfig(course) {
  const minimal = {
    id: course.id,
    t: course.title,
    d: course.description || '',
    j: course.isJointCurriculum ? 1 : 0,
    o: course.isOpen ? 1 : 0,
    f: (course.fields || []).map((f) => ({
      i: f.id,
      l: f.label,
      p: f.placeholder || '',
      y: f.type || 'textarea',
      r: f.role || 'custom',
      q: f.required ? 1 : 0,
      o: f.options || [],
    })),
  };
  const json = JSON.stringify(minimal);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCourseConfig(encoded) {
  try {
    const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const m = JSON.parse(json);
    return {
      id: m.id,
      title: m.t || '수집 과목',
      description: m.d || '',
      isJointCurriculum: Boolean(m.j),
      isOpen: m.o !== 0,
      fields: Array.isArray(m.f)
        ? m.f.map((f) => ({
            id: f.i,
            label: f.l,
            placeholder: f.p || '',
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
      const decoded = decodeCourseConfig(cfgParam);
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

    const now = new Date().toISOString();
    const autoText = generateSeteuk({
      answers: payload.answers || {},
      fields: course.fields || [],
      course,
      style: 'inquiry',
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
      style: 'inquiry',
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
    if (await checkBackend()) {
      return `/api/qr?format=png&text=${encodeURIComponent(targetUrl)}`;
    }
    if (typeof window !== 'undefined' && window.QRCode?.toDataURL) {
      return window.QRCode.toDataURL(targetUrl, {
        width: 512,
        margin: 2,
        color: { dark: '#142927', light: '#FFFFFF' },
      });
    }
    return '';
  },
};
