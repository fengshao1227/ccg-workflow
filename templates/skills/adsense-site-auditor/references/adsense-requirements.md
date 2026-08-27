# AdSense Website Requirements Checklist

Source snapshot: Google AdSense Help and Google Publisher Policies, checked 2026-06-16.

Use this as the working checklist for website audits. Treat the linked Google pages as canonical if updated.

## Source URLs

- AdSense Help topic: https://support.google.com/adsense/?hl=zh-Hans#topic=16344192
- Ensure pages meet AdSense requirements: https://support.google.com/adsense/answer/7299563?hl=zh-Hans
- AdSense eligibility requirements: https://support.google.com/adsense/answer/9724?hl=zh-Hans
- Site ownership requirement: https://support.google.com/adsense/answer/91205?hl=zh-Hans
- AdSense site management: https://support.google.com/adsense/answer/12131223?hl=zh-Hans
- AdSense crawler troubleshooting: https://support.google.com/adsense/answer/2381908?hl=zh-Hans
- AdSense Program policies: https://support.google.com/adsense/answer/48182?hl=zh-Hans
- Google Publisher Policies: https://support.google.com/adsense/answer/10502938?hl=zh-Hans
- Google Publisher Restrictions: https://support.google.com/adsense/answer/10437795?hl=zh-Hans

## Severity

- `Blocker`: hard policy violation, ownership/crawl failure, no original content, severe deceptive UX, prohibited content, or application cannot be verified.
- `High`: likely review failure or ad-serving restriction, but not always a hard account-level block.
- `Medium`: quality, trust, UX, disclosure, or implementation gap that should be fixed before applying.
- `Unknown`: needs owner/account/server access or more pages to verify.

## A. Eligibility and Account Requirements

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-ELIG-01 | Blocker | Applicant must be eligible for AdSense and generally at least 18 years old, or use a parent/guardian account when under 18. | Ask/confirm owner/account context when relevant. |
| ADS-ELIG-02 | Blocker | The publisher should not create duplicate AdSense accounts for the same publisher; use an existing account to add more sites unless a distinct organization entity applies. | Ask whether an existing AdSense account exists. |
| ADS-ELIG-03 | Blocker | Site content must comply with AdSense Program policies and Google Publisher Policies before application. | Run sections C-H below. |
| ADS-ELIG-04 | Medium | Hosted products such as Blogger/YouTube have separate hosted-account flows and eligibility. | Note if the site is Blogger/YouTube/hosted partner. |

## B. Site Ownership, Verification, and Readiness

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-OWN-01 | Blocker | Publisher must control the site and be able to access the HTML source or CMS/plugin/theme path needed to place AdSense code in `<head>`. | Confirm repository/CMS/template access; verify `<head>` injection path. |
| ADS-OWN-02 | Blocker | Do not apply with a site the publisher does not own or cannot verify. | Confirm domain/control ownership. |
| ADS-OWN-03 | High | The site should support JavaScript and normal browser rendering for AdSense code. | Check pages render with JS enabled and do not break head/body structure. |
| ADS-SITE-01 | Blocker | A site must be added to the AdSense site list, ownership verified, reviewed by Google, and marked ready before ads can show. | For account audits, check AdSense site status if accessible. |
| ADS-SITE-02 | High | Ownership may be verified by ad code, `ads.txt`, or a meta tag depending on AdSense flow. | Confirm one working verification method can be deployed. |
| ADS-TXT-01 | High | If the domain uses `ads.txt`, Google must be listed as an authorized seller for the account. | Fetch `/ads.txt`; check for correct Google seller line after account id exists. |
| ADS-TXT-02 | Medium | Publishing `ads.txt` is recommended to prevent unauthorized selling of inventory. | Recommend adding once AdSense publisher ID is known. |

## C. Content Quality and Site Value

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-CONTENT-01 | Blocker | Site must have useful, original, visitor-relevant content. | Sample key pages; reject scraped, AI-spun, doorway, placeholder, or auto-generated pages without value. |
| ADS-CONTENT-02 | Blocker | Do not rely on copied articles, embedded videos, syndicated content, or affiliate feeds without original commentary, curation, review, data, tools, or analysis. | Compare templates and page bodies; check duplicate snippets and source attribution. |
| ADS-CONTENT-03 | High | Main content should be substantial enough for users and crawlers, not only navigation, tags, listings, empty galleries, or thin pages. | Check homepage, category/list pages, and detail pages. |
| ADS-CONTENT-04 | High | Site must not be under construction, empty, or built only to display ads. | Check live pages, broken sections, lorem ipsum, coming soon blocks. |
| ADS-CONTENT-05 | High | Ads, affiliate blocks, sponsored listings, or paid promotion must not exceed or dominate publisher content. | Estimate above-the-fold and full-page ratio. |
| ADS-CONTENT-06 | Medium | Main content language should be supported by AdSense. | Identify site primary language and check if mixed-language pages have real content. |
| ADS-CONTENT-07 | Medium | Comment sections and user-generated content must be moderated for policy compliance. | Check visible comments, review workflow, spam, adult/offensive links. |
| ADS-CONTENT-08 | Medium | Content should not use excessive keyword repetition, doorway pages, or pages made mainly for search engines. | Inspect title/H1/body patterns and internal page duplication. |

## D. Navigation, UX, and Trust Signals

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-UX-01 | High | Navigation must be clear, readable, aligned, and functional. | Test header/menu/dropdowns/footer links on desktop and mobile. |
| ADS-UX-02 | High | Users must be able to understand what the site is, find content, and move between sections without misleading paths. | Check homepage/category/detail flow and breadcrumbs/search. |
| ADS-UX-03 | Blocker | Do not use deceptive navigation, fake download/play buttons, links to nonexistent content, irrelevant redirects, or ads where navigation normally appears. | Inspect CTAs, buttons, ad placeholders, and redirects. |
| ADS-UX-04 | Blocker | Site behavior must not change user preferences, redirect unexpectedly, trigger downloads, include malware, or use obstructive popups/popunders. | Test page load, clicks, mobile overlays, external scripts. |
| ADS-UX-05 | Medium | Include basic trust pages appropriate to the site: About, Contact, Privacy Policy, terms/disclaimer when relevant. | Verify pages are real, accessible, and not boilerplate-only. |
| ADS-UX-06 | Medium | Avoid intrusive ad-like layout before approval; do not create confusing separation between ads and content. | Check visual hierarchy and labels. |

## E. Crawlability, Access, and Technical Availability

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-CRAWL-01 | Blocker | The site must be live and publicly reachable; key URLs must not return 404/5xx. | Fetch homepage and representative pages with `curl` or browser. |
| ADS-CRAWL-02 | Blocker | AdSense crawler must not be blocked by login walls, IP restrictions, geoblocking, WAF rules, or robots.txt. | Check public access, `robots.txt`, firewall/bot protection symptoms. |
| ADS-CRAWL-03 | High | Do not require POST data to view ad-bearing pages; crawler does not send POST payloads. | Check forms/search/detail pages and server routes. |
| ADS-CRAWL-04 | High | Avoid excessive or fragile redirects on pages where ads will show. | Trace redirects and cookie/session dependencies. |
| ADS-CRAWL-05 | Medium | Prefer stable, simple URLs over per-user session IDs or one-off dynamic paths for same content. | Inspect URLs for session/user identifiers and canonical tags. |
| ADS-CRAWL-06 | High | DNS and hosting must reliably resolve and respond. | Check DNS, TLS, uptime, server response times. |
| ADS-CRAWL-07 | Medium | Newly published pages may need time to be crawled; large UGC/news/catalog sites should expose stable index paths and sitemap. | Check sitemap and internal links. |

## F. AdSense Program Policy Requirements

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-PROG-01 | Blocker | Do not click your own ads and do not artificially inflate impressions or clicks with bots, repeated manual actions, automated tools, or fraudulent software. | Ask owner and inspect traffic/automation if relevant. |
| ADS-PROG-02 | Blocker | Do not ask users to click or view ads, offer rewards for ad actions, use phrases like support us by clicking ads, or place arrows/images to draw attention to ads. | Inspect copy near ad slots and CTA wording. |
| ADS-PROG-03 | Blocker | Do not make ads hard to distinguish from content or label ads misleadingly; acceptable labels are neutral such as ad/sponsored. | Inspect ad slot labels/design. |
| ADS-PROG-04 | High | Traffic sources must be legitimate; avoid paid-to-click, paid-to-surf, auto-surf, click exchange, spam email, spam posts, toolbar/software-driven traffic, or online ads with poor landing pages. | Ask owner; inspect campaign sources if available. |
| ADS-PROG-05 | High | Ad code modifications must not inflate performance or harm advertisers. | Inspect ad code and wrappers when present. |
| ADS-PROG-06 | Blocker | Do not place Google ads in software, toolbars, popups/popunders, emails, private communication screens, non-content pages, ad-only pages, framed third-party content, or pages impersonating Google. | Inspect placement plan and templates. |
| ADS-PROG-07 | High | WebView monetization has special requirements; normal websites should not assume app WebView eligibility. | Mark applicable only for app/webview audits. |

## G. Google Publisher Policies: Prohibited Content and Conduct

Any matching item is normally a `Blocker` for AdSense approval or ad serving on affected pages.

| ID | Requirement | Check |
| --- | --- | --- |
| ADS-PUB-01 | No illegal content, illegal activity promotion, or rights violations. | Review topic, products, downloads, instructions. |
| ADS-PUB-02 | No copyright infringement, counterfeit goods, or brand/trademark abuse. | Check copied media, product pages, logo use, fake brand claims. |
| ADS-PUB-03 | No dangerous or derogatory content: hate, discrimination, harassment, threats, self-harm promotion, violence praise, terrorism/cartel support, extortion. | Review content and UGC. |
| ADS-PUB-04 | No animal cruelty promotion or sale of endangered species products. | Review niche/product content. |
| ADS-PUB-05 | No misleading representation: do not hide or misstate publisher identity, content creator, content purpose, content itself, affiliation, endorsement, or brand relationship. | Check About, author, branding, logos, product claims, disclosures. |
| ADS-PUB-06 | No deceptive behavior: phishing, personal-information theft, fake get-rich claims, intentionally misleading content or service promotion. | Check forms, offers, lead flows. |
| ADS-PUB-07 | No content enabling dishonest behavior: fake documents, academic cheating, drug-test evasion, hacking/cracking, unauthorized tracking/spyware. | Review tools/downloads/tutorials. |
| ADS-PUB-08 | No paid sexual acts, mail-order bride/cross-border marriage broker content, adult themes in family content, or child sexual abuse/exploitation. | Review adult/family/UGC areas carefully. |
| ADS-PUB-09 | Publisher information and ad request data must be accurate and complete, including site/app identity and ads.txt/app-ads.txt where applicable. | Check metadata, account/site mapping, ads.txt. |
| ADS-PUB-10 | Ads must not interfere with content or user interaction, overlap navigation, push content away, or trap users on screens that require ad clicks to exit. | Inspect ad layout plan. |
| ADS-PUB-11 | Do not show ads on screens with no publisher content, low-value content, under-construction content, copied content without added value, unsupported languages, or where paid promotion exceeds content. | Inspect representative templates. |
| ADS-PUB-12 | Do not place ads out of context: background pages, off-screen placements, or screens where user attention is clearly elsewhere. | Inspect responsive layout and lazy-loaded slots. |
| ADS-PUB-13 | No demonstrably false claims that undermine elections/democratic processes, harmful health claims contradicting scientific consensus, or climate-change claims contradicting authoritative scientific consensus. | Review news, health, politics, science, climate, and UGC content. |
| ADS-PUB-14 | No manipulated media that deceives users about politics, social issues, or public-concern topics. | Review images/video/audio and AI-generated media disclosures. |
| ADS-PUB-15 | No child endangerment, grooming, sextortion, sexualization of minors, child trafficking, or CSAM-related content; treat any signal as an immediate hard blocker. | Review content, images, comments, uploads, moderation logs where available. |
| ADS-PUB-16 | Do not monetize content that requires sensitive-event restraint when it exploits, denies, or is insensitive toward an active crisis or unexpected event. | Check news/crisis pages and monetization context. |

## H. Google Publisher Restrictions: Restricted Inventory Risks

Restricted content is not always an account/application blocker by itself, but it can sharply reduce or prevent ad demand and should be treated as `High` for approval readiness unless isolated and clearly excluded from ads.

| ID | Requirement | Check |
| --- | --- | --- |
| ADS-REST-01 | Sexual content, sexual entertainment, sexual products, sexual health supplements, or sexual advice. | Review categories, images, UGC. |
| ADS-REST-02 | Shocking, graphic, violent, disgusting, or prominent obscene language. | Review images, articles, comments. |
| ADS-REST-03 | Explosives, firearms, firearm parts, other weapons, or instructions to obtain/assemble/improve them. | Review products/tutorials. |
| ADS-REST-04 | Tobacco, recreational drugs, drug paraphernalia, drug production/use instructions. | Review products/articles. |
| ADS-REST-05 | Alcohol online sales or irresponsible drinking promotion. | Review ecommerce/affiliate links and content framing. |
| ADS-REST-06 | Online gambling or paid games of chance, subject to location exceptions. | Review offers and target geos. |
| ADS-REST-07 | Prescription-drug sales, online pharmacies, unapproved drugs/supplements, or delisted Google Play apps. | Review health/ecommerce/app content. |
| ADS-REST-08 | Ad obstruction: ads covering content, content covering ads, video ad controls hidden, unsupported video implementation, autoplay/sticky video violations. | Inspect layout/video placements. |

## I. Privacy and Data Requirements

| ID | Severity | Requirement | Check |
| --- | --- | --- | --- |
| ADS-PRIV-01 | Blocker | Publish and follow a privacy policy that discloses data collection, sharing, and use caused by Google products, including cookies, web beacons, IP addresses, or other identifiers. | Inspect privacy page and footer link. |
| ADS-PRIV-02 | High | Disclose that third parties may place/read cookies or use web beacons/IP addresses because ads are served on the site. | Check privacy policy language. |
| ADS-PRIV-03 | High | Do not pass personally identifiable information to Google in ad requests or use Google services to identify users without required notice/consent. | Inspect URLs, query params, ad code, analytics/ad personalization setup. |
| ADS-PRIV-04 | High | Comply with EU user consent policy where applicable. | Check consent banner/CMP for EEA/UK traffic. |
| ADS-PRIV-05 | High | If collecting precise location data, disclose use, obtain opt-in consent, transmit securely, and document it in privacy policy. | Check app/site permissions and data flows. |
| ADS-PRIV-06 | High | If content is child-directed or COPPA-covered, mark it appropriately and do not use interest-based targeting for children. | Check audience, content, account settings. |
| ADS-PRIV-07 | High | Do not set, modify, intercept, or delete cookies on Google domains. | Inspect scripts only if custom ad/proxy code exists. |
| ADS-PRIV-08 | High | Do not use Google ad code or platform products to target personalized ads or build audience lists from child-directed activity, adult/gambling/government-site activity, or sensitive information such as health, financial hardship, ethnicity, religion, crime, political affiliation, union membership, sexual behavior, or sexual orientation. | Inspect ad personalization, remarketing, audience lists, analytics audiences, and data-layer events. |
| ADS-PRIV-09 | High | In the US and Canada, do not target housing, employment, or credit-related ads by gender, age, parental status, marital status, or postal code. | Check ad/marketing audience settings if site advertises or retargets these categories. |
| ADS-PRIV-10 | Medium | If personalized ads are used, confirm the publisher has rights to audience data and shows required interest-based advertising disclosures or controls where applicable. | Check consent/CMP, privacy policy, and ad choice disclosures. |

## J. Recommended Audit Output

Use this format:

```markdown
**Decision**
Not ready / Ready after fixes / Ready

**Blockers**
- `ADS-CONTENT-02`: Issue. Evidence. Fix.

**High Risks**
- `ADS-CRAWL-02`: Issue. Evidence. Fix.

**Medium Risks**
- `ADS-UX-05`: Issue. Evidence. Fix.

**Exhaustive Checklist**
Every requirement ID in this reference must appear exactly once.

| ID | Status | Evidence | Next action |
| --- | --- | --- | --- |
| ADS-ELIG-01 | Pass/Fail/Unknown/N/A | ... | ... |
| ADS-ELIG-02 | Pass/Fail/Unknown/N/A | ... | ... |
| ... | ... | ... | ... |

**Completeness Check**
- Requirement IDs in reference: `<count>`
- Requirement IDs in report: `<count>`
- Missing IDs: `none` or list IDs
```

Rules:

- Do not collapse multiple IDs into one row.
- Do not omit IDs because they seem unlikely; mark them `N/A` with a reason.
- Do not mark an item `Pass` without evidence.
- Use `Unknown` when account data, analytics, AdSense dashboard access, owner confirmation, or server access is required.
