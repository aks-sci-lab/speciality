/**
 * Korean NEIS 세부능력 및 특기사항(세특) 자동 생성 엔진
 * - 1~7번 핵심 항목 + 교사가 추가한 사용자 정의 항목을 자연스러운 NEIS 문체로 변환
 * - 내장 AI 설정 조절(분량 상세도, 종결 어미, 과목명 포함, 오개념 교정 강조, 교사 강조 키워드, 1,500B 자동 맞춤) 지원
 * - 받침 기반 한국어 조사(을/를, 이/가, 은/는, 과/와, 으로/로) 자동 처리
 */

import { DEFAULT_AI_SETTINGS } from './defaults.js';

export const NEIS_BYTE_LIMIT = 1500;

export function calcNeisBytes(text = '') {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      bytes += 2;
    } else if (code > 127) {
      bytes += 3;
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

function toReasonClause(raw) {
  let text = cleanPhrase(raw);
  if (!text) return '';

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

function getToneEndings(endingTone) {
  if (endingTone === 'competency') {
    return {
      conceptEnd: '과학적 사고력을 바탕으로 명확히 정립함.',
      activityEnd: '우수한 탐구 역량과 문제 해결력을 드러냄.',
      abilityEnd: '한층 신장시키며 높은 교과 역량을 발휘함.',
      potentialEnd: '앞으로도 깊이 있는 탐구를 이어갈 역량이 돋보임.',
    };
  }
  if (endingTone === 'growth') {
    return {
      conceptEnd: '스스로 개념을 확장하며 깊이 있게 이해함.',
      activityEnd: '자기주도적 학습 태도를 한층 성숙시킴.',
      abilityEnd: '꾸준히 발전시키는 의미 있는 성장을 이룸.',
      potentialEnd: '배움에 대한 진지한 태도를 바탕으로 향후 지속적인 발전이 기대됨.',
    };
  }
  return {
    conceptEnd: '과학적 근거를 토대로 정확하게 정립함.',
    activityEnd: '높은 탐구 의욕과 성실한 참여 태도를 보임.',
    abilityEnd: '한층 발전시키며 과학적 문제 해결력을 기름.',
    potentialEnd: '학습 내용을 스스로 점검하고 확장하는 태도가 인상적임.',
  };
}

function buildReasonSentence(activity, reason, style, settings, isSecond = false) {
  const act = cleanPhrase(activity);
  const rsn = cleanPhrase(reason);
  if (!act && !rsn) return '';

  const prefix = isSecond ? (settings.detailLevel === 'detailed' ? '나아가 ' : '또한 ') : '특히 ';
  const tone = getToneEndings(settings.endingTone);

  if (act && !rsn) {
    if (style === 'concise' || settings.detailLevel === 'brief') {
      return `${prefix}'${act}' 활동에 적극 참여하여 탐구 역량을 발휘함.`;
    }
    return `${prefix}'${act}' 활동에 주도적으로 참여하며 ${tone.activityEnd}`;
  }

  if (!act && rsn) {
    return `${prefix}수업 활동 과정에서 ${toNeisEnding(rsn)}`;
  }

  const clause = toReasonClause(rsn);
  const endsWithBecause = /때문에$/.test(clause);
  const endsWithModifier = /(던|한|된|인|운|낀|은|는|을|를|적|본)$/.test(clause);

  if (style === 'concise' || settings.detailLevel === 'brief') {
    if (endsWithBecause) {
      return `${prefix}'${act}' 활동에서 ${clause} 적극적인 탐구 태도를 보임.`;
    }
    if (endsWithModifier) {
      return `${prefix}'${act}' 활동에 참여하며 ${clause} 점에서 높은 학습 의욕을 보임.`;
    }
    return `${prefix}'${act}' 활동에 참여하였으며, ${toNeisEnding(rsn)}`;
  }

  if (settings.detailLevel === 'detailed') {
    if (endsWithBecause) {
      return `${prefix}'${act}' 활동에 주도적으로 참여하였으며, ${clause} 이론과 실제 현상을 연결하며 탐구의 깊이를 더하고 ${tone.activityEnd}`;
    }
    if (endsWithModifier) {
      return `${prefix}'${act}' 활동을 수행하는 과정에서 ${clause} 경험을 바탕으로 핵심 원리를 체계적으로 분석하며 ${tone.activityEnd}`;
    }
    return `${prefix}'${act}' 활동에 몰입하여 ${toNeisEnding(rsn)} 이를 통해 탐구 과정을 논리적으로 정리하며 ${tone.activityEnd}`;
  }

  if (style === 'growth') {
    if (endsWithBecause) {
      return `${prefix}'${act}' 활동에 깊은 흥미를 가지고 참여하였으며, ${clause} 스스로 질문을 던지며 탐구의 폭을 넓힘.`;
    }
    if (endsWithModifier) {
      return `${prefix}'${act}' 활동을 수행하며 ${clause} 경험을 통해 ${tone.activityEnd}`;
    }
    return `${prefix}'${act}' 활동을 통해 유의미한 학습 경험을 쌓았으며, ${toNeisEnding(rsn)}`;
  }

  // Default: inquiry + standard
  if (endsWithBecause) {
    return `${prefix}'${act}' 활동에 적극적으로 참여하였으며, ${clause} 과학적 호기심을 바탕으로 깊이 있게 탐구함.`;
  }
  if (endsWithModifier) {
    return `${prefix}'${act}' 활동에 주도적으로 참여하여 ${clause} 점에서 ${tone.activityEnd}`;
  }
  return `${prefix}'${act}' 활동에 적극적으로 참여하였으며, ${toNeisEnding(rsn)}`;
}

function buildCoreText({ data, course, style, settings }) {
  const sentences = [];
  const courseTitle = cleanPhrase(course.title);
  const subjectPrefix =
    settings.includeCourseTitle && courseTitle ? `${courseTitle} 수업에서 ` : '수업 과정에서 ';
  const tone = getToneEndings(settings.endingTone);

  // 1 & 2. 새로 알게 된 개념 + 과학적으로 더 정확히 알게 된 개념
  if (data.newConcept && data.refinedConcept) {
    const newJosa = josa(data.newConcept, '을', '를');
    const refJosa = josa(data.refinedConcept, '을', '를');
    if (style === 'concise' || settings.detailLevel === 'brief') {
      sentences.push(
        `${subjectPrefix}'${data.newConcept}'${newJosa} 새롭게 학습하고, '${data.refinedConcept}'${refJosa} 과학적 근거에 기반해 정확히 정립함.`
      );
    } else if (settings.emphasizeMisconception) {
      if (settings.detailLevel === 'detailed') {
        sentences.push(
          `${subjectPrefix}'${data.newConcept}'의 핵심 원리를 새롭게 습득하여 개념적 기반을 넓혔으며, 기존에 막연히 이해하거나 오개념을 지니기 쉬웠던 '${data.refinedConcept}'에 대해 ${tone.conceptEnd}`
        );
      } else {
        sentences.push(
          `${subjectPrefix}'${data.newConcept}'의 원리를 새롭게 이해하였으며, 기존에 막연히 알고 있던 '${data.refinedConcept}'에 대해 ${tone.conceptEnd}`
        );
      }
    } else {
      sentences.push(
        `${subjectPrefix}'${data.newConcept}'의 원리를 새롭게 이해하고, '${data.refinedConcept}'에 대해 ${tone.conceptEnd}`
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
  const act1Sentence = buildReasonSentence(data.activity1, data.reason1, style, settings, false);
  if (act1Sentence) sentences.push(act1Sentence);

  // 5 & 6. 인상 깊었던 활동 2 + 이유 2
  const act2Sentence = buildReasonSentence(
    data.activity2,
    data.reason2,
    style,
    settings,
    Boolean(act1Sentence)
  );
  if (act2Sentence) sentences.push(act2Sentence);

  // Custom teacher-defined fields
  for (const item of data.custom) {
    const labelClean = cleanPhrase(item.label);
    const valClean = cleanPhrase(item.value);
    if (!valClean) continue;
    sentences.push(`${labelClean} 측면에서 ${toNeisEnding(valClean)}`);
  }

  // 7. 내가 발전시킨 능력 + 교사 강조 키워드
  const keywords = String(settings.focusKeywords || '')
    .split(',')
    .map((k) => cleanPhrase(k))
    .filter(Boolean);

  if (data.developedAbility) {
    const ab = data.developedAbility;
    const abJosa = josa(ab, '을', '를');
    const abEuro = euro(ab);
    const kwClause =
      keywords.length > 0 ? ` ${keywords.join(' 및 ')} 측면과 더불어` : '';

    if (style === 'concise' || settings.detailLevel === 'brief') {
      sentences.push(`일련의 활동을 통해${kwClause} '${ab}'${abJosa} 발전시키는 성장을 이룸.`);
    } else if (style === 'growth') {
      sentences.push(
        `이러한 꾸준한 학습과 탐구 경험을 바탕으로${kwClause} '${ab}'${abEuro} 이어지는 의미 있는 학업적 성장을 이룸.`
      );
    } else {
      sentences.push(
        `일련의 개념 학습과 탐구 활동을 통해${kwClause} '${ab}'${abJosa} ${tone.abilityEnd}`
      );
    }
  } else if (keywords.length > 0) {
    const joined = keywords.join(', ');
    sentences.push(
      `수업 전반에서 '${joined}'${josa(joined, '을', '를')} 꾸준히 발휘하며 성실히 참여함.`
    );
  }

  // Optional closing sentence
  if (settings.closingTemplate === 'potential') {
    sentences.push(tone.potentialEnd);
  } else if (
    settings.closingTemplate === 'auto' &&
    settings.detailLevel === 'detailed' &&
    sentences.length > 0
  ) {
    sentences.push(tone.potentialEnd);
  }

  return sentences.join(' ');
}

/**
 * Main NEIS 세특 auto-generator
 */
export function generateSeteuk({
  answers = {},
  fields = [],
  course = {},
  style = null,
  aiSettings = {},
}) {
  const settings = { ...DEFAULT_AI_SETTINGS, ...(aiSettings || {}) };
  const effectiveStyle = style || settings.defaultStyle || 'inquiry';
  const data = extractByRoles(answers, fields);

  let result = buildCoreText({ data, course, style: effectiveStyle, settings });

  if (!result) {
    return '학생이 입력한 내용이 충분하지 않아 세부능력 및 특기사항 초안을 생성할 수 없습니다.';
  }

  // Auto-compress if exceeding NEIS 1,500 Bytes and option is enabled
  if (settings.autoFitNeisLimit && calcNeisBytes(result) > NEIS_BYTE_LIMIT) {
    const compactSettings = {
      ...settings,
      detailLevel: 'brief',
      closingTemplate: 'none',
    };
    const compacted = buildCoreText({ data, course, style: 'concise', settings: compactSettings });
    if (calcNeisBytes(compacted) < calcNeisBytes(result)) {
      result = compacted;
    }
  }

  return result;
}

// ============================================================================
// Shared Prompt Builder for Generative AI (WebLLM / Gemini / Claude)
// ============================================================================

export function buildAiPrompt({ course, answers, fields, style, aiSettings = {} }) {
  const settings = { ...DEFAULT_AI_SETTINGS, ...(aiSettings || {}) };
  const effectiveStyle = style || settings.defaultStyle || 'inquiry';
  const styleLabel =
    effectiveStyle === 'growth'
      ? '성장 서사형'
      : effectiveStyle === 'concise'
      ? '간결 요약형'
      : '탐구 중심형';

  const detailGuide =
    settings.detailLevel === 'brief'
      ? '약 200~280자(600~850 Bytes)'
      : settings.detailLevel === 'detailed'
      ? '약 400~480자(1,200~1,450 Bytes)'
      : '약 300~380자(900~1,150 Bytes)';

  const toneGuide =
    settings.endingTone === 'competency'
      ? '~드러냄., ~발휘함., ~신장함. 등 역량 강조형 종결어미'
      : settings.endingTone === 'growth'
      ? '~성장함., ~확장함., ~기대됨. 등 성장 관찰형 종결어미'
      : '~함., ~보임., ~이룸. 등 표준 NEIS 개조식 종결어미';

  const qaLines = fields
    .map((f, idx) => `${idx + 1}. ${f.label}: ${answers[f.id] || '(미작성)'}`)
    .join('\n');

  const extraRules = [];
  if (settings.includeCourseTitle && course?.title) {
    extraRules.push(`- 문장 서두에 '${course.title} 수업에서' 형태로 과목명을 자연스럽게 포함할 것.`);
  }
  if (settings.emphasizeMisconception) {
    extraRules.push('- 기존 이해에서 과학적 근거로 개념을 정확히 재정립한 과정을 잘 드러낼 것.');
  }
  if (settings.focusKeywords?.trim()) {
    extraRules.push(`- 교사 강조 키워드 반영: ${settings.focusKeywords.trim()}`);
  }
  if (settings.geminiInstruction?.trim()) {
    extraRules.push(`- 추가 작성 지침: ${settings.geminiInstruction.trim()}`);
  }

  return [
    '당신은 대한민국 고등학교 교사입니다. 아래 학생의 자기평가 응답을 바탕으로 학교생활기록부 [세부능력 및 특기사항]을 작성해 주세요.',
    '',
    '작성 규칙:',
    `1. 반드시 3인칭 관찰자 시점의 ${toneGuide}로 작성할 것.`,
    '2. 학생 이름, 학교명, 사교육/외부 대회 등 NEIS 기재 금지 사항은 절대 포함하지 말 것.',
    '3. 학생이 작성한 핵심 개념, 활동, 이유, 발전시킨 능력을 누락 없이 자연스럽게 하나의 문단으로 연결할 것.',
    `4. 문체 스타일: ${styleLabel}`,
    `5. 분량: 공백 포함 한글 ${detailGuide} 이내 (1,500 Bytes 절대 초과 금지).`,
    ...extraRules,
    '6. 인사말이나 부가 설명, 따옴표 감싸기 없이 세특 본문만 출력할 것.',
    '',
    `과목명: ${course?.title || '과학'}`,
    '학생 응답:',
    qaLines,
  ].join('\n');
}

function normalizeAiOutput(text) {
  return String(text || '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// 1. Google Gemini API
// ============================================================================

export async function refineWithGemini({
  apiKey,
  course,
  answers,
  fields,
  style,
  aiSettings = {},
}) {
  const settings = { ...DEFAULT_AI_SETTINGS, ...(aiSettings || {}) };
  const prompt = buildAiPrompt({ course, answers, fields, style, aiSettings: settings });
  const model = settings.geminiModel || 'gemini-2.5-flash';
  const temperature = Number(settings.geminiTemperature ?? 0.5);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: 800 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const output = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!output) {
    throw new Error('Gemini 응답이 비어 있습니다.');
  }
  return normalizeAiOutput(output);
}

// ============================================================================
// 2. Anthropic Claude API (Direct Browser Access enabled)
// ============================================================================

export async function refineWithClaude({
  apiKey,
  course,
  answers,
  fields,
  style,
  aiSettings = {},
}) {
  const settings = { ...DEFAULT_AI_SETTINGS, ...(aiSettings || {}) };
  const prompt = buildAiPrompt({ course, answers, fields, style, aiSettings: settings });
  const model = settings.claudeModel || 'claude-sonnet-4-20250514';
  const temperature = Number(settings.geminiTemperature ?? 0.5);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const output = Array.isArray(data?.content)
    ? data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
    : '';
  if (!output) {
    throw new Error('Claude 응답이 비어 있습니다.');
  }
  return normalizeAiOutput(output);
}

// ============================================================================
// 3. WebLLM (In-Browser Local LLM via WebGPU)
// ============================================================================

let webllmEngine = null;
let webllmLoadedModel = null;
let webllmLoading = false;
let webllmProgressText = '';
let webllmProgressPct = 0;

export function isWebGpuSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

export function getWebLlmState() {
  return {
    supported: isWebGpuSupported(),
    loadedModel: webllmLoadedModel,
    loading: webllmLoading,
    progressText: webllmProgressText,
    progressPct: webllmProgressPct,
  };
}

export async function loadWebLlmModel(modelId, onProgress = null) {
  if (!isWebGpuSupported()) {
    throw new Error('현재 브라우저가 WebGPU를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 사용해 주세요.');
  }
  if (webllmEngine && webllmLoadedModel === modelId) {
    return webllmEngine;
  }

  webllmLoading = true;
  webllmProgressPct = 0;
  webllmProgressText = 'WebLLM 런타임 모듈을 불러오는 중...';
  onProgress?.({ progress: 0, text: webllmProgressText });

  try {
    if (webllmEngine && typeof webllmEngine.unload === 'function') {
      await webllmEngine.unload();
      webllmEngine = null;
      webllmLoadedModel = null;
    }

    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    webllmEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        const pct = Math.round((report.progress || 0) * 100);
        webllmProgressPct = pct;
        webllmProgressText = report.text || `모델 불러오는 중... (${pct}%)`;
        onProgress?.({ progress: pct, text: webllmProgressText });
      },
    });
    webllmLoadedModel = modelId;
    webllmProgressPct = 100;
    webllmProgressText = '모델 준비 완료';
    onProgress?.({ progress: 100, text: webllmProgressText });
    return webllmEngine;
  } catch (err) {
    webllmEngine = null;
    webllmLoadedModel = null;
    throw new Error(`WebLLM 로드 실패: ${err.message || err}`);
  } finally {
    webllmLoading = false;
  }
}

export async function unloadWebLlm() {
  if (webllmEngine && typeof webllmEngine.unload === 'function') {
    await webllmEngine.unload();
  }
  webllmEngine = null;
  webllmLoadedModel = null;
  webllmProgressPct = 0;
  webllmProgressText = '';
}

export async function refineWithWebLlm({
  course,
  answers,
  fields,
  style,
  aiSettings = {},
  onProgress = null,
}) {
  const settings = { ...DEFAULT_AI_SETTINGS, ...(aiSettings || {}) };
  const modelId = settings.webllmModel || 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
  const engine = await loadWebLlmModel(modelId, onProgress);

  const prompt = buildAiPrompt({ course, answers, fields, style, aiSettings: settings });
  const temperature = Number(settings.geminiTemperature ?? 0.5);

  const reply = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          '당신은 대한민국 고등학교 교사이며 학교생활기록부 세부능력 및 특기사항을 NEIS 개조식 한국어(~함., ~보임.)로 작성합니다.',
      },
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: 700,
  });

  const output = reply?.choices?.[0]?.message?.content;
  if (!output) {
    throw new Error('WebLLM 응답이 비어 있습니다.');
  }
  return normalizeAiOutput(output);
}

