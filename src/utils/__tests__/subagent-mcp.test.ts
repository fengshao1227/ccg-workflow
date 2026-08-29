/**
 * Regression guard: a sub-agent told to use MCP must be given MCP.
 *
 * Since v3.6.0 the wrapper makes sub-agents skip MCP by default, because a
 * sub-agent that only edits files and runs commands spends ~25s connecting
 * servers it never calls. `/ccg:codex-exec` is the one command built on the
 * opposite premise — its whole point is that the sub-agent does the retrieval
 * so Claude spends no tokens on it — and its payload names ace-tool, context7
 * and grok-search explicitly.
 *
 * The two halves live in different files (a Go wrapper and a Markdown
 * template), so nothing but a test connects them: the default changed under a
 * template that still assumed the old one, and the failure is silent — the
 * sub-agent is simply asked to use tools it cannot see.
 */

import { readFileSync } from 'node:fs'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { PACKAGE_ROOT } from '../installer-template'

/** Every wrapper invocation in a command template, one per line. */
function wrapperCalls(template: string): string[] {
  return readFileSync(join(PACKAGE_ROOT, 'templates', template), 'utf-8')
    .split('\n')
    .filter(line => line.includes('codeagent-wrapper'))
}

/**
 * Lines that are inside a heredoc — i.e. text handed to the sub-agent rather
 * than instructions Claude follows itself.
 *
 * Paired by the opener's own tag: closers here are written `EOF",` inside a
 * JSON-ish Bash({...}) block, so matching a bare `EOF` word is not enough and
 * a stricter pattern silently never closes, swallowing the rest of the file.
 */
function payloadLines(template: string): string[] {
  const lines = readFileSync(join(PACKAGE_ROOT, 'templates', template), 'utf-8').split('\n')
  const payload: string[] = []
  let tag: string | undefined
  for (const line of lines) {
    if (tag === undefined) {
      const opener = line.match(/<<'([A-Z_]+)'/)
      if (opener) tag = opener[1]
      continue
    }
    if (line.trimStart().startsWith(tag)) {
      tag = undefined
      continue
    }
    payload.push(line)
  }
  return payload
}

describe('sub-agents that are told to use MCP get MCP', () => {
  const CODEX_EXEC = 'commands-legacy/codex-exec.md'

  it('every executor call in codex-exec passes --with-mcp', () => {
    const calls = wrapperCalls(CODEX_EXEC)
    expect(calls.length).toBeGreaterThan(0)

    // The executor is the one carrying the MCP-dependent payload; the reviewer
    // reads a diff and the fixer works from file:line, so neither should pay
    // the startup cost.
    const executors = calls.filter(line => line.includes('EXEC_EOF'))
    expect(executors.length).toBe(3)
    for (const call of executors) {
      expect(call, `executor call must opt into MCP:\n${call}`).toContain('--with-mcp')
    }

    const others = calls.filter(line => !line.includes('EXEC_EOF'))
    for (const call of others) {
      expect(call, `only the executor needs MCP:\n${call}`).not.toContain('--with-mcp')
    }
  })

  it('the payload still asks the sub-agent for MCP retrieval', () => {
    // If this stops being true the flag above is dead weight — and the reason
    // for it, recorded in the template, would quietly stop applying.
    const body = readFileSync(join(PACKAGE_ROOT, 'templates', CODEX_EXEC), 'utf-8')
    expect(body).toMatch(/ace-tool MCP/)
    expect(body).toMatch(/context7 MCP/)
  })

  it('no other command template asks a sub-agent to call MCP', () => {
    // execute.md also names MCP, but there Claude itself is the caller — it is
    // the one running the slash command, and it holds the servers. This pins
    // the distinction so a future template does not quietly cross it.
    const mcpInPayload = payloadLines('commands-legacy/execute.md')
      .filter(line => line.includes('MCP'))
    expect(mcpInPayload, 'execute.md must keep MCP on the Claude side').toEqual([])
  })
})
