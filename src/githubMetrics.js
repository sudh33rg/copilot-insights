'use strict';

const { isoDay, daysAgo, dateRangeInclusive, asNumber } = require('./utils');

class GitHubMetricsService {
  constructor(vscode, context, store, output) {
    this.vscode = vscode;
    this.context = context;
    this.store = store;
    this.output = output;
  }

  async setPersonalToken() {
    const token = await this.vscode.window.showInputBox({
      title: 'Copilot Insights: GitHub token',
      prompt: 'Optional fallback token for GitHub billing/metrics APIs. Stored only in VS Code SecretStorage.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'github_pat_… or ghp_…'
    });
    if (token === undefined) return false;
    if (!token.trim()) await this.context.secrets.delete('copilotInsights.githubToken');
    else await this.context.secrets.store('copilotInsights.githubToken', token.trim());
    return true;
  }

  async getAuth(scopes, interactive = true) {
    const secret = await this.context.secrets.get('copilotInsights.githubToken');
    if (secret) return { token: secret, source: 'secret' };
    try {
      const session = await this.vscode.authentication.getSession('github', scopes, { createIfNone: interactive });
      if (!session) return null;
      return { token: session.accessToken, source: 'vscode', account: session.account };
    } catch (e) {
      if (!interactive) return null;
      throw new Error(`GitHub sign-in failed: ${e.message || e}`);
    }
  }

  async request(url, token) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'copilot-insights-vscode'
      }
    });
    if (res.status === 204) { const err = new Error('GitHub API 204: no report content'); err.status = 204; throw err; }
    if (!res.ok) {
      const body = await res.text().catch(()=> '');
      const err = new Error(`GitHub API ${res.status}: ${body.slice(0, 280) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async text(url, token) {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'copilot-insights-vscode' } });
    if (!res.ok) throw new Error(`Usage report download failed (${res.status})`);
    return res.text();
  }

  async currentUser(token) {
    return this.request('https://api.github.com/user', token);
  }

  async sync(interactive = true) {
    const config = this.vscode.workspace.getConfiguration('copilotInsights');
    const scope = config.get('githubScope', 'auto');
    if (scope === 'off') return { synced: false, message: 'GitHub usage sync is disabled.' };
    const syncDays = Math.max(1, Math.min(90, Number(config.get('syncDays', 28)) || 28));
    const org = String(config.get('githubOrganization', '') || '').trim();
    const enterprise = String(config.get('githubEnterprise', '') || '').trim();
    const chosen = scope === 'auto' ? (org ? 'organization' : enterprise ? 'enterprise' : 'user') : scope;
    const scopes = chosen === 'user' ? ['read:user'] : ['read:user', 'read:org'];
    const auth = await this.getAuth(scopes, interactive);
    if (!auth) return { synced: false, message: 'No existing GitHub authentication session.' };
    const user = await this.currentUser(auth.token);
    this.output.appendLine(`[sync] scope=${chosen}, user=${user.login}, days=${syncDays}`);

    let result;
    if (chosen === 'organization') {
      if (!org) throw new Error('Set copilotInsights.githubOrganization before organization sync.');
      result = await this.syncUsageMetricsDaily('organization', org, user.login, auth.token, syncDays);
    } else if (chosen === 'enterprise') {
      if (!enterprise) throw new Error('Set copilotInsights.githubEnterprise before enterprise sync.');
      result = await this.syncUsageMetricsDaily('enterprise', enterprise, user.login, auth.token, syncDays);
    } else {
      result = await this.syncIndividualBilling(user.login, auth.token, syncDays);
    }
    this.store.setMeta('last_sync_at', String(Date.now()));
    this.store.setMeta('last_sync_scope', chosen);
    this.store.setMeta('last_sync_user', user.login);
    return { synced: true, scope: chosen, user: user.login, ...result };
  }

  async syncIndividualBilling(username, token, syncDays) {
    const today = isoDay();
    const first = daysAgo(today, syncDays - 1);
    const days = dateRangeInclusive(first, today);
    const results = await mapLimit(days, 4, async (day) => {
      const d = new Date(`${day}T12:00:00Z`);
      const url = `https://api.github.com/users/${encodeURIComponent(username)}/settings/billing/ai_credit/usage?year=${d.getUTCFullYear()}&month=${d.getUTCMonth()+1}&day=${d.getUTCDate()}`;
      try {
        const data = await this.request(url, token);
        const items = Array.isArray(data.usageItems) ? data.usageItems : [];
        const credits = items.reduce((a,x)=>a + usageCredits(x), 0);
        this.store.upsertDailyUsage({ day, source: 'github-user-billing', account: username, credits, interactions: 0, raw: data });
        this.store.replaceModelUsage(day, 'github-user-billing', username, items.map(x => ({ model: x.model || x.sku || 'Unknown', credits: usageCredits(x), interactions: 0 })));
        return { day, ok: true };
      } catch (e) {
        if (e.status === 404 || e.status === 403) return { day, fatal: true, error: 'GitHub user billing API is not available for this account/token. For organization-managed Copilot, configure organization or enterprise scope; administrators need the corresponding metrics permission.' };
        return { day, ok: false, error: e.message };
      }
    });
    const fatal = results.find(x => x.fatal);
    if (fatal) throw new Error(fatal.error);
    return { syncedDays: results.filter(x => x.ok).length, errors: results.filter(x => !x.ok).map(x => `${x.day}: ${x.error}`) };
  }

  async syncUsageMetricsDaily(kind, account, username, token, syncDays) {
    const today = isoDay();
    const first = daysAgo(today, syncDays - 1);
    const prefix = kind === 'organization' ? `orgs/${encodeURIComponent(account)}` : `enterprises/${encodeURIComponent(account)}`;
    const days = dateRangeInclusive(first, today);
    const results = await mapLimit(days, 4, async (day) => {
      const url = `https://api.github.com/${prefix}/copilot/metrics/reports/users-1-day?day=${day}`;
      try {
        const meta = await this.request(url, token);
        const links = Array.isArray(meta.download_links) ? meta.download_links : [];
        const reportTexts = await mapLimit(links, 2, link => this.text(link, token));
        const records = [];
        for (const ndjson of reportTexts) {
          for (const line of ndjson.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try { records.push(JSON.parse(line)); } catch {}
          }
        }
        const mine = records.find(r => String(r.user_login || '').toLowerCase() === username.toLowerCase());
        this.store.upsertDailyUsage({
          day, source: `github-${kind}-metrics`, account,
          credits: asNumber(mine?.ai_credits_used),
          interactions: asNumber(mine?.user_initiated_interaction_count),
          raw: mine || { report_day: day, user_not_present: true }
        });
        return { day, ok: true };
      } catch (e) {
        if (e.status === 403) return { day, fatal: true, error: `GitHub denied ${kind} Copilot metrics access. The signed-in identity needs the GitHub Copilot metrics permission for ${account}.` };
        if (e.status === 204 || e.status === 404) return { day, ok: false, error: 'report unavailable' };
        return { day, ok: false, error: e.message };
      }
    });
    const fatal = results.find(x => x.fatal);
    if (fatal) throw new Error(fatal.error);
    return { syncedDays: results.filter(x => x.ok).length, errors: results.filter(x => !x.ok).map(x => `${x.day}: ${x.error}`) };
  }

  shouldAutoSync() {
    const config = this.vscode.workspace.getConfiguration('copilotInsights');
    if (!config.get('autoSync', true) || config.get('githubScope', 'auto') === 'off') return false;
    const last = Number(this.store.getMeta('last_sync_at') || 0);
    return Date.now() - last > 6 * 60 * 60 * 1000;
  }
}

function usageCredits(item) {
  const unit = String(item.unitType || '').toLowerCase();
  if (unit.includes('credit')) return asNumber(item.grossQuantity ?? item.netQuantity ?? item.quantity);
  if (asNumber(item.pricePerUnit) === 0.01 && item.grossAmount != null) return asNumber(item.grossAmount) / 0.01;
  return 0;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

module.exports = { GitHubMetricsService, usageCredits, mapLimit };
