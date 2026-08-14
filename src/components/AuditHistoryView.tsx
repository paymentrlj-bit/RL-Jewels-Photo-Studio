import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  Filter,
  FileSpreadsheet,
  Download,
  Calendar,
  User,
  Gem,
  Sparkles,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  Scale
} from 'lucide-react';
import { AuditLogItem } from '../types';
import { getStoredAuditLogs } from '../utils/exportUtils';

interface AuditHistoryViewProps {
  onBackToNew: () => void;
}

export const AuditHistoryView: React.FC<AuditHistoryViewProps> = ({ onBackToNew }) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [purityFilter, setPurityFilter] = useState<string>('all');

  useEffect(() => {
    setLogs(getStoredAuditLogs());
  }, []);

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear the local session audit history?')) {
      localStorage.removeItem('rl_jewels_audit_log_v2');
      localStorage.removeItem('rl_jewels_audit_log_v1');
      setLogs([]);
    }
  };

  const handleExportAllCsv = () => {
    if (logs.length === 0) return;
    const header = 'CPC,product_name,item_type,gold_purity,gender_category,gross_weight_grams,other_weight_grams,net_weight_grams,approved_photos_count,has_tryon,staff_member,date';
    const rows = logs.map(l => 
      `"${l.cpc || l.sku}","${l.productName}","${l.itemType}","${l.purity}","${l.gender}","${l.grossWeightGrams || l.weightGrams || '0.000'}","${l.otherWeightGrams || '0.000'}","${l.netWeightGrams || l.weightGrams || '0.000'}","${l.approvedPhotosCount}","${l.hasTryon ? 'YES' : 'NO'}","${l.staffName}","${l.date}"`
    );
    const fullCsv = `${header}\n${rows.join('\n')}`;
    const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RL_Jewels_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter((log) => {
    const code = log.cpc || log.sku || '';
    const matchesSearch =
      code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.itemType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.staffName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.productName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPurity = purityFilter === 'all' || log.purity === purityFilter;
    return matchesSearch && matchesPurity;
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto text-stone-900">
      
      {/* Header Bar */}
      <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToNew}
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl sm:text-2xl font-serif italic font-bold text-stone-900 flex items-center gap-2">
              <History className="w-5 h-5 text-red-600" />
              <span>Counter Photo Studio Audit Log</span>
            </h2>
            <p className="text-xs text-stone-500 font-medium">
              {logs.length} products logged from this counter terminal
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {logs.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportAllCsv}
                className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-xs transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Master CSV</span>
              </button>
              <button
                type="button"
                onClick={handleClearLogs}
                className="p-2.5 rounded-xl bg-stone-100 hover:bg-red-50 text-stone-500 hover:text-red-700 border border-stone-200 hover:border-red-200 transition-colors"
                title="Clear History"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3 flex flex-col sm:flex-row items-center gap-2.5 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by CPC, item type, or staff member..."
            className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 rounded-xl pl-9 pr-4 py-2.5 text-xs sm:text-sm text-stone-900 focus:outline-none transition-colors"
          />
        </div>

        {/* Purity Filter */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
          <Filter className="w-3.5 h-3.5 text-stone-400 hidden sm:inline" />
          {['all', '18kt', '22kt', '24kt'].map((karat) => (
            <button
              key={karat}
              onClick={() => setPurityFilter(karat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                purityFilter === karat
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'bg-stone-100 border border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              {karat}
            </button>
          ))}
        </div>
      </div>

      {/* Log Entries */}
      {filteredLogs.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-3xl p-8 sm:p-12 text-center space-y-3 shadow-xs">
          <Gem className="w-10 h-10 text-stone-300 mx-auto" />
          <h3 className="font-serif italic font-bold text-stone-900 text-lg">No Audit Records Found</h3>
          <p className="text-xs sm:text-sm text-stone-500 max-w-sm mx-auto">
            Process new jewelry products on the counter to automatically log them here for store audit.
          </p>
          <button
            onClick={onBackToNew}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow-xs transition-colors"
          >
            Process New Product
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((item) => {
            const formattedDate = new Date(item.date).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const itemCpc = item.cpc || item.sku;

            return (
              <div
                key={item.id}
                className="bg-white border border-stone-200 hover:border-stone-300 rounded-2xl p-4 sm:p-5 transition-all space-y-3 shadow-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-900 border border-amber-300 flex items-center justify-center font-bold text-xs">
                      {item.purity}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-red-700 text-sm bg-red-50 px-2 py-0.5 rounded border border-red-200">
                          {itemCpc}
                        </span>
                        <span className="text-xs text-stone-800 font-bold capitalize">
                          {item.productName}
                        </span>
                        <span className="text-[11px] text-emerald-800 font-mono font-bold bg-emerald-50 px-2 py-0.5 rounded">
                          Net: {item.netWeightGrams || item.weightGrams || '0.000'}g
                        </span>
                      </div>
                      <div className="text-[11px] text-stone-500 flex items-center gap-2 mt-1 font-medium">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-stone-400" />
                          <span>{item.staffName}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Scale className="w-3 h-3 text-stone-400" />
                          <span>Gross: {item.grossWeightGrams || item.weightGrams || '0.000'}g (Other: {item.otherWeightGrams || '0.000'}g)</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-stone-400" />
                          <span>{formattedDate}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{item.approvedPhotosCount} Approved</span>
                    </span>
                    {item.hasTryon && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>Styled Try-On</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* CSV Raw line */}
                <div className="bg-stone-50 rounded-xl p-3 text-[11px] font-mono text-stone-600 overflow-x-auto border border-stone-200">
                  <span className="text-stone-400 select-none font-bold">ERP CSV: </span>
                  {item.csvRow}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
