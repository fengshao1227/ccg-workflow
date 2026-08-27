# AdSense Site Auditor Usage Prompts

Use this file when the user asks how to invoke the skill or wants ready-to-copy prompts.

## Skill Invocation

Preferred explicit invocation:

```text
@adsense-site-auditor
```

If the current Codex surface expects dollar-style skill invocation, use:

```text
$adsense-site-auditor
```

## Prompt Principles

- Always include the target URL or local repo path.
- State whether this is pre-application, post-rejection, or post-fix verification.
- Ask for an exhaustive checklist, not a summary-only audit.
- Require every `ADS-*` requirement ID to be marked `Pass`, `Fail`, `Unknown`, or `N/A`.
- Require evidence and exact fixes for every `Fail` and `Unknown`.

## Full Website Audit

```text
@adsense-site-auditor 请完整审计这个网站是否适合申请 Google AdSense：

URL: https://example.com
阶段：申请前

要求：
1. 必须逐项检查所有 ADS-* 要求 ID。
2. 每一项都必须标记 Pass / Fail / Unknown / N/A。
3. 不允许只给摘要，不允许省略看起来不相关的项目。
4. 输出 Blocker / High / Medium 风险，并给每项的证据和修复建议。
5. 最后做 Completeness Check，确认报告覆盖了全部要求 ID。
```

## Live URL Only

```text
@adsense-site-auditor 只基于线上可访问页面审计这个站是否能申请 AdSense：

URL: https://example.com

请抓取首页、robots.txt、sitemap、隐私政策、About/Contact、分类页和代表性内容页。
如果某项必须依赖 AdSense 后台、服务器配置或站长确认，请标为 Unknown，并说明需要什么证据。
```

## Repo Plus Live Site Audit

```text
@adsense-site-auditor 结合本地代码仓库和线上站点，审计 AdSense 申请准备情况：

线上 URL: https://example.com
本地仓库: /absolute/path/to/repo
阶段：申请前

请同时检查：
- 渲染后的页面和抓取可访问性
- 模板/路由/内容来源
- robots.txt、sitemap、canonical、隐私政策
- 是否存在低价值、复制、聚合、广告/联盟内容过多的问题
- 是否满足全部 ADS-* 检查项
```

## Post-Rejection Diagnosis

```text
@adsense-site-auditor 这个站 AdSense 申请被拒了，请按官方要求做拒审原因诊断：

URL: https://example.com
拒审信息：粘贴 AdSense 后台显示的原文

请把拒审信息映射到 ADS-* 要求 ID，逐项检查所有要求，并给出优先级修复清单。
```

## Post-Fix Verification

```text
@adsense-site-auditor 我已经按上次建议修复了网站，请复审是否可以重新提交 AdSense：

URL: https://example.com
已修复内容：
- ...
- ...

请重新逐项检查全部 ADS-* 要求 ID，不要只检查已修复项。输出 Ready / Ready after fixes / Not ready。
```

## Task List Output

```text
@adsense-site-auditor 请把这个网站的 AdSense 申请问题转成可执行修复任务：

URL: https://example.com

输出格式：
1. Blocker 任务
2. High 任务
3. Medium 任务
4. 每个任务包含：涉及 ADS-* ID、文件/页面、修复动作、验收标准
5. 最后附完整逐项检查表
```

## Minimal Prompt

```text
@adsense-site-auditor 审计 https://example.com 是否符合 AdSense 申请要求。必须逐项覆盖所有 ADS-* 检查项，并输出完整 Pass/Fail/Unknown/N/A 表。
```
