import React, { useState, useEffect } from 'react';
import { Download, FileSpreadsheet, Archive, Copy, Check, PlusCircle, CheckCircle2, CloudUpload, ExternalLink } from 'lucide-react';
import { ProductRecord } from '../types';
import { downloadProductZip, downloadCsvFile, generateErpCsv } from '../utils/exportUtils';

interface ExportStepProps {
  product: ProductRecord;
  onStartNewProduct: () => void;
}

export const ExportStep: React.FC<ExportStepProps> = ({ product, onStartNewProduct }) => {
  const [isZipping, setIsZipping] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveStatus, setDriveStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [driveError, setDriveError] = useState('');
  const [driveFolderLink, setDriveFolderLink] = useState('');

  useEffect(() => {
    fetch('/api/drive-status')
      .then((res) => res.json())
      .then((data) => setDriveConfigured(Boolean(data.configured)))
      .catch(() => setDriveConfigured(false));
  }, []);

  const handleUploadToDrive = async () => {
    setDriveStatus('uploading');
    setDriveError('');
    try {
      const res = await fetch('/api/export-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpc: displayCpc,
          itemType: product.itemType,
          photoBase64: product.photo.processedImage || product.photo.originalImage,
          metadataCsv: csvString,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDriveStatus('done');
        setDriveFolderLink(data.folderLink);
      } else {
        setDriveStatus('error');
        setDriveError(data.error || 'Upload failed.');
      }
    } catch (err: any) {
      setDriveStatus('error');
      setDriveError('Could not reach the server.');
    }
  };

  const displayCpc = product.cpc || product.sku;

  // A plain .split(',') breaks the moment a quoted field (like a generated
  // description) contains a comma of its own - this respects CSV quoting.
  const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  };

  const csvString = generateErpCsv(product);
  const csvLines = csvString.split('\n');
  const csvHeaders = csvLines[0] ? parseCsvLine(csvLines[0]) : [];
  const csvValues = csvLines[1] ? parseCsvLine(csvLines[1]) : [];

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      await downloadProductZip(product);
    } catch (e) {
      console.error('Failed to generate ZIP:', e);
    } finally {
      setIsZipping(false);
    }
  };

  const handleCopyCsv = () => {
    navigator.clipboard.writeText(csvString);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2500);
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-8 text-stone-900 shadow-xs text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
          <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
        </div>
        <div>
          <span className="text-xs uppercase font-mono tracking-widest text-red-600 font-bold">
            RL Jewels Studio Package Complete
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif italic font-bold text-stone-900 mt-1">
            {displayCpc} Ready for Catalog
          </h2>
          <p className="text-xs sm:text-sm text-stone-500 mt-1 font-medium">
            {product.purity} Gold {product.itemType} • Studio-Grade Photo + ERP Import Metadata
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-stone-200 rounded-3xl p-6 flex flex-col justify-between space-y-4 shadow-xs hover:border-red-300 transition-colors">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
              <Archive className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif italic font-bold text-lg text-stone-900">
                Option A: Download Studio ZIP
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Photo and CSV, named by your CPC:
              </p>
            </div>

            <div className="bg-stone-50 rounded-xl p-3 text-xs font-mono text-stone-700 space-y-1 border border-stone-200">
              <div className="text-red-700 font-bold">📦 {displayCpc}_studio_pack.zip</div>
              <div className="pl-3 text-stone-500">├── {displayCpc}_photo.jpg</div>
              <div className="pl-3 text-stone-500">└── {displayCpc}_erp_import.csv</div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="w-full py-3.5 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            <Download className="w-4 h-4 text-white" />
            <span>{isZipping ? 'Generating ZIP...' : 'Download ZIP'}</span>
          </button>
        </div>

        <div className="bg-white border border-stone-200 rounded-3xl p-6 flex flex-col justify-between space-y-4 shadow-xs hover:border-emerald-500/40 transition-colors">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif italic font-bold text-lg text-stone-900">
                Option B: Structured ERP CSV
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Standard format ready for bulk import into your store inventory & ERP system:
              </p>
            </div>

            <div className="bg-stone-50 rounded-xl p-3 text-xs space-y-1.5 border border-stone-200">
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <span className="text-stone-500 font-medium">CPC:</span>
                <span className="font-mono font-bold text-red-700">{displayCpc}</span>
                <span className="text-stone-500 font-medium">Item Type / Purity:</span>
                <span className="text-stone-800 font-medium capitalize">{product.purity} {product.itemType}</span>
                <span className="text-stone-500 font-medium">Gross Weight:</span>
                <span className="text-stone-800 font-medium">{product.grossWeightGrams || product.weightGrams || '0.000'}g</span>
                <span className="text-stone-500 font-medium">Net Gold Weight:</span>
                <span className="text-emerald-700 font-bold">{product.netWeightGrams || product.grossWeightGrams || '0.000'}g</span>
                <span className="text-stone-500 font-medium">Staff Auditor:</span>
                <span className="text-stone-800 font-medium">{product.staffName}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadCsvFile(product)}
              className="flex-1 py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download CSV</span>
            </button>
            <button
              type="button"
              onClick={handleCopyCsv}
              className="py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold uppercase tracking-wider border border-stone-200 flex items-center justify-center gap-1.5 transition-colors"
              title="Copy CSV to Clipboard"
            >
              {copiedCsv ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-stone-600" />}
              <span>{copiedCsv ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>

      {driveConfigured && (
        <div className="bg-white border border-stone-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs hover:border-blue-400/40 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <CloudUpload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif italic font-bold text-lg text-stone-900">
                Option C: Upload to Google Drive
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Saves the photo + data file into a folder for "{product.itemType}" in your Drive.
              </p>
              {driveStatus === 'error' && (
                <p className="text-xs text-red-600 mt-1 font-medium">{driveError}</p>
              )}
            </div>
          </div>

          {driveStatus === 'done' ? (
            <a
              href={driveFolderLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 py-3.5 px-5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Uploaded - Open Folder</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <button
              type="button"
              onClick={handleUploadToDrive}
              disabled={driveStatus === 'uploading'}
              className="shrink-0 py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <CloudUpload className="w-4 h-4" />
              <span>{driveStatus === 'uploading' ? 'Uploading…' : driveStatus === 'error' ? 'Retry Upload' : 'Upload to Drive'}</span>
            </button>
          )}
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 text-stone-900 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-red-600" />
            <span>ERP Bulk Import CSV Preview</span>
          </span>
          <span className="text-[10px] text-stone-500 font-medium">Ready for API or file import</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-stone-50">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-stone-100 text-stone-700 border-b border-stone-200">
              <tr>
                {csvHeaders.map((h, i) => (
                  <th key={i} className="px-3.5 py-2.5 text-[11px] whitespace-nowrap uppercase tracking-wider font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 text-stone-800">
              <tr>
                {csvValues.map((v, i) => (
                  <td key={i} className="px-3.5 py-2.5 whitespace-nowrap text-xs">
                    {v || '-'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-3xl p-5 flex items-center justify-end gap-3 shadow-xs">
        <button
          type="button"
          onClick={onStartNewProduct}
          className="w-full sm:w-auto py-3.5 sm:py-4 px-8 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <PlusCircle className="w-5 h-5 text-white stroke-[2.5]" />
          <span>Process Next Product (New CPC)</span>
        </button>
      </div>
    </div>
  );
};