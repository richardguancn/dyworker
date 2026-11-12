// 真实 Electron 主进程驱动的多语言 App Store 截图生成脚本
// 100% 真实渲染、生产级 IPC 全功能运行、零隐私泄露、完全符合苹果 16:10 (2880x1800) 标准
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputBaseDir = path.resolve(rootDir, 'output/app-store-screenshots');
const cdpPort = 9444;

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'];

const DEMO_SUITES = {
  'zh-CN': {
    title: '2026年度业务数据分析与汇报',
    userPrompt: '请帮我分析本季度各区域的销售指标完成情况，提取关键亮点与潜在风险，并给出下一季度的针对性改进建议。',
    assistantReply: `### 📊 本季度各区域销售表现分析报告

已对各区域经营数据进行深度清洗与多维归因分析，核心发现如下：

| 业务大区 | 目标达成率 | 同比增长 | 核心增长驱动 / 关键特征 |
| :--- | :--- | :--- | :--- |
| **华东大区** | **118.4%** | +34.2% | 重点企业云端方案采购量超预期增长 |
| **华南大区** | **106.8%** | +21.5% | 跨境电商供应链协同工具交付稳健 |
| **华北大区** | **94.2%** | +8.7% | 招投标采购周期略有延缓，管线储备充足 |
| **西南与综合** | **102.1%** | +15.3% | 新兴区域渠道伙伴拓展成效显著 |

---

#### 💡 关键业务洞察
1. **产品矩阵协同效益显著**：企业协同处理模块渗透率达到 **64.2%**，客户续约率提升至 **92.8%**。
2. **交付周期有效缩短**：自动化工作流落地后，标准实施交付周期由 21 天降至 **13.5 天**（-35.7%）。

#### 🎯 下阶段改进建议
* **策略 1**：强化华北大区大型项目前置技术支持，加速招投标闭环。
* **策略 2**：推广华东大区成熟的行业模板方案至新兴区域，降低销售周期。
* **策略 3**：引入智能工作区预检插件，提升首期交付质量。`,
    docTitle: 'Q3 综合运营分析与策略规划.md',
    traces: [
      { step: '意图理解与规划', tool: 'intent_parser', time: '18ms', detail: '解析区域销售分析意图，确立指标维度与约束' },
      { step: '工作区安全读取', tool: 'sandbox_file_reader', time: '42ms', detail: '安全沙箱读取 datasets/q3_regional_sales.csv' },
      { step: '多维统计运算', tool: 'variance_calculator', time: '135ms', detail: '完成同比增长率与达成率方差矩阵计算' },
      { step: '生成结构化分析', tool: 'document_synthesizer', time: '85ms', detail: '输出结构化分析图表与 Markdown 交付报告' }
    ]
  },
  'zh-TW': {
    title: '2026年度業務數據分析與簡報',
    userPrompt: '請幫我分析本季度各區域的銷售指標達成狀況，整理關鍵亮點與潛在風險，並提供下季度的針對性改進建議。',
    assistantReply: `### 📊 本季度各區域銷售表現分析報告

已對各區域營運數據完成深入清洗與多維歸因分析，核心結論如下：

| 業務大區 | 目標達成率 | 同比增長 | 核心增長驅動 / 關鍵特徵 |
| :--- | :--- | :--- | :--- |
| **北部區域** | **118.4%** | +34.2% | 企業雲端方案採購量顯著超越預期 |
| **南部區域** | **106.8%** | +21.5% | 供應鏈協同工具交付平穩增長 |
| **中部區域** | **94.2%** | +8.7% | 招標審批週期遞延，潛在商機儲備充足 |
| **東部與其他** | **102.1%** | +15.3% | 新興通路合作夥伴拓展效益顯著 |

---

#### 💡 關鍵業務洞察
1. **產品組合效益深化**：協同處理模組導入率達 **64.2%**，客戶續約率攀升至 **92.8%**。
2. **交付週期持續優化**：工作流程自動化落實後，標準導入期由 21 天縮減至 **13.5 天**（-35.7%）。`,
    docTitle: 'Q3 綜合營運分析與策略規劃.md',
    traces: [
      { step: '意圖理解與規劃', tool: 'intent_parser', time: '18ms', detail: '解析區域銷售分析意圖，確立指標維度與約束' },
      { step: '工作區安全讀取', tool: 'sandbox_file_reader', time: '40ms', detail: '安全沙箱讀取 datasets/q3_regional_sales.csv' },
      { step: '多維統計運算', tool: 'variance_calculator', time: '130ms', detail: '完成同比增長率與達成率變異數矩陣計算' },
      { step: '生成結構化分析', tool: 'document_synthesizer', time: '82ms', detail: '產出結構化分析圖表與 Markdown 交付報告' }
    ]
  },
  'en-US': {
    title: 'Annual Business Performance & Executive Summary',
    userPrompt: 'Please analyze quarterly regional sales performance, highlight key growth drivers and potential risks, and outline actionable recommendations for next quarter.',
    assistantReply: `### 📊 Quarterly Regional Sales Performance Report

Based on sanitized operating data across all regional units, here is the structured executive analysis:

| Region | Quota Attainment | YoY Growth | Primary Growth Driver |
| :--- | :--- | :--- | :--- |
| **North America** | **118.4%** | +34.2% | Rapid enterprise adoption of automated AI workflows |
| **EMEA** | **106.8%** | +21.5% | Steady cross-border compliance & collaboration tools |
| **APAC** | **94.2%** | +8.7% | Procurement cycles elongated; pipeline remains robust |
| **LATAM & Other** | **102.1%** | +15.3% | Successful regional channel partner ecosystem |

---

#### 💡 Key Strategic Takeaways
1. **Workflow Automation Synergy**: Cross-functional module adoption reached **64.2%**, driving net revenue retention to **92.8%**.
2. **Cycle Time Efficiency**: Deployment timelines decreased from 21 days to **13.5 days** (-35.7%).

#### 🎯 Strategic Action Plan
* **Initiative 1**: Expand pre-sales engineering in APAC to expedite tender conversion cycles.
* **Initiative 2**: Package proven NA enterprise templates into self-serve starter kits.
* **Initiative 3**: Deploy workspace pre-validation tooling to guarantee day-one integration.`,
    docTitle: 'Q3 Executive Business Strategy.md',
    traces: [
      { step: 'Intent Parsing & Plan', tool: 'intent_parser', time: '17ms', detail: 'Parsed multi-regional analytical requirements & constraints' },
      { step: 'Sandboxed Retrieval', tool: 'sandbox_file_reader', time: '38ms', detail: 'Sandboxed read of datasets/q3_regional_sales.csv' },
      { step: 'Variance Modeling', tool: 'variance_calculator', time: '128ms', detail: 'Executed YoY growth variance & quota attainment matrix' },
      { step: 'Report Synthesis', tool: 'document_synthesizer', time: '80ms', detail: 'Synthesized executive summary and validated report fidelity' }
    ]
  },
  'ja-JP': {
    title: '2026年度事業実績分析およびエグゼクティブサマリー',
    userPrompt: '今四半期の地域別売上実績を分析し、主な成長要因と潜在的リスクを特定した上で、来期に向けた具体的な改善提案をまとめてください。',
    assistantReply: `### 📊 四半期地域別売上実績分析レポート

各事業部門のデータを精査し、多角的な要因分析を実施しました。要約は以下の通りです。

| エリア | 目標達成率 | 前年同期比 | 主な成長要因 / 特記事項 |
| :--- | :--- | :--- | :--- |
| **東日本エリア** | **118.4%** | +34.2% | 大手エンタープライズの自動化導入が大幅伸長 |
| **西日本エリア** | **106.8%** | +21.5% | サプライチェーン連携ツールの導入が堅調に推移 |
| **中部エリア** | **94.2%** | +8.7% | 意思決定サイクルの長期化、商談パイプラインは豊富 |
| **その他地域** | **102.1%** | +15.3% | パートナーアライアンスの拡大効果が発現 |

---

#### 💡 重要な戦略的示唆
1. **業務効率化モジュールの浸透**：社内ワークフローの導入率が **64.2%** に達し、契約継続率は **92.8%** に向上。
2. **導入リードタイムの短縮**：標準導入期間が 21 日から **13.5 日**（-35.7%）へと大幅に改善。`,
    docTitle: 'Q3 総合事業分析と戦略立案.md',
    traces: [
      { step: '意図解析と計画', tool: 'intent_parser', time: '19ms', detail: '地域別売上指標と改善提案の自然言語要件を解析' },
      { step: 'サンドボックス取得', tool: 'sandbox_file_reader', time: '41ms', detail: '安全なサンドボックス内から datasets/q3_regional_sales.csv を読込' },
      { step: 'クロス集計計算', tool: 'variance_calculator', time: '132ms', detail: '前年比成長率および達成率のクロス集計を実行' },
      { step: 'レポート合成', tool: 'document_synthesizer', time: '84ms', detail: 'エグゼクティブサマリーおよび検証済みレポートを出力' }
    ]
  },
  'ko-KR': {
    title: '2026 연간 비즈니스 성과 분석 및 요약 보고서',
    userPrompt: '이번 분기 지역별 매출 실적을 분석하여 핵심 성장 요인과 잠재적 위험 요소를 정리하고, 다음 분기를 위한 실행 가능한 개선 제안을 작성해 주세요.',
    assistantReply: `### 📊 분기별 지역 매출 실적 분석 보고서

전체 지역의 운영 데이터를 바탕으로 다차원 분석을 완료했습니다. 핵심 내용은 다음과 같습니다.

| 지역 본부 | 목표 달성률 | 전년 대비 성장 | 주요 성장 요인 |
| :--- | :--- | :--- | :--- |
| **수도권 본부** | **118.4%** | +34.2% | 엔터프라이즈 AI 워크플로우 도입 급증 |
| **영남 본부** | **106.8%** | +21.5% | 공급망 협업 및 데이터 처리 도구 안정적 공급 |
| **호남 본부** | **94.2%** | +8.7% | 심사 주기 지연 발생, 파이프라인은 견고함 유지 |
| **기타 지역** | **102.1%** | +15.3% | 지역 파트너 네트워크 확장 성과 가시화 |

---

#### 💡 주요 비즈니스 인사이트
1. **워크플로우 시너지 효과**：협업 모듈 도입률이 **64.2%**에 도달하며 고객 유지율 **92.8%** 기록.
2. **배포 기간 단축**：표준 구현 기간이 21일에서 **13.5일**(-35.7%)로 크게 단축됨.`,
    docTitle: 'Q3 비즈니스 전략 및 운영 분석.md',
    traces: [
      { step: '의도 분석 및 기획', tool: 'intent_parser', time: '18ms', detail: '지역별 성과 지표 및 전략 제안 자연어 요구사항 파악' },
      { step: '안전 로드', tool: 'sandbox_file_reader', time: '39ms', detail: '격리된 샌드박스에서 datasets/q3_regional_sales.csv 안전 접근' },
      { step: '다차원 연산', tool: 'variance_calculator', time: '131ms', detail: '전년 대비 성장률 및 달성률 모델링 연산' },
      { step: '보고서 합성', tool: 'document_synthesizer', time: '82ms', detail: '구조화된 분석 리포트 및 검증된 Markdown 결과물 생성' }
    ]
  },
  'fr-FR': {
    title: 'Analyse de la performance commerciale annuelle et synthèse',
    userPrompt: 'Veuillez analyser les performances commerciales régionales du trimestre, mettre en évidence les principaux moteurs de croissance et proposer des recommandations stratégiques.',
    assistantReply: `### 📊 Rapport de performance commerciale par région

L'analyse multidimensionnelle des données régionales est synthétisée ci-dessous :

| Région | Atteinte d'objectif | Croissance annuelle | Moteur principal de croissance |
| :--- | :--- | :--- | :--- |
| **Île-de-France** | **118.4%** | +34.2% | Adoption accélérée des flux de travail automatisés |
| **Auvergne-Rhône-Alpes** | **106.8%** | +21.5% | Intégration continue des outils de conformité |
| **Hauts-de-France** | **94.2%** | +8.7% | Cycles d'approbation plus longs ; opportunités robustes |
| **Autres régions** | **102.1%** | +15.3% | Dynamisme du réseau de partenaires régionaux |

---

#### 💡 Enseignements clés
1. **Synergie d'automatisation** : Le taux d'adoption des modules collaboratifs atteint **64.2%**, avec une rétention client de **92.8%**.
2. **Gain de réactivité** : Le cycle de déploiement moyen est passé de 21 jours à **13.5 jours** (-35.7%).`,
    docTitle: 'Q3 Stratégie et Analyse Opérationnelle.md',
    traces: [
      { step: 'Analyse d’intention', tool: 'intent_parser', time: '18ms', detail: 'Détection des critères régionaux et des indicateurs d’objectifs' },
      { step: 'Accès sécurisé', tool: 'sandbox_file_reader', time: '41ms', detail: 'Lecture en bac à sable du fichier datasets/q3_regional_sales.csv' },
      { step: 'Calcul analytique', tool: 'variance_calculator', time: '133ms', detail: 'Évaluation des écarts annuels et de l’atteinte des quotas' },
      { step: 'Rapport validé', tool: 'document_synthesizer', time: '83ms', detail: 'Génération de la synthèse décisionnelle en Markdown enrichi' }
    ]
  },
  'de-DE': {
    title: 'Geschäftsbericht 2026: Leistungsanalyse & Management-Summary',
    userPrompt: 'Bitte analysieren Sie die regionale Vertriebsleistung dieses Quartals, heben Sie die wichtigsten Wachstumstreiber hervor und formulieren Sie strategische Empfehlungen.',
    assistantReply: `### 📊 Quartalsanalyse der regionalen Vertriebsleistung

Die bereinigten Geschäftsdaten zeigen folgende zentrale Ergebnisse im regionalen Querschnitt:

| Region | Zielerreichung | Vorjahreswachstum | Wesentlicher Wachstumstreiber |
| :--- | :--- | :--- | :--- |
| **Region West** | **118.4%** | +34.2% | Hohe Nachfrage nach automatisierten Workflows |
| **Region Süd** | **106.8%** | +21.5% | Kontinuierliche Implementierung von Compliance-Lösungen |
| **Region Nord** | **94.2%** | +8.7% | Längere Vergabeprozesse, Pipeline bleibt stabil |
| **Weitere Regionen** | **102.1%** | +15.3% | Erfolgreicher Ausbau des Partnernetzwerks |

---

#### 💡 Strategische Erkenntnisse
1. **Plattformsynergie** : Modulnutzung stieg auf **64.2%**; Kundenbindungsrate liegt bei **92.8%**.
2. **Zykluszeitverkürzung** : Die Bereitstellungsdauer sank von 21 Tagen auf **13.5 Tage** (-35.7%).`,
    docTitle: 'Q3 Strategische Geschäftsführung & Analyse.md',
    traces: [
      { step: 'Bedarfsanalyse', tool: 'intent_parser', time: '17ms', detail: 'Interpretation der Anforderungen zur Leistungsbewertung' },
      { step: 'Sicherer Zugriff', tool: 'sandbox_file_reader', time: '40ms', detail: 'Lesezugriff in isolierter Sandbox auf datasets/q3_regional_sales.csv' },
      { step: 'Varianzberechnung', tool: 'variance_calculator', time: '130ms', detail: 'Berechnung von Zielerreichung und Wachstumsraten' },
      { step: 'Ergebnisprüfung', tool: 'document_synthesizer', time: '81ms', detail: 'Erstellung und Validierung des strukturierten Management-Berichts' }
    ]
  },
  'es-ES': {
    title: 'Análisis de rendimiento comercial anual y resumen ejecutivo',
    userPrompt: 'Analice el rendimiento de ventas regional del trimestre, identifique los factores clave de crecimiento y detalle recomendaciones estratégicas para el próximo trimestre.',
    assistantReply: `### 📊 Informe trimestral de rendimiento comercial regional

El análisis consolidado de las operaciones regionales presenta los siguientes resultados clave:

| Región | Cumplimiento de cuota | Crecimiento interanual | Impulsor clave de crecimiento |
| :--- | :--- | :--- | :--- |
| **Región Central** | **118.4%** | +34.2% | Rápida adopción corporativa de flujos de trabajo con IA |
| **Región Sur** | **106.8%** | +21.5% | Integración sólida de herramientas de colaboración |
| **Región Norte** | **94.2%** | +8.7% | Ciclos de aprobación más extensos; cartera sólida |
| **Otras zonas** | **102.1%** | +15.3% | Expansión efectiva de alianzas regionales |

---

#### 💡 Conclusiones estratégicas
1. **Sinergia en automatización**: La tasa de adopción de módulos colaborativos alcanzó el **64.2%**, con retención neta del **92.8%**.
2. **Eficiencia en despliegue**: Los plazos de implementación se redujeron de 21 a **13.5 días** (-35.7%).`,
    docTitle: 'Q3 Estrategia y Rendimiento Operativo.md',
    traces: [
      { step: 'Comprensión', tool: 'intent_parser', time: '18ms', detail: 'Análisis de intenciones e indicadores clave solicitados' },
      { step: 'Lectura segura', tool: 'sandbox_file_reader', time: '41ms', detail: 'Acceso en entorno aislado a datasets/q3_regional_sales.csv' },
      { step: 'Cálculo analítico', tool: 'variance_calculator', time: '132ms', detail: 'Modelado de variación interanual y metas' },
      { step: 'Generación final', tool: 'document_synthesizer', time: '82ms', detail: 'Entrega de informe estructurado y verificado en Markdown' }
    ]
  }
};

async function prepareSandboxEnv() {
  const tempDir = path.join(os.tmpdir(), `dyw-mas-env-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const tracesDir = path.join(tempDir, 'traces');
  await fs.mkdir(tracesDir, { recursive: true });

  const allSessions = [];

  for (const locale of LOCALES) {
    const data = DEMO_SUITES[locale];
    const sessionId = `demo-session-${locale}`;

    const sessionObj = {
      id: sessionId,
      title: data.title,
      workspacePath: '~/Workspace/AnnualReport',
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:05:00.000Z',
      messages: [
        {
          id: `${sessionId}-msg-1`,
          role: 'user',
          content: data.userPrompt,
          createdAt: '2026-11-10T10:00:00.000Z'
        },
        {
          id: `${sessionId}-msg-2`,
          role: 'assistant',
          content: data.assistantReply,
          createdAt: '2026-11-10T10:01:00.000Z'
        }
      ]
    };
    allSessions.push(sessionObj);

    // 写入格式规范的 Trace 事件文件
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    const traceEvents = [
      { seq: 1, turn: 1, step: 0, time: "2026-11-10T10:00:00.000Z", kind: "request", direction: "out", target: "model", title: "模型请求", content: data.userPrompt },
      ...data.traces.flatMap((t, idx) => [
        { seq: (idx + 1) * 2, turn: 1, step: idx, time: "2026-11-10T10:00:01.000Z", kind: "tool-call", tool: t.tool, title: t.step, content: JSON.stringify({ action: t.step, detail: t.detail }) },
        { seq: (idx + 1) * 2 + 1, turn: 1, step: idx, time: "2026-11-10T10:00:02.000Z", kind: "tool-result", tool: t.tool, title: `${t.step} 完成`, content: JSON.stringify({ status: "success", elapsed: t.time }) }
      ])
    ];
    await fs.writeFile(path.join(tracesDir, `${safeId}.jsonl`), traceEvents.map(e => JSON.stringify(e)).join('\n'));
  }

  // 写入单文件 sessions.json
  await fs.writeFile(path.join(tempDir, 'sessions.json'), JSON.stringify(allSessions, null, 2));

  // 写入 settings.json：设置 identity 为 general，关闭首次使用向导，确保主界面直接展现
  const settingsObj = {
    identity: 'general',
    locale: 'zh-CN',
    theme: 'system',
    appearance: {
      theme: 'system',
      accentColor: 'blue'
    }
  };
  await fs.writeFile(path.join(tempDir, 'settings.json'), JSON.stringify(settingsObj, null, 2));

  return tempDir;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectCDP(port) {
  console.log(`🔌 正在连接 CDP 端口 ${port}...`);
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await resp.json();
      const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (page && page.webSocketDebuggerUrl) {
        console.log(`✓ 已找到目标页面: ${page.title || page.url}`);
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          ws.addEventListener('open', () => resolve(ws));
          ws.addEventListener('error', reject);
        });
      }
    } catch {
      // 等待服务启动
    }
    await sleep(400);
  }
  throw new Error(`无法连接 CDP 端口 ${port}`);
}

function createCdpClient(ws) {
  let msgId = 0;
  const pending = new Map();

  ws.addEventListener('message', event => {
    try {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch {
      // ignore
    }
  });

  return {
    send(method, params = {}) {
      const id = ++msgId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP ${method} 超时`));
          }
        }, 15000);
      });
    },
    async eval(expr) {
      const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(`JS 执行错误: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      }
      return res.result?.value;
    }
  };
}

async function main() {
  console.log('✨ 正在构建真实干净的演示沙箱环境...');
  const sandboxDir = await prepareSandboxEnv();
  console.log(`✓ 临时沙箱路径: ${sandboxDir}`);

  console.log('🚀 正在以完全主进程启动真实 Electron 应用...');
  const child = spawn('./node_modules/.bin/electron', ['dist/electron/main.mjs', `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: {
      ...process.env,
      DYWORKER_USER_DATA_DIR: sandboxDir,
      DYWORKER_DISABLE_TELEMETRY: '1',
      NODE_ENV: 'production'
    },
    stdio: 'ignore'
  });

  child.on('exit', code => {
    console.log(`Electron 退出码: ${code}`);
  });

  try {
    const ws = await connectCDP(cdpPort);
    const cdp = createCdpClient(ws);

    // 锁定标准 Mac 16:10 视口 (1440x900 @ 2x => 2880x1800)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false
    });

    console.log('🎨 等待主界面挂载与动画就绪...');
    await sleep(2500);

    for (const locale of LOCALES) {
      console.log(`\n======================================================`);
      console.log(`📸 正在生成语言 [${locale}] 真实全套截图...`);
      console.log(`======================================================`);

      const localeDir = path.join(outputBaseDir, locale);
      await fs.mkdir(localeDir, { recursive: true });
      const data = DEMO_SUITES[locale];

      // 切换当前会话与语言
      await cdp.eval(`
        (async () => {
          if (window.__dyworker_i18n__) {
            window.__dyworker_i18n__.setLocale('${locale}');
          }
          // 在侧边栏查找并点击对应语言的会话
          const links = Array.from(document.querySelectorAll('.session-item, [role="button"], button'));
          const target = links.find(el => el.textContent.includes(${JSON.stringify(data.title)}));
          if (target) target.click();
        })();
      `);
      await sleep(500);

      // 场景 1: 主工作台与智能交互
      await cdp.eval(`
        (() => {
          const store = window.__layoutStore?.getState?.();
          if (store) {
            store.setSidebarOpen(true);
            store.setRightPanelOpen(false);
            store.setSettingsOpen?.(false);
            store.setPluginsPageOpen?.(false);
            store.setDebugOpen?.(false);
          }
        })();
      `);
      await sleep(500);
      let shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(path.join(localeDir, '01-task-assistant.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  ✓ 01-task-assistant.png 已生成`);

      // 场景 2: 文档协同与工具侧栏
      await cdp.eval(`
        (() => {
          const store = window.__layoutStore?.getState?.();
          if (store) {
            store.setSidebarOpen(true);
            store.setRightPanelOpen(true);
            store.setSettingsOpen?.(false);
            store.setPluginsPageOpen?.(false);
            store.setDebugOpen?.(false);
          }
        })();
      `);
      await sleep(500);
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(path.join(localeDir, '02-document-preview.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  ✓ 02-document-preview.png 已生成`);

      // 场景 3: 透明执行轨迹与审计链
      await cdp.eval(`
        (() => {
          const store = window.__layoutStore?.getState?.();
          if (store) {
            store.setRightPanelOpen(false);
            store.setDebugOpen?.(true);
          }
        })();
      `);
      await sleep(500);
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(path.join(localeDir, '03-execution-trace.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  ✓ 03-execution-trace.png 已生成`);

      // 场景 4: 扩展生态与插件/MCP Server 中心
      await cdp.eval(`
        (() => {
          window.__settingsStore?.getState?.().setSettingsTab('plugins');
          window.__layoutStore?.getState?.().setSettingsOpen(true);
        })();
      `);
      await sleep(500);
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(path.join(localeDir, '04-plugin-ecosystem.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  ✓ 04-plugin-ecosystem.png 已生成`);

      // 场景 5: 偏好设置与外观/模型配置
      await cdp.eval(`
        (() => {
          window.__settingsStore?.getState?.().setSettingsTab('appearance');
          window.__layoutStore?.getState?.().setSettingsOpen(true);
        })();
      `);
      await sleep(500);
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(path.join(localeDir, '05-settings-appearance.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  ✓ 05-settings-appearance.png 已生成`);
    }

    console.log('\n🎉 所有语言的真实无隐私泄露 2880x1800 截图已全部生成完成！');
    ws.close();
  } finally {
    child.kill('SIGTERM');
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
