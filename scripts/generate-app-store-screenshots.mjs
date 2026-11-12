// Mac App Store 真实多语言应用截图生成驱动脚本
// 100% 真实渲染、严格脱敏（零个人隐私）、完全符合苹果 16:10 (2880x1800) 标准
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputBaseDir = path.resolve(rootDir, 'output/app-store-screenshots');

// 支持的 8 种语言
const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'];

// 各语言专业脱敏业务演示数据
const DEMO_DATA = {
  'zh-CN': {
    recentTasks: [
      '2026年度业务数据分析与汇报',
      '市场竞争态势与定价策略评估',
      '企业知识库自动检索与归档',
      '核心业务指标可视化看板设计'
    ],
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
    docContent: `# Q3 综合运营分析与策略规划报告
> 文档密级：内部公开 | 归档状态：已核验 | 责任团队：商业智能协同组

## 1. 经营概览与关键指标
本季度全线产品净推荐值 (NPS) 提升至 **72**，总处理文档量突破 **1,200 万件**。
自动化流程为组织节约了约 **42,000 人时**的高重复性劳动。

\`\`\`
   [ 数据采集 ] ──> [ 智能清洗与交叉比对 ] ──> [ 自动生成多维图表 ]
         │                        │                           │
   沙箱文件安全读入          无感结构化提取              高保真 Markdown 渲染
\`\`\`

## 2. 核心指标对比看板
* **综合计算吞吐**：8,450 任务/日 (+42%)
* **任务平均响应**：280 毫秒 (-18%)
* **数据合规遵从度**：100%（全链路沙箱存储与加密）

## 3. 落地推进计划
1. 完成跨语言工作流模板库第一期发布；
2. 强化私有化工作区持久化授权机制；
3. 扩展第三方企业协作工具连接器。`,
    traceSteps: [
      { step: '任务理解', detail: '解析多维销售分析与策略生成意图，提取区域及指标约束' },
      { step: '数据检索', detail: '安全访问工作区 datasets/q3_sales_metrics.csv (安全沙箱隔离)' },
      { step: '结构化运算', detail: '执行同比/环比方差分析与达成率计算（耗时 184ms）' },
      { step: '产物生成', detail: '生成结构化分析表、图表数据并输出高保真 Markdown 报告' }
    ]
  },
  'zh-TW': {
    recentTasks: [
      '2026年度業務數據分析與簡報',
      '市場競爭態勢與定價策略評估',
      '企業知識庫自動檢索與歸檔',
      '核心業務指標可視化看板設計'
    ],
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
    docContent: `# Q3 綜合營運分析與策略規劃報告
> 文件級別：內部公開 | 歸檔狀態：已核驗 | 負責團隊：商業智慧協同組

## 1. 營運綜述與關鍵成果
本季度產品淨推薦值 (NPS) 躍升至 **72**，累計文檔處理量突破 **1,200 萬件**。
自動化工作流累計為組織節省逾 **42,000 人時**之重複性作業。`,
    traceSteps: [
      { step: '任務解析', detail: '分析自然語言意圖與約束條件，確立多維指標模型' },
      { step: '安全讀取', detail: '自工作區安全沙箱載入營運數據 datasets/q3_metrics.csv' },
      { step: '指標運算', detail: '執行區域增長率與變異數分析（耗時 176ms）' },
      { step: '報表交付', detail: '驗證成果完整性並產出專業 Markdown 分析報告' }
    ]
  },
  'en-US': {
    recentTasks: [
      'Annual Business Performance & Executive Summary',
      'Competitive Intelligence & Market Positioning',
      'Knowledge Base Indexing & Document Triage',
      'Executive KPI Dashboard & Metric Tracking'
    ],
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
    docContent: `# Q3 Executive Business Strategy & Performance
> Classification: Internal General | Verification: Validated | Owner: Business Intelligence

## 1. Executive Summary & KPIs
Net Promoter Score (NPS) advanced to **72**, with over **12 Million documents** processed securely.
Automated agent tasks eliminated over **42,000 hours** of manual administrative overhead.

\`\`\`
   [ Data Ingestion ] ──> [ Cross-Validation & Cleaning ] ──> [ High-Fidelity Rendering ]
           │                            │                               │
    Secure Sandboxing             Zero Data Leakage                Markdown & ECharts
\`\`\`

## 2. Platform Telemetry & Reliability
* **Throughput**: 8,450 agent tasks/day (+42%)
* **Median Latency**: 280 ms (-18%)
* **Security & Privacy**: 100% compliant with local-first sandbox boundaries.`,
    traceSteps: [
      { step: 'Intent Parsing', detail: 'Parsed multi-regional analytical requirements & constraints' },
      { step: 'Data Retrieval', detail: 'Sandboxed read of datasets/q3_sales_metrics.csv' },
      { step: 'Variance Model', detail: 'Executed YoY growth variance & quota attainment (168ms)' },
      { step: 'Artifact Output', detail: 'Synthesized executive summary and validated report fidelity' }
    ]
  },
  'ja-JP': {
    recentTasks: [
      '2026年度事業実績分析およびエグゼクティブサマリー',
      '競合市場調査および価格戦略レポート',
      '社内文書の自動整理とナレッジベース構築',
      '主要経営指標可視化ダッシュボード設計'
    ],
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
    docContent: `# Q3 総合事業分析と戦略立案レポート
> 社内公開 | 検証ステータス：承認済 | 担当：ビジネスインテリジェンス推進部

## 1. 経営概況と主要KPI
今四半期の顧客満足度 (NPS) は **72** に向上し、累計処理文書数は **1,200万件** を突破しました。
自動化アシスタントにより、累計 **42,000人時** の定型業務が削減されました。`,
    traceSteps: [
      { step: '要求分析', detail: '地域別売上指標と改善提案の自然言語要件を解析' },
      { step: 'データ取得', detail: '安全なサンドボックス内から datasets/q3_metrics.csv を読込' },
      { step: '指標計算', detail: '前年比成長率および達成率のクロス集計を実行（所要時間 182ms）' },
      { step: '成果物出力', detail: 'エグゼクティブサマリーおよび検証済みレポートを生成' }
    ]
  },
  'ko-KR': {
    recentTasks: [
      '2026 연간 비즈니스 성과 분석 및 요약 보고서',
      '시장 경쟁 분석 및 가격 전략 수립',
      '업무 문서 자동 분류 및 정리',
      '핵심 KPI 대시보드 시각화 설계'
    ],
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
    docContent: `# Q3 비즈니스 전략 및 운영 분석 보고서
> 분류: 내부 공개 | 검증 상태: 확인 완료 | 담당: 비즈니스 인텔리전스팀

## 1. 운영 총괄 및 핵심 KPI
순추천고객지수(NPS)가 **72**로 상승하였으며, 누적 처리 문서 **1,200만 건**을 돌파했습니다.`,
    traceSteps: [
      { step: '의도 분석', detail: '지역별 성과 지표 및 전략 제안 자연어 요구사항 파악' },
      { step: '데이터 로드', detail: '격리된 샌드박스에서 datasets/q3_metrics.csv 안전 접근' },
      { step: '교차 분석', detail: '전년 대비 성장률 및 달성률 모델링 연산 (174ms)' },
      { step: '결과물 생성', detail: '구조화된 분석 리포트 및 검증된 Markdown 결과물 생성' }
    ]
  },
  'fr-FR': {
    recentTasks: [
      'Analyse de la performance commerciale annuelle et synthèse',
      'Étude de marché et veille concurrentielle',
      'Organisation et indexation automatique des documents',
      'Conception du tableau de bord des indicateurs clés'
    ],
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
    docContent: `# Rapport de Synthèse Stratégique Q3
> Statut : Validé | Classification : Interne | Équipe : Intelligence Économique

## 1. Synthèse globale & Indicateurs clés
Le Net Promoter Score (NPS) atteint **72**, avec plus de **12 millions de documents** traités en toute sécurité.`,
    traceSteps: [
      { step: 'Analyse d’intention', detail: 'Détection des critères régionaux et des indicateurs d’objectifs' },
      { step: 'Accès sécurisé', detail: 'Lecture en bac à sable du fichier datasets/q3_metrics.csv' },
      { step: 'Calcul analytique', detail: 'Évaluation des écarts annuels et de l’atteinte des quotas (179ms)' },
      { step: 'Rapport validé', detail: 'Génération de la synthèse décisionnelle en Markdown enrichi' }
    ]
  },
  'de-DE': {
    recentTasks: [
      'Geschäftsbericht 2026: Leistungsanalyse & Management-Summary',
      'Marktforschung & Wettbewerbsanalyse',
      'Automatisierte Dokumentenorganisation & Archivierung',
      'Design des KPI-Dashboards für Führungskräfte'
    ],
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
    docContent: `# Strategiebericht & operative Leistungsanalyse Q3
> Klassifizierung: Intern | Prüfstatus: Bestätigt | Team: Business Intelligence

## 1. Zusammenfassung & Leistungskennzahlen
Der Net Promoter Score (NPS) stieg auf **72** bei mehr als **12 Millionen** sicher verarbeiteten Dokumenten.`,
    traceSteps: [
      { step: 'Bedarfsanalyse', detail: 'Interpretation der Anforderungen zur Leistungsbewertung' },
      { step: 'Sicherer Zugriff', detail: 'Lesezugriff in isolierter Sandbox auf datasets/q3_metrics.csv' },
      { step: 'Varianzberechnung', detail: 'Berechnung von Zielerreichung und Wachstumsraten (171ms)' },
      { step: 'Ergebnisprüfung', detail: 'Erstellung und Validierung des strukturierten Management-Berichts' }
    ]
  },
  'es-ES': {
    recentTasks: [
      'Análisis de rendimiento comercial anual y resumen ejecutivo',
      'Estudio de mercado y análisis competitivo',
      'Organización y clasificación automatizada de documentos',
      'Diseño de panel de control de métricas e indicadores'
    ],
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
    docContent: `# Informe Estratégico y Operativo Q3
> Clasificación: Uso Interno | Estado: Verificado | Responsable: Inteligencia de Negocios

## 1. Resumen ejecutivo y métricas principales
El Net Promoter Score (NPS) aumentó a **72**, superando los **12 millones de documentos** procesados de forma segura.`,
    traceSteps: [
      { step: 'Comprensión', detail: 'Análisis de intenciones e indicadores clave solicitados' },
      { step: 'Lectura segura', detail: 'Acceso en entorno aislado a datasets/q3_metrics.csv' },
      { step: 'Cálculo analítico', detail: 'Modelado de variación interanual y metas (175ms)' },
      { step: 'Generación final', detail: 'Entrega de informe estructurado y verificado en Markdown' }
    ]
  }
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('🚀 启动 DYWorker App Store 真实截图生成驱动...');
  const tempUserData = path.join(os.tmpdir(), `dyw-screenshots-profile-${Date.now()}`);
  app.setPath('userData', tempUserData);

  // 确保输出根目录存在
  await fs.mkdir(outputBaseDir, { recursive: true });

  // 创建 16:10 窗口（标准 1440x900，在 deviceScaleFactor: 2 模式下产出 2880x1800 图像）
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: false,
    frame: true,
    titleBarStyle: 'hiddenInset', // 经典 Mac 原生红黄绿交通灯
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.resolve(rootDir, 'electron/preload.cjs'),
      backgroundThrottling: false,
    }
  });

  const entryHtml = path.resolve(rootDir, 'dist/client/index.html');
  await win.loadFile(entryHtml);

  // 绑定 CDP 调试器以精确锁定视口与 2x 缩放
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  });

  // 等待首帧渲染完成
  await sleep(1500);

  // 截图捕获函数
  async function capture(filePath) {
    const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    });
    await fs.writeFile(filePath, Buffer.from(data, 'base64'));
    console.log(`  ✓ 截图已保存: ${path.relative(rootDir, filePath)}`);
  }

  // 依次为 8 种语言执行截图
  for (const locale of LOCALES) {
    console.log(`\n==============================================`);
    console.log(`📸 正在生成语言 [${locale}] 截图套件...`);
    console.log(`==============================================`);

    const localeDir = path.join(outputBaseDir, locale);
    await fs.mkdir(localeDir, { recursive: true });
    const data = DEMO_DATA[locale];

    // 1. 切换界面语言与注入脱敏会话数据
    await win.webContents.executeJavaScript(`
      (() => {
        if (window.__dyworker_i18n__) {
          window.__dyworker_i18n__.setLocale('${locale}');
        }
      })();
    `);
    await sleep(300);

    // 场景 1：主工作台与任务助理交互 (01-task-assistant.png)
    // 注入当前语言展示的会话和内容
    await win.webContents.executeJavaScript(`
      (() => {
        const store = window.__layoutStore?.getState?.();
        if (store) {
          store.setSidebarOpen(true);
          store.setRightPanelOpen(false);
          store.setSettingsOpen?.(false);
          store.setPluginsPageOpen?.(false);
          store.setDebugOpen?.(false);
        }

        // 修改当前对话内容以呈现最真实、最优雅的脱敏演示
        const promptEl = document.querySelector('.user-message-bubble, .message-user .message-content, .message-bubble-user');
        const replyEl = document.querySelector('.assistant-message-bubble, .message-assistant .message-content, .message-bubble-assistant');

        // 查找或模拟展示
        window.dispatchEvent(new CustomEvent('dyworker:demo-hydrate', {
          detail: {
            locale: '${locale}',
            prompt: ${JSON.stringify(data.userPrompt)},
            reply: ${JSON.stringify(data.assistantReply)}
          }
        }));
      })();
    `);
    await sleep(600);
    await capture(path.join(localeDir, '01-task-assistant.png'));

    // 场景 2：文档协同与实时产物预览 (02-document-preview.png)
    await win.webContents.executeJavaScript(`
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
    await sleep(600);
    await capture(path.join(localeDir, '02-document-preview.png'));

    // 场景 3：透明执行轨迹与审计链 (03-execution-trace.png)
    await win.webContents.executeJavaScript(`
      (() => {
        const store = window.__layoutStore?.getState?.();
        if (store) {
          store.setRightPanelOpen(false);
          store.setDebugOpen?.(true);
        }
      })();
    `);
    await sleep(600);
    await capture(path.join(localeDir, '03-execution-trace.png'));

    // 场景 4：扩展生态与插件/MCP Server 中心 (04-plugin-ecosystem.png)
    await win.webContents.executeJavaScript(`
      (() => {
        const store = window.__layoutStore?.getState?.();
        if (store) {
          store.setDebugOpen?.(false);
          store.setPluginsPageOpen?.(true);
        }
      })();
    `);
    await sleep(600);
    await capture(path.join(localeDir, '04-plugin-ecosystem.png'));

    // 场景 5：偏好与外观配置 (05-settings-appearance.png)
    await win.webContents.executeJavaScript(`
      (() => {
        const store = window.__layoutStore?.getState?.();
        if (store) {
          store.setPluginsPageOpen?.(false);
          store.setSettingsOpen?.(true);
        }
      })();
    `);
    await sleep(600);
    await capture(path.join(localeDir, '05-settings-appearance.png'));
  }

  console.log('\n🎉 所有语言的真实 App Store 截图已成功生成！');
  win.close();
  app.quit();
}

app.whenReady().then(run).catch(err => {
  console.error('截图生成失败：', err);
  app.quit();
  process.exit(1);
});
