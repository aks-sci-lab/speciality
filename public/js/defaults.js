export const DEFAULT_FIELDS = [
  {
    id: 'new_concept',
    label: '새로 알게 된 개념',
    placeholder: '이번 수업을 통해 처음 알게 된 개념이나 원리를 구체적으로 작성해 주세요.',
    type: 'textarea',
    role: 'newConcept',
    required: true,
    options: [],
  },
  {
    id: 'refined_concept',
    label: '과학적으로 더 정확히 알게 된 개념',
    placeholder: '기존에 막연히 알거나 오개념이 있었지만, 수업을 통해 과학적으로 더 정확히 이해하게 된 개념을 작성해 주세요.',
    type: 'textarea',
    role: 'refinedConcept',
    required: true,
    options: [],
  },
  {
    id: 'activity_1',
    label: '인상 깊었던 활동 1',
    placeholder: '가장 기억에 남는 실험, 탐구, 발표 또는 프로젝트 활동명을 적어주세요.',
    type: 'text',
    role: 'activity1',
    required: true,
    options: [],
  },
  {
    id: 'reason_1',
    label: '이유 1',
    placeholder: '활동 1이 인상 깊었던 이유와 그 과정에서 본인이 수행한 역할이나 깨달은 점을 작성해 주세요.',
    type: 'textarea',
    role: 'reason1',
    required: true,
    options: [],
  },
  {
    id: 'activity_2',
    label: '인상 깊었던 활동 2',
    placeholder: '두 번째로 인상 깊었던 탐구 또는 수업 활동을 적어주세요.',
    type: 'text',
    role: 'activity2',
    required: false,
    options: [],
  },
  {
    id: 'reason_2',
    label: '이유 2',
    placeholder: '활동 2가 인상 깊었던 이유와 이를 통해 확장된 생각이나 배운 점을 작성해 주세요.',
    type: 'textarea',
    role: 'reason2',
    required: false,
    options: [],
  },
  {
    id: 'developed_ability',
    label: '내가 발전시킨 능력',
    placeholder: '이 과목의 학습과 탐구를 통해 본인이 성장시켰다고 생각하는 역량(예: 자료 해석 능력, 가설 설정 및 변인 통제 역량 등)을 작성해 주세요.',
    type: 'textarea',
    role: 'developedAbility',
    required: true,
    options: [],
  },
];

export const FIELD_ROLES = [
  { value: 'newConcept', label: '새로 알게 된 개념' },
  { value: 'refinedConcept', label: '과학적으로 더 정확히 알게 된 개념' },
  { value: 'activity1', label: '인상 깊었던 활동 1' },
  { value: 'reason1', label: '이유 1 (활동 1 연결)' },
  { value: 'activity2', label: '인상 깊었던 활동 2' },
  { value: 'reason2', label: '이유 2 (활동 2 연결)' },
  { value: 'developedAbility', label: '발전시킨 능력/역량' },
  { value: 'custom', label: '추가 반영 항목 (자동 문장 추가)' },
];

export const GENERATION_STYLES = [
  {
    id: 'inquiry',
    label: '탐구 중심형',
    description: '과학적 개념 이해와 실험·탐구 수행 과정을 강조',
  },
  {
    id: 'growth',
    label: '성장 서사형',
    description: '오개념 교정, 경험의 의미, 역량 성장을 자연스럽게 연결',
  },
  {
    id: 'concise',
    label: '간결 요약형',
    description: '핵심 내용 위주로 간결하게 압축 (NEIS 바이트 여유 확보)',
  },
];

export function cloneDefaultFields() {
  return DEFAULT_FIELDS.map((f) => ({ ...f, options: [...(f.options || [])] }));
}

export function createCourseObject({
  id,
  title = '새 과목',
  description = '한 학기 동안의 수업과 탐구 활동을 돌아보며 아래 항목을 성실하게 작성해 주세요.',
  isJointCurriculum = false,
  isOpen = true,
  fields = null,
} = {}) {
  return {
    id: id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim() || '새 과목',
    description: description.trim(),
    isJointCurriculum: Boolean(isJointCurriculum),
    isOpen: Boolean(isOpen),
    fields: Array.isArray(fields) && fields.length > 0 ? fields : cloneDefaultFields(),
    createdAt: new Date().toISOString(),
  };
}
