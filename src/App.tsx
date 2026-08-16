import React, { useState, useEffect } from 'react';
import {
  GoldPurity,
  ProductGender,
  PhotoItem,
  ProductRecord,
  ReviewDecision,
  UserSession,
  ProcessingStage,
} from './types';
import { Header } from './components/Header';
import { ProductForm } from './components/ProductForm';
import { UploadPhotosStep } from './components/UploadPhotosStep';
import { ReviewStep } from './components/ReviewStep';
import { ExportStep } from './components/ExportStep';
import { LoginModal, getStoredUserSession, saveStoredUserSession } from './components/LoginModal';
import { useNetworkStatus } from './utils/useNetworkStatus';
import { getStoredPromptConfig } from './utils/promptSettings';
import { logClientEvent } from './utils/analytics';
import { WifiOff } from 'lucide-react';

function createInitialPhoto(): PhotoItem {
  return {
    id: 'product_photo',
    title: 'Product Photo',
    originalImage: '',
    mimeType: 'image/jpeg',
    status: 'idle',
    reviewDecision: 'pending',
  };
}

export default function App() {
  const { isOnline } = useNetworkStatus();

  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => getStoredUserSession());
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(() => !getStoredUserSession());
  const [currentStep, setCurrentStep] = useState<'capture' | 'details' | 'review' | 'export'>('capture');
  const [hasApiKey, setHasApiKey] = useState(true);

  const [cpc, setCpc] = useState('RLJ-RN-8821');
  const [productName, setProductName] = useState('22kt Solitaire Floral Diamond Ring');
  const [itemType, setItemType] = useState('ring');
  const [purity, setPurity] = useState<GoldPurity>('22kt');
  const [gender, setGender] = useState<ProductGender>("women's");
  const [grossWeight, setGrossWeight] = useState('6.450');
  const [otherWeight, setOtherWeight] = useState('0.210');
  const [netWeight, setNetWeight] = useState('6.240');
  const [size, setSize] = useState('DEFAULT');
  const [staffName, setStaffName] = useState(currentUser?.username || 'admin');

  const [photo, setPhoto] = useState<PhotoItem>(createInitialPhoto());

  useEffect(() => {
    if (currentUser?.username) {
      setStaffName(currentUser.username);
    }
  }, [currentUser]);

  // Verify the server session cookie is actually valid on load - the localStorage
  // copy is just a display convenience and can go stale (e.g. server restarted).
  useEffect(() => {
    fetch('/api/session')
      .then((res) => {
        if (!res.ok) throw new Error('not signed in');
        return res.json();
      })
      .then((data) => {
        const session: UserSession = {
          username: data.username,
          isAdmin: data.isAdmin,
          loggedInAt: new Date().toISOString(),
        };
        setCurrentUser(session);
        saveStoredUserSession(session);
        setIsLoginModalOpen(false);
      })
      .catch(() => {
        setCurrentUser(null);
        saveStoredUserSession(null);
        setIsLoginModalOpen(true);
      });
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.hasApiKey === 'boolean') {
          setHasApiKey(data.hasApiKey);
        }
      })
      .catch((err) => console.log('Health check note:', err));
  }, []);

  // Records the staff funnel through the wizard - which steps get reached,
  // and (via /api/analytics/summary) where people stall out. Fires on every
  // step change, not just forward progress, since going back is signal too.
  useEffect(() => {
    logClientEvent('step_view', { step: currentStep, itemType, photoStatus: photo.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const handleLoginSuccess = (session: UserSession) => {
    setCurrentUser(session);
    setStaffName(session.username);
    setIsLoginModalOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    saveStoredUserSession(null);
    setCurrentUser(null);
    setIsLoginModalOpen(true);
  };

  const handleUpdatePhoto = (dataUrl: string, options?: { isSample?: boolean }) => {
    setPhoto((prev) => ({
      ...prev,
      originalImage: dataUrl,
      status: 'idle',
      reviewDecision: 'pending',
      reshootReason: undefined,
      failureReason: undefined,
      processedImage: undefined,
      isSample: Boolean(options?.isSample),
    }));
  };

  const handleRemovePhoto = () => {
    setPhoto(createInitialPhoto());
  };

  // Streams newline-delimited progress events from the server (stage names as
  // each pipeline step starts) so the UI can show real progress instead of a
  // spinner, then resolves with the final {..., done:true} result line.
  const runPipeline = async (activePhoto: PhotoItem, onStage: (stage: ProcessingStage) => void) => {
    const promptConfig = getStoredPromptConfig();
    const res = await fetch('/api/audit-and-enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: activePhoto.originalImage,
        itemType,
        purity,
        gender,
        sku: cpc,
        cpc,
        weight: netWeight || grossWeight,
        customEnhancePrompt: promptConfig.enhancePrompt,
      }),
    });

    if (res.status === 401) {
      setIsLoginModalOpen(true);
      throw new Error('Session expired');
    }

    if (!res.body) {
      return res.json();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.done) {
          finalPayload = event;
        } else if (event.stage) {
          onStage(event.stage);
        }
      }
    }

    return finalPayload || {
      status: 'failed',
      reason: 'Connection closed before a result came back. Please try again.',
      retryable: true,
    };
  };

  // Shared by the initial run and every regenerate/retry so the three result
  // branches (approved / needs_reshoot / failed) are only written once.
  const applyPipelineResult = (data: any) => {
    if (data.status === 'needs_reshoot') {
      setPhoto((prev) => ({
        ...prev,
        status: 'needs_reshoot',
        reshootReason: data.reason || 'Photo did not meet quality standards. Please reshoot.',
        reviewDecision: 'pending',
        processingStage: undefined,
      }));
    } else if (data.status === 'approved') {
      setPhoto((prev) => ({
        ...prev,
        status: 'approved',
        processedImage: data.processedImageBase64,
        confidenceScore: data.confidence,
        reviewDecision: 'approved',
        modelUsed: data.modelUsed,
        attemptCount: data.attemptCount,
        processingStage: undefined,
      }));
    } else {
      setPhoto((prev) => ({
        ...prev,
        status: 'failed',
        failureReason: data.reason || 'Enhancement failed. Please try again.',
        debugDetail: data.debugDetail,
        reviewDecision: 'pending',
        processingStage: undefined,
      }));
    }
  };

  // Sample/demo photos never touch the paid API - approve them locally so
  // testing or demoing the flow never costs a real Gemini call.
  const approveSampleLocally = () => {
    setPhoto((prev) => ({
      ...prev,
      status: 'approved',
      processedImage: prev.originalImage,
      reviewDecision: 'approved',
      modelUsed: 'demo-sample',
      attemptCount: 0,
    }));
  };

  // Fires the moment a photo is captured - runs in the background while staff
  // moves straight on to the Details step and keeps typing. No more full-
  // screen blocking wait: the ProcessingStatusCard on Details (and Review, as
  // a safety net) reflects live progress via photo.status/processingStage.
  const handleSubmitForProcessing = async () => {
    if (!photo.originalImage) return;

    if (photo.isSample) {
      approveSampleLocally();
      setCurrentStep('details');
      return;
    }

    setPhoto((prev) => ({ ...prev, status: 'processing', processingStage: undefined }));
    setCurrentStep('details');

    try {
      const data = await runPipeline(photo, (stage) => {
        setPhoto((prev) => ({ ...prev, processingStage: stage }));
      });
      applyPipelineResult(data);
    } catch (err: any) {
      console.error('Processing error:', err);
      logClientEvent('pipeline_error', { context: 'submit', message: String(err?.message || err) });
      setPhoto((prev) => ({
        ...prev,
        status: 'failed',
        failureReason: 'Could not reach the server. Check your connection and try again.',
        reviewDecision: 'pending',
        processingStage: undefined,
      }));
    }
  };

  const handleRegeneratePhoto = async () => {
    if (!photo.originalImage) return;

    if (photo.isSample) {
      approveSampleLocally();
      return;
    }

    setPhoto((prev) => ({ ...prev, status: 'processing', reviewDecision: 'regenerating', processingStage: undefined }));

    try {
      const data = await runPipeline(photo, (stage) => {
        setPhoto((prev) => ({ ...prev, processingStage: stage }));
      });
      applyPipelineResult(data);
    } catch (err: any) {
      console.error('Regenerate error:', err);
      logClientEvent('pipeline_error', { context: 'regenerate', message: String(err?.message || err) });
      setPhoto((prev) => ({
        ...prev,
        status: 'failed',
        failureReason: 'Could not reach the server. Check your connection and try again.',
        reviewDecision: 'pending',
        processingStage: undefined,
      }));
    }
  };

  const handleRetakePhoto = (newDataUrl: string) => {
    setPhoto((prev) => ({
      ...prev,
      originalImage: newDataUrl,
      status: 'idle',
      processedImage: undefined,
      reshootReason: undefined,
      failureReason: undefined,
      reviewDecision: 'pending',
      isSample: false,
    }));
    setTimeout(() => {
      handleRegeneratePhoto();
    }, 100);
  };

  const [productDescription, setProductDescription] = useState('');
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const [copyGeneratedForImage, setCopyGeneratedForImage] = useState<string | null>(null);
  // Immutable snapshot of what the model generated, kept purely so a later
  // edit can be measured against it - productName/productDescription
  // themselves get overwritten the moment staff edit the fields.
  const [generatedCopyBaseline, setGeneratedCopyBaseline] = useState<{ name: string; description: string } | null>(null);

  // Writes a customer-facing name + description once staff actually approve a
  // photo - not on every AI pass, since plenty of AI-approved photos get
  // regenerated or retaken before a human signs off, and there's no reason to
  // spend a call writing copy for a photo that might not ship.
  const generateProductCopy = async (force = false) => {
    if (!photo.processedImage || photo.isSample) return;
    if (!force && copyGeneratedForImage === photo.processedImage) return;

    setIsGeneratingCopy(true);
    setCopyGeneratedForImage(photo.processedImage);
    try {
      const res = await fetch('/api/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photo.processedImage,
          itemType,
          purity,
          gender,
          weight: netWeight || grossWeight,
          size,
        }),
      });
      if (res.status === 401) {
        setIsLoginModalOpen(true);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setProductName(data.name);
        setProductDescription(data.description);
        setGeneratedCopyBaseline({ name: data.name, description: data.description });
      }
    } catch (err: any) {
      console.error('generate-copy error:', err);
      logClientEvent('copy_error', { message: String(err?.message || err) });
    } finally {
      setIsGeneratingCopy(false);
    }
  };

  const handleUpdateReviewDecision = (decision: ReviewDecision) => {
    setPhoto((prev) => ({ ...prev, reviewDecision: decision }));
    logClientEvent('review_decision', {
      decision,
      auditModelUsed: photo.modelUsed,
      auditAttemptCount: photo.attemptCount,
      isSample: photo.isSample,
    });
    if (decision === 'approved') {
      generateProductCopy();
    }
  };

  const handleProceedToExport = () => {
    if (generatedCopyBaseline) {
      logClientEvent('copy_edited', {
        nameChanged: productName !== generatedCopyBaseline.name,
        descriptionChanged: productDescription !== generatedCopyBaseline.description,
      });
    }
    setCurrentStep('export');
  };

  const handleStartNewProduct = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setCpc(`RLJ-RN-${randomNum}`);
    setProductName('');
    setItemType('ring');
    setPurity('22kt');
    setGender("women's");
    setSize('DEFAULT');
    setGrossWeight('8.500');
    setOtherWeight('0.250');
    setNetWeight('8.250');
    setProductDescription('');
    setCopyGeneratedForImage(null);
    setGeneratedCopyBaseline(null);
    setPhoto(createInitialPhoto());
    setCurrentStep('capture');
  };

  const currentProductRecord: ProductRecord = {
    id: `prod_${cpc}`,
    sku: cpc,
    cpc,
    name: productName,
    description: productDescription,
    itemType,
    purity,
    gender,
    size,
    grossWeightGrams: grossWeight,
    otherWeightGrams: otherWeight,
    netWeightGrams: netWeight,
    weightGrams: netWeight || grossWeight,
    staffName,
    createdAt: new Date().toISOString(),
    photo,
    overallStatus: currentStep === 'export' ? 'exported' : 'reviewed',
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-stone-900 flex flex-col font-sans selection:bg-red-600 selection:text-white">
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
        hasApiKey={hasApiKey}
        isOnline={isOnline}
      />

      <main className="flex-1 max-w-4xl w-full mx-auto p-3 sm:p-5 lg:p-6">
        {!isOnline && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-2xl p-3.5 sm:p-4 text-amber-950 flex items-center gap-3 text-xs shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0">
              <WifiOff className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <span className="font-bold text-sm text-amber-900 block">You're offline</span>
              <span className="text-amber-800 text-xs">
                Photo capture works, but enhancement needs a connection. Reconnect before submitting.
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2 mb-4 sm:mb-6">
            <div className="bg-white border border-stone-200 shadow-xs rounded-2xl p-1.5 sm:p-2.5 flex items-center justify-between gap-1 overflow-x-auto scrollbar-none text-xs">
              {(['capture', 'details', 'review', 'export'] as const).map((step, idx) => {
                const labels: Record<typeof step, string> = {
                  capture: 'Capture Photo',
                  details: 'Product Details',
                  review: 'Review',
                  export: 'Export',
                };
                const isActive = currentStep === step;
                const isClickable = step === 'capture' || step === 'details' || (step === 'review' && photo.status !== 'idle') || (step === 'export' && photo.reviewDecision === 'approved');
                return (
                  <React.Fragment key={step}>
                    {idx > 0 && <div className="w-3 sm:w-4 h-[1px] bg-stone-200 shrink-0" />}
                    <button
                      type="button"
                      disabled={!isClickable}
                      onClick={() => setCurrentStep(step)}
                      className={`min-h-[44px] flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-[11px] sm:text-xs shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        isActive ? 'bg-red-600 text-white shadow-xs' : 'text-stone-500 hover:text-stone-900'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isActive ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                      }`}>{idx + 1}</span>
                      <span>{labels[step]}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

        {currentStep === 'capture' && (
          <UploadPhotosStep
            cpc={cpc}
            productName={productName}
            itemType={itemType}
            setItemType={setItemType}
            purity={purity}
            gender={gender}
            netWeight={netWeight}
            photo={photo}
            onUpdatePhoto={handleUpdatePhoto}
            onRemovePhoto={handleRemovePhoto}
            onSubmitForProcessing={handleSubmitForProcessing}
          />
        )}

        {currentStep === 'details' && (
          <ProductForm
            cpc={cpc}
            setCpc={setCpc}
            productName={productName}
            setProductName={setProductName}
            itemType={itemType}
            setItemType={setItemType}
            purity={purity}
            setPurity={setPurity}
            gender={gender}
            setGender={setGender}
            size={size}
            setSize={setSize}
            grossWeight={grossWeight}
            setGrossWeight={setGrossWeight}
            otherWeight={otherWeight}
            setOtherWeight={setOtherWeight}
            netWeight={netWeight}
            setNetWeight={setNetWeight}
            staffName={staffName}
            setStaffName={setStaffName}
            photo={photo}
            onRetryProcessing={handleSubmitForProcessing}
            onProceed={() => setCurrentStep('review')}
          />
        )}

        {currentStep === 'review' && (
          <ReviewStep
            sku={cpc}
            cpc={cpc}
            productName={productName}
            setProductName={setProductName}
            productDescription={productDescription}
            setProductDescription={setProductDescription}
            isGeneratingCopy={isGeneratingCopy}
            onRegenerateCopy={() => generateProductCopy(true)}
            itemType={itemType}
            purity={purity}
            gender={gender}
            photo={photo}
            onUpdateReviewDecision={handleUpdateReviewDecision}
            onRegeneratePhoto={handleRegeneratePhoto}
            onRetakePhoto={handleRetakePhoto}
            onBackToPhotos={() => setCurrentStep('capture')}
            onProceedToExport={handleProceedToExport}
          />
        )}

        {currentStep === 'export' && (
          <ExportStep product={currentProductRecord} onStartNewProduct={handleStartNewProduct} />
        )}
      </main>

      <footer className="border-t border-stone-200 bg-white text-stone-500 text-[11px] py-2.5 sm:py-3 text-center px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 font-medium">
          <span>RL Jewels Photo Studio • Internal Store Management</span>
          <span className="text-stone-400">Authorized Personnel: {currentUser?.username || 'Staff'}</span>
        </div>
      </footer>

      <LoginModal isOpen={isLoginModalOpen} onLoginSuccess={handleLoginSuccess} />
    </div>
  );
}