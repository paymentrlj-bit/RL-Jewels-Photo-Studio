import React, { useState } from 'react';
import { Sparkles, Scan, ChevronRight, Scale, User, ShieldAlert, Calculator, CheckCircle2, Ruler } from 'lucide-react';
import { GoldPurity, ProductGender, ITEM_TYPE_SUGGESTIONS } from '../types';
import { BarcodeScannerModal, ScannedProductData } from './BarcodeScannerModal';

interface ProductFormProps {
  cpc: string;
  setCpc: (val: string) => void;
  productName: string;
  setProductName: (val: string) => void;
  itemType: string;
  setItemType: (val: string) => void;
  purity: GoldPurity;
  setPurity: (val: GoldPurity) => void;
  gender: ProductGender;
  setGender: (val: ProductGender) => void;
  size?: string;
  setSize?: (val: string) => void;
  grossWeight: string;
  setGrossWeight: (val: string) => void;
  otherWeight: string;
  setOtherWeight: (val: string) => void;
  netWeight: string;
  setNetWeight: (val: string) => void;
  staffName: string;
  setStaffName: (val: string) => void;
  onProceed: () => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({
  cpc,
  setCpc,
  productName,
  setProductName,
  itemType,
  setItemType,
  purity,
  setPurity,
  gender,
  setGender,
  size = 'DEFAULT',
  setSize,
  grossWeight,
  setGrossWeight,
  otherWeight,
  setOtherWeight,
  netWeight,
  setNetWeight,
  staffName,
  setStaffName,
  onProceed,
}) => {
  const [showTypeSuggestions, setShowTypeSuggestions] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [scanSuccessBanner, setScanSuccessBanner] = useState<string | null>(null);

  // Calculate Net Weight: Net = Gross - Other
  const calculateNetWeight = (grossVal: string, otherVal: string) => {
    const g = parseFloat(grossVal) || 0;
    const o = parseFloat(otherVal) || 0;
    const net = Math.max(0, g - o);
    return net > 0 ? net.toFixed(3) : '';
  };

  const handleGrossWeightChange = (val: string) => {
    setGrossWeight(val);
    const newNet = calculateNetWeight(val, otherWeight);
    setNetWeight(newNet);
  };

  const handleOtherWeightChange = (val: string) => {
    setOtherWeight(val);
    const newNet = calculateNetWeight(grossWeight, val);
    setNetWeight(newNet);
  };

  // Quick auto-generator for sample CPC at counter
  const generateSampleCpc = (type: string = itemType || 'ring') => {
    const prefix = 'RLJ';
    const typeCode = type.slice(0, 2).toUpperCase() || 'RN';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const newCpc = `${prefix}-${typeCode}-${randomNum}`;
    setCpc(newCpc);
    if (!productName) {
      setProductName(`${purity.toUpperCase()} Gold ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    }
    if (!grossWeight || grossWeight === '0.000') {
      setGrossWeight('8.500');
      setOtherWeight('0.250');
      setNetWeight('8.250');
    }
  };

  // Auto-fill all fields directly when scanner completes
  const handleScanSuccess = (data: ScannedProductData) => {
    if (data.cpc) setCpc(data.cpc);
    if (data.name) setProductName(data.name);
    if (data.itemType) setItemType(data.itemType);
    if (data.purity) setPurity(data.purity);
    if (data.gender) setGender(data.gender);
    if (setSize && data.size) setSize(data.size);
    if (data.grossWeight) setGrossWeight(data.grossWeight);
    if (data.otherWeight) setOtherWeight(data.otherWeight);
    if (data.netWeight) setNetWeight(data.netWeight);
    
    setErrorMsg('');
    setScanSuccessBanner(`Tag ${data.cpc} parsed successfully: ${data.purity.toUpperCase()} ${data.itemType} (${data.grossWeight}g GW, ${data.netWeight}g NW)`);
    setTimeout(() => {
      setScanSuccessBanner(null);
    }, 6000);
  };

  const handleValidateAndProceed = () => {
    if (!cpc.trim()) {
      setErrorMsg('Please enter, scan, or generate a Counter Product Code (CPC).');
      return;
    }
    if (!itemType.trim()) {
      setErrorMsg('Please enter or select an Item Type (e.g. ring, earrings, necklace).');
      return;
    }
    setErrorMsg('');
    onProceed();
  };

  const filteredSuggestions = ITEM_TYPE_SUGGESTIONS.filter((s) =>
    s.toLowerCase().includes(itemType.toLowerCase().trim())
  );

  return (
    <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-7 text-stone-900 shadow-xs space-y-5 sm:space-y-6">
      
      {/* Header title */}
      <div className="flex flex-wrap items-center justify-between border-b border-stone-100 pb-3 sm:pb-4 gap-2">
        <div>
          <span className="text-red-600 font-mono text-[11px] sm:text-xs uppercase tracking-widest font-bold">
            Step 01 • Product Entry
          </span>
          <h2 className="text-xl sm:text-2xl font-serif italic font-bold text-stone-900 mt-0.5">
            Jewelry Specification
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Barcode Scanner Button */}
          <button
            type="button"
            onClick={() => setShowScannerModal(true)}
            className="min-h-[44px] text-xs bg-red-600 hover:bg-red-700 text-white px-3.5 sm:px-4 py-2.5 rounded-xl flex items-center gap-1.5 font-bold transition-all shadow-xs active:scale-95"
          >
            <Scan className="w-4 h-4 text-white" />
            <span>Scan Tag</span>
          </button>

          <button
            type="button"
            onClick={() => generateSampleCpc()}
            className="min-h-[44px] text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-3.5 sm:px-4 py-2.5 rounded-xl flex items-center gap-1 font-bold transition-colors shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Auto-Gen</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner when scanned */}
      {scanSuccessBanner && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs px-4 py-3 rounded-2xl flex items-center gap-2.5 shadow-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{scanSuccessBanner}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {/* 1. CPC & Product Name Input with Scanner Icon in right of input */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5 flex items-center justify-between">
            <span>
              CPC (Counter Product Code) <span className="text-red-600">*</span>
            </span>
            <span className="text-[10px] text-stone-400 font-medium">Tag Barcode Number</span>
          </label>
          
          <div className="relative">
            <input
              type="text"
              value={cpc}
              onChange={(e) => {
                setCpc(e.target.value.toUpperCase());
                setErrorMsg('');
              }}
              placeholder="e.g. 20L1579 or RLJ-RN-8821"
              className="min-h-[48px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl pl-4 pr-14 py-3 text-stone-900 font-mono text-base tracking-wider placeholder:text-stone-400 focus:outline-none transition-all uppercase font-bold"
            />
            {/* Scanner Button inside the right of the textbox */}
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
              <button
                type="button"
                onClick={() => setShowScannerModal(true)}
                title="Scan Barcode / Tag to auto-fill specs"
                className="min-w-[44px] min-h-[44px] p-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors flex items-center justify-center active:scale-95"
              >
                <Scan className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">
              Display Title / Name (Optional)
            </label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. 22kt Gold Traditional Earrings (Sz: 17N0)"
              className="min-h-[48px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-4 py-3 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
              <Ruler className="w-3 h-3 text-stone-400" />
              <span>Size / Dimension</span>
            </label>
            <input
              type="text"
              value={size}
              onChange={(e) => setSize && setSize(e.target.value.toUpperCase())}
              placeholder="e.g. 17N0, 2.4, 18&quot;, DEFAULT"
              className="min-h-[48px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-3.5 py-3 text-stone-900 font-mono text-sm placeholder:text-stone-400 focus:outline-none uppercase"
            />
          </div>
        </div>
      </div>

      {/* 2. Item Type (Free-text with autocomplete suggestions) */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5">
          Item Type <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={itemType}
            onFocus={() => setShowTypeSuggestions(true)}
            onChange={(e) => {
              setItemType(e.target.value);
              setShowTypeSuggestions(true);
              setErrorMsg('');
            }}
            placeholder="Type or select (e.g. ring, earrings, necklace, bangle, pendant...)"
            className="min-h-[48px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-4 py-3 text-stone-900 text-base placeholder:text-stone-400 focus:outline-none transition-all"
          />
          {itemType && (
            <button
              type="button"
              onClick={() => setItemType('')}
              className="min-h-[44px] px-3 absolute right-1 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 text-xs font-bold flex items-center"
            >
              Clear
            </button>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {ITEM_TYPE_SUGGESTIONS.slice(0, 8).map((suggestion) => {
            const isSelected = itemType.toLowerCase() === suggestion.toLowerCase();
            return (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setItemType(suggestion);
                  setShowTypeSuggestions(false);
                  if (!cpc) generateSampleCpc(suggestion);
                }}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center ${
                  isSelected
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200/80'
                }`}
              >
                {suggestion}
              </button>
            );
          })}
        </div>

        {/* Full dropdown autocomplete if typing */}
        {showTypeSuggestions && filteredSuggestions.length > 0 && (
          <div className="mt-2 bg-white border border-stone-200 rounded-xl max-h-48 overflow-y-auto p-2 space-y-1 shadow-lg z-20">
            <div className="text-[10px] text-stone-400 px-2 py-1 uppercase tracking-wider font-bold">
              Select Category
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {ITEM_TYPE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setItemType(suggestion);
                    setShowTypeSuggestions(false);
                  }}
                  className={`min-h-[44px] text-left px-3 py-2 rounded-xl text-xs font-medium transition-colors flex items-center ${
                    itemType.toLowerCase() === suggestion.toLowerCase()
                      ? 'bg-red-50 text-red-700 font-bold'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Gold Purity Selector (18kt / 22kt / 24kt) */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5 flex items-center justify-between">
          <span>Gold Purity & Hallmarking <span className="text-red-600">*</span></span>
          <span className="text-[10px] text-amber-800 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
            BIS Hallmark Certified
          </span>
        </label>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(['18kt', '22kt', '24kt'] as GoldPurity[]).map((karat) => {
            const isSelected = purity === karat;
            return (
              <button
                key={karat}
                type="button"
                onClick={() => setPurity(karat)}
                className={`min-h-[64px] py-3.5 sm:py-4 px-2.5 rounded-2xl text-center border transition-all flex flex-col justify-center items-center ${
                  isSelected
                    ? 'bg-amber-50/80 border-2 border-amber-500 text-stone-900 shadow-xs'
                    : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
                }`}
              >
                <div className={`text-base sm:text-lg font-bold font-serif ${isSelected ? 'text-amber-900' : 'text-stone-800'}`}>
                  {karat.toUpperCase()}
                </div>
                <div className={`text-[10px] ${isSelected ? 'text-amber-900 font-bold' : 'text-stone-400'}`}>
                  {karat === '22kt' ? '91.6% BIS' : karat === '24kt' ? '99.9% Pure' : '75.0% Diamond'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Gender Category Selector */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5">
          Gender / Target Category <span className="text-red-600">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
          {(["women's", "men's", 'unisex', "kids'"] as ProductGender[]).map((g) => {
            const isSelected = gender === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`min-h-[48px] py-3 px-2 rounded-xl text-center border capitalize text-xs sm:text-sm font-bold transition-all flex items-center justify-center ${
                  isSelected
                    ? 'bg-red-600 text-white border-red-600 shadow-xs'
                    : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Product Weights: Gross Weight, Other Weight, Net Weight Formula */}
      <div className="bg-stone-50/80 border border-stone-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
            <Scale className="w-4 h-4 text-red-600" />
            <span>Product Weights (Grams)</span>
          </span>
          <span className="text-[10px] text-stone-500 font-mono flex items-center gap-1">
            <Calculator className="w-3 h-3 text-amber-600" />
            <span>Formula: Net = Gross - Other</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Gross Weight */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-1">
              Gross Weight (g)
            </label>
            <input
              type="number"
              step="0.001"
              value={grossWeight}
              onChange={(e) => handleGrossWeightChange(e.target.value)}
              placeholder="e.g. 18.450"
              className="min-h-[48px] w-full bg-white border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-3 text-stone-900 text-base font-mono focus:outline-none"
            />
          </div>

          {/* Other Weight */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-1">
              Other Weight (g) <span className="text-stone-400 font-normal">(Stones/Dori)</span>
            </label>
            <input
              type="number"
              step="0.001"
              value={otherWeight}
              onChange={(e) => handleOtherWeightChange(e.target.value)}
              placeholder="e.g. 0.250"
              className="min-h-[48px] w-full bg-white border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-3 text-stone-900 text-base font-mono focus:outline-none"
            />
          </div>

          {/* Net Weight (Auto calculated strictly - read only) */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-800 mb-1 flex items-center justify-between">
              <span>Net Gold Weight (g)</span>
              <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-bold">Auto-Locked</span>
            </label>
            <input
              type="text"
              readOnly
              tabIndex={-1}
              value={netWeight ? `${netWeight}g` : '0.000g'}
              placeholder="0.000g"
              className="min-h-[48px] w-full bg-emerald-50 border border-emerald-300 text-emerald-950 font-bold text-base font-mono px-3.5 py-3 rounded-xl cursor-not-allowed select-none shadow-xs"
            />
          </div>
        </div>
      </div>

      {/* 6. Staff Auditor (Counter Log) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1.5 flex items-center gap-1">
          <User className="w-3.5 h-3.5 text-stone-400" />
          <span>Staff Auditor</span>
        </label>
        <input
          type="text"
          value={staffName}
          onChange={(e) => setStaffName(e.target.value)}
          placeholder="Auditor Name"
          className="min-h-[48px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-4 py-3 text-stone-800 text-base focus:outline-none font-bold"
        />
      </div>

      {/* Next Step Action Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleValidateAndProceed}
          className="min-h-[52px] w-full py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <span>Next: Capture Photos ({itemType ? itemType.toUpperCase() : 'PIECE'})</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Barcode / Tag Scanner Modal */}
      <BarcodeScannerModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onScanSuccess={handleScanSuccess}
      />

    </div>
  );
};