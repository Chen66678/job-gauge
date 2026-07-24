import type { JobPosting, PreferenceRuleSet, UserProfile } from "./types";

export const sampleProfile: UserProfile = {
  id: "profile-demo-lzy",
  displayName: "林知远",
  headline: "应届前端开发候选人",
  targetRoles: ["前端工程师", "Web 前端", "全栈开发"],
  targetCities: ["上海", "杭州"],
  resumeText: [
    "林知远，虚构样例候选人，应届本科毕业。",
    "教育：华东样例大学，软件工程，本科，2026 届。",
    "项目：校园二手交易小程序，负责前端页面、搜索筛选和订单状态。",
    "项目：课程数据可视化看板，使用 TypeScript 和 ECharts 展示学习数据。",
    "实习：样例科技前端实习，参与 React 组件整理和接口联调。",
    "偏好：上海或杭州，前端或全栈方向，期望 12K 以上。"
  ].join("\n"),
  facts: [
    {
      id: "fact-edu",
      category: "教育",
      label: "软件工程本科",
      value: "华东样例大学软件工程本科，2026 届",
      sourceType: "resume",
      sourceRef: "样例简历第 2 行",
      status: "confirmed",
      confidence: 0.95
    },
    {
      id: "fact-react",
      category: "技能",
      label: "React 与组件开发",
      value: "参与 React 组件整理和接口联调",
      sourceType: "resume",
      sourceRef: "样例简历第 5 行",
      status: "confirmed",
      confidence: 0.92
    },
    {
      id: "fact-ts",
      category: "技能",
      label: "TypeScript",
      value: "使用 TypeScript 完成课程数据可视化看板",
      sourceType: "resume",
      sourceRef: "样例简历第 4 行",
      status: "confirmed",
      confidence: 0.9
    },
    {
      id: "fact-miniapp",
      category: "项目",
      label: "小程序项目",
      value: "负责校园二手交易小程序的前端页面、搜索筛选和订单状态",
      sourceType: "resume",
      sourceRef: "样例简历第 3 行",
      status: "confirmed",
      confidence: 0.9
    },
    {
      id: "fact-echarts",
      category: "技能",
      label: "数据可视化",
      value: "使用 ECharts 展示学习数据",
      sourceType: "resume",
      sourceRef: "样例简历第 4 行",
      status: "confirmed",
      confidence: 0.86
    },
    {
      id: "fact-award",
      category: "奖项",
      label: "校一等奖学金",
      value: "获得校一等奖学金",
      sourceType: "manual",
      sourceRef: "用户尚未确认的补充信息",
      status: "unconfirmed",
      confidence: 0.42
    },
    {
      id: "fact-node",
      category: "技能",
      label: "Node.js 后端",
      value: "有 Node.js 后端服务开发经验",
      sourceType: "user_answer",
      sourceRef: "补充问题草稿，待用户确认",
      status: "unconfirmed",
      confidence: 0.51
    },
    {
      id: "fact-shanghai",
      category: "偏好",
      label: "上海/杭州优先",
      value: "优先考虑上海或杭州岗位",
      sourceType: "resume",
      sourceRef: "样例简历第 6 行",
      status: "confirmed",
      confidence: 0.88
    }
  ],
  imageResumeAttachment: null
};

export const samplePreferences: PreferenceRuleSet = {
  targetRoles: ["前端工程师", "Web 前端", "全栈开发"],
  targetCities: ["上海", "杭州"],
  minSalaryK: 12,
  excludedKeywords: ["培训", "收费", "无薪", "超长试岗"],
  preferCompanyTags: ["工具", "教育科技", "AI", "SaaS"]
};

export const sampleJobs: JobPosting[] = [
  {
    id: "job-personalize",
    title: "前端工程师（AI 工具方向）",
    company: "澄明工具科技",
    city: "上海",
    salaryK: [14, 20],
    companyTags: ["AI", "工具", "SaaS"],
    jdText:
      "岗位职责：参与 AI 工具产品的 Web 前端研发，负责组件建设、接口联调、数据看板和交互体验优化。要求熟悉 React、TypeScript，有可展示的前端项目，理解基础工程化流程。加分项：数据可视化经验、小程序经验。工作地点上海。",
    requirements: [
      {
        id: "req-react",
        kind: "skill",
        label: "熟悉 React 组件开发",
        evidence: "JD 要求熟悉 React，负责组件建设和接口联调。",
        requiredFactIds: ["fact-react"],
        weight: 24
      },
      {
        id: "req-ts",
        kind: "skill",
        label: "TypeScript 项目经验",
        evidence: "JD 明确要求 TypeScript。",
        requiredFactIds: ["fact-ts"],
        weight: 18
      },
      {
        id: "req-project",
        kind: "experience",
        label: "可展示前端项目",
        evidence: "JD 要求有可展示的前端项目。",
        requiredFactIds: ["fact-miniapp", "fact-echarts"],
        weight: 18
      },
      {
        id: "req-viz",
        kind: "skill",
        label: "数据可视化加分",
        evidence: "JD 将数据看板和可视化列为职责与加分项。",
        requiredFactIds: ["fact-echarts"],
        weight: 10
      }
    ],
    risks: [
      {
        id: "risk-scope",
        label: "AI 工具业务节奏可能较快",
        severity: "low",
        evidence: "JD 提到多项产品职责，需要面试时确认节奏和导师投入。"
      }
    ],
    reviewFlags: ["确认团队是否有应届培养机制"],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  },
  {
    id: "job-generic",
    title: "Web 前端开发助理",
    company: "青竹教育科技",
    city: "杭州",
    salaryK: [10, 14],
    companyTags: ["教育科技", "工具"],
    jdText:
      "负责教育后台系统页面开发、表单页面维护、简单数据报表展示和接口联调。要求熟悉 HTML/CSS/JavaScript，了解任一前端框架，有项目经验优先。可接受应届生。",
    requirements: [
      {
        id: "req-framework",
        kind: "skill",
        label: "掌握至少一种前端框架",
        evidence: "JD 要求了解任一前端框架。",
        requiredFactIds: ["fact-react"],
        weight: 20
      },
      {
        id: "req-report",
        kind: "experience",
        label: "数据报表或后台页面经验",
        evidence: "JD 提到后台系统和数据报表。",
        requiredFactIds: ["fact-echarts"],
        weight: 14
      },
      {
        id: "req-fresh",
        kind: "preference",
        label: "可接受应届生",
        evidence: "JD 明确可接受应届生。",
        requiredFactIds: ["fact-edu"],
        weight: 12
      },
      {
        id: "req-node",
        kind: "skill",
        label: "接口联调经验",
        evidence: "JD 提到接口联调，样例候选人有 React 实习中的联调经历。",
        requiredFactIds: ["fact-react"],
        weight: 8
      }
    ],
    risks: [],
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  },
  {
    id: "job-skip",
    title: "全栈开发储备生",
    company: "速成优才咨询",
    city: "苏州",
    salaryK: [6, 9],
    companyTags: ["培训"],
    jdText:
      "零基础也可投递，入职前需参加统一技能提升营，合格后安排项目。岗位包含销售支持、课程顾问沟通和开发练习，试用期薪资 6K 起。表现优秀可转开发。",
    requirements: [
      {
        id: "req-fullstack",
        kind: "skill",
        label: "全栈开发储备",
        evidence: "JD 宣称全栈储备，但开发职责不明确。",
        requiredFactIds: ["fact-react", "fact-node"],
        weight: 12
      },
      {
        id: "req-sales",
        kind: "risk",
        label: "包含销售支持和课程沟通",
        evidence: "JD 中包含销售支持、课程顾问沟通。",
        requiredFactIds: [],
        weight: 0
      }
    ],
    risks: [
      {
        id: "risk-training",
        label: "疑似培训或转岗包装",
        severity: "high",
        evidence: "公司标签和 JD 出现技能提升营、零基础、转开发等信号。"
      },
      {
        id: "risk-salary",
        label: "薪资低于用户底线",
        severity: "medium",
        evidence: "薪资 6-9K，低于 12K 底线。"
      }
    ],
    reviewFlags: ["触发排除关键词：培训", "岗位职责与前端目标不一致"],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  }
];
