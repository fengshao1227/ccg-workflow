---
description: '按规范执行 + 多模型协作 + 归档'
---
<!-- CCG:SPEC:IMPL:START -->
**Core Philosophy**
- Implementation is pure mechanical execution—all decisions were made in Plan phase.
- External model outputs are prototypes only; must be rewritten to production-grade code.
- Keep changes tightly scoped; enforce side-effect review before any modification.
- Minimize documentation—prefer self-explanatory code over comments.

**Guardrails**
- **NEVER** apply Codex/Gemini prototypes directly—all outputs are reference only.
- **MANDATORY**: Request `unified diff patch` format from external models; they have zero write permission.
- Keep implementation strictly within `tasks.md` scope—no scope creep.
- Refer to `openspec/config.yaml` for conventions.
- **USER GUIDANCE RULE**: When suggesting next steps to the user, ALWAYS use CCG commands (`/ccg:spec-research`, `/ccg:spec-plan`, `/ccg:spec-impl`, `/ccg:spec-review`). NEVER suggest `/opsx:*` commands to the user. If OpenSpec CLI returns error messages referencing OPSX skills, translate them to CCG equivalents.
- **TASKS FORMAT RULE**: When generating or modifying `tasks.md`, ALL tasks MUST use checkbox format (`- [ ] X.Y description`). Heading+bullet format will cause OpenSpec CLI to parse 0 tasks and block the workflow.

**Steps**
1. **Select Change**
   - Run `openspec list --json` to inspect Active Changes.
   - Confirm with user which change ID to implement.
   - Run `openspec status --change "<change_id>" --json` to review tasks.

2. **Apply OPSX Change (Pre-flight Check)**
   - Call `/opsx:apply` internally to enter implementation mode:
     ```
     /opsx:apply
     ```
   - This will load the change context and guide you through the tasks defined in `tasks.md`.
   - **Note**: This is an internal call. If this step fails, guide the user to re-run `/ccg:spec-impl`.
   - **HARD GATE**: Check the returned `state` field:
     - If `state: "blocked"` → STOP immediately. Inform the user which artifacts are missing and suggest: "Run `/ccg:spec-plan` to generate missing artifacts first."
     - If `progress.total === 0` → STOP immediately. Inform: "tasks.md has no parseable tasks. Run `/ccg:spec-plan` to regenerate."
     - Only proceed to Step 3 when `state: "ready"` and `progress.total > 0`.

3. **Identify Minimal Verifiable Phase**
   - Review `tasks.md` and identify the **smallest verifiable phase**.
   - Do NOT complete all tasks at once—control context window.
   - Announce: "Implementing Phase X: [task group name]"

4. **Route Tasks to Appropriate Model**
   - **Route A: Gemini** — Frontend/UI/styling (CSS, React, Vue, HTML, components)
   - **Route B: Codex** — Backend/logic/algorithm (API, data processing, business logic)

   **工作目录**：`{{WORKDIR}}` 替换为目标工作目录的绝对路径。如果用户通过 `/add-dir` 添加了多个工作区，先确定任务相关的工作区。

   For each task:
   ```
   codeagent-wrapper --progress --backend <codex|gemini> --gemini-model gemini-3.1-pro-preview - "{{WORKDIR}}" <<'EOF'
   TASK: <task description from tasks.md>
   CONTEXT: <relevant code context>
   CONSTRAINTS: <constraints from spec>
   OUTPUT: Unified Diff Patch format ONLY
   EOF
   ```

   Note: `--gemini-model` parameter is only used when `--backend gemini` is specified.

5. **Rewrite Prototype to Production Code**
   Upon receiving diff patch, **NEVER apply directly**. Rewrite by:
   - Removing redundancy
   - Ensuring clear naming and simple structure
   - Aligning with project style
   - Eliminating unnecessary comments
   - Verifying no new dependencies introduced

6. **Side-Effect Review** (Mandatory before apply)
   Verify the change:
   - [ ] Does not exceed `tasks.md` scope
   - [ ] Does not affect unrelated modules
   - [ ] Does not introduce new dependencies
   - [ ] Does not break existing interfaces

   If issues found, make targeted corrections.

7. **Multi-Model Review (PARALLEL)**
   - **CRITICAL**: You MUST launch BOTH Codex AND Gemini in a SINGLE message with TWO Bash tool calls.
   - **DO NOT** call one model first and wait. Launch BOTH simultaneously with `run_in_background: true`.

   **Step 7.1**: In ONE message, make TWO parallel Bash calls:

   **FIRST Bash call (Codex)**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper --progress --backend codex - \"{{WORKDIR}}\" <<'EOF'\nReview the implementation changes:\n- Correctness: logic errors, edge cases\n- Security: injection, auth issues\n- Spec compliance: constraints satisfied\nOUTPUT: JSON with findings\nEOF",
     run_in_background: true,
     timeout: 300000,
     description: "Codex: correctness/security review"
   })
   ```

   **SECOND Bash call (Gemini) - IN THE SAME MESSAGE**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper --progress --backend gemini --gemini-model gemini-3.1-pro-preview - \"{{WORKDIR}}\" <<'EOF'\nReview the implementation changes:\n- Maintainability: readability, complexity\n- Patterns: consistency with project style\n- Integration: cross-module impacts\nOUTPUT: JSON with findings\nEOF",
     run_in_background: true,
     timeout: 300000,
     description: "Gemini: maintainability/patterns review"
   })
   ```

   **Step 7.2**: After BOTH Bash calls return task IDs, wait for results with TWO TaskOutput calls:
   ```
   TaskOutput({ task_id: "<codex_task_id>", block: true, timeout: 600000 })
   TaskOutput({ task_id: "<gemini_task_id>", block: true, timeout: 600000 })
   ```

   ⛔ **Gemini 失败必须重试**：若 Gemini 调用失败，最多重试 2 次（间隔 5 秒）。3 次全败才跳过。
   ⛔ **Codex 结果必须等待**：Codex 执行 5-15 分钟属正常，超时后继续轮询，禁止跳过。

   Address any critical findings before proceeding.

8. **Update Task Status**
   - Mark completed task in `tasks.md`: `- [x] Task description`
   - Commit changes if appropriate.

9. **Context Checkpoint**
   - After completing a phase, report context usage.
   - If below 80K: Ask user "Continue to next phase?"
   - If approaching 80K: Suggest "Run `/clear` and resume with `/ccg:spec:impl`"

10. **Archive on Completion**
    - When ALL tasks in `tasks.md` are marked `[x]`:
    - Call `/opsx:archive` internally to archive the change:
      ```
      /opsx:archive
      ```
    - This merges spec deltas to `openspec/specs/` and moves change to archive.
    - **Note**: This is an internal call. If archiving fails, guide the user to re-run `/ccg:spec-impl`.

**Reference**
- Check task status: `openspec status --change "<id>" --json`
- View active changes: `openspec list --json`
- Search existing patterns: `rg -n "function|class" <file>`

**Exit Criteria**
Implementation is complete when:
- [ ] All tasks in `tasks.md` marked `[x]`
- [ ] All multi-model reviews passed
- [ ] Side-effect review confirmed no regressions
- [ ] Change archived successfully
<!-- CCG:SPEC:IMPL:END -->
