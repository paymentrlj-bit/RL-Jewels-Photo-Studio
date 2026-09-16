import { useCallback, useEffect, useState } from 'react';
import { Camera, ClipboardCheck, PackageOpen, Settings, LogOut, WifiOff, AlertTriangle } from 'lucide-react';
import { api, ApiError, setUnauthorizedHandler } from './api';
import type { Batch, HealthFeatures, Product, QueueDepth, SessionUser } from './types';
import { ShootView } from './views/ShootView';
import { ReviewView } from './views/ReviewView';
import { ExportView } from './views/ExportView';
import { AdminView } from './views/AdminView';
import { LoginView } from './views/LoginView';
import { BrandLogo } from './components/BrandLogo';
import { useNetworkStatus } from './utils/useNetworkStatus';

type Tab = 'shoot' | 'review' | 'export' | 'admin';

// How often the queue and product lists refresh. Three seconds is frequent
// enough that a finished photo appears while the staff member is still
// looking at the screen, and light enough that a day of polling is nothing.
const POLL_MS = 3000;

export default function App() {
  const { isOnline } = useNetworkStatus();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [features, setFeatures] = useState<HealthFeatures | null>(null);

  const [tab, setTab] = useState<Tab>('shoot');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [queue, setQueue] = useState<QueueDepth>({ queued: 0, running: 0, failed: 0 });
  const [error, setError] = useState<string | null>(null);

  // A 401 on any request drops straight back to sign-in, rather than leaving
  // an empty screen that silently fails every action.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    api.session().then(setUser).catch(() => setUser(null)).finally(() => setCheckingSession(false));
    api.health().then((h) => setFeatures(h.features)).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [productData, queueData] = await Promise.all([
        api.listProducts({ limit: 200 }),
        api.queueStatus(),
      ]);
      setProducts(productData.products);
      setQueue(queueData.depth);
      setError(null);
    } catch (err) {
      // A transient poll failure should not throw an error banner up over a
      // working screen - only a real, repeatable problem is worth surfacing.
      if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    api.currentBatch().then((data) => setBatch(data.batch)).catch(() => undefined);

    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [user, refresh]);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    setProducts([]);
  }, []);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    );
  }

  if (!user) return <LoginView onSignedIn={setUser} aiConfigured={features?.ai ?? true} />;

  const awaitingCount = products.filter((p) => p.status === 'awaiting_review').length;
  const problemCount = products.filter((p) => p.status === 'needs_reshoot' || p.status === 'failed').length;
  const recent = products.slice(0, 8);

  const tabs: { key: Tab; label: string; icon: typeof Camera; badge?: number; adminOnly?: boolean }[] = [
    { key: 'shoot', label: 'Shoot', icon: Camera },
    { key: 'review', label: 'Review', icon: ClipboardCheck, badge: awaitingCount + problemCount },
    { key: 'export', label: 'Export', icon: PackageOpen },
    { key: 'admin', label: 'Admin', icon: Settings, adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo />
            {batch && (
              <span className="hidden rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600 sm:inline">
                {batch.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden items-center gap-1.5 text-stone-500 sm:flex">
              <span className={`h-2 w-2 rounded-full ${queue.running > 0 ? 'animate-pulse bg-blue-500' : 'bg-stone-300'}`} />
              {queue.queued + queue.running > 0
                ? `${queue.queued + queue.running} processing`
                : 'Queue clear'}
            </span>
            <span className="text-stone-700">{user.displayName}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-stone-600 hover:bg-stone-100"
            >
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {tabs.filter((t) => !t.adminOnly || user.isAdmin).map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === key ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
              {badge ? (
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${tab === key ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!isOnline && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
            <WifiOff className="w-4 h-4" /> You are offline. Captures cannot be queued until the connection is back.
          </div>
        )}

        {features && !features.ai && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>GEMINI_API_KEY is not set on the server.</strong> Photos can be captured and will queue, but nothing
              will be processed until an admin sets the key and restarts.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {tab === 'shoot' && (
          <ShootView
            batch={batch}
            onQueued={refresh}
            recent={recent}
          />
        )}
        {tab === 'review' && <ReviewView products={products} onChanged={refresh} />}
        {tab === 'export' && <ExportView driveConfigured={features?.driveExport ?? false} />}
        {tab === 'admin' && user.isAdmin && <AdminView />}
      </main>
    </div>
  );
}
