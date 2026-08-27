---
name: adsense-site-auditor
description: Audit websites for Google AdSense application readiness and ad-serving compliance. Use when checking whether a site is likely to satisfy AdSense eligibility, site ownership, content quality, navigation, crawler access, ads.txt, privacy disclosure, Google Publisher Policies, AdSense Program policies, or when the user asks if a site can apply for AdSense, pass AdSense review, show ads, or fix AdSense rejection/site-not-ready issues.
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash, WebFetch
argument-hint: "[site URL or local project path]"
license: MIT
---

# AdSense Site Auditor

## Core Rule

Use Google AdSense and Google Publisher official documentation as the source of truth. This skill converts those docs into an actionable website audit, but it cannot guarantee approval.

Before a serious audit, refresh the official docs when internet access is available because AdSense policies can change. If live docs conflict with this skill, the live Google docs win.

Every audit must explicitly evaluate every checklist item in `references/adsense-requirements.md`. Do not sample, summarize, or check only likely problem areas. For each requirement ID, assign exactly one status: `Pass`, `Fail`, `Unknown`, or `N/A`. Use `N/A` only when the requirement truly does not apply to the site type or monetization mode, and state why.

## Required Reference

Read `references/adsense-requirements.md` before auditing. It contains the full checklist, severity mapping, and source URLs.

For user-facing invocation examples and reusable prompts, read `references/usage-prompts.md` when the user asks how to use this skill, asks for prompt templates, or needs an audit request template.

## Audit Workflow

1. Identify the target:
   - Live URL/domain, repo path, or both.
   - Whether the audit is pre-application, post-rejection, or ad-serving cleanup.
   - Whether the site is a normal website, CMS/blog, directory, ecommerce, tool/app, UGC site, video site, or login-gated product.

2. Gather evidence:
   - Crawl the homepage and representative content pages.
   - Check `robots.txt`, sitemap, canonical URLs, redirects, HTTP status, login walls, WAF/geoblocking symptoms, and whether important pages render without POST-only state.
   - Inspect privacy policy, about/contact/ownership signals, navigation, content depth, ad/affiliate density, copied or embedded-only content, and unsupported/prohibited content risks.
   - If repo access exists, inspect templates/routes/content sources rather than only the rendered homepage.

3. Classify findings:
   - `Blocker`: likely to prevent application approval or violate a hard policy.
   - `High`: meaningful approval or ad-serving risk.
   - `Medium`: quality, crawlability, UX, disclosure, or evidence gap that should be fixed before applying.
   - `Pass`: checked with evidence.
   - `Unknown`: cannot verify from available access; state exactly what is needed.
   - `N/A`: not applicable; state the site condition that makes it irrelevant.

4. Produce an audit report:
   - Executive decision: `Ready`, `Not ready`, or `Ready after fixes`.
   - Findings first, ordered by severity.
   - For each finding: requirement ID, issue, evidence, official basis, exact fix.
   - Include a final exhaustive checklist table covering every requirement ID, with `Pass`/`Fail`/`Unknown`/`N/A`, evidence, and next action.

## Implementation Guidance

Prefer concrete checks over generic advice. Examples:

- Say `robots.txt blocks Mediapartners-Google` instead of `crawler issue`.
- Say `article pages are mostly scraped snippets with no added commentary` instead of `thin content`.
- Say `ads or affiliate blocks exceed the main content area above the fold` instead of `too many ads`.
- Say `privacy policy does not disclose third-party ad cookies or Google data use` instead of `privacy policy incomplete`.

Do not advise applying until all Blockers are resolved and High risks have either been fixed or explicitly accepted.

## Completeness Gate

Before finishing, count the requirement IDs in `references/adsense-requirements.md` and compare them with the IDs in the final checklist. If any ID is missing, the audit is incomplete. Add the missing rows before giving a final readiness decision.
