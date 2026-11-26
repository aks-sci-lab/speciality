import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { createCourseObject, cloneDefaultFields } from './public/js/defaults.js';
import { generateSeteuk } from './public/js/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
let DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
let STORE_PATH = path.join(DATA_DIR, 'store.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function createInitialStore() {
  const defaultCourse = createCourseObject({
    id: 'sci_lab_01',
    title: '과학탐구실험',
    description:
      '한 학기 동안의 수업과 탐구 활동을 돌아보며 아래 항목을 성실하게 작성해 주세요. 제출 내용은 수업 기록 참고 자료로 활용됩니다.',
    isJointCurriculum: false,
    isOpen: true,
    fields: cloneDefaultFields(),
  });
  return {
    courses: [defaultCourse],
    submissions: [],
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(createInitialStore(), null, 2), 'utf-8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const submissions = Array.isArray(parsed.submissions) ? parsed.submissions : [];
    return { courses, submissions };
  } catch (err) {
    console.error('Failed to read store.json:', err);
    return createInitialStore();
  }
}

function writeStore(data) {
  ensureStore();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexFile, (readErr, content) => {
        if (readErr) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(resolved, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

function checkCliInstalled(cmd) {
  return new Promise((resolve) => {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    execFile(checker, [cmd], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve({ installed: false, path: '' });
      resolve({ installed: true, path: stdout.trim().split(/\r?\n/)[0] });
    });
  });
}

function runLocalCli(provider, prompt, model = '') {
  return new Promise((resolve, reject) => {
    let cmd = '';
    let args = [];

    if (provider === 'claude') {
      cmd = 'claude';
      args = ['-p', prompt, '--output-format', 'text'];
      if (model) args.push('--model', model);
    } else if (provider === 'gemini') {
      cmd = 'gemini';
      args = ['-p', prompt];
      if (model) args.push('-m', model);
    } else if (provider === 'codex') {
      cmd = 'codex';
      args = ['exec', prompt];
      if (model) args.push('-m', model);
    } else {
      return reject(new Error(`지원하지 않는 CLI 공급자입니다: ${provider}`));
    }

    const child = spawn(cmd, args, {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${provider} CLI 응답 시간이 초과되었습니다 (90초).`));
    }, 90000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} CLI 실행 실패: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(
          new Error(
            `${cmd} CLI 오류 (종료코드 ${code}): ${(stderr || stdout || '로그인 상태를 확인해 주세요.').trim().slice(0, 220)}`
          )
        );
      }
      const cleaned = stdout
        .replace(/^["'「『]+|["'」』]+$/g, '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) {
        return reject(new Error(`${cmd} CLI 출력이 비어 있습니다.`));
      }
      resolve(cleaned);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = urlObj;
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    try {
      // Health check
      if (pathname === '/api/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, mode: 'local-server' });
      }

      // Local CLI status check (Claude Code / Gemini CLI / Codex CLI)
      if (pathname === '/api/cli/status' && method === 'GET') {
        const [claude, gemini, codex] = await Promise.all([
          checkCliInstalled('claude'),
          checkCliInstalled('gemini'),
          checkCliInstalled('codex'),
        ]);
        return sendJson(res, 200, {
          available: true,
          providers: { claude, gemini, codex },
        });
      }

      // Local CLI refine using existing subscription login
      if (pathname === '/api/cli/refine' && method === 'POST') {
        const body = await parseBody(req);
        const provider = String(body.provider || '').trim();
        const prompt = String(body.prompt || '').trim();
        const model = String(body.model || '').trim();
        if (!provider || !prompt) {
          return sendJson(res, 400, { error: 'provider와 prompt가 필요합니다.' });
        }
        const text = await runLocalCli(provider, prompt, model);
        return sendJson(res, 200, { text });
      }

      // QR Code generator (SVG or PNG)
      if (pathname === '/api/qr' && method === 'GET') {
        const text = searchParams.get('text') || '';
        const format = (searchParams.get('format') || 'svg').toLowerCase();
        if (!text) {
          return sendJson(res, 400, { error: 'text query parameter is required' });
        }
        if (format === 'png') {
          const buffer = await QRCode.toBuffer(text, {
            type: 'png',
            width: 512,
            margin: 2,
            color: { dark: '#142927', light: '#FFFFFF' },
          });
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
          });
          return res.end(buffer);
        }
        const svg = await QRCode.toString(text, {
          type: 'svg',
          margin: 2,
          color: { dark: '#142927', light: '#FFFFFF' },
        });
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        return res.end(svg);
      }

      // List courses (with submission counts for teacher)
      if (pathname === '/api/courses' && method === 'GET') {
        const store = readStore();
        const counts = new Map();
        for (const sub of store.submissions) {
          counts.set(sub.courseId, (counts.get(sub.courseId) || 0) + 1);
        }
        const courses = store.courses.map((c) => ({
          ...c,
          submissionCount: counts.get(c.id) || 0,
        }));
        return sendJson(res, 200, { courses });
      }

      // Create new course
      if (pathname === '/api/courses' && method === 'POST') {
        const body = await parseBody(req);
        const store = readStore();
        const course = createCourseObject({
          title: body.title,
          description: body.description,
          isJointCurriculum: body.isJointCurriculum,
          isOpen: body.isOpen !== undefined ? body.isOpen : true,
          fields: Array.isArray(body.fields) && body.fields.length > 0 ? body.fields : cloneDefaultFields(),
        });
        store.courses.unshift(course);
        writeStore(store);
        return sendJson(res, 201, { course: { ...course, submissionCount: 0 } });
      }

      // Course-specific routes
      const courseMatch = pathname.match(/^\/api\/courses\/([^/]+)$/);
      if (courseMatch) {
        const courseId = decodeURIComponent(courseMatch[1]);
        const store = readStore();
        const idx = store.courses.findIndex((c) => c.id === courseId);

        // Public student-safe course fetch (returns ONLY course config, never submissions)
        if (method === 'GET') {
          if (idx === -1) return sendJson(res, 404, { error: '존재하지 않는 과목입니다.' });
          return sendJson(res, 200, { course: store.courses[idx] });
        }

        if (method === 'PUT') {
          if (idx === -1) return sendJson(res, 404, { error: '과목을 찾을 수 없습니다.' });
          const body = await parseBody(req);
          const existing = store.courses[idx];
          store.courses[idx] = {
            ...existing,
            title: body.title !== undefined ? String(body.title).trim() || existing.title : existing.title,
            description:
              body.description !== undefined ? String(body.description).trim() : existing.description,
            isJointCurriculum:
              body.isJointCurriculum !== undefined
                ? Boolean(body.isJointCurriculum)
                : existing.isJointCurriculum,
            isOpen: body.isOpen !== undefined ? Boolean(body.isOpen) : existing.isOpen,
            fields: Array.isArray(body.fields) ? body.fields : existing.fields,
            updatedAt: new Date().toISOString(),
          };
          writeStore(store);
          return sendJson(res, 200, { course: store.courses[idx] });
        }

        if (method === 'DELETE') {
          if (idx === -1) return sendJson(res, 404, { error: '과목을 찾을 수 없습니다.' });
          store.courses.splice(idx, 1);
          store.submissions = store.submissions.filter((s) => s.courseId !== courseId);
          writeStore(store);
          return sendJson(res, 200, { deleted: true });
        }
      }

      // Submissions for a course
      const courseSubsMatch = pathname.match(/^\/api\/courses\/([^/]+)\/submissions$/);
      if (courseSubsMatch) {
        const courseId = decodeURIComponent(courseSubsMatch[1]);
        const store = readStore();
        const course = store.courses.find((c) => c.id === courseId);
        if (!course) return sendJson(res, 404, { error: '존재하지 않는 과목입니다.' });

        if (method === 'GET') {
          const submissions = store.submissions.filter((s) => s.courseId === courseId);
          return sendJson(res, 200, { submissions });
        }

        // Student submission endpoint: auto-generates 세특 server-side, NEVER returns it to student
        if (method === 'POST') {
          if (!course.isOpen) {
            return sendJson(res, 403, { error: '현재 제출이 마감된 과목입니다.' });
          }
          const body = await parseBody(req);
          const studentId = String(body.studentId || '').trim();
          const studentName = String(body.studentName || '').trim();
          const school = course.isJointCurriculum ? String(body.school || '').trim() : '';
          const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};

          if (!studentId || !studentName) {
            return sendJson(res, 400, { error: '학번과 이름을 모두 입력해 주세요.' });
          }
          if (course.isJointCurriculum && !school) {
            return sendJson(res, 400, { error: '학교명을 입력해 주세요.' });
          }

          const now = new Date().toISOString();
          const autoText = generateSeteuk({
            answers,
            fields: course.fields,
            course,
            style: 'inquiry',
          });

          const submission = {
            id: `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            courseId,
            studentId,
            studentName,
            school,
            answers,
            generatedText: autoText,
            style: 'inquiry',
            status: 'auto', // auto | reviewed
            createdAt: now,
            updatedAt: now,
          };

          store.submissions.unshift(submission);
          writeStore(store);

          // Return minimal confirmation only (NO generatedText!)
          return sendJson(res, 201, {
            ok: true,
            submittedAt: now,
          });
        }
      }

      // Single submission update / delete (Teacher)
      const subMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/);
      if (subMatch) {
        const subId = decodeURIComponent(subMatch[1]);
        const store = readStore();
        const idx = store.submissions.findIndex((s) => s.id === subId);

        if (method === 'PUT') {
          if (idx === -1) return sendJson(res, 404, { error: '제출 기록을 찾을 수 없습니다.' });
          const body = await parseBody(req);
          store.submissions[idx] = {
            ...store.submissions[idx],
            generatedText:
              body.generatedText !== undefined
                ? String(body.generatedText)
                : store.submissions[idx].generatedText,
            style: body.style || store.submissions[idx].style,
            status: body.status || store.submissions[idx].status,
            updatedAt: new Date().toISOString(),
          };
          writeStore(store);
          return sendJson(res, 200, { submission: store.submissions[idx] });
        }

        if (method === 'DELETE') {
          if (idx === -1) return sendJson(res, 404, { error: '제출 기록을 찾을 수 없습니다.' });
          store.submissions.splice(idx, 1);
          writeStore(store);
          return sendJson(res, 200, { deleted: true });
        }
      }

      // Bulk update submissions (Teacher)
      if (pathname === '/api/submissions/bulk-update' && method === 'POST') {
        const body = await parseBody(req);
        const updates = Array.isArray(body.updates) ? body.updates : [];
        const store = readStore();
        const updateMap = new Map(updates.map((u) => [u.id, u]));
        const now = new Date().toISOString();

        store.submissions = store.submissions.map((sub) => {
          const patch = updateMap.get(sub.id);
          if (!patch) return sub;
          return {
            ...sub,
            generatedText:
              patch.generatedText !== undefined ? String(patch.generatedText) : sub.generatedText,
            style: patch.style || sub.style,
            status: patch.status || sub.status,
            updatedAt: now,
          };
        });

        writeStore(store);
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'API route not found' });
    } catch (err) {
      console.error('API Error:', err);
      return sendJson(res, 400, { error: err.message || 'Bad Request' });
    }
  }

  serveStatic(req, res, pathname);
});

export function startServer({ port = PORT, host = '0.0.0.0', dataDir = null } = {}) {
  if (dataDir) {
    DATA_DIR = path.resolve(dataDir);
    STORE_PATH = path.join(DATA_DIR, 'store.json');
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://127.0.0.1:${boundPort}`;
      console.log(`Speciality 세특 수집 웹앱이 실행 중입니다: ${url}`);
      resolve({ server, port: boundPort, url });
    });
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  startServer({ port: PORT, host: '0.0.0.0' }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
