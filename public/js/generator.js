/**
 * Korean NEIS 세부능력 및 특기사항(세특) 자동 생성 엔진
 * - 1~7번 핵심 항목 + 교사가 추가한 사용자 정의 항목을 자연스러운 NEIS 문체(~함., ~보임., ~이룸.)로 변환
 * - 받침 기반 한국어 조사(을/를, 이/가, 은/는, 과/와, 으로/로) 자동 처리
 * - NEIS UTF-8 바이트 계산 (한글 3바이트, 줄바꿈 2바이트, 영문/숫자/공백 1바이트, 기준 1,500 Bytes)
 */

export const NEIS_BYTE_LIMIT = 1500;

export function calcNeisBytes(text = '') {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      bytes += 2; // NEIS counts newline as 2 bytes
    } else if (code > 127) {
      bytes += 3; // UTF-8 Korean / multibyte character
    } else {
      bytes += 1;
    }
  }
  return bytes;
}

function getLastHangulBatchim(word) {
  const cleaned = String(word || '')
    .trim()
    .replace(/["'‘’“”()\[\]{}.,!?~]+$/g, '');
  if (!cleaned) return { hasBatchim: false, isRieul: false };
  const lastChar = cleaned[cleaned.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return { hasBatchim: jong !== 0, isRieul: jong === 8 };
  }
  // Digits & common English endings approximation
  if (/[013678lmnrLMNR]/.test(lastChar)) {
    return { hasBatchim: true, isRieul: /[178lL]/.test(lastChar) };
  }
  return { hasBatchim: false, isRieul: false };
}

function josa(word, withBatchim, withoutBatchim) {
  const { hasBatchim } = getLastHangulBatchim(word);
  return hasBatchim ? withBatchim : withoutBatchim;
}

function euro(word) {
  const { hasBatchim, isRieul } = getLastHangulBatchim(word);
  if (!hasBatchim || isRieul) return '로';
  return '으로';
}

function cleanPhrase(raw) {
  return String(raw || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。!！?？~]+$/, '')
    .trim();
}

/**
 * Convert a student's casual reason sentence into a clean NEIS-friendly nominal/clause form
 */
function toReasonClause(raw) {
  let text = cleanPhrase(raw);
  if (!text) return '';

  // Remove polite/casual endings to embed smoothly (order matters: specific before general)
  const replacements = [
    [/(기 때문입니다|기 때문이에요|기 때문이다|기 때문에)$/, '기 때문에'],
    [/(때문입니다|때문이에요|때문이다|때문에)$/, '때문에'],
    [/(알게 되었습니다|알게 되었어요|알게 되었다|알게 됨)$/, '알게 된'],
    [/(도움이 되었습니다|도움이 되었어요|도움이 되었다)$/, '큰 도움이 된'],
    [/(있었습니다|있었어요|있었다|있음)$/, '있었던'],
    [/(배웠습니다|배웠어요|배웠다|배움)$/, '배운'],
    [/(느꼈습니다|느꼈어요|느꼈다|느낌)$/, '느낀'],
    [/(재미있었습니다|재미있었어요|재미있었다)$/, '흥미를 느낀'],
    [/(흥미로웠습니다|흥미로웠어요|흥미로웠다)$/, '흥미로웠던'],
    [/(신기했습니다|신기했어요|신기했다)$/, '호기심을 자극한'],
    [/(좋았습니다|좋았어요|좋았다)$/, '유익했던'],
    [/(해 보았습니다|해 보았어요|해 보았다|해봤습니다|해봤어요|해봤다)$/, '해 본'],
    [/(했습니다|했어요|했다)$/, '한'],
    [/(되었습니다|되었어요|되었다)$/, '된'],
    [/(입니다|이에요|예요|이다)$/, '인'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      return text;
    }
  }
  return text;
}

/**
 * Convert a casual sentence into a standalone NEIS-style (~함./~임.) ending
 */
function toNeisEnding(raw) {
  let text = cleanPhrase(raw);
  if (!text) return '';
  if (/(함|임|됨|보임|드러냄|이룸|성장함|이해함|탐구함|분석함|정리함|깨달음|수행함)$/.test(text)) {
    return `${text}.`;
  }
  text = text
    .replace(/(해 보았습니다|해 보았어요|해 보았다|해봤습니다|해봤어요|해봤다)$/, '함')
    .replace(/(보았습니다|보았어요|보았다|봤습니다|봤어요|봤다)$/, '확인함')
    .replace(/(하였습니다|했습니다|했어요|했다)$/, '함')
    .replace(/(되었습니다|됐습니다|됐어요|되었다)$/, '됨')
    .replace(/(입니다|이에요|예요|이다)$/, '임')
    .replace(/(있었습니다|있었어요|있었다)$/, '있었음')
    .replace(/(배웠습니다|배웠어요|배웠다)$/, '배움')
    .replace(/(느꼈습니다|느꼈어요|느꼈다)$/, '느낌')
    .replace(/(좋았습니다|좋았어요|좋았다)$/, '긍정적으로 평가함')
    .replace(/(습니다|어요|아요|해요)$/, '함')
    .replace(/\s+/g, ' ')
    .trim();

  if (/(함|임|됨|음|낌)$/.test(text)) {
    return `${text}.`;
  }
  return `${text} 내용을 정리함.`;
}

function extractByRoles(answers = {}, fields = []) {
  const byRole = {
    newConcept: [],
    refinedConcept: [],
    activity1: [],
    reason1: [],
    activity2: [],
    reason2: [],
    developedAbility: [],
    custom: [],
  };

  for (const field of fields) {
    const val = cleanPhrase(answers[field.id]);
    if (!val) continue;
    const role = field.role || 'custom';
    if (role === 'custom') {
      byRole.custom.push({ label: field.label, value: val });
    } else if (byRole[role]) {
      byRole[role].push(val);
    } else {
      byRole.custom.push({ label: field.label, value: val });
    }
  }

  return {
    newConcept: byRole.newConcept.join(', '),
    refinedConcept: byRole.refinedConcept.join(', '),
    activity1: byRole.activity1.join(', '),
    reason1: byRole.reason1.join(' '),
    activity2: byRole.activity2.join(', '),
    reason2: byRole.reason2.join(' '),
    developedAbility: byRole.developedAbility.join(', '),
    custom: byRole.custom,
  };
}

function buildReasonSentence(activity, reason, style, isSecond = false) {
  const act = cleanPhrase(activity);
  const rsn = cleanPhrase(reason);
  if (!act && !rsn) return '';

  const prefix = isSecond ? '또한 ' : '특히 ';

  if (act && !rsn) {
    if (style === 'concise') {
      return `${prefix}'${act}' 활동에 적극 참여하여 탐구 역량을 발휘함.`;
    }
    return `${prefix}'${act}' 활동에 주도적으로 참여하며 수업 내용을 실제 탐구로 확장하는 태도를 보임.`;
  }

  if (!act && rsn) {
    return `${prefix}수업 활동 과정에서 ${toNeisEnding(rsn)}`;
  }

  const clause = toReasonClause(rsn);
  const endsWithBecause = /때문에$/.test(clause);
  const endsWithModifier = /(던|한|된|인|운|낀|은|는|을|를|적|본)$/.test(clause);

  if (style === 'concise') {
    if (endsWithBecause) {
      return `${prefix}'${act}' 활동에서 ${clause} 적극적인 탐구 태도를 보임.`;
    }
    if (endsWithModifier) {
      return `${prefix}'${act}' 활동에 참여하며 ${clause} 점에서 높은 학습 의욕을 보임.`;
    }
    return `${prefix}'${act}' 활동에 참여하였으며, ${toNeisEnding(rsn)}`;
  }

  if (style === 'growth') {
    if (endsWithBecause) {
      return `${prefix}'${act}' 활동에 깊은 흥미를 가지고 참여하였으며, ${clause} 스스로 질문을 던지며 탐구의 폭을 넓힘.`;
    }
    if (endsWithModifier) {
      return `${prefix}'${act}' 활동을 수행하며 ${clause} 경험을 통해 자기주도적 학습 태도를 한층 성숙시킴.`;
    }
    return `${prefix}'${act}' 활동을 통해 유의미한 학습 경험을 쌓았으며, ${toNeisEnding(rsn)}`;
  }

  // Default: 'inquiry'
  if (endsWithBecause) {
    return `${prefix}'${act}' 활동에 적극적으로 참여하였으며, ${clause} 과학적 호기심을 바탕으로 깊이 있게 탐구함.`;
  }
  if (endsWithModifier) {
    return `${prefix}'${act}' 활동에 주도적으로 참여하여 ${clause} 점에서 우수한 탐구 의욕과 몰입도를 드러냄.`;
  }
  return `${prefix}'${act}' 활동에 적극적으로 참여하였으며, ${toNeisEnding(rsn)}`;
}

/**
 * Main NEIS 세특 auto-generator
 */
export function generateSeteuk({ answers = {}, fields = [], course = {}, style = 'inquiry' }) {
  const data = extractByRoles(answers, fields);
  const sentences = [];
  const courseTitle = cleanPhrase(course.title);
  const subjectPrefix = courseTitle ? `${courseTitle} 수업에서 ` : '수업 과정에서 ';

  // 1 & 2. 새로 알게 된 개념 + 과학적으로 더 정확히 알게 된 개념
  if (data.newConcept && data.refinedConcept) {
    const newJosa = josa(data.newConcept, '을', '를');
    const refJosa = josa(data.refinedConcept, '을', '를');
    if (style === 'concise') {
      sentences.push(
        `${subjectPrefix}'${data.newConcept}'${newJosa} 새롭게 학습하고, '${data.refinedConcept}'${refJosa} 과학적 근거에 기반해 정확히 정립함.`
      );
    } else if (style === 'growth') {
      sentences.push(
        `${subjectPrefix}'${data.newConcept}'의 개념을 새롭게 습득하며 지적 호기심을 넓혔으며, 기존에 막연히 이해하던 '${data.refinedConcept}'에 대해 과학적 원리를 바탕으로 개념을 명확히 재정립함.`
      );
    } else {
      sentences.push(
        `${subjectPrefix}'${data.newConcept}'의 원리를 새롭게 이해하였으며, '${data.refinedConcept}'에 대해 과학적 근거를 토대로 개념을 보다 정교하고 정확하게 정립함.`
      );
    }
  } else if (data.newConcept) {
    const newJosa = josa(data.newConcept, '을', '를');
    sentences.push(
      `${subjectPrefix}'${data.newConcept}'${newJosa} 새롭게 이해하고 핵심 원리를 체계적으로 정리함.`
    );
  } else if (data.refinedConcept) {
    const refJosa = josa(data.refinedConcept, '을', '를');
    sentences.push(
      `${subjectPrefix}'${data.refinedConcept}'${refJosa} 과학적 근거에 비추어 보다 정확하게 이해하고 오개념을 스스로 교정함.`
    );
  }

  // 3 & 4. 인상 깊었던 활동 1 + 이유 1
  const act1Sentence = buildReasonSentence(data.activity1, data.reason1, style, false);
  if (act1Sentence) sentences.push(act1Sentence);

  // 5 & 6. 인상 깊었던 활동 2 + 이유 2
  const act2Sentence = buildReasonSentence(data.activity2, data.reason2, style, Boolean(act1Sentence));
  if (act2Sentence) sentences.push(act2Sentence);

  // Custom teacher-defined fields
  for (const item of data.custom) {
    const labelClean = cleanPhrase(item.label);
    const valClean = cleanPhrase(item.value);
    if (!valClean) continue;
    sentences.push(`${labelClean} 측면에서 ${toNeisEnding(valClean)}`);
  }

  // 7. 내가 발전시킨 능력
  if (data.developedAbility) {
    const ab = data.developedAbility;
    const abJosa = josa(ab, '을', '를');
    const abEuro = euro(ab);
    if (style === 'concise') {
      sentences.push(`일련의 활동을 통해 '${ab}'${abJosa} 발전시키는 성장을 이룸.`);
    } else if (style === 'growth') {
      sentences.push(
        `이러한 꾸준한 학습과 탐구 경험을 바탕으로 '${ab}'${abEuro} 이어지는 의미 있는 학업적 성장을 이루어 앞으로의 발전이 기대됨.`
      );
    } else {
      sentences.push(
        `일련의 개념 학습과 탐구 활동을 통해 '${ab}'${abJosa} 한층 발전시키며 과학적 문제 해결력을 신장함.`
      );
    }
  }

  if (sentences.length === 0) {
    return '학생이 입력한 내용이 충분하지 않아 세부능력 및 특기사항 초안을 생성할 수 없습니다.';
  }

  return sentences.join(' ');
}

/**
 * Optional Gemini API refinement (only called if teacher enters their own API key in settings)
 */
export async function refineWithGemini({ apiKey, course, student, answers, fields, style }) {
  const styleLabel =
    style === 'growth' ? '성장 서사형' : style === 'concise' ? '간결 요약형' : '탐구 중심형';

  const qaLines = fields
    .map((f, idx) => `${idx + 1}. ${f.label}: ${answers[f.id] || '(미작성)'}`)
    .join('\n');

  const prompt = [
    '당신은 대한민국 고등학교 교사입니다. 아래 학생의 자기평가 응답을 바탕으로 학교생활기록부 [세부능력 및 특기사항]을 작성해 주세요.',
    '',
    '작성 규칙:',
    '1. 반드시 3인칭 관찰자 시점의 개조식/명사형 종결어미(~함., ~보임., ~드러냄., ~성장함.)로 작성할 것.',
    '2. 학생 이름, 학교명, 사교육/외부 대회 등 NEIS 기재 금지 사항은 절대 포함하지 말 것.',
    '3. 학생이 작성한 핵심 개념, 활동, 이유, 발전시킨 능력을 누락 없이 자연스럽게 하나의 문단으로 연결할 것.',
    `4. 문체 스타일: ${styleLabel}`,
    '5. 분량: 공백 포함 한글 약 350~450자(1,200~1,400 Bytes 이내, 1,500 Bytes 절대 초과 금지).',
    '6. 부가 설명 없이 세특 본문만 출력할 것.',
    '',
    `과목명: ${course.title || '과학'}`,
    '학생 응답:',
    qaLines,
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 700 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const output = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!output) {
    throw new Error('AI 응답이 비어 있습니다.');
  }
  return output.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}
