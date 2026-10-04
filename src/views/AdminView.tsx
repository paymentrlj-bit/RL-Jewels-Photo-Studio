// Admin: staff accounts, the enhance prompt, and the numbers worth acting on.

import React, { useCallback, useEffect, useState } from 'react';
import { Users, Wand2, BarChart3, AlertTriangle, Check, UserPlus, RotateCcw, KeyRound } from 'lucide-react';
import { api, ApiError, type AnalyticsSummary, type MetaFeedStatus } from '../api';
import { SimilarList } from '../components/SimilarList';
import { AUDIT_CHECK_FAILURE_LABELS, ROLE_LABELS, type Role } from '../types';
import type { SessionUser } from '../types';
import { AUDIT_CHECK_LABELS } from '../types';

type Tab = 'insights' | 'staff' | 'prompt';

// What to tell someone whose pieces keep failing the same check - the fixes
// that live at the counter rather than in the prompt.
const COACHING: Record<string, string> = {
  sharpFocus: 'Tap the piece on the screen to focus; rest the phone on something steady.',
  notCropped: 'Step back so the whole piece sits inside the frame.',
  backgroundCleanWhite: 'Clear the tag, ruler and anything else from the velvet.',
  noBlownHighlights: 'Turn the flash off; use the lightbox.',
  neutralWhiteBalance: 'Shoot under the same light each time.',
  clearlyIdentifiableCategory: 'Lay the piece out the way the shooting tip says.',
};

export const AdminView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('insights');

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 rounded-xl bg-stone-100 p-1">
        {([
          ['insights', 'Insights', BarChart3],
          ['staff', 'Staff accounts', Users],
          ['prompt', 'Enhance prompt', Wand2],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </nav>

      {tab === 'insights' && <InsightsPanel />}
      {tab === 'staff' && <StaffPanel />}
      {tab === 'prompt' && <PromptPanel />}
    </div>
  );
};

const InsightsPanel: React.FC = () => {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [feed, setFeed] = useState<MetaFeedStatus | null>(null);
  const [daily, setDaily] = useState<{ text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dupes, setDupes] = useState<Awaited<ReturnType<typeof api.duplicates>>['pairs'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.analytics(30).then(setData).catch((err) => setError(err.message));
    api.dailySummary().then(setDaily).catch(() => setDaily(null));
    api.metaFeed().then(setFeed).catch(() => setFeed(null));
    api.duplicates().then((r) => setDupes(r.pairs)).catch(() => setDupes(null));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const worstCheck = Object.entries(data.qualityChecks.failuresByCheck).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Photos processed" value={data.throughput.photosProcessed} sub={`last ${data.windowDays} days`} />
        <Stat label="Reshoot rate" value={data.throughput.reshootRate === null ? '—' : `${data.throughput.reshootRate}%`} sub="AI failed its own QA twice" />
        <Stat label="Escalation rate" value={data.throughput.escalationRate === null ? '—' : `${data.throughput.escalationRate}%`} sub="needed the stronger model" />
        <Stat
          label="Avg time per photo"
          value={data.throughput.avgLatencyMs === null ? '—' : `${(data.throughput.avgLatencyMs / 1000).toFixed(1)}s`}
          sub="end to end"
        />
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="font-semibold text-stone-900">Estimated AI cost</h3>
        <p className="mt-2 text-3xl font-semibold text-stone-900">
          ₹{data.cost.totalEstimatedInr.toFixed(2)}
          {data.cost.avgPerPhotoInr !== null && (
            <span className="ml-2 text-sm font-normal text-stone-500">
              (₹{data.cost.avgPerPhotoInr.toFixed(3)} per photo)
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          ${data.cost.totalEstimatedUsd.toFixed(2)} at ₹{data.cost.usdToInrRate.toFixed(2)}/$
          {data.cost.rateIsLive ? " (today's rate)" : ' (fallback rate - live rate unreachable)'} - Gemini bills in USD, this is a display conversion only.
        </p>
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${data.cost.calibrated ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          {data.cost.note}
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="font-semibold text-stone-900">Quality checks that fail most</h3>
        <p className="mt-1 text-xs text-stone-500">{data.qualityChecks.note}</p>

        {data.qualityChecks.verdictsAnalyzed === 0 ? (
          <p className="mt-4 text-sm text-stone-500">No verdicts recorded yet.</p>
        ) : (
          <>
            {worstCheck && worstCheck[1] > 0 && (
              <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                Most common failure: <strong>{AUDIT_CHECK_LABELS[worstCheck[0]] || worstCheck[0]}</strong> ({worstCheck[1]} times).
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {Object.entries(data.qualityChecks.failuresByCheck)
                .sort((a, b) => b[1] - a[1])
                .map(([key, count]) => {
                  const pct = data.qualityChecks.verdictsAnalyzed > 0
                    ? Math.round((count / data.qualityChecks.verdictsAnalyzed) * 100)
                    : 0;
                  return (
                    <li key={key} className="flex items-center gap-3">
                      <span className="w-52 shrink-0 text-sm text-stone-700">{AUDIT_CHECK_LABELS[key] || key}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-stone-500">{count} ({pct}%)</span>
                    </li>
                  );
                })}
            </ul>
          </>
        )}
      </section>

      {feed && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-semibold text-stone-900">Meta catalogue feed (Instagram, Facebook, WhatsApp)</h3>
          {!feed.enabled ? (
            <p className="mt-2 text-sm text-stone-600">
              Switched off. Set <code className="rounded bg-stone-100 px-1">META_FEED_KEY</code> (a long random secret) and <code className="rounded bg-stone-100 px-1">PUBLIC_BASE_URL</code> on the server to turn it on.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-stone-600">
                Paste this address into Meta Commerce Manager as a scheduled feed (daily). {feed.included} product{feed.included === 1 ? ' is' : 's are'} complete enough to be in it;
                {' '}{feed.skipped} approved product{feed.skipped === 1 ? ' is' : 's are'} left out for lacking a price, photo or description.
              </p>
              <input readOnly value={feed.url ?? ''} onFocus={(e) => e.currentTarget.select()} aria-label="Feed address" className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 font-mono text-xs" />
              <p className="mt-2 text-xs text-stone-500">Treat the address like a password: it contains the feed key.</p>
              {!feed.hasPublicBaseUrl && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">PUBLIC_BASE_URL is not set, so photo links use this page&apos;s address. Set it to the public address of the studio.</p>}
              {!feed.hasLinkBase && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">CATALOG_LINK_BASE is not set, so the feed&apos;s product link column is empty. Meta requires a link to the product on the store&apos;s website for Instagram/Facebook shops.</p>}
            </>
          )}
        </section>
      )}

      {daily && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-semibold text-stone-900">Today&apos;s summary</h3>
          <p className="mt-1 text-xs text-stone-500">The day so far, ready to send. Copy it, or open it straight into WhatsApp.</p>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 font-sans text-sm text-stone-800">{daily.text}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(daily.text);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 3000);
                } catch {
                  setCopied(false);
                }
              }}
              className="min-h-[44px] rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(daily.text)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Send on WhatsApp
            </a>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="font-semibold text-stone-900">Staff scorecard</h3>
        <p className="mt-1 text-xs text-stone-500">
          How each person&apos;s shoots turned out in the last {data.windowDays} days. A coaching tool: with few pieces the rates mean little, so read the counts first.
        </p>
        {data.staff.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Nothing shot in this period yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="pb-2">Name</th><th className="pb-2">Shot</th><th className="pb-2">Approved</th>
                  <th className="pb-2">Reshoot</th><th className="pb-2">Asked for another photo</th><th className="pb-2">Approval</th><th className="pb-2">Most common problem</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.userId} className="border-b border-stone-100 align-top">
                    <td className="py-2 font-medium text-stone-800">{s.name}</td>
                    <td className="py-2">{s.shot}</td>
                    <td className="py-2">{s.approved}</td>
                    <td className="py-2">{s.reshoot}</td>
                    <td className="py-2">{s.needAngle}</td>
                    <td className="py-2">
                      {s.approvalRate === null ? '—' : `${s.approvalRate}%`}
                      {s.fewShots && <span className="ml-1 text-[11px] text-stone-400">(few pieces)</span>}
                    </td>
                    <td className="py-2 text-stone-600">
                      {s.topIssue ? `${AUDIT_CHECK_FAILURE_LABELS[s.topIssue.check] ?? s.topIssue.check} (${s.topIssue.count})` : '—'}
                      {s.topIssue && COACHING[s.topIssue.check] && <span className="block text-[11px] text-stone-400">{COACHING[s.topIssue.check]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dupes && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-semibold text-stone-900">Possible duplicates in the catalogue</h3>
          <p className="mt-1 text-xs text-stone-500">Pieces whose studio photos look alike - the same design shot twice, or several lots of one design. Nothing is deleted automatically.</p>
          {dupes.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">None found.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {dupes.map((p) => (
                <li key={`${p.a.productId}-${p.b.productId}`}>
                  <SimilarList matches={[{ ...p.a, score: p.score, tier: p.tier }, { ...p.b, score: p.score, tier: p.tier }]} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="font-semibold text-stone-900">Approval rate by category</h3>
        <p className="mt-1 text-xs text-stone-500">
          Approved vs sent back for reshoot, last {data.windowDays} days. Weakest categories first - those are the ones to fix or shoot differently. Pieces still waiting are not counted.
        </p>
        {data.outcomes.byCategory.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">Nothing shot in this period yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="pb-2">Category</th><th className="pb-2">Shot</th><th className="pb-2">Approved</th>
                  <th className="pb-2">Reshoot</th><th className="pb-2">Approval</th><th className="pb-2">Avg risk</th>
                </tr>
              </thead>
              <tbody>
                {data.outcomes.byCategory.map((g) => (
                  <tr key={g.label} className="border-b border-stone-100">
                    <td className="py-2 font-medium text-stone-800">{g.label}</td>
                    <td className="py-2">{g.total}</td>
                    <td className="py-2">{g.approved}</td>
                    <td className="py-2">{g.reshoot}</td>
                    <td className={`py-2 font-medium ${g.approvalRate !== null && g.approvalRate < 60 ? 'text-red-700' : 'text-stone-800'}`}>
                      {g.approvalRate === null ? '—' : `${g.approvalRate}%`}
                    </td>
                    <td className="py-2 text-stone-500">{g.avgRisk ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.outcomes.byRiskTier.length > 0 && (
          <p className="mt-3 text-xs text-stone-500">
            By risk score:{' '}
            {data.outcomes.byRiskTier.map((g) => `${g.label} ${g.approvalRate === null ? '—' : `${g.approvalRate}%`} approved (${g.total})`).join(' · ')}.
            If high-risk pieces are not approved less often, the score needs retuning.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="mb-3 font-semibold text-stone-900">Per-stage performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="pb-2">Stage</th><th className="pb-2">Calls</th>
                <th className="pb-2">Failures</th><th className="pb-2">Timeouts</th><th className="pb-2">Avg</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.stageLatency).map(([stage, s]) => (
                <tr key={stage} className="border-b border-stone-100">
                  <td className="py-2 font-medium text-stone-800">{stage}</td>
                  <td className="py-2 text-stone-600">{s.calls}</td>
                  <td className={`py-2 ${s.failures > 0 ? 'text-red-600' : 'text-stone-600'}`}>{s.failures}</td>
                  <td className={`py-2 ${s.timeouts > 0 ? 'text-amber-600' : 'text-stone-600'}`}>{s.timeouts}</td>
                  <td className="py-2 text-stone-600">{(s.avgLatencyMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
              {Object.keys(data.stageLatency).length === 0 && (
                <tr><td colSpan={5} className="py-4 text-stone-500">No calls recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Queue" value={`${data.system.queue.queued} waiting`} sub={`${data.system.queue.running} running, ${data.system.queue.failed} failed`} />
        <Stat label="Photos stored" value={data.system.storage.photoCount} sub={`${(data.system.storage.totalBytes / 1024 / 1024).toFixed(0)} MB on disk`} />
        <Stat label="Catalogue" value={data.system.cpcMaster.totalProducts} sub={`${data.system.cpcMaster.totalRows} rows`} />
        <Stat label="ERP format" value={data.system.erpMapping} sub={data.system.axiomMirror ? 'Axiom mirror on' : 'local log only'} />
      </section>
    </div>
  );
};

const StaffPanel: React.FC = () => {
  const [users, setUsers] = useState<(SessionUser & { isActive: boolean; lastLoginAt: string | null })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ username: string; password: string; displayName: string; role: Role }>({ username: '', password: '', displayName: '', role: 'photographer' });
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers((await api.listUsers()).users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      await api.createUser(form);
      setNotice(`Created ${form.username}.`);
      setForm({ username: '', password: '', displayName: '', role: 'photographer' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that account.');
    }
  }, [form, load]);

  const toggleActive = useCallback(async (user: SessionUser & { isActive: boolean }) => {
    setError(null);
    try {
      await api.updateUser(user.id, { isActive: !user.isActive });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that account.');
    }
  }, [load]);

  const submitReset = useCallback(async (user: SessionUser) => {
    setError(null);
    try {
      await api.updateUser(user.id, { password: resetPassword });
      setNotice(`Password reset for ${user.username}.`);
      setResettingId(null);
      setResetPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset that password.');
    }
  }, [resetPassword]);

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <Check className="w-4 h-4" /> {notice}
        </div>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="mb-1 font-semibold text-stone-900">Add a staff account</h3>
        <p className="mb-4 text-xs text-stone-500">
          Give every person their own login. The name on each product comes from whoever is signed in, so shared accounts
          make the record meaningless.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Username"
            aria-label="Username"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="Display name"
            aria-label="Display name"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Password (10+ characters)"
            aria-label="Password"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <label className="flex flex-col gap-1 text-sm text-stone-700">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="photographer">Photographer - shoots only, cannot approve</option>
              <option value="manager">Manager - approves, exports, shares</option>
              <option value="admin">Admin - everything, including staff and insights</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={!form.username || !form.password}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-800 disabled:bg-stone-300"
        >
          <UserPlus className="w-4 h-4" /> Create account
        </button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        {/* min-w forces horizontal scroll on a phone-width screen instead of
            clipping columns - the outer section's overflow-hidden is only for
            the rounded corners and must not be what contains this table. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Last signed in</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <React.Fragment key={user.id}>
                  <tr className="border-t border-stone-100">
                    <td className="px-4 py-3">
                      <span className="font-medium text-stone-900">{user.displayName}</span>
                      <span className="ml-2 text-xs text-stone-500">{user.username}</span>
                      {!user.isActive && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">disabled</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      <select
                        value={user.role}
                        aria-label={`Role for ${user.username}`}
                        onChange={async (e) => {
                          try {
                            await api.updateUser(user.id, { role: e.target.value });
                            await load();
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : 'Could not change that role.');
                          }
                        }}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-sm"
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-stone-500">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('en-IN') : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setResettingId(resettingId === user.id ? null : user.id);
                          setResetPassword('');
                        }}
                        className="-my-2 min-h-[44px] px-2 py-2 text-xs text-stone-600 underline hover:text-stone-900"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(user)}
                        className="-my-2 min-h-[44px] px-2 py-2 text-xs text-stone-600 underline hover:text-stone-900"
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                  {resettingId === user.id && (
                    <tr className="border-t border-stone-100 bg-stone-50">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <KeyRound className="w-4 h-4 text-stone-400" />
                          <input
                            type="password"
                            autoFocus
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            placeholder="New password (10+ characters)"
                            aria-label={`New password for ${user.username}`}
                            className="min-h-[44px] flex-1 min-w-[200px] rounded-lg border border-stone-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => submitReset(user)}
                            disabled={resetPassword.length < 10}
                            className="min-h-[44px] rounded-lg bg-stone-900 px-4 text-sm text-white hover:bg-stone-800 disabled:bg-stone-300"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => { setResettingId(null); setResetPassword(''); }}
                            className="min-h-[44px] px-3 text-sm text-stone-600 hover:text-stone-900"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const PromptPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const state = await api.getPrompt();
    setPrompt(state.prompt);
    setIsCustom(state.isCustom);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const state = await api.savePrompt(prompt);
      setIsCustom(state.isCustom);
      setNotice('Saved. This applies to every photo processed from now on, on every device.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the prompt.');
    } finally {
      setSaving(false);
    }
  }, [prompt]);

  const reset = useCallback(async () => {
    const state = await api.resetPrompt();
    setPrompt(state.prompt);
    setIsCustom(false);
    setNotice('Reset to the default prompt.');
  }, []);

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <Check className="w-4 h-4" /> {notice}
        </div>
      )}

      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        <strong>Careful.</strong> Every clause in the default prompt is there because of a specific failure seen in real
        output — invented engravings, kinked jhumka chains, patchy colour on motifs. Edit it to lock in RL Jewels' house
        style (background, shadow, crop), not to shorten it.
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-600">{isCustom ? 'Using a customised prompt.' : 'Using the default prompt.'}</span>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-sm text-stone-600 underline hover:text-stone-900"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset to default
        </button>
      </div>

      <label htmlFor="prompt" className="sr-only">Enhance prompt</label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={24}
        className="w-full rounded-xl border border-stone-300 p-4 font-mono text-xs leading-relaxed"
      />

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save prompt'}
      </button>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-2xl border border-stone-200 bg-white p-4">
    <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
    {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
  </div>
);

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{message}</span>
  </div>
);
