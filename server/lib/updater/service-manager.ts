/**
 * Service management — detect and control systemd / launchd services.
 * Detection order: systemd first, then launchd.
 */

import { execFileSync } from 'node:child_process';
import type { ServiceManager } from './types.js';

// ── Systemd adapter ──────────────────────────────────────────────────

class SystemdManager implements ServiceManager {
  readonly name = 'systemd';
  private unit = '';
  private isUserUnit = false;

  detect(): boolean {
    try {
      execFileSync('systemctl', ['--version'], { stdio: 'pipe' });
    } catch {
      return false;
    }

    // Search system units first, then user units
    const systemUnit = this.findUnit(false);
    if (systemUnit) {
      this.unit = systemUnit;
      this.isUserUnit = false;
      return true;
    }

    const userUnit = this.findUnit(true);
    if (userUnit) {
      this.unit = userUnit;
      this.isUserUnit = true;
      return true;
    }

    return false;
  }

  async restart(): Promise<void> {
    const args = this.isUserUnit
      ? ['--user', 'restart', this.unit]
      : ['restart', this.unit];
    execFileSync('systemctl', args, { stdio: 'pipe' });
  }

  async isActive(): Promise<boolean> {
    try {
      const args = this.isUserUnit
        ? ['--user', 'is-active', this.unit]
        : ['is-active', this.unit];
      const result = execFileSync('systemctl', args, { stdio: 'pipe' })
        .toString()
        .trim();
      return result === 'active';
    } catch {
      return false;
    }
  }

  async getLogs(lines: number): Promise<string> {
    try {
      const args = this.isUserUnit
        ? ['--user', '-u', this.unit, '-n', String(lines), '--no-pager']
        : ['-u', this.unit, '-n', String(lines), '--no-pager'];
      return execFileSync('journalctl', args, { stdio: 'pipe' }).toString();
    } catch {
      return '';
    }
  }

  private findUnit(user: boolean): string | null {
    try {
      const args = user
        ? ['--user', 'list-units', '--type=service', '--all', '--no-legend']
        : ['list-units', '--type=service', '--all', '--no-legend'];
      const output = execFileSync('systemctl', args, { stdio: 'pipe' }).toString();

      for (const line of output.split('\n')) {
        if (/nerve/i.test(line)) {
          const unit = line.trim().split(/\s+/)[0];
          if (unit) return unit;
        }
      }
    } catch {
      // systemd not available for this scope
    }
    return null;
  }
}

// ── Launchd adapter ──────────────────────────────────────────────────

class LaunchdManager implements ServiceManager {
  readonly name = 'launchd';
  private label = '';

  detect(): boolean {
    if (process.platform !== 'darwin') return false;

    try {
      const output = execFileSync('launchctl', ['list'], { stdio: 'pipe' }).toString();
      for (const line of output.split('\n')) {
        if (/nerve/i.test(line)) {
          const parts = line.trim().split(/\s+/);
          const candidate = parts[parts.length - 1];
          if (candidate) {
            this.label = candidate;
            return true;
          }
        }
      }
    } catch {
      // no launchd
    }

    return false;
  }

  async restart(): Promise<void> {
    const uid = execFileSync('id', ['-u'], { stdio: 'pipe' }).toString().trim();
    try {
      execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${this.label}`], { stdio: 'pipe' });
    } catch {
      // Fallback to stop + start
      try {
        execFileSync('launchctl', ['stop', this.label], { stdio: 'pipe' });
      } catch {
        // may already be stopped
      }
      execFileSync('launchctl', ['start', this.label], { stdio: 'pipe' });
    }
  }

  async isActive(): Promise<boolean> {
    try {
      const output = execFileSync('launchctl', ['list'], { stdio: 'pipe' }).toString();
      for (const line of output.split('\n')) {
        if (line.includes(this.label)) {
          const pid = line.trim().split(/\s+/)[0];
          return pid !== '-' && pid !== '' && !isNaN(Number(pid));
        }
      }
    } catch {
      // can't determine
    }
    return false;
  }

  async getLogs(lines: number): Promise<string> {
    try {
      return execFileSync(
        'log',
        ['show', '--predicate', 'processImagePath contains "nerve"', '--last', '5m', '--info'],
        { stdio: 'pipe' },
      ).toString().split('\n').slice(-lines).join('\n');
    } catch {
      return '';
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Detect the active service manager, or null if neither is found.
 * Tries systemd first, then launchd.
 */
export function detectServiceManager(): ServiceManager | null {
  const systemd = new SystemdManager();
  if (systemd.detect()) return systemd;

  const launchd = new LaunchdManager();
  if (launchd.detect()) return launchd;

  return null;
}
