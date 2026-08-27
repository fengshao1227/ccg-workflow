# references/
> L2 | 父级: ../AGENTS.md

成员清单
feature-page-seo.md: SEO 工具页新增与优化流程，保留工具页类型分流、模板扫描、JSON 同构、模块信息价值、政策门槛与全页 QA。
firecrawl-workflow.md: Firecrawl MCP/CLI 执行映射，定义搜索、抓取、站内发现、动态交互与 CLI 安装认证方式。
serp-research.md: SERP 研究唯一真源，定义 5/10 分级深度、逐页抓取、真实查询词采集（Google autocomplete + 竞品 FAQ 提取）、意图归类、信息缺口与失败处理。
seo-source-library.md: SEO 资料引用库，集中保存 Google、Moz、Backlinko、Ahrefs、Semrush、SearchPilot、Reddit 线索与算法解读资料，供后续按需校准 checklist。

架构决策
`references/` 只存放 SEO 工具页执行时的辅助规则；入口流程由父级 `SKILL.md` 调度。SERP、工具页类型分流、模块 QA、资料引用库、Firecrawl 各有单一真源，避免重复指令互相覆盖。

开发规范
新增 reference 时必须同步父级 `SKILL.md` 的参考资料列表；删除或重命名 reference 时必须同步本文件成员清单。短规则优先合并进现有 reference，不单独建文件。

变更日志
2026-08-15: `feature-page-seo.md` 新增「关键词覆盖与密度校准」，收纳 hits%/span% 口径歧义、
  竞品实测流程与样本、长页面密度稀释陷阱、零命中的三种成因（H1/title 用词不一致、修饰词劈断短语、
  同义词无搜索量），以及反灌水规则与关键词密度的天然冲突和对冲手段；全页兜底检查补两条实测项。
  `serp-research.md` 新增「真实查询词采集」，定义 Google autocomplete 端点、种子词 × 疑问前缀
  交叉法、同音词噪音过滤，与竞品 FAQ schema 提取；明令禁止模型凭空生成 PAA。
  两者的可执行实现在父级 `scripts/onpage-audit.py`。
2026-05-05: 用 Firecrawl 检索 SearchPilot resources，补入 GEO fan-out、机器可读事实层、AI 内容测试治理、schema 语境测试、JS-only 动态事实风险和链接块压缩原则。
2026-05-05: 用 Firecrawl 补充 Ahrefs、Semrush、SearchPilot、BuzzStream 与 Reddit 社区线索，区分权威指南、控制实验、普通 case study 和需人工核验的社区讨论。
2026-05-05: 新增 `seo-source-library.md`，集中保存 Google、Moz、Backlinko 与算法解读资料，后续按需调用而不污染核心 checklist。
2026-05-05: 对照 Google helpful content、spam policies、Moz 与 Backlinko 最新 on-page 指南，补充 Who/How/Why、答案块、唯一 meta、Googlebot 可见一致性与无固定字数规则。
2026-05-05: 基于多类真实工具页与 Google/Backlinko 研究，新增工具页类型分流，按删除、批量、生成编辑、增强修复、转换与模型页决定模块轻重。
2026-05-05: 放宽 H1 必须首词匹配和相关工具数量硬约束，强化首屏任务区、入口附近能力限制与可验证承诺规则。
2026-05-05: 将 `feature-page-seo.md` 的页面模块检查与 SEO QA 合并为模块信息价值 QA，确保每个模块都能指导 AI 产出符合 Google 信息价值要求的内容。
2026-05-05: 将父级技能重命名为 `seo-page-builder`，并将 reference 正文统一为中文。
2026-05-05: 按奥卡姆剃刀瘦身，删除独立链接规范文件，将 SERP 规则收敛到 `serp-research.md`，将 feature 专属规则收敛到 `feature-page-seo.md`。
2026-05-05: 根据 Google spam/AI guidance、Backlinko、Ahrefs、SEOFOMO 与优秀工具页样本，补强政策门槛、工具页模块 checklist、AI search readiness 与反误导检查。
2026-05-05: 将 `on-page-checklist.md` 的核心检查合并进 `feature-page-seo.md` 的 `Indexability QA`，移除第二检查真源。
2026-05-05: 将 `marketing-skills/reference/feature-page-seo.md` 的功能页流程揉入本技能，新增 `feature-page-seo.md` 作为内置模式参考。
2026-05-05: 新增 `firecrawl-workflow.md`，将 SERP 研究从 Playwright 点击流替换为 Firecrawl 搜索、抓取、map 与 interact 流。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
