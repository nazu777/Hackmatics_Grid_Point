import React, { useState, useRef } from 'react';
import { UploadCloud, AlertCircle, Sparkles, FileSpreadsheet } from 'lucide-react';
import { uploadFile } from '../services/api';
import { Neighborhood, ValidationResult, DatasetSummary } from '../types';

interface FileUploaderProps {
  onDataLoaded: (neighborhoods: Neighborhood[], validation: ValidationResult, summary: DatasetSummary) => void;
  onOpenSyntheticModal: () => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onDataLoaded, onOpenSyntheticModal }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadFile(file);
      onDataLoaded(result.neighborhoods, result.validation, result.summary);
    } catch (err: any) {
      setUploadError(err.message || 'Error processing file');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-emerald-600" />
            Data Ingestion Layer (schema.md §3)
          </h2>
          <p className="text-xs text-slate-500">
            Upload CSV/JSON files with auto-detected aliases or generate synthetic clusters
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenSyntheticModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-xs font-semibold shadow-sm hover:from-emerald-700 hover:to-teal-700 transition-all cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Synthetic</span>
          </button>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-emerald-500 bg-emerald-50/50'
            : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.txt"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFiles(e.target.files[0]);
            }
          }}
        />

        <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
          <UploadCloud className="w-7 h-7" />
        </div>

        <h4 className="text-sm font-semibold text-slate-800 mb-1">
          {uploading ? "Parsing & validating dataset..." : "Drop CSV or JSON file here, or click to browse"}
        </h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Automatic header mapping for: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">neighborhood_id</code>,{' '}
          <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">latitude</code>,{' '}
          <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">longitude</code>,{' '}
          <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">daily_orders</code>
        </p>

        {uploadError && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Canonical Headers Format Helper */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-slate-700">Supported Formats:</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-600">.csv</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-600">.json (array/object)</span>
        </div>

        <div className="text-slate-400">
          Range checks: Lat [-90, 90] &bull; Lon [-180, 180] &bull; Orders &ge; 0
        </div>
      </div>
    </div>
  );
};
