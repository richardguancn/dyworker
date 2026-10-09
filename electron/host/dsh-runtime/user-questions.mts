import { randomUUID } from 'node:crypto';

/** 保留官方问题标识和选项；应用的单问题窗口逐项提交同一批问题。 */
export async function answerDshQuestions(questions: any[], requestUserInput: any, signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof requestUserInput !== 'function') throw new Error('当前环境不支持向用户提问');
  if (!Array.isArray(questions) || !questions.length) throw new Error('提问内容不能为空');
  const ids = new Set<string>();
  const answers = [];
  for (const question of questions) {
    if (typeof question.id !== 'string' || !question.id || ids.has(question.id)
      || typeof question.question !== 'string' || !question.question.trim()) throw new Error('问题必须有独立标识和完整内容');
    ids.add(question.id);
    const choices = question.options ?? [];
    if (!Array.isArray(choices) || choices.some((option: any) => typeof option.label !== 'string' || !option.label))
      throw new Error('问题选项无效');
    const labels = choices.map((option: any) => option.label);
    if (new Set(labels).size !== labels.length) throw new Error('问题选项不能重名');
    const request = { id: `dsh-question:${randomUUID()}`, question: question.question, options: labels,
      optionDescriptions: choices.map((option: any) => String(option.description || '')),
      header: question.header, detail: question.detail, multiSelect: Boolean(question.multiSelect), answerFormat: 'dsh' };
    let abort: () => void;
    let result: any;
    try {
      result = await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return requestUserInput(request, signal); }),
        new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort(); })]);
    } finally { signal.removeEventListener('abort', abort); }
    signal.throwIfAborted();
    if (!result?.ok) throw new Error(`提问未得到回答：${String(result?.reason || '已取消')}`);
    const raw = String(result.answer ?? '').trim();
    let answer: any;
    try { answer = JSON.parse(raw); } catch { /* 渠道和旧窗口保留普通文字回答。 */ }
    if (answer?.format === 'dsh-question-answer-v1') {
      if (!Array.isArray(answer.selected) || answer.selected.some((label: any) => !labels.includes(label))
        || new Set(answer.selected).size !== answer.selected.length
        || (!question.multiSelect && (answer.selected.length > 1 || (answer.selected.length && answer.custom)))
        || (answer.custom !== undefined && typeof answer.custom !== 'string')) throw new Error('提交的答案不符合此问题的选项');
      answers.push({ id: question.id, selected: answer.selected, ...(answer.custom?.trim() ? { custom: answer.custom.trim() } : {}) });
    } else answers.push({ id: question.id, selected: labels.includes(raw) ? [raw] : [],
      ...(raw && !labels.includes(raw) ? { custom: raw } : {}) });
  }
  return { answers };
}
