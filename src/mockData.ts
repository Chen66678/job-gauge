export type ScoreTier = 'high' | 'mid' | 'low' | 'pending' | 'queued' | 'unevaluated'

export interface SkillMatch {
  label: string
  pct: number | null   // null = 待确认
  confident: boolean
  question?: string    // 待确认时的追问
}

export interface MockJob {
  id: string
  title: string
  company: string
  city: string
  salary: string
  commute?: string
  companyTags: string[]
  coreMatch?: { label: string; pct: number }
  risks: string[]
  gaps: string[]
  score: number | null
  scoreTier: ScoreTier
  strategyLabel: string
  strategyClass: 'recommend' | 'suggest' | 'consider' | 'skip'
  pinned: boolean
  // Expanded detail
  skills: SkillMatch[]
  jdSummary: string[]
  requirements: string[]
  industry: string
  sourceUrl?: string
}

export const MOCK_JOBS: MockJob[] = [
  {
    id: '1',
    title: '前端工程师',
    company: '字节跳动',
    city: '上海',
    salary: '25-40k',
    commute: '8.5km',
    companyTags: ['大厂', '上市'],
    coreMatch: { label: 'React生态', pct: 90 },
    risks: ['加班强度高', '核心业务压力'],
    gaps: ['缺SSR实践'],
    score: 83,
    scoreTier: 'high',
    strategyLabel: '推荐定制',
    strategyClass: 'recommend',
    pinned: true,
    skills: [
      { label: 'React 生态', pct: 90, confident: true },
      { label: 'TypeScript', pct: 75, confident: true },
      { label: 'Node.js / 中间层', pct: null, confident: false, question: '你做过 Node.js 服务端开发吗？请简单描述你的经验。' },
      { label: '前端工程化 / CI/CD', pct: null, confident: false, question: '你在工程化方面做过哪些实践？（Webpack 配置、CI 流程等）' },
    ],
    jdSummary: [
      '负责核心业务线 Web / H5 页面开发与性能优化',
      '参与前端基础架构设计，推动组件库与工具链演进',
      '与产品、设计及后端团队紧密协作，保障高质量交付',
    ],
    requirements: [
      '3年以上前端开发经验，精通 React 及其周边生态',
      '深入理解 JavaScript 原理，熟练使用 TypeScript',
      '具备复杂业务场景的架构设计与性能调优能力',
      '有 Node.js 或跨端开发经验者优先',
    ],
    industry: 'B端 · 前端 · 中后台',
  },
  {
    id: '2',
    title: '产品经理',
    company: '美团',
    city: '北京',
    salary: '18-30k',
    commute: '15km',
    companyTags: ['大厂', '上市'],
    coreMatch: { label: '用户增长', pct: 82 },
    risks: ['竞争激烈'],
    gaps: [],
    score: 79,
    scoreTier: 'mid',
    strategyLabel: '推荐投递',
    strategyClass: 'recommend',
    pinned: false,
    skills: [
      { label: '用户增长策略', pct: 82, confident: true },
      { label: '数据分析', pct: 70, confident: true },
      { label: 'SQL / BI 工具', pct: null, confident: false, question: '你用过 SQL 或 BI 工具（如 Tableau、Power BI）做数据分析吗？' },
    ],
    jdSummary: [
      '负责用户增长相关产品的规划与迭代',
      '深度分析用户行为数据，提炼产品优化方向',
      '跨团队推动产品落地，协调研发、运营资源',
    ],
    requirements: [
      '2年以上产品经理经验，有 C 端增长方向背景',
      '具备较强数据分析能力，能独立撰写 PRD',
      '良好的沟通与协调能力，有电商行业经验者优先',
    ],
    industry: 'C端 · 产品 · 用户增长',
  },
  {
    id: '3',
    title: '数据分析师',
    company: '腾讯',
    city: '深圳',
    salary: '20-35k',
    commute: '22km',
    companyTags: ['大厂', '上市'],
    coreMatch: { label: 'Python 分析', pct: 78 },
    risks: [],
    gaps: ['缺SQL深度经验', '缺 A/B 测试经验'],
    score: 74,
    scoreTier: 'mid',
    strategyLabel: '建议投递',
    strategyClass: 'suggest',
    pinned: false,
    skills: [
      { label: 'Python / Pandas', pct: 78, confident: true },
      { label: '数据可视化', pct: 65, confident: true },
      { label: 'SQL 复杂查询', pct: null, confident: false, question: '你写过多表关联的复杂 SQL 查询吗？最复杂的场景是什么？' },
      { label: 'A/B 实验设计', pct: null, confident: false, question: '你参与过 A/B 测试的设计或分析吗？' },
    ],
    jdSummary: [
      '支撑业务团队的数据需求，提供数据报表与分析报告',
      '参与 A/B 测试方案设计与效果评估',
      '协助建设数据指标体系，推动数据文化落地',
    ],
    requirements: [
      '熟练掌握 SQL，有大数据平台（Hive、Spark）使用经验',
      '熟悉 Python 数据分析工具栈（Pandas、Matplotlib 等）',
      '有互联网产品数据分析经验，了解核心业务指标',
    ],
    industry: 'B端 · 数据 · 商业分析',
  },
  {
    id: '4',
    title: '前端工程师',
    company: '小红书',
    city: '上海',
    salary: '22-38k',
    commute: '12km',
    companyTags: ['独角兽'],
    coreMatch: { label: 'Vue 生态', pct: 85 },
    risks: ['高速发展期压力'],
    gaps: [],
    score: null,
    scoreTier: 'pending',
    strategyLabel: '评估中',
    strategyClass: 'suggest',
    pinned: false,
    skills: [],
    jdSummary: [],
    requirements: [],
    industry: 'C端 · 前端',
  },
  {
    id: '5',
    title: '运营专员',
    company: '某互联网公司',
    city: '上海',
    salary: '12-18k',
    commute: '6km',
    companyTags: [],
    coreMatch: { label: '内容运营', pct: 58 },
    risks: ['业务线不稳定'],
    gaps: ['缺KOL资源'],
    score: 58,
    scoreTier: 'low',
    strategyLabel: '可以考虑',
    strategyClass: 'consider',
    pinned: false,
    skills: [
      { label: '内容策划', pct: 58, confident: true },
      { label: '数据运营', pct: 40, confident: true },
    ],
    jdSummary: [
      '负责品牌社交媒体账号的日常运营',
      '策划并执行内容营销活动',
    ],
    requirements: [
      '1年以上内容运营经验',
      '熟悉微博、抖音等社交平台运营逻辑',
    ],
    industry: 'C端 · 运营 · 内容',
  },
  {
    id: '6',
    title: 'Java 后端工程师',
    company: '某创业公司',
    city: '北京',
    salary: '15-25k',
    commute: '31km',
    companyTags: ['初创'],
    risks: ['团队稳定性存疑'],
    gaps: ['技术方向不匹配'],
    score: 41,
    scoreTier: 'low',
    strategyLabel: '不推荐',
    strategyClass: 'skip',
    pinned: false,
    skills: [
      { label: 'Java / Spring', pct: 35, confident: true },
      { label: '微服务架构', pct: 28, confident: true },
    ],
    jdSummary: ['负责后端微服务开发与维护'],
    requirements: ['3年以上 Java 开发经验', '熟悉 Spring Boot、Spring Cloud'],
    industry: 'B端 · 后端 · Java',
  },
  {
    id: '7',
    title: 'iOS 开发工程师',
    company: '滴滴',
    city: '北京',
    salary: '28-45k',
    commute: '19km',
    companyTags: ['大厂'],
    risks: [],
    gaps: ['缺 Swift 经验'],
    score: null,
    scoreTier: 'queued',
    strategyLabel: '排队中',
    strategyClass: 'suggest',
    pinned: false,
    skills: [],
    jdSummary: [],
    requirements: [],
    industry: 'C端 · 移动端 · iOS',
  },
]
