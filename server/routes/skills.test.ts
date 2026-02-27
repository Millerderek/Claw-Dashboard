/** Tests for the skills API route (GET /api/skills). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';

interface ExecError extends Error {
  code?: string;
  killed?: boolean;
  signal?: string;
}

type ExecCb = (err: ExecError | null, stdout: string, stderr: string) => void;

let execFileImpl: (bin: string, args: string[], opts: unknown, cb: ExecCb) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = {
    ...actual,
    execFile: (...args: unknown[]) => {
      const [bin, cmdArgs, opts, cb] = args as [string, string[], unknown, ExecCb];
      return execFileImpl(bin, cmdArgs, opts, cb);
    },
  };
  return { ...mock, default: mock };
});

vi.mock('../lib/config.js', () => ({
  config: { auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443 },
  SESSION_COOKIE_NAME: 'nerve_session_3000',
}));

vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../lib/openclaw-bin.js', () => ({
  resolveOpenclawBin: () => '/usr/bin/openclaw',
}));

const RAW_SKILLS = [
  { name: 'weather', description: 'Get weather', emoji: '🌤️', eligible: true, disabled: false, blockedByAllowlist: false, source: 'bundled', bundled: true },
  { name: 'github', description: 'GitHub ops', emoji: '🐙', eligible: true, disabled: false, blockedByAllowlist: false, source: 'bundled', bundled: true },
];

const GOOD_SKILLS_JSON = JSON.stringify({ skills: RAW_SKILLS });
const GOOD_SKILLS_ARRAY_JSON = JSON.stringify(RAW_SKILLS);

import skillsRoutes from './skills.js';

function buildApp() {
  const app = new Hono();
  app.route('/', skillsRoutes);
  return app;
}

describe('GET /api/skills', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns skill list on success', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, GOOD_SKILLS_JSON, '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
    expect(json.skills[0].name).toBe('weather');
  });

  it('parses skills when warnings are printed before JSON', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, `Config warnings: duplicate plugin id\n${GOOD_SKILLS_JSON}`, '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
  });

  it('parses skills when warning prelude contains bracket characters', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, `[warn] duplicate plugin id\n${GOOD_SKILLS_JSON}`, '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
  });

  it('parses top-level skills array when warnings are printed before JSON', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, `Config warnings: noisy prelude\n${GOOD_SKILLS_ARRAY_JSON}`, '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
    expect(json.skills[1].name).toBe('github');
  });

  it('fails loud when openclaw binary is missing', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      const err = Object.assign(new Error('spawn /usr/bin/openclaw ENOENT'), { code: 'ENOENT' });
      cb(err, '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found/i);
  });

  it('fails loud on invalid JSON output', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, 'not json', '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/parse/i);
  });

  it('fails loud when JSON payload has no skills array', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, JSON.stringify({ workspaceDir: '/tmp/workspace' }), '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/missing skills array/i);
  });

  it('includes skill detail fields in response', async () => {
    execFileImpl = (_bin, _args, _opts, cb) => {
      cb(null, GOOD_SKILLS_JSON, '');
    };

    const app = buildApp();
    const res = await app.request('/api/skills');

    const json = (await res.json()) as { skills: Array<Record<string, unknown>> };
    const skill = json.skills[0];
    expect(skill).toHaveProperty('name');
    expect(skill).toHaveProperty('description');
    expect(skill).toHaveProperty('eligible');
    expect(skill).toHaveProperty('bundled');
  });
});
