import React, { useEffect, useState } from 'react';
import { X, BarChart3, RefreshCw, TrendingUp, Clock, DollarSign, ScanLine, Smartphone, AlertTriangle } from 'lucide-react';

interface AnalyticsSummary {
  windowDays: number;
  generatedAt: string;
  totalEventsLogged: number;
  pipeline: {
    totalRuns: number;
    approved: number;
    needsReshoot: number;
    failed: number;
    approvalRate: number | null;
    reshootRate: number | null;
    failureRate: number | null;
    escalationRate: number | null;
    avgLatencyMs: number | null;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  apiCalls: {
    total: number;
    failed: number;
    timedOut: number;
    failureRate: number | null;
    timeoutRate: number | null;
  };
  cost: {
    estimatedTotalUsd: number;
    estimatedAvgPerApprovedUsd: number | null;
    note: string;
  };
  qualityChecklist: {
    failCounts: Record<string, number>;
    note: string;
  };
  ocr: {
    tagScansAttempted: number;
    tagScansApplied: number;
    fieldCorrections: Record<string, number>;
    note: string;
  };
  funnel: {
    stepViews: Record<string, number>;
    retakes: number;
    captureByMethod: Record<string, number>;
  };
  device: {
    mobileViewShare: number | null;
  };
  copy: {
    reviewedAfterApproval: number;
    editedCount: number;
    editRate: number | null;
  };
  drive: {
    attempts: number;
    successes: number;
    successRate: number | null;
  };
  auth: {
    loginSuccesses: number;
    loginFailures: number;
  };
}

interface AdminInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const fmtMs = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
};

const StatTile: React.FC<{ label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }> = ({
  label,
  value,
  sub,
  tone = 'default',
}) => {
  const toneClasses: Record<string, string> = {
    default: 'bg-white border-stone-200 text-stone-900',
    good: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    bad: 'bg-red-50 border-red-200 text-red-900',
  };
  return (
    <div className={`rounded-2xl border p-3.5 ${toneClasses[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-xl font-serif italic font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] mt-0.5 opacity-70 font-medium">{sub}</div>}
    </div>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-700 mt-5 mb-2">
    {icon}
    <span>{children}</span>
  </div>
);

export const AdminInsightsModal: React.FC<AdminInsightsModalProps> = ({ isOpen, onClose }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = (windowDays: number) => {
    setLoading(true);
    setError('');
    fetch(`/api/analytics/summary?days=${windowDays}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 403 ? 'Admin access required.' : 'Could not load analytics.');
        return res.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err.message || 'Could not load analytics.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const topChecklistFails = data
    ? Object.entries(data.qualityChecklist.failCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];
  const topFieldCorrections = data
    ? Object.entries(data.ocr.fieldCorrections).sort((a, b) => b[1] - a[1])
    : [];
  const stepViewEntries = data ? Object.entries(data.funnel.stepViews) : [];
  const captureMethodEntries = data ? Object.entries(data.funnel.captureByMethod) : [];

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-stone-200 rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shadow-xs">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-stone-900 text-base sm:text-lg">Studio Insights</h3>
                <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-amber-300">
                  Admin Only
                </span>
              </div>
              <p className="text-xs text-stone-500 font-medium">
                Reliability, cost, and quality trends drawn straight from the logged event history.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Window selector */}
        <div className="px-4 sm:px-6 pt-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-xl border border-stone-200">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDays(d);
                  load(d);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  days === d ? 'bg-white text-red-600 shadow-xs border border-stone-200' : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                Last {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load(days)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-1 flex-1">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-xl flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {loading && !data && <div className="text-center py-10 text-stone-400 text-sm">Loading…</div>}

          {data && (
            <>
              {data.totalEventsLogged === 0 ? (
                <div className="text-center py-10 text-stone-400 text-sm">
                  No events logged yet in this window - process a product to start building history.
                </div>
              ) : (
                <>
                  <SectionTitle icon={<TrendingUp className="w-3.5 h-3.5 text-red-600" />}>Pipeline Outcomes</SectionTitle>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <StatTile label="Total Runs" value={String(data.pipeline.totalRuns)} />
                    <StatTile label="Approval Rate" value={fmtPct(data.pipeline.approvalRate)} tone="good" />
                    <StatTile label="Reshoot Rate" value={fmtPct(data.pipeline.reshootRate)} tone={data.pipeline.reshootRate && data.pipeline.reshootRate > 0.2 ? 'warn' : 'default'} />
                    <StatTile label="Failure Rate" value={fmtPct(data.pipeline.failureRate)} tone={data.pipeline.failureRate && data.pipeline.failureRate > 0.1 ? 'bad' : 'default'} />
                  </div>

                  <SectionTitle icon={<Clock className="w-3.5 h-3.5 text-red-600" />}>Speed & Reliability</SectionTitle>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <StatTile label="Avg Latency" value={fmtMs(data.pipeline.avgLatencyMs)} />
                    <StatTile label="P95 Latency" value={fmtMs(data.pipeline.p95LatencyMs)} sub="worst-case, typical run" />
                    <StatTile label="Escalation Rate" value={fmtPct(data.pipeline.escalationRate)} sub="needed the premium retry" />
                    <StatTile label="API Timeout Rate" value={fmtPct(data.apiCalls.timeoutRate)} tone={data.apiCalls.timeoutRate && data.apiCalls.timeoutRate > 0.05 ? 'warn' : 'default'} />
                  </div>

                  <SectionTitle icon={<DollarSign className="w-3.5 h-3.5 text-red-600" />}>Estimated Cost</SectionTitle>
                  <div className="grid grid-cols-2 gap-2.5">
                    <StatTile label={`Total (${data.windowDays}d)`} value={`$${data.cost.estimatedTotalUsd.toFixed(2)}`} />
                    <StatTile
                      label="Avg / Approved Product"
                      value={data.cost.estimatedAvgPerApprovedUsd !== null ? `$${data.cost.estimatedAvgPerApprovedUsd.toFixed(3)}` : '—'}
                    />
                  </div>
                  <p className="text-[10px] text-stone-400 mt-1.5 px-0.5">{data.cost.note}</p>

                  {topChecklistFails.length > 0 && (
                    <>
                      <SectionTitle icon={<AlertTriangle className="w-3.5 h-3.5 text-red-600" />}>
                        Most Common Quality Check Failures
                      </SectionTitle>
                      <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 space-y-2">
                        {topChecklistFails.map(([check, count]) => (
                          <div key={check} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-stone-700">{check}</span>
                            <span className="font-bold text-stone-900 bg-white border border-stone-200 rounded-full px-2 py-0.5">
                              {count}×
                            </span>
                          </div>
                        ))}
                        <p className="text-[10px] text-stone-400 pt-1">{data.qualityChecklist.note}</p>
                      </div>
                    </>
                  )}

                  <SectionTitle icon={<ScanLine className="w-3.5 h-3.5 text-red-600" />}>Tag Scanning & OCR</SectionTitle>
                  <div className="grid grid-cols-2 gap-2.5">
                    <StatTile label="Tag Scans Attempted" value={String(data.ocr.tagScansAttempted)} />
                    <StatTile label="Applied to Form" value={String(data.ocr.tagScansApplied)} />
                  </div>
                  {topFieldCorrections.length > 0 && (
                    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 space-y-2 mt-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Field Corrections After Scan</span>
                      {topFieldCorrections.map(([field, count]) => (
                        <div key={field} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-stone-700">{field}</span>
                          <span className="font-bold text-stone-900 bg-white border border-stone-200 rounded-full px-2 py-0.5">
                            {count}×
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-stone-400 pt-1">{data.ocr.note}</p>
                    </div>
                  )}

                  <SectionTitle icon={<Smartphone className="w-3.5 h-3.5 text-red-600" />}>Usage & Funnel</SectionTitle>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <StatTile label="Mobile Share" value={fmtPct(data.device.mobileViewShare)} />
                    <StatTile label="Retakes" value={String(data.funnel.retakes)} />
                    <StatTile label="Copy Edit Rate" value={fmtPct(data.copy.editRate)} sub="staff rewrote generated copy" />
                  </div>
                  {stepViewEntries.length > 0 && (
                    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {stepViewEntries.map(([step, count]) => (
                        <div key={step} className="text-center">
                          <div className="font-bold text-stone-900 text-sm">{count}</div>
                          <div className="text-[10px] text-stone-500 capitalize">{step}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {captureMethodEntries.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {captureMethodEntries.map(([method, count]) => (
                        <span key={method} className="text-[11px] bg-white border border-stone-200 rounded-full px-2.5 py-1 text-stone-600 font-medium">
                          {method}: <strong className="text-stone-900">{count}</strong>
                        </span>
                      ))}
                    </div>
                  )}

                  {data.drive.attempts > 0 && (
                    <>
                      <SectionTitle icon={<TrendingUp className="w-3.5 h-3.5 text-red-600" />}>Google Drive Export</SectionTitle>
                      <div className="grid grid-cols-2 gap-2.5">
                        <StatTile label="Attempts" value={String(data.drive.attempts)} />
                        <StatTile label="Success Rate" value={fmtPct(data.drive.successRate)} />
                      </div>
                    </>
                  )}

                  <p className="text-[10px] text-stone-400 mt-5 pt-3 border-t border-stone-100">
                    Generated {new Date(data.generatedAt).toLocaleString()} from {data.totalEventsLogged} logged events.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-stone-200 bg-stone-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
