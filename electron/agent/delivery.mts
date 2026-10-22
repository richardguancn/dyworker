// 交付内容选择与真实执行结果核验。
import { existsSync } from "node:fs";
import path from "node:path";


// 命令解析：轻量词法分词，识别单双引号内外状态，精确拆分语句（|、;、&&、||）与重定向（>、>>）
function parseCommandStatements(cmdStr) {
  const statements = [];
  let currentCmd = [];
  let currentWord = "";
  let inSingle = false;
  let inDouble = false;
  let hasQuotes = false;
  const redirections = [];
  const s = String(cmdStr || "");
  let i = 0;
  const len = s.length;

  const pushWord = () => {
    if (currentWord || hasQuotes) {
      currentCmd.push(currentWord);
      currentWord = "";
      hasQuotes = false;
    }
  };

  const endStatement = () => {
    pushWord();
    if (currentCmd.length || redirections.length) {
      statements.push({ args: currentCmd, redirections: [...redirections] });
      currentCmd = [];
      redirections.length = 0;
    }
  };

  while (i < len) {
    const ch = s[i];
    if (ch === "\\" && !inSingle) {
      if (i + 1 < len) {
        currentWord += s[i + 1];
        i += 2;
        continue;
      }
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasQuotes = true;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasQuotes = true;
      i++;
      continue;
    }
    if (inSingle || inDouble) {
      currentWord += ch;
      i++;
      continue;
    }

    if (ch === ">") {
      pushWord();
      let isAppend = false;
      if (i + 1 < len && s[i + 1] === ">") {
        isAppend = true;
        i++;
      }
      i++;
      while (i < len && /\s/.test(s[i])) i++;
      let targetWord = "";
      let targetInSingle = false;
      let targetInDouble = false;
      let targetHasQuotes = false;
      while (i < len) {
        const tc = s[i];
        if (tc === "\\" && !targetInSingle) {
          if (i + 1 < len) { targetWord += s[i + 1]; i += 2; continue; }
        }
        if (tc === "'" && !targetInDouble) {
          targetInSingle = !targetInSingle;
          targetHasQuotes = true;
          i++;
          continue;
        }
        if (tc === '"' && !targetInSingle) {
          targetInDouble = !targetInDouble;
          targetHasQuotes = true;
          i++;
          continue;
        }
        if (!targetInSingle && !targetInDouble && /[\s;&|<>]/.test(tc)) {
          break;
        }
        targetWord += tc;
        i++;
      }
      if (targetWord || targetHasQuotes) {
        redirections.push({ type: isAppend ? ">>" : ">", target: targetWord });
      }
      continue;
    }

    if (/[\s]/.test(ch)) {
      pushWord();
      i++;
      continue;
    }

    if (/[;&|]/.test(ch)) {
      endStatement();
      i++;
      continue;
    }

    currentWord += ch;
    i++;
  }

  endStatement();
  return statements;
}

// 规范化相对路径
function normalizeRelPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

// 只解析专门上传工具的返回值。通用命令的输出即使包含同样字段，也可能
// 来自旧文件、打印语句或失败命令之后的其他操作，不参与完成核验。
function hasUploadReceipt(result) {
  const text = String(result || "");
  const block = text.match(/\{[\s\S]*\}/);
  if (!block) return false;
  try {
    const parsed = JSON.parse(block[0]);
    if (!parsed || typeof parsed !== "object") return false;
    const payloads = [parsed, ...(parsed.data && typeof parsed.data === "object" ? [parsed.data] : [])];
    return payloads.some((p) => Number(p.errcode) === 0 || p.success === true || Boolean(p.media_id) || Boolean(p.draft_id));
  } catch {
    return false;
  }
}

// 逐项正向凭证核查：必须具备确凿的正向成功标识（media_id/draft_id/article_id/id，或 success: true / errcode: 0 / status: success|ok）
function isSuccessItem(item) {
  if (!item || typeof item !== "object") return false;
  if (Boolean(item.media_id || item.draft_id || item.article_id || item.item_id || item.id)) return true;
  if (item.success === true) return true;
  if (item.errcode !== undefined && Number(item.errcode) === 0) return true;
  if (typeof item.status === "string" && ["success", "ok", "published", "done"].includes(item.status.toLowerCase())) return true;
  return false;
}

// 上传篇数计数：一次批量调用可能成功上传多篇（如一次返回四篇草稿编号），
// 按回执中的逐篇正向凭据计数，而不是按工具调用次数；空白对象不计为成功；
// 重复的草稿/文章编号不能重复计为不同文章
function countUploadReceipts(tool) {
  const text = String(tool?.result || "");
  try {
    const parsed = JSON.parse(text);
    const containers = [parsed, ...(parsed && typeof parsed.data === "object" && parsed.data ? [parsed.data] : [])];
    for (const container of containers) {
      if (!container || typeof container !== "object") continue;
      for (const key of ["articles", "drafts", "items", "results", "list"]) {
        const list = Array.isArray(container[key]) ? container[key] : null;
        if (list) {
          const successfulItems = list.filter(isSuccessItem);
          if (successfulItems.length === 0) return 0;
          const seenIds = new Set();
          let uniqueCount = 0;
          for (const item of successfulItems) {
            const id = item.media_id || item.draft_id || item.article_id || item.item_id || item.id;
            if (id !== undefined && id !== null && String(id).trim() !== "") {
              const idStr = String(id).trim();
              if (seenIds.has(idStr)) {
                // 重复编号，不计为不同文章
                continue;
              }
              seenIds.add(idStr);
              uniqueCount++;
            } else {
              uniqueCount++;
            }
          }
          return uniqueCount;
        }
      }
      if (Number.isFinite(container.count) && container.count >= 1 && (Number(container.errcode) === 0 || container.success === true)) {
        return Math.floor(container.count);
      }
    }
    if (parsed && typeof parsed === "object") {
      if (isSuccessItem(parsed)) return 1;
    }
  } catch {
    // 非 JSON 回执落到下方的 ID 计数
  }
  // 非结构化回执：按出现的不同媒体/草稿 ID 计数
  const ids = new Set([...text.matchAll(/(?:media_id|draft_id)["'\s:：]*["']?([0-9a-zA-Z_-]{3,})/gi)].map((m) => m[1]));
  if (ids.size > 0) return ids.size;
  if (tool?.status === "success" && !text.includes("articles") && !text.includes("drafts")) return 1;
  return 0;
}

// 交付正文是否以「半截话」收尾：以冒号收尾的引子，或「结论如下」这类后面什么都没有的引子。
// 只认整个文本的结尾——「结论如下：视频号没有发布接口」这种后面有内容的完整句不算引子；
// 单个字母加冒号按 Windows 盘符处理（「保存到 D:」），但「请见 Notion:」这类英文词尾不算豁免。
export function isIncompleteDeliveryEnding(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (/(?:^|[\s（(「])[A-Za-z]:\s*$/.test(value)) return false;
  if (/[:：]\s*$/.test(value)) return true;
  return /(?:答案|结论|结果|清单|明细|要点|建议|方案)[^。！？\n]{0,6}(?:如下|见下|附后|在下方|随后给出)[：:]?\s*$/.test(value);
}

// 正文里是否存在「只承诺交付、还没给内容」的句子。逐句判定而不是只看最后一句：正文后面可能还跟着
// 「有问题随时问我」这类客套，只查尾句会漏掉真正的承诺句。要求同一句里同时出现预告口吻、交付动词、
// 对象「你/您」与交付物名词（或「请查收」这类收件提示），避免把「以上是我给你的结论」这种已经交付
// 的收尾误判成承诺。
const PROMISE_ANNOUNCE = /(?:现在|这就|下面|接下来|稍后|马上|等一下|待会|即将|将要|将会|可以|会|准备|回头|随后)/;
const PROMISE_DELIVER = /(?:给|交给|发|呈|奉|提供|汇报|说明|整理|列|输出|呈现)/;
const PROMISE_TARGET = /(?:你|您)/;
const PROMISE_NOUN = /(?:答案|结论|结果|回复|答复|说明|汇报|总结|清单|明细|建议|要点|方案|报告|正文|内容|详情|数据|资料|表格)/;
const PROMISE_RECEIVING = /(?:请查收|请过目|请查阅)/;

function deliverySentences(text) {
  return String(text || "")
    .split(/[。！？!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isPromiseSentence(sentence) {
  return (PROMISE_ANNOUNCE.test(sentence) && PROMISE_DELIVER.test(sentence) && PROMISE_TARGET.test(sentence) && PROMISE_NOUN.test(sentence))
    || (PROMISE_RECEIVING.test(sentence) && PROMISE_NOUN.test(sentence));
}

export function promisesDelivery(text) {
  return deliverySentences(text).some(isPromiseSentence);
}

// summary 是否只是「已完成/已归档」式回执或过程工作日志，而不是交付内容。这类文本再长也不能盖掉
// 正文里已经给出的答案（实测「已核实完毕并把资料归档保存」「我把三层数据逐条核对了一遍」
// 「本次已完成以下工作：…」都只是过程记录）。
// 只有「没有冒号/分号、也不是分条清单」的纯动作汇报才算回执：像
//「已整理好三条替代方案：一是换平台，二是走人工通道」这种带内容的成稿，绝不能当成回执丢掉。
const STATUS_REPORT_PATTERN = /^(?:我|我们|本次|本轮|这次|已经?|都|均|全部)[^。！？\n]{0,20}(?:核实|核对|复核|检查|整理|梳理|归档|保存|处理|执行|读取|检索|汇总|确认|更新|交付|结束|搞定|通过|落库|完成)/;
// 过程日志：本轮工作汇报、工具调用记录，以及「先…然后…接着…最后…」式流水叙述
const PROCESS_LOG_PATTERN = /(?:本次|本轮|这次)[^。！？\n]{0,12}(?:完成|执行|进行)(?:了)?[^。！？\n]{0,12}工作|(?:调用|执行)了?[^。！？\n]{0,8}工具|工具清单|操作步骤|执行记录|已归档|(?:先|首先)[^。！？\n]{2,40}(?:然后|接着|最后|之后)/;
// 极短 summary 只有落到这些动作词才算回执：「视频号没有发布接口。」这类短答是交付内容，不能当回执丢掉
const RECEIPT_WORD_PATTERN = /(?:完毕|读取|读完|阅读|核对|复核|检查|整理|梳理|归档|处理|执行|交付|结束|搞定|确认|修改|更新|落库|保存|生成|通过|就绪|完成)/;

function isStatusOnlySummary(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (value.length <= 12) return RECEIPT_WORD_PATTERN.test(value);
  if (PROCESS_LOG_PATTERN.test(value)) return true;
  // 带冒号/分号或分条序号说明已经给出内容，不是纯回执
  if (/[：:；;]/.test(value) || /(?:^|\n)\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.])/.test(value)) return false;
  return value.length <= 60 && !ANSWER_PAYLOAD_PATTERN.test(value) && STATUS_REPORT_PATTERN.test(value);
}

// 判定交付正文是否写出了「具体产出」：文件、路径、链接，或「12 页」「3 条」「128 处」这类带单位的
// 数量。写了具体产出的正文不能被一份更长的工作日志或一句更短的回执盖掉。
const ANSWER_PAYLOAD_PATTERN = /(?:[A-Za-z]:[\\/]|[^\s，。；：、（）()「」]{1,60}\.(?:docx?|xlsx?|pptx?|pdf|md|txt|csv|json|html?|png|jpe?g|gif|mp4|mov|mp3|wav|zip|py|js|ts|tsx|mjs)|https?:\/\/|\/[\w.\u4e00-\u9fa5-]+\/|\d+\s*(?:页|篇|条|个|处|行|项|份|例|人|家|张|套|组|道|节|步|元|%|次|字|分钟|小时|天|GB|MB|KB))/i;

// 正文尾句只是「答案在下面表格里 / 见附件文档 / 见后文」这类指路话，并且指路之后没有真的给出
// 内容。指路话不带人称词，靠 promisesDelivery 抓不到；但「结论如下：<内容>」这种后面有内容的
// 完整句必须放行，所以「如下/如上」只在句末才算指路话，地点类指路词后面也几乎不能有实质内容。
export function pointsElsewhereOnly(text) {
  const sentences = deliverySentences(text);
  const last = sentences[sentences.length - 1] || "";
  const pointer = /(?:答案|结论|结果|清单|明细|要点|建议|方案|报告|表格|正文|内容|资料)[^。！？\n]{0,16}(?:放在|见|详见|参见|整理在|汇总在|转到)?[^。！？\n]{0,6}(?:下面|下方|下表|下页|下一节|后文|后面|末尾|本节|第\s*\d+\s*[节页章]|附页|附表|附件|文档|下文|表格|表里|清单里|附后|如上|如下)/;
  const match = last.match(pointer);
  if (!match) return false;
  const after = last.slice(match.index + match[0].length).replace(/[。！？!?、，,：:\s]/g, "");
  const marker = match[0].slice(-2);
  return marker === "如下" || marker === "如上" ? after.length <= 1 : after.length <= 6;
}

// 交付正文选择。finish_task 有两个都可能面向用户的文本来源：模型在同一轮的收尾正文，和工具
// 契约里要求「完整、能独立阅读」的 summary。二者都可能是过程旁白/半句引子，也都可能是真正的
// 成稿，所以不能一味偏好其中一个：
//   · 旧口径固定优先同轮正文，实测有三类交付因此丢了内容——正文只写一句预告（「现在可以给你
//     完整、有依据的答案了。」）而完整结论写在 summary 里；正文只写「复核通过。简介已成功落库。」
//     而补好的成稿在 summary 里；正文只写「视频部分已全部完成。」而成片路径在 summary 里。
//   · 反过来，同轮正文是完整汇报、summary 只是「已读取报告」这类回执时，应当保留正文；正文
//     完整但末尾补一句客套承诺（「需要的话我可以给你更详细的明细」）时同样要保留正文。
// 规则：正文为空或以半截话收尾 → summary；summary 只是回执/过程日志 → 保留正文；成稿比正文更长，
// 且（正文含承诺句/指路话，或正文没有写出具体产出）时用 summary；成稿更长但正文写了具体产出时，
// 只有正文几乎只剩一句承诺才用 summary；成稿不比正文长时，只有正文本身是空壳（≤12 字且没有产出）
// 才用 summary；否则保留正文；再退回更早轮次的遗留正文，最后兜底固定文案。
// 关键约束：正文写出了具体结论或产出时，不会被一句更短的回执或一份更长的工作日志盖掉；
// summary 也不会因为正文只是一句预告/指路话而被静默丢弃。
export function pickDeliveryText(roundText, summaryText, legacyText = "") {
  const text = String(roundText || "").trim();
  const summary = String(summaryText || "").trim();
  const legacy = String(legacyText || "").trim();
  const fallback = summary || legacy || "任务已完成";
  if (!text) return fallback;
  // 正文以半截话收尾：肯定没写完，summary 再短也比它完整
  if (isIncompleteDeliveryEnding(text)) return fallback;
  if (!summary) return text;
  const concrete = ANSWER_PAYLOAD_PATTERN.test(text);
  // summary 只是回执或过程日志：不能盖掉正文（正文只有一句「报告是季度总结。」时也一样）
  if (isStatusOnlySummary(summary)) return text;
  const substantive = deliverySentences(text).filter((sentence) => !isPromiseSentence(sentence)).join("");
  const pointerOnly = pointsElsewhereOnly(text);
  // 正文本身就是一句指路话（「完整结论就放在下面的表格里。」），或去掉承诺句后几乎没内容：
  // 成稿就是 summary，比正文短也要用，否则用户拿到的永远是一句空话
  if (pointerOnly || (promisesDelivery(text) && substantive.length <= 12 && !ANSWER_PAYLOAD_PATTERN.test(substantive))) return summary;
  const teaser = promisesDelivery(text) || pointerOnly;
  // 正文只是预告/指路话，或没有写出具体产出，而成稿更长 → 用成稿
  if (summary.length > text.length && (teaser || !concrete)) return summary;
  // 成稿更长但正文写了具体产出：只有正文几乎只剩一句承诺时才用成稿
  if (summary.length > text.length) return text;
  // 成稿不比正文长：只有正文本身是空壳时才用成稿
  if (text.length <= 12 && !concrete) return summary;
  return text;
}

// 任务完成证据核验：检查模型声称的完成是否具备真实工具执行凭据
export function verifyTaskEvidence({
  finalText = "",
  executedTools = [],
  fileChanges = [],
  planSteps = null,
  isExplicitFinish = false,
  workspacePath = "",
}) {
  const text = String(finalText || "").trim();

  // 1. 优先检查计划完整性：
  // 若存在计划且有未完成步骤（pending 或 in_progress）：
  // A. 模型调用了 finish_task（isExplicitFinish 为 true）；
  // B. 模型在文字中声称了全部完成（"全部完成"、"任务完成"、"所有步骤均已完成" 等）。
  // 必须直接拦截，防止虚报完成或过早交付。
  if (planSteps && planSteps.length > 0) {
    const hasUnfinished = planSteps.some((step) => step.status !== "completed");
    if (hasUnfinished) {
      if (isExplicitFinish || /(全部完成|已全部完成|所有步骤均已完成|全部搞定|任务完成|全部做完|已完成全部)/i.test(text)) {
        return {
          verified: false,
          verdict: "unverified",
          reason: "计划中仍有未完成的步骤，但声称全部完成或尝试交付，与事实不符",
          code: "PLAN_INCOMPLETE",
        };
      }
    }
  }

  // 2. 区分否定/如实陈述与正面完成声明
  // 按子句独立判定：除标点外，还在“但/但是/然而/不过/却”等转折连接词处拆开，
  // “A已上传但B尚未上传”两侧分别核对，未完成的 B 不能掩盖虚报的 A
  const clauses = text.split(/[，,；;。！!\n\r]+|但(?:是)?|然而|不过|却/).map((s) => s.trim()).filter(Boolean);
  // 「推送/发送/转发」有歧义（git push 不是平台发布）：只有整段回复处在内容平台语境里才按发布声明
  // 处理；本次调用过上传/发布类工具，同样说明处在发布语境
  const platformContext = /(?:公众号|服务号|订阅号|视频号|草稿箱|草稿|素材库|发布平台|内容平台|后台|朋友圈|企业微信|抖音|小红书|微博|知乎|bilibili|文章|图文|稿件)/i.test(text)
    || executedTools.some((tool) => /(?:^|[_-])(?:upload|publish|post|draft|material)(?:[_-]|$)/i.test(String(tool?.name || "")));
  const isPositiveUploadClause = (clause) => {
    // 「已发表的文章页」这类定语用法不是完成声明：实测「2. 或者已发表的文章页里手动转发到视频号」
    // 会被当成助手「已发表」，把纯咨询类交付误判成虚报上传。先把定语形式的上传动词剥掉再判声明，
    // 这样既不会误判定语，也不会因为句子以「可以/请/如需」开头就漏掉真正的完成声明。
    const stripped = clause.replace(/已(?:经)?(?:成功)?(?:全部)?(?:上传|发布|发表|同步)(?:的|过的)/g, "");
    const hasAttributive = stripped !== clause;
    // 「尝试/准备/开始入库」是打算，不是完成；整句按意图处理，避免「均已尝试入库」被算成入库成功
    const attemptOnly = /(?:尝试|准备|打算|开始|即将|计划)[^。！？\n]{0,4}(?:入库|上传|发布|发表|同步|发送|推送)/.test(stripped);
    const hasPos = !attemptOnly && /(?:已(?:经)?(?:成功)?(?:全部)?(?:上传|发布|发表|同步)|(?:全部)?(?:上传|发布|发表|同步)(?:成功|完成)|全部(?:上传|发布|同步)|已(?:经)?(?:全部|均|都)?入(?:库|仓)|(?:均已|都已|全部|都|均)(?!\s*(?:尝试|准备|打算|开始|即将|计划))[^。！？\n]{0,6}入库|入库(?:成功|完成|完毕)|已进入草稿箱|(?:已经?|都|均|全部|成功)[^。！？\n]{0,3}进[^。！？\n]{0,3}草稿箱|已存为草稿|已加入草稿|成功存入草稿箱)/i.test(stripped);
    // 定语剥离后剩下的若是数量/回执信息（「已发布的 3 篇文章：ID1、ID2」），或「都传上去了」
    // 这类口语完成式（「已发布的文章都传上去了」），仍然是完成声明
    const attributiveClaim = hasAttributive
      && /(?:成功|完成|就绪|入库|均已|都已|都同步|全部|共\s*\d+|\d+\s*(?:篇|个|条)|编号|\bid\b|media_id|(?:都|均)(?:已)?[^。！？\n]{0,8}(?:传|发|转|推送|同步|上传|发布|发表|存|入|进)|(?:传|发|转|推送|同步|上传|发布|发表|存|入|进)[^。！？\n]{0,4}了)/i.test(stripped);
    // 口语完成式：「已经/成功 + 动词」或「动词 + 完成标记」（「文章都已经传到公众号后台了」
    // 「全部传上去了」「上传完毕」「都同步好了」）。完成标记必须紧贴动词，否则「这两条都只在你
    // 手动发表的瞬间发生」这种无关句会被误判成完成声明。
    const colloquialClaim = !attemptOnly && /(?:已经?|成功)[^。！？\n]{0,4}(?:上传|传到|传上去|发布|发表|发到|发出去|发出|发好|转存|转到|同步|入库|进草稿箱|存草稿|存好)|(?:上传|传到|传上去|发布|发表|发到|发出去|发出|发好|转存|转到|同步|入库|进草稿箱|存草稿|存好)[^。！？\n]{0,8}(?:成功|完毕|完成|好了|掉了|完了|了|完)/.test(stripped);
    // 平台语境下的「已推送成功/已发送/已转发」才算发布声明（git push 的「已推送。」不算）
    const pushClaim = platformContext
      && (/(?:已经?|成功)[^。！？\n]{0,4}(?:推送|发送|转发)|(?:推送|发送|转发)[^。！？\n]{0,8}(?:成功|完毕|完成|好了|掉了|完了|了|完)/.test(stripped));
    // 否定词与完成动词之间允许夹「真正/实际/全部/都」等副词，否则「并没有真正发布成功」这类
    // 如实的失败汇报会被当成虚报成功
    const hasNeg = /(?:尚未|未|暂未|没有|并没有|并没|暂无|暂不|先不|不予|不需|不用|无需|不需要)[^。！？\n]{0,6}(?:上传|发布|发表|同步|推送|发送|发到|发出去|存入草稿|入库)/i.test(clause);
    return (hasPos || attributiveClaim || colloquialClaim || pushClaim) && !hasNeg;
  };
  const claimsUpload = clauses.some(isPositiveUploadClause);

  // 正面文件写入/创建声明（支持包含中文字符的文件名，如“已创建 result.txt”、“已生成 报告.txt”、“写入 分析.xlsx”）
  // 必须带写入动词才算声明——“文件 notes.txt 的用途是记录笔记”这类普通提及不算；
  // 含“尚未生成”等否定的子句整句剔除（不提取其中的文件名），不能掩盖其他子句的正面声明
  const fileActionMatch = /已(?:经)?(?:成功)?(?:创建|写入|保存|生成|导出)(?:了)?(?:文件)?\s*[`'"]?([a-zA-Z0-9_\u4e00-\u9fa5./-]+\.[a-zA-Z0-9]+)[`'"]?/gi;
  const genericFileWritePattern = /(?:已(?:经)?(?:成功)?(?:创建|写入|保存|生成|导出)文件|文件已(?:创建|写入|保存|生成)|已导出|导出成功)/i;
  const fileNegationPattern = /(?:尚未|未|暂未|没有|暂不|先不)\s*(?:创建|写入|保存|生成|导出)/i;
  const positiveFileText = clauses.filter((clause) => !fileNegationPattern.test(clause)).join("\n");
  const claimedFiles = [...positiveFileText.matchAll(fileActionMatch)].map((m) => m[1]);
  const hasGenericFileWrite = genericFileWritePattern.test(positiveFileText);
  const claimsFileWrite = claimedFiles.length > 0 || hasGenericFileWrite;

  // 纯文本普通问答、咨询、方案草拟、如实陈述等：直接放行
  if (!claimsUpload && !claimsFileWrite && !isExplicitFinish) {
    return {
      verified: true,
      verdict: "not_required",
      detail: "普通文本交互或如实陈述，无需外部操作证据",
    };
  }

  // 3. 检查上传发布证据
  if (claimsUpload) {
    // 只有专门的上传/发布工具能提供操作凭据。通用命令的标准输出可以来自
    // 旧文件、打印语句或命令链中另一段操作，不能证明本次向目标平台写入。
    const uploadTools = executedTools.filter((tool) => {
      if (tool?.isReadOnly === true) return false;
      const name = String(tool?.name || "").toLowerCase();
      if (name === "run_command") return false;
      if (/(?:^|[_-])(?:get|read|list|fetch|search|query|check)(?:[_-]|$)/.test(name)) return false;
      return /(?:^|[_-])(?:upload|publish|post|create_draft|save_draft|draft_add|add_draft)(?:[_-]|$)/.test(name);
    });

    if (!uploadTools.length) {
      const hasCommand = executedTools.some((tool) => tool?.name === "run_command");
      return {
        verified: false,
        verdict: "unverified",
        reason: hasCommand
          ? "命令输出不能单独证明外部平台已上传，尚无可核对的平台操作回执"
          : "未检测到真实上传操作执行记录（仅有只读操作或零操作），声明未经验证",
        code: "NO_UPLOAD_ACTION",
      };
    }

    const failedUploads = uploadTools.filter((t) => t.status === "error" || /errcode\D*[1-9]|ip.*white|白名单|failed|error|失败/i.test(String(t.result || "")));
    const successfulUploads = uploadTools.filter((t) => t.status === "success" && !failedUploads.includes(t) && hasUploadReceipt(t.result));

    // 如果没有成功的上传工具
    if (!successfulUploads.length) {
      const allFailed = uploadTools.every((t) => t.status === "error" || failedUploads.includes(t));
      return {
        verified: false,
        verdict: allFailed ? "failed" : "unverified",
        reason: allFailed
          ? "上传操作实际执行失败，但回复声称成功，与事实不符"
          : "上传操作没有返回可核对的成功凭据，不能确认已经上传",
        code: allFailed ? "FAILED_CLAIMED_SUCCESS" : "NO_UPLOAD_RECEIPT",
      };
    }

    // 若声称全部/所有文章成功，但实际上有失败项
    const claimsAll = /(全部|所有|均已|都已|\b\d+篇全部)/i.test(text);
    if (claimsAll && successfulUploads.length !== uploadTools.length) {
      return {
        verified: false,
        verdict: "unverified",
        reason: "上传操作存在失败项或缺少有效回执，但回复声称全部成功，与事实不符",
        code: "PARTIAL_OR_FAILED",
      };
    }

    // 核验声称的具体数量与实际成功数量
    const zhNumMap = { "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
    let claimedQuantity = null;
    const qtyMatch = text.match(/(?:(\d+|[一两二三四五六七八九十])\s*篇(?:全部)?|全部\s*(\d+|[一两二三四五六七八九十])\s*篇)/i);
    if (qtyMatch) {
      const rawNum = qtyMatch[1] || qtyMatch[2];
      claimedQuantity = zhNumMap[rawNum] || Number(rawNum);
    }
    // 一次批量调用可能成功上传多篇：按成功回执中的逐篇凭据计数，而不是按工具调用次数
    const successfulReceipts = successfulUploads.reduce((sum, tool) => sum + countUploadReceipts(tool), 0);
    // 已经如实说明有失败/被驳回时，成功数少于总数是吻合事实的，不能再判「数量不符」
    const reportsFailure = /(?:失败|驳回|被拒|拒绝|未成功|没有成功|不成功|出错|异常|部分)/.test(text);
    if (!reportsFailure && claimedQuantity && Number.isFinite(claimedQuantity) && successfulReceipts < claimedQuantity) {
      return {
        verified: false,
        verdict: "unverified",
        reason: `声称上传完成 ${claimedQuantity} 篇，但实际成功回执仅 ${successfulReceipts} 篇，数量不符`,
        code: "QUANTITY_MISMATCH",
      };
    }

    // 提取正文及表格中的草稿编号/文章 ID
    const claimedNumbers = new Set();
    // A. 键值对提取
    for (const m of text.matchAll(/(?:草稿编号|草稿\s*id|编号|id)[：:\s]*([0-9a-zA-Z_-]{4,})/gi)) {
      claimedNumbers.add(m[1]);
    }
    // B. Markdown 表格提取：检查包含草稿/ID列的单元格
    const lines = text.split(/\r?\n/);
    let tableIdColIdx = -1;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
      const cols = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      if (cols.some((c) => /(?:草稿|文章)?\s*(?:id|编号)/i.test(c))) {
        tableIdColIdx = cols.findIndex((c) => /(?:草稿|文章)?\s*(?:id|编号)/i.test(c));
        continue;
      }
      if (trimmed.includes("---")) continue;
      if (tableIdColIdx >= 0 && cols[tableIdColIdx]) {
        const val = cols[tableIdColIdx];
        const match = val.match(/([0-9a-zA-Z_-]{4,})/);
        if (match) claimedNumbers.add(match[1]);
      }
    }

    if (claimedNumbers.size > 0) {
      const allResultsText = successfulUploads.map((t) => String(t.result || "")).join(" ");
      const fabricated = [...claimedNumbers].filter((num) => !allResultsText.includes(String(num)));
      if (fabricated.length) {
        return {
          verified: false,
          verdict: "unverified",
          reason: `回复中包含未在工具执行结果中出现的虚构凭证编号（${fabricated.join(", ")}）`,
          code: "FABRICATED_ID",
        };
      }
    }
  }

  // 4. 检查写入文件证据
  if (claimsFileWrite) {
    const normalizeRelPath = (p) => {
      return String(p || "")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .toLowerCase();
    };

    // 收集所有成功写入记录的规范化相对路径
    const recordedPaths = new Set();
    for (const t of executedTools) {
      if (t.status === "success" && ["write_file", "edit_file", "append_file", "export_word_document", "export_excel_workbook"].includes(t.name)) {
        if (t.args?.path) recordedPaths.add(normalizeRelPath(t.args.path));
      }
    }
    for (const fc of fileChanges) {
      if (fc.path) recordedPaths.add(normalizeRelPath(fc.path));
    }

    // 物理检查：如果提供了 workspacePath，检查工作区物理文件是否存在
    const checkPhysicalFile = (fileName) => {
      if (!workspacePath) return false;
      try {
        const fullPath = path.resolve(workspacePath, fileName);
        return existsSync(fullPath);
      } catch {
        return false;
      }
    };

    // 检查是否有针对具体文件的命令写入特征（重定向/写入命令）。
    // 基于词法状态机精确解析 shell 语句：引号外部的 > 或 >>，或 touch/tee/cp/mv/sed -i 等写命令；
    // 引号内的纯字符串（如 printf '> result.txt'）不触发重定向
    const commandWritesFile = (cmdStr, fileName) => {
      if (!cmdStr) return false;
      const targetNorm = normalizeRelPath(fileName);
      const rawBase = path.basename(fileName);
      const statements = parseCommandStatements(cmdStr);

      for (const stmt of statements) {
        // 1. 引号外的重定向 > 或 >>
        for (const r of stmt.redirections) {
          const rNorm = normalizeRelPath(r.target);
          if (rNorm === targetNorm || path.basename(r.target) === rawBase) {
            if (targetNorm.includes("/")) {
              if (rNorm === targetNorm) return true;
            } else {
              if (!rNorm.includes("/") || rNorm === targetNorm) return true;
            }
          }
        }
        // 2. 检查特定文件写命令：touch, tee, cp, mv, sed -i 等
        const cmdName = (stmt.args[0] || "").toLowerCase();
        if (["touch", "tee"].includes(cmdName)) {
          for (const arg of stmt.args.slice(1)) {
            const aNorm = normalizeRelPath(arg);
            if (aNorm === targetNorm || (!targetNorm.includes("/") && !aNorm.includes("/") && path.basename(arg) === rawBase)) return true;
          }
        }
        if (["cp", "mv"].includes(cmdName)) {
          const dest = stmt.args[stmt.args.length - 1];
          if (dest) {
            const dNorm = normalizeRelPath(dest);
            if (dNorm === targetNorm || (!targetNorm.includes("/") && !dNorm.includes("/") && path.basename(dest) === rawBase)) return true;
          }
        }
        if (cmdName === "sed" && stmt.args.some((a) => a.startsWith("-i"))) {
          for (const arg of stmt.args.slice(1)) {
            const aNorm = normalizeRelPath(arg);
            if (aNorm === targetNorm || (!targetNorm.includes("/") && !aNorm.includes("/") && path.basename(arg) === rawBase)) return true;
          }
        }
      }
      return false;
    };

    const hasCommandSuccess = executedTools.some((t) => t.name === "run_command" && t.status === "success");
    const checkCommandWroteFile = (fileName) => {
      return executedTools.some((t) => t.name === "run_command" && t.status === "success" && commandWritesFile(t.args?.command, fileName));
    };

    // 若提取到了声称的目标文件名（例如 target.txt、a/result.txt、报告.txt）
    if (claimedFiles.length > 0) {
      for (const claimed of claimedFiles) {
        const normClaimed = normalizeRelPath(claimed);
        // 目标解析为工作区内明确相对路径后精确匹配：
        // 缺省目录时不再按文件名模糊匹配（sub/result.txt 不能冒充根目录 result.txt）
        const inRecorded = recordedPaths.has(normClaimed);
        const physicallyExists = checkPhysicalFile(claimed);
        const commandWrote = checkCommandWroteFile(claimed);

        // 如果文件既没有被写入工具记录，也不是（物理存在且被本次命令明确写入）
        if (!inRecorded && !(physicallyExists && commandWrote)) {
          return {
            verified: false,
            verdict: "unverified",
            reason: `未检测到目标文件 ${claimed} 的真实写入或修改记录`,
            code: "TARGET_FILE_NOT_FOUND",
          };
        }
      }
    } else {
      // 未指明具体文件名，但声称写文件：检查是否有任一写入工具、变更或物理文件写入
      const hasAnyWrite = recordedPaths.size > 0 || (hasCommandSuccess && workspacePath);
      if (!hasAnyWrite) {
        return {
          verified: false,
          verdict: "unverified",
          reason: "未检测到文件写入或修改记录，声明未经验证",
          code: "NO_WRITE_ACTION",
        };
      }
    }
  }

  return {
    verified: true,
    verdict: "verified",
    detail: "所有操作声明均有对应真实工具执行记录支持",
  };
}
