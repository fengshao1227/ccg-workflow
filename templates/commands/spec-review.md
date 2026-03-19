---
description: '双模型交叉审查（独立工具，随时可用）'
---
<!-- CCG:SPEC:REVIEW:START -->
**Core Philosophy**
- Dual-model cross-validation catches blind spots single-model review would miss.
- Critical findings SHOULD be addressed before proceeding.
- Review validates implementation against spec constraints and code quality.
- This is an independent review tool—can be used anytime, not tied to archive workflow.

**Guardrails**
- **MANDATORY**: Both Codex AND Gemini must complete review before synthesis.
- Review scope is strictly limited to the proposal's changes—no scope creep.
- Refer to `openspec/config.yaml` for project conventions when reviewing OpenSpec proposals.

**Steps**
1. **Select Proposal**
   - Run `openspec list --json` to display Active Changes.
   - Confirm with user which proposal ID to review.
   - Run `openspec status --change "<proposal_id>" --json` to load spec and tasks.

2. **Collect Implementation Artifacts**
   - Identify all files modified by this proposal.
   - Use `git diff` to get change summary.
   - Load relevant spec constraints and PBT properties from `openspec/changes/<id>/specs/`.

3. **Multi-Model Review (PARALLEL)**
   - **CRITICAL**: You MUST launch BOTH Codex AND Gemini in a SINGLE message with TWO Bash tool calls.
   - **DO NOT** call one model first and wait. Launch BOTH simultaneously with `run_in_background: true`.
   - **工作目录**：`{{WORKDIR}}` 替换为目标工作目录的绝对路径。如果用户通过 `/add-dir` 添加了多个工作区，先确定任务相关的工作区。

   **Step 3.1**: In ONE message, make TWO parallel Bash calls:

   **FIRST Bash call (Codex)**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper --backend codex - \"{{WORKDIR}}\" <<'EOF'\nReview proposal <proposal_id> implementation:\n\n## Codex Review Dimensions\n1. **Spec Compliance**: Verify ALL constraints from spec are satisfied\n2. **PBT Properties**: Check invariants, idempotency, bounds are correctly implemented\n3. **Logic Correctness**: Edge cases, error handling, algorithm correctness\n4. **Backend Security**: Injection vulnerabilities, auth checks, input validation\n5. **Regression Risk**: Interface compatibility, type safety, breaking changes\n\n## Output Format (JSON)\n{\n  \"findings\": [\n    {\n      \"severity\": \"Critical|Warning|Info\",\n      \"dimension\": \"spec_compliance|pbt|logic|security|regression\",\n      \"file\": \"path/to/file.ts\",\n      \"line\": 42,\n      \"description\": \"What is wrong\",\n      \"constraint_violated\": \"Constraint ID from spec (if applicable)\",\n      \"fix_suggestion\": \"How to fix\"\n    }\n  ],\n  \"passed_checks\": [\"List of verified constraints/properties\"],\n  \"summary\": \"Overall assessment\"\n}\nEOF",
     run_in_background: true,
     timeout: 300000,
     description: "Codex: backend/logic review"
   })
   ```

   **SECOND Bash call (Gemini) - IN THE SAME MESSAGE**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"{{WORKDIR}}\" <<'EOF'\nReview proposal <proposal_id> implementation:\n\n## Gemini Review Dimensions\n1. **Pattern Consistency**: Naming conventions, code style, project patterns\n2. **Maintainability**: Readability, complexity, documentation adequacy\n3. **Integration Risk**: Dependency changes, cross-module impacts\n4. **Frontend Security**: XSS, CSRF, sensitive data exposure\n5. **Spec Alignment**: Implementation matches spec intent (not just letter)\n\n## Output Format (JSON)\n{\n  \"findings\": [\n    {\n      \"severity\": \"Critical|Warning|Info\",\n      \"dimension\": \"patterns|maintainability|integration|security|alignment\",\n      \"file\": \"path/to/file.ts\",\n      \"line\": 42,\n      \"description\": \"What is wrong\",\n      \"spec_reference\": \"Spec section (if applicable)\",\n      \"fix_suggestion\": \"How to fix\"\n    }\n  ],\n  \"passed_checks\": [\"List of verified aspects\"],\n  \"summary\": \"Overall assessment\"\n}\nEOF",
     run_in_background: true,
     timeout: 300000,
     description: "Gemini: patterns/integration review"
   })
   ```

   **Step 3.2**: After BOTH Bash calls return task IDs, wait for results with TWO TaskOutput calls:
   ```
   TaskOutput({ task_id: "<codex_task_id>", block: true, timeout: 600000 })
   TaskOutput({ task_id: "<gemini_task_id>", block: true, timeout: 600000 })
   ```

   ⛔ **Gemini 失败必须重试**：若 Gemini 调用失败，最多重试 2 次（间隔 5 秒）。3 次全败才跳过。
   ⛔ **Codex 结果必须等待**：Codex 执行 5-15 分钟属正常，超时后继续轮询，禁止跳过。

4. **Synthesize Findings**
   - Merge findings from both models.
   - Deduplicate overlapping issues.
   - Classify by severity:
     * **Critical**: Spec violation, security vulnerability, breaking change → MUST fix
     * **Warning**: Pattern deviation, maintainability concern → SHOULD fix
     * **Info**: Minor improvement suggestion → MAY fix

5. **Present Review Report**
   - Display findings grouped by severity:
   ```
   ## Review Report: <proposal_id>

   ### Critical (X issues) - MUST FIX
   - [ ] [SPEC] file.ts:42 - Constraint X violated: description
   - [ ] [SEC] api.ts:15 - SQL injection vulnerability

   ### Warning (Y issues) - SHOULD FIX
   - [ ] [PATTERN] utils.ts:88 - Inconsistent naming convention

   ### Info (Z issues) - MAY FIX
   - [ ] [MAINT] helper.ts:20 - Consider extracting to separate function

   ### Passed Checks
   - ✅ PBT: Idempotency property verified
   - ✅ Security: No XSS vulnerabilities found
   ```

6. **Decision Gate**
   - **If Critical > 0**:
     * Present findings to user.
     * Ask: "Fix now or return to `/ccg:spec-impl` to address?"
     * Do NOT allow archiving.

   - **If Critical = 0**:
     * Ask user: "All critical checks passed. Proceed to archive?"
     * If Warning > 0, recommend addressing before archive.

7. **Optional: Inline Fix Mode**
   - If user chooses "Fix now" for Critical issues:
     * Route each fix to appropriate model (backend→Codex, frontend→Gemini).
     * Apply fix using unified diff patch pattern.
     * Re-run affected review dimension.
     * Repeat until Critical = 0.

8. **Context Checkpoint**
   - Report current context usage.
   - If approaching 80K tokens, suggest: "Run `/clear` and continue with `/ccg:spec-review` or `/ccg:spec-impl`"

**Exit Criteria**
Review is complete when:
- [ ] Both Codex and Gemini reviews completed
- [ ] All findings synthesized and classified
- [ ] Zero Critical issues remain (fixed or user-acknowledged)
- [ ] User decision captured (archive / return to impl / defer)

**Reference**
- View proposal: `openspec status --change "<id>" --json`
- Check spec constraints: `rg -n "CONSTRAINT:|MUST|INVARIANT:" openspec/changes/<id>/specs/`
- View implementation diff: `git diff`
- Archive (after passing): `/ccg:spec-impl` → Step 10
<!-- CCG:SPEC:REVIEW:END -->
