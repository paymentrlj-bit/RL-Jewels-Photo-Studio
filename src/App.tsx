import React, { useState, useEffect } from 'react';
import {
  GoldPurity,
  ProductGender,
  PhotoItem,
  ProductRecord,
  ReviewDecision,
  TryonConfig,
  UserSession
} from './types';
import { Header } from './components/Header';
import { ProductForm } from './components/ProductForm';
import { UploadPhotosStep } from './components/UploadPhotosStep';
import { ProcessingStep } from './components/ProcessingStep';
import { ReviewStep } from './components/ReviewStep';
import { ExportStep } from './components/ExportStep';
import { AuditHistoryView } from './components/AuditHistoryView';
import { saveAuditLogEntry } from './utils/exportUtils';
import { LoginModal, getStoredUserSession, saveStoredUserSession } from './components/LoginModal';
import { loadProductDraft, saveProductDraft, clearProductDraft } from './utils/draftStorage';
import { useNetworkStatus } from './utils/useNetworkStatus';
import { retouchJewelryPhoto } from './utils/studioRetoucher';
import { CheckCircle2, RotateCcw, WifiOff } from 'lucide-react';

// Standard 5-slot capture structure
function createInitialPhotoSlots(): PhotoItem[] {
  return [
    {
      id: 'photo_hero',
      type: 'hero',
      title: '1. Hero Photo',
      description: 'Primary centerpiece shot. Flat-lay or pedestal display.',
      required: true,
      originalImage: '',
      mimeType: 'image/jpeg',
      status: 'idle',
      reviewDecision: 'pending',
    },
    {
      id: 'photo_angle_1',
      type: 'angle_1',
      title: '2. Front View (0°)',
      description: 'Direct straight-on eye-level view showing symmetry.',
      required: true,
      originalImage: '',
      mimeType: 'image/jpeg',
      status: 'idle',
      reviewDecision: 'pending',
    },
    {
      id: 'photo_angle_2',
      type: 'angle_2',
      title: '3. 45-Degree Angle',
      description: 'Shows 3D depth, stone elevation & side profile.',
      required: true,
      originalImage: '',
      mimeType: 'image/jpeg',
      status: 'idle',
      reviewDecision: 'pending',
    },
    {
      id: 'photo_angle_3',
      type: 'angle_3',
      title: '4. Side / Clasp / Back',
      description: 'Locking mechanism, screw, hinge, or back open-work.',
      required: false,
      originalImage: '',
      mimeType: 'image/jpeg',
      status: 'idle',
      reviewDecision: 'pending',
    },
    {
      id: 'photo_macro',
      type: 'macro_hallmark',
      title: '5. Macro Hallmark (Optional)',
      description: 'BIS 916 / 750 / HUID laser purity stamp.',
      required: false,
      originalImage: '',
      mimeType: 'image/jpeg',
      status: 'idle',
      reviewDecision: 'pending',
    },
  ];
}

export default function App() {
  const { isOnline } = useNetworkStatus();

  // Authentication state
  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => getStoredUserSession());
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(() => !getStoredUserSession());

  // Load existing persistent draft from LocalStorage
  const savedDraft = loadProductDraft();

  // Navigation & View Mode
  const [currentTab, setCurrentTab] = useState<'new' | 'history'>('new');
  const [currentStep, setCurrentStep] = useState<'form' | 'upload' | 'processing' | 'review' | 'export'>(
    () => (savedDraft?.currentStep === 'processing' ? 'upload' : savedDraft?.currentStep || 'form')
  );

  // Server health state
  const [hasApiKey, setHasApiKey] = useState(true);

  // Form state initialized from LocalStorage draft if available
  const [cpc, setCpc] = useState(() => savedDraft?.cpc || 'RLJ-RN-8821');
  const [productName, setProductName] = useState(() => savedDraft?.productName || '22kt Solitaire Floral Diamond Ring');
  const [itemType, setItemType] = useState(() => savedDraft?.itemType || 'ring');
  const [purity, setPurity] = useState<GoldPurity>(() => savedDraft?.purity || '22kt');
  const [gender, setGender] = useState<ProductGender>(() => savedDraft?.gender || "women's");
  const [grossWeight, setGrossWeight] = useState(() => savedDraft?.grossWeight || '6.450');
  const [otherWeight, setOtherWeight] = useState(() => savedDraft?.otherWeight || '0.210');
  const [netWeight, setNetWeight] = useState(() => savedDraft?.netWeight || '6.240');
  const [size, setSize] = useState(() => savedDraft?.size || 'DEFAULT');
  const [staffName, setStaffName] = useState(currentUser?.username || savedDraft?.staffName || 'admin');

  // Photos state initialized from LocalStorage draft
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    savedDraft?.photos && savedDraft.photos.length > 0 ? savedDraft.photos : createInitialPhotoSlots()
  );
  const [processingIndex, setProcessingIndex] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [lastAutoSaved, setLastAutoSaved] = useState<string | null>(() => savedDraft?.lastSavedAt || null);

  // Sync staffName when currentUser changes
  useEffect(() => {
    if (currentUser?.username) {
      setStaffName(currentUser.username);
    }
  }, [currentUser]);

  // LocalStorage Auto-Save Effect (Debounced)
  useEffect(() => {
    if (currentStep === 'processing' || currentStep === 'export') return;

    const timer = setTimeout(() => {
      const res = saveProductDraft({
        cpc,
        productName,
        itemType,
        purity,
        gender,
        size,
        grossWeight,
        otherWeight,
        netWeight,
        staffName,
        photos,
        currentStep,
      });
      if (res.success) {
        setLastAutoSaved(res.timestamp);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [cpc, productName, itemType, purity, gender, size, grossWeight, otherWeight, netWeight, staffName, photos, currentStep]);

  // Check server health on mount
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

  const handleLoginSuccess = (session: UserSession) => {
    setCurrentUser(session);
    setStaffName(session.username);
    setIsLoginModalOpen(false);
  };

  const handleLogout = () => {
    saveStoredUserSession(null);
    setCurrentUser(null);
    setIsLoginModalOpen(true);
  };

  // Update a single photo slot's original image
  const handleUpdatePhoto = (id: string, dataUrl: string) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              originalImage: dataUrl,
              status: 'idle',
              reviewDecision: 'pending',
              reshootReason: undefined,
              processedImage: undefined,
            }
          : p
      )
    );
  };

  // Remove photo
  const handleRemovePhoto = (id: string) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              originalImage: '',
              status: 'idle',
              reviewDecision: 'pending',
              processedImage: undefined,
              tryonImage: undefined,
              reshootReason: undefined,
            }
          : p
      )
    );
  };

  // Submit all captured photos for Gemini Prompt Audit & Enhancement
  const handleSubmitForProcessing = async () => {
    const photosToProcess = photos.filter((p) => Boolean(p.originalImage));
    if (photosToProcess.length === 0) return;

    setCurrentStep('processing');
    setTotalToProcess(photosToProcess.length);
    setProcessingIndex(0);

    const updatedPhotos = [...photos];

    for (let i = 0; i < photosToProcess.length; i++) {
      const activePhoto = photosToProcess[i];
      setProcessingIndex(i);

      // Mark this photo as processing in state
      setPhotos((current) =>
        current.map((p) => (p.id === activePhoto.id ? { ...p, status: 'processing' } : p))
      );

      try {
        const res = await fetch('/api/audit-and-enhance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: activePhoto.originalImage,
            itemType,
            purity,
            gender,
            photoType: activePhoto.type,
            sku: cpc,
            cpc,
            weight: netWeight || grossWeight,
          }),
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();

        const idx = updatedPhotos.findIndex((p) => p.id === activePhoto.id);
        if (idx !== -1) {
          if (data.status === 'needs_reshoot') {
            updatedPhotos[idx] = {
              ...updatedPhotos[idx],
              status: 'needs_reshoot',
              reshootReason: data.reason || 'Tag obstruction or blur detected. Please reshoot.',
              confidenceScore: data.confidence,
              reviewDecision: 'pending',
            };
          } else {
            let processedUrl = data.processedImageBase64;
            // If image generation was not available or returned original, apply Studio Retoucher
            if (!processedUrl || processedUrl === activePhoto.originalImage) {
              try {
                processedUrl = await retouchJewelryPhoto(activePhoto.originalImage, {
                  purity,
                  itemType,
                });
              } catch {
                processedUrl = activePhoto.originalImage;
              }
            }

            updatedPhotos[idx] = {
              ...updatedPhotos[idx],
              status: 'approved',
              processedImage: processedUrl,
              confidenceScore: data.confidence || 0.95,
              reviewDecision: 'approved',
            };
          }
        }
      } catch (err: any) {
        console.error('Processing error for photo:', activePhoto.id, err);
        const idx = updatedPhotos.findIndex((p) => p.id === activePhoto.id);
        if (idx !== -1) {
          let fallbackProcessed = activePhoto.originalImage;
          try {
            fallbackProcessed = await retouchJewelryPhoto(activePhoto.originalImage, {
              purity,
              itemType,
            });
          } catch {
            // ignore
          }

          updatedPhotos[idx] = {
            ...updatedPhotos[idx],
            status: 'approved',
            processedImage: fallbackProcessed,
            reviewDecision: 'approved',
          };
        }
      }

      setPhotos([...updatedPhotos]);
    }

    // Finished processing all photos, transition to Review Step
    setCurrentStep('review');
  };

  // Re-audit / regenerate single photo
  const handleRegenerateSinglePhoto = async (photoId: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo || !photo.originalImage) return;

    setPhotos((current) =>
      current.map((p) => (p.id === photoId ? { ...p, status: 'processing', reviewDecision: 'regenerating' } : p))
    );

    try {
      const res = await fetch('/api/audit-and-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photo.originalImage,
          itemType,
          purity,
          gender,
          photoType: photo.type,
          sku: cpc,
          cpc,
          weight: netWeight || grossWeight,
        }),
      });

      const data = await res.json();
      let processedUrl = data.processedImageBase64;
      if (!processedUrl || processedUrl === photo.originalImage) {
        try {
          processedUrl = await retouchJewelryPhoto(photo.originalImage, {
            purity,
            itemType,
          });
        } catch {
          processedUrl = photo.originalImage;
        }
      }

      setPhotos((current) =>
        current.map((p) => {
          if (p.id === photoId) {
            if (data.status === 'needs_reshoot') {
              return {
                ...p,
                status: 'needs_reshoot',
                reshootReason: data.reason || 'Tag overlaps piece or blur detected.',
                reviewDecision: 'pending',
              };
            }
            return {
              ...p,
              status: 'approved',
              processedImage: processedUrl,
              reviewDecision: 'approved',
            };
          }
          return p;
        })
      );
    } catch (err) {
      console.error('Regenerate error:', err);
      let fallbackProcessed = photo.originalImage;
      try {
        fallbackProcessed = await retouchJewelryPhoto(photo.originalImage, {
          purity,
          itemType,
        });
      } catch {
        // ignore
      }
      setPhotos((current) =>
        current.map((p) => (p.id === photoId ? { ...p, status: 'approved', processedImage: fallbackProcessed, reviewDecision: 'approved' } : p))
      );
    }
  };

  // Retake a photo with new image capture
  const handleRetakePhoto = (photoId: string, newDataUrl: string) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId
          ? {
              ...p,
              originalImage: newDataUrl,
              status: 'idle',
              processedImage: undefined,
              reshootReason: undefined,
              reviewDecision: 'pending',
            }
          : p
      )
    );
    setTimeout(() => {
      handleRegenerateSinglePhoto(photoId);
    }, 100);
  };

  // Update Review Decision (Approve / Discard)
  const handleUpdateReviewDecision = (photoId: string, decision: ReviewDecision) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, reviewDecision: decision } : p))
    );
  };

  // Attach Model Try-On image
  const handleSaveTryonImage = (photoId: string, tryonUrl: string, config: TryonConfig) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId
          ? {
              ...p,
              tryonImage: tryonUrl,
              tryonSettings: config,
            }
          : p
      )
    );
  };

  // Finalize product & save audit log
  const handleProceedToExport = () => {
    const productRecord: ProductRecord = {
      id: `prod_${Date.now()}`,
      sku: cpc,
      cpc,
      name: productName,
      itemType,
      purity,
      gender,
      grossWeightGrams: grossWeight,
      otherWeightGrams: otherWeight,
      netWeightGrams: netWeight,
      weightGrams: netWeight || grossWeight,
      staffName,
      createdAt: new Date().toISOString(),
      photos,
      overallStatus: 'reviewed',
    };

    saveAuditLogEntry(productRecord);
    setCurrentStep('export');
  };

  // Reset to start new product (clears active draft)
  const handleStartNewProduct = () => {
    clearProductDraft();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setCpc(`RLJ-RN-${randomNum}`);
    setProductName('');
    setItemType('ring');
    setPurity('22kt');
    setGender("women's");
    setSize('DEFAULT');
    setGrossWeight('6.500');
    setOtherWeight('0.200');
    setNetWeight('6.300');
    setPhotos(createInitialPhotoSlots());
    setCurrentStep('form');
    setLastAutoSaved(null);
  };

  const currentProductRecord: ProductRecord = {
    id: `prod_${cpc}`,
    sku: cpc,
    cpc,
    name: productName,
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
    photos,
    overallStatus: currentStep === 'export' ? 'exported' : 'reviewed',
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-stone-900 flex flex-col font-sans selection:bg-red-600 selection:text-white">
      
      {/* Top Header */}
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          if (tab === 'new' && currentStep === 'export') {
            handleStartNewProduct();
          }
        }}
        currentUser={currentUser}
        onLogout={handleLogout}
        hasApiKey={hasApiKey}
        isOnline={isOnline}
        lastAutoSavedAt={lastAutoSaved}
      />

      {/* Main App Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-3 sm:p-5 lg:p-6">
        
        {/* Offline Showroom Status Banner */}
        {!isOnline && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-2xl p-3.5 sm:p-4 text-amber-950 flex items-center justify-between gap-3 text-xs shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0">
                <WifiOff className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div>
                <span className="font-bold text-sm text-amber-900 block">
                  Showroom Offline Mode Active
                </span>
                <span className="text-amber-800 text-xs">
                  Working offline in counter area. All jewelry photos, tag specifications, and edits are automatically saved to local device storage.
                </span>
              </div>
            </div>
          </div>
        )}

        {currentTab === 'history' ? (
          <AuditHistoryView onBackToNew={() => setCurrentTab('new')} />
        ) : (
          <div>
            {/* Step Navigation Indicator for Core Flow */}
            {currentStep !== 'processing' && (
              <div className="space-y-2 mb-4 sm:mb-6">
                <div className="bg-white border border-stone-200 shadow-xs rounded-2xl p-1.5 sm:p-2.5 flex items-center justify-between gap-1 overflow-x-auto scrollbar-none text-xs">
                  
                  {/* 1. New Product */}
                  <button
                    type="button"
                    onClick={() => setCurrentStep('form')}
                    className={`min-h-[44px] flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-[11px] sm:text-xs shrink-0 transition-all ${
                      currentStep === 'form'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      currentStep === 'form' ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                    }`}>1</span>
                    <span>Product Info</span>
                  </button>

                  <div className="w-3 sm:w-4 h-[1px] bg-stone-200 shrink-0" />

                  {/* 2. Upload Photos */}
                  <button
                    type="button"
                    onClick={() => setCurrentStep('upload')}
                    className={`min-h-[44px] flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-[11px] sm:text-xs shrink-0 transition-all ${
                      currentStep === 'upload'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      currentStep === 'upload' ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                    }`}>2</span>
                    <span>Capture Photos</span>
                  </button>

                  <div className="w-3 sm:w-4 h-[1px] bg-stone-200 shrink-0" />

                  {/* 3. Review & Try-On */}
                  <button
                    type="button"
                    onClick={() => {
                      const hasProcessed = photos.some((p) => p.status === 'approved' || p.status === 'needs_reshoot');
                      if (hasProcessed) setCurrentStep('review');
                    }}
                    className={`min-h-[44px] flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-[11px] sm:text-xs shrink-0 transition-all ${
                      currentStep === 'review'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      currentStep === 'review' ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                    }`}>3</span>
                    <span>Review & Try-On</span>
                  </button>

                  <div className="w-3 sm:w-4 h-[1px] bg-stone-200 shrink-0" />

                  {/* 4. Export */}
                  <button
                    type="button"
                    onClick={() => setCurrentStep('export')}
                    className={`min-h-[44px] flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-[11px] sm:text-xs shrink-0 transition-all ${
                      currentStep === 'export'
                        ? 'bg-red-600 text-white shadow-xs'
                        : 'text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      currentStep === 'export' ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                    }`}>4</span>
                    <span>ZIP / ERP Export</span>
                  </button>

                </div>

                {/* Auto-Save Status Bar */}
                {lastAutoSaved && currentStep !== 'export' && (
                  <div className="flex items-center justify-between text-[11px] text-stone-500 px-2 py-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Draft auto-saved to local browser storage</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartNewProduct}
                      className="min-h-[36px] px-2 text-stone-400 hover:text-red-600 flex items-center gap-1 transition-colors font-medium"
                      title="Clear saved draft & reset form"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Start Fresh</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Core Steps Switcher */}
            {currentStep === 'form' && (
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
                onProceed={() => setCurrentStep('upload')}
              />
            )}

            {currentStep === 'upload' && (
              <UploadPhotosStep
                cpc={cpc}
                productName={productName}
                itemType={itemType}
                purity={purity}
                gender={gender}
                grossWeight={grossWeight}
                netWeight={netWeight}
                photos={photos}
                onUpdatePhoto={handleUpdatePhoto}
                onRemovePhoto={handleRemovePhoto}
                onBack={() => setCurrentStep('form')}
                onSubmitForProcessing={handleSubmitForProcessing}
              />
            )}

            {currentStep === 'processing' && (
              <ProcessingStep
                cpc={cpc}
                purity={purity}
                itemType={itemType}
                photos={photos}
                currentIndex={processingIndex}
                totalToProcess={totalToProcess}
              />
            )}

            {currentStep === 'review' && (
              <ReviewStep
                sku={cpc}
                cpc={cpc}
                productName={productName}
                itemType={itemType}
                purity={purity}
                gender={gender}
                photos={photos}
                onUpdateReviewDecision={handleUpdateReviewDecision}
                onRegeneratePhoto={handleRegenerateSinglePhoto}
                onRetakePhoto={handleRetakePhoto}
                onSaveTryonImage={handleSaveTryonImage}
                onBackToPhotos={() => setCurrentStep('upload')}
                onProceedToExport={handleProceedToExport}
              />
            )}

            {currentStep === 'export' && (
              <ExportStep
                product={currentProductRecord}
                onStartNewProduct={handleStartNewProduct}
                onViewHistory={() => setCurrentTab('history')}
              />
            )}
          </div>
        )}
      </main>

      {/* Internal Staff Footer */}
      <footer className="border-t border-stone-200 bg-white text-stone-500 text-[11px] py-2.5 sm:py-3 text-center px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 font-medium">
          <span>RL Jewels Photo Studio • Internal Store Management</span>
          <span className="text-stone-400">Authorized Personnel: {currentUser?.username || 'Staff'}</span>
        </div>
      </footer>

      {/* Mandatory Login Modal on Page Load */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onLoginSuccess={handleLoginSuccess}
      />

    </div>
  );
}
