// 工作模板（技能）服务 ctx.skills：把 main.mts 里的模板读写、内置模板合并、
// 文件技能（SKILL.md）发现与覆盖表收编为 cordis 服务。
// 职责边界：
//   - read(workspacePath)：内置/本地（skills.json）+ 文件技能 + 覆盖表 → 合并后的可见列表
//   - append/update/remove/setEnabled：本地模板的增改删与启停（文件技能只走覆盖表）
//   - create(payload)：会话「总结为工作模板」落盘入口
// 用户目录（homeDir）与数据目录（dir）由宿主注入，本文件不依赖 electron。
import { Service } from "cordis";
import path from "node:path";
import crypto from "node:crypto";
import { discoverFileSkills, mergeSkillRecords } from "../../skills.mts";
import { readJson, writeJson } from "../io.mts";

declare module "cordis" {
  interface Context {
    skills: SkillsService;
  }
}

const builtInSkills = [
  {
    id: "builtin-official-draft",
    name: "公文起草",
    description: "起草通知、请示、报告、函等党政机关公文",
    instructions: "1. 先确认文种（通知/请示/报告/函）、主送单位和行文依据，请示一文一事，报告不夹带请示事项；2. 结构：标题（发文机关+事由+文种）→ 主送单位 → 正文（缘由—事项—要求）→ 落款和日期；3. 开头不强套“根据……为……”式（真实公文中依据式开头占比不到一成），按事由自然切入；结尾自然收束，不滥用“请遵照执行”类程式化结语；4. 语言庄重准确，以长句为主，用“甲、乙、丙”顿号并列枚举撑开句子；“必须/应当”全篇一两处即可，堆叠反而显虚；5. 涉及政策依据时用政府官网搜索核实文号和条款并注明来源；无法核实的数字一律写【待补：xx】占位，绝不编造；6. 完成后通读检查格式、称谓和落款。",
  },
  {
    id: "builtin-meeting-minutes",
    name: "会议纪要",
    description: "把会议记录整理成规范纪要",
    instructions: "1. 从记录中提取：时间地点、主持人、出席人员、议题，记录里缺失的项标注【待补】，不臆造；2. 按“会议认为/会议指出/会议议定”组织正文；3. 议定事项逐条列出，明确责任单位和完成时限；4. 语言客观，不添加记录中没有的内容；5. 末尾列出任务分工表。",
  },
  {
    id: "builtin-policy-brief",
    name: "政策解读",
    description: "解读政策法规文件并核对权威来源",
    instructions: "1. 先在政府官网找到政策原文并打开核对；2. 提炼：适用范围、核心条款、办理流程、时限、新旧变化；3. 结合本单位实际说明影响和要做的事；4. 所有文号、数字、期限必须与原文一致并附来源网址；5. 不确定的地方明确标注，不得推测。",
  },
  {
    id: "builtin-materials-summary",
    name: "材料汇总",
    description: "从工作区多份材料中提取要点并汇总成稿",
    instructions: "1. 列出工作区文件，识别与主题相关的材料；2. 逐份读取并记录关键事实、数据、结论；3. 合并同类内容并标注出处；4. 按用户要求的体裁成稿；5. 数据有出入时并列说明，不擅自取舍。",
  },
  {
    id: "builtin-mail-register",
    name: "收发文登记",
    description: "登记来文来件并维护收发文台账",
    instructions: "1. 台账固定为工作区根目录的 收发文台账.csv（没有则创建，表头：序号,日期,来文单位,文号,标题,承办人,办理状态,备注）；2. 每收到一份文件，读取文件提取来文单位、文号、标题和日期，追加一行，序号顺延；3. 文号保留原文〔〕格式，日期统一 YYYY-MM-DD；4. 办理状态默认“待办”，用户说明进展时更新对应行；5. 用户需要时汇总未办结事项清单。",
  },
  {
    id: "builtin-info-brief",
    name: "信息简报",
    description: "把工作动态、经验做法整理成政务信息简报",
    instructions: "1. 结构：报头（单位、期号、日期）→ 标题（一句话点明主题）→ 导语（时间、地点、事项）→ 正文（措施、成效，条目化）→ 结尾（下一步打算）；2. 一事一报，控制在一页以内；正文每段用段首动宾提领句领起（如“聚焦隐患抓整治”）；3. 措施和成效尽量挂一线人员、群众的原话，比概括性表述更可信；4. 数据必须来自工作区材料并注明出处，没有可靠数据就用事实和引语支撑，不硬凑百分比；5. 语言客观简练，不用修饰性空话；交付前先扫描敏感信息，涉及个人信息的提醒脱敏。",
  },
  {
    id: "builtin-leader-summary",
    name: "领导摘要",
    description: "把长篇材料压缩成一页纸决策摘要",
    instructions: "1. 通读材料后先写“核心结论”（不超过 3 条，每条一句话）；2. 再列“关键数据与事实”（注明来源文件）；3. 然后列“风险与问题”；4. 最后写“建议事项”（需要领导决定或批示的）；5. 全篇约 500 字、不超过一页，不用套话。",
  },
  {
    id: "builtin-deep-research",
    name: "深度调研",
    description: "围绕一个主题（市场、公司、行业、政策）做多角度检索和交叉验证，产出带来源的调研报告",
    instructions: "1. 先用 update_plan 把调研主题拆成 3-6 个子问题（如：基本情况、经营与财务、行业地位、政策环境、风险与争议）；相互独立的子问题可用 dispatch_agent 并行派发子代理调研（任务描述要完整自足），有依赖关系的自己按顺序做；2. 每个子问题至少用 2 组不同关键词检索，避免单一角度；3. 优先精读一手来源：公司官网、公告年报、政府部门和监管机构发布、权威媒体；用 fetch_web_page 打开原文，不只依赖搜索摘要；4. 关键事实必须有两个独立来源相互印证，数字注明口径和日期；5. 每完成一个子问题更新计划；发现信息缺口就补检索，至少完成一轮“检索—精读—验证”后再考虑收尾；6. 公司工商信息以国家企业信用信息公示系统或官方公告为准，第三方平台（天眼查、企查查等）数据要标注来源属性；7. 产出结构化调研报告：概述 → 分子问题分析 → 关键数据与事实（逐条带出处网址和日期）→ 矛盾与不确定项（明确标注，不猜测）→ 风险与关注建议 → 来源清单；一级标题用承载观点的完整句（可带转折），不用“一、基本情况”式短标签，段内分层用“一是、二是”；报告写入工作区，用户需要正式文档时再用 export_word_document 导出。",
  },
  {
    id: "builtin-leader-speech",
    name: "领导讲话稿",
    description: "起草动员部署、推进调度、总结表彰等会议讲话稿",
    instructions: "1. 先确认场合（动员部署/推进调度/总结表彰）、讲话人身份、受众和时长；2. 结构：开门见山点明会议主题和目的 → 形势与成绩（简洁）→ 任务部署（主体，分几条讲）→ 保障要求（组织领导、督导考核）；3. 各部分标题用承载观点的完整句（如“把设施短板补齐是当前最紧迫的任务”），不用“一、提高认识”式空标签堆砌；4. 长句论述与短句提气交替，适当用设问和反复强调，书面语中保留口语节奏；5. 成绩、名次、表彰对象、目标数字等无法核实的内容一律写【待补：xx】，绝不编造；6. 完稿后出声通读一遍，拗口的长句拆开。",
  },
  {
    id: "builtin-research-report",
    name: "调研报告",
    description: "起草分析问题、向上反映情况的政务调研报告",
    instructions: "1. 先明确调研主题和材料来源，工作区材料不足时先检索补充，必要时向用户询问本地情况；2. 结构：开头一两段交代背景与总体判断 → 正文按“现状—问题—原因—建议”或观点并列展开 → 自然收束，不加程式化结尾；3. 一级标题用 15-20 字承载观点的句子（常带转折，如“改造已经起步，热度却集中在头部企业”），不用“一、基本情况”式短标签；4. 段内分层主要用“一是、二是、三是”；典型事例和访谈对象原话是核心证据，引语注明身份；5. 数据必须有出处，无法核实的写【待补：xx】；不硬凑百分比，用事实和事例同样可以支撑判断；6. 建议与发现的问题一一对应，可落地、有责任主体。",
  },
  {
    id: "builtin-work-plan",
    name: "工作方案",
    description: "起草专项行动、集中整治等部署类工作方案",
    instructions: "1. 先确认行动目标、时间范围、牵头与配合单位；2. 结构：开头段交代依据和要解决的问题 → 工作目标（可量化、有期限）→ 重点任务 → 实施步骤/时间安排 → 保障措施；3. 一级标题用 4-8 字业务标签（工作目标、重点任务、保障措施）；重点任务下用（一）（二）细分，每条措施落到“谁牵头、干什么、什么时限”，需要再细时用“1．2．”三级编号；4. 目标和任务中的具体数字无法核实时写【待补：xx】，宁可留空让用户填，不编造；5. 语言以长句为主，用顿号并列枚举动作和责任单位；6. 保障措施不写空话，落到组织、经费、督导、考核上。",
  },
  {
    id: "builtin-experience-summary",
    name: "经验总结",
    description: "起草经验交流材料、典型做法总结（含党建类千字材料）",
    instructions: "1. 先确认篇幅定位：两三千字的汇报材料用标题分层结构，千字左右的交流材料用零标题写法（见第 4 条），两种结构不可混用；2. 长材料结构：标题用“做法+成效”式（如“四链联动激活红色引擎”）→ 开头段点出破解了什么难题、形成了什么路径 → 做法分 3-5 条，每条一个小标题 → 成效与启示自然收束；3. 每条做法用段首动宾提领句领起（如“拧紧责任链”），随后讲怎么改、改前改后对比，挂一两个具体事例和一线人员原话，长引语比概括性表述可信；4. 千字材料不加一级标题，全靠段首提领句分层，压在一页以内；5. 数据没有可靠来源就不用，优秀经验材料多数完全不靠百分比；无法核实的写【待补：xx】；6. 警惕“两张皮”式空对空表述，每条做法都要落到可核实的机制、制度或场景上。",
  },
];

export class SkillsService extends Service {
  dir;
  homeDir;

  constructor(ctx, config = {} as any) {
    super(ctx, "skills");
    this.dir = config.dir;
    this.homeDir = config.homeDir;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  // 用户删掉过的内置模板不再复活（按名字记录）
  async listDismissed() {
    const items = await readJson(this.file("skills-dismissed.json"), []);
    return Array.isArray(items) ? items : [];
  }

  async readStored() {
    const file = this.file("skills.json");
    const items = await readJson(file, []);
    const list = Array.isArray(items) ? items : [];
    // 合并新增的内置模板（老用户升级也能获得）；用户删除过的内置模板不复活。
    // 名字和 id 任一命中都视为已存在：用户改名内置模板后不应再补一份原版。
    const dismissed = new Set(await this.listDismissed());
    const present = new Set(list.map((item) => String(item?.name || "")));
    const presentIds = new Set(list.map((item) => String(item?.id || "")));
    const missing = builtInSkills.filter((skill) => !present.has(skill.name) && !presentIds.has(skill.id) && !dismissed.has(skill.name));
    if (!missing.length) return list;
    const merged = [
      ...list,
      ...missing.map((skill) => ({ ...skill, enabled: true, builtIn: true, createdAt: new Date().toISOString() })),
    ];
    await writeJson(file, merged);
    return merged;
  }

  async readOverrides() {
    const stored = await readJson(this.file("skill-overrides.json"), {});
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  }

  async read(workspacePath = "") {
    const [storedSkills, fileSkills, overrides] = await Promise.all([
      this.readStored(),
      discoverFileSkills({ homeDir: this.homeDir, workspacePath }),
      this.readOverrides(),
    ]);
    return mergeSkillRecords(storedSkills, fileSkills, overrides);
  }

  async writeStored(items) {
    await writeJson(this.file("skills.json"), items);
  }

  async append(item) {
    const skills = await this.readStored();
    const record = {
      id: crypto.randomUUID(),
      name: String(item.name || ""),
      description: String(item.description || ""),
      instructions: String(item.instructions || ""),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    skills.push(record);
    await this.writeStored(skills);
    return record;
  }

  // 技能自我改进（借鉴 Hermes Agent 的学习闭环）：按 id 更新已有模板的名称、说明与执行要求
  async update(item) {
    const skills = await this.readStored();
    const index = skills.findIndex((skill) => String(skill.id) === String(item.id));
    if (index < 0) return null;
    const name = String(item.name ?? "").trim() || skills[index].name;
    skills[index] = {
      ...skills[index],
      name,
      description: String(item.description || skills[index].description || ""),
      instructions: String(item.instructions || skills[index].instructions || ""),
    };
    await this.writeStored(skills);
    return skills[index];
  }

  // 启停：本地模板直接改 skills.json；文件技能（只读）走覆盖表
  async setEnabled(payload) {
    const id = String(payload?.id || "");
    const storedSkills = await this.readStored();
    const storedSkill = storedSkills.find((item) => String(item.id) === id);
    if (storedSkill) {
      storedSkill.enabled = Boolean(payload?.enabled);
      await this.writeStored(storedSkills);
      return { ok: true };
    }
    const allSkills = await this.read(String(payload?.workspacePath || ""));
    if (!allSkills.some((item) => String(item.id) === id && item.readOnly)) return { ok: false };
    const overrides = await this.readOverrides();
    overrides[id] = Boolean(payload?.enabled);
    await writeJson(this.file("skill-overrides.json"), overrides);
    return { ok: true };
  }

  async remove(id) {
    const skills = await this.readStored();
    const target = skills.find((item) => String(item.id) === String(id));
    if (!target) return { ok: false, error: "文件技能请在来源目录中管理" };
    await this.writeStored(skills.filter((item) => String(item.id) !== String(id)));
    if (target?.builtIn) {
      const dismissed = await this.listDismissed();
      if (!dismissed.includes(target.name)) {
        dismissed.push(target.name);
        await writeJson(this.file("skills-dismissed.json"), dismissed);
      }
    }
    return { ok: true };
  }
}
