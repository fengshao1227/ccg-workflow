import fs from 'fs-extra'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { collectSkills } from '../skill-registry'

const SKILLS_DIR = join(__dirname, '../../../templates/skills')

/**
 * Walk templates/skills and return every text file we ship.
 *
 * Skills are the one place where hand-written operational notes (real panel
 * addresses, API keys, client project paths) can slip into the npm tarball,
 * because they start life as someone's working notes rather than as source
 * code. A grep in review catches that once; this catches it every run.
 */
function shippedTextFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') continue
        walk(full)
      }
      else if (/\.(?:md|py|js|json|ya?ml|txt)$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(SKILLS_DIR)
  return out
}

describe('skills hygiene — nothing personal ships to npm', () => {
  const files = shippedTextFiles()

  it('ships a non-trivial number of skill files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('contains no absolute home paths', () => {
    // `~/...` is correct in templates: installer-template.ts rewrites it to the
    // installing user's real home. A baked-in /Users/<name> or C:\Users\<name>
    // would point every user at the author's machine. `/Users/you/` is the
    // documented placeholder in bt-panel's example config.
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, 'utf-8')
      return /\/Users\/(?!you\/)[A-Za-z0-9_.-]+\//.test(text)
        || /[A-Z]:\\Users\\(?!you\\)[A-Za-z0-9_.-]+\\/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('contains no credential-shaped bare tokens', () => {
    // Bare 32+ char mixed-case alphanumeric strings are what BT panel, OpenAI
    // and most vendors hand out as keys. Hex-only strings are excluded: those
    // are md5/sha digests, which the bt-panel docs legitimately explain.
    const offenders: string[] = []
    for (const f of files) {
      for (const m of fs.readFileSync(f, 'utf-8').matchAll(/\b[A-Za-z0-9]{32,64}\b/g)) {
        const s = m[0]
        if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) continue
        offenders.push(`${f}: ${s}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('contains no hardcoded public IPv4 addresses', () => {
    // Private/documentation ranges are fine as examples; a routable address is
    // somebody's actual server.
    const offenders: string[] = []
    for (const f of files) {
      for (const m of fs.readFileSync(f, 'utf-8').matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
        const [a, b] = [Number(m[1]), Number(m[2])]
        if (a === 10 || a === 127 || a === 0 || a >= 224) continue
        if (a === 192 && b === 168) continue
        if (a === 172 && b >= 16 && b <= 31) continue
        if (a === 169 && b === 254) continue // link-local, incl. the 169.254.169.254 cloud-metadata SSRF target the pentest docs teach
        if (a === 1 && b === 2) continue // 1.2.3.4 — the docs' stand-in address
        if (m[0] === '0.0.0.0') continue
        offenders.push(`${f}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('skills registry — v3.5.1 additions are wired up', () => {
  const skills = collectSkills(SKILLS_DIR)
  const byName = new Map(skills.map(s => [s.name, s]))

  it.each(['bt-panel', 'seo-page-builder', 'adsense-site-auditor'])(
    '%s is discoverable and user-invocable',
    (name) => {
      const skill = byName.get(name)
      expect(skill, `${name} not found by the registry`).toBeDefined()
      expect(skill!.userInvocable).toBe(true)
    },
  )

  it('bt-panel ships its executable scripts, not just docs', () => {
    for (const f of ['bt_client.py', 'bt_deploy.py', 'sites.example.json']) {
      expect(fs.existsSync(join(SKILLS_DIR, 'bt-panel', f)), f).toBe(true)
    }
  })

  it('seo-page-builder ships its audit script', () => {
    expect(fs.existsSync(join(SKILLS_DIR, 'seo-page-builder/scripts/onpage-audit.py'))).toBe(true)
  })

  it('seo-page-builder credits its upstream author', () => {
    const text = fs.readFileSync(join(SKILLS_DIR, 'seo-page-builder/SKILL.md'), 'utf-8')
    expect(text).toContain('yuzeiki')
  })
})
