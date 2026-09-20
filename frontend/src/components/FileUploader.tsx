import React, { useState, useRef } from 'react';
import { UploadCloud, AlertCircle, Sparkles, FileSpreadsheet, Flag, Truck, Warehouse } from 'lucide-react';
import { uploadFile, uploadDatasetFile, OnboardingDataset } from '../services/api';
import { Neighborhood, ValidationResult, DatasetSummary, VehicleType, Warehouse as WarehouseType } from '../types';

interface FileUploaderProps {
  onDataLoaded: (neighborhoods: Neighborhood[], validation: ValidationResult, summary: DatasetSummary) => void;
  onOpenSyntheticModal: () => void;
  onOpenCensusModal?: () => void;
  /** Phase A onboarding trio: optional fleet + site callbacks reuse the same dropzone. */
  onVehiclesLoaded?: (vehicles: VehicleType[], validation: ValidationResult, summary: any) => void;
  onWarehousesLoaded?: (warehouses: WarehouseType[], validation: ValidationResult, summary: any) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onDataLoaded, onOpenSyntheticModal, onOpenCensusModal, onVehiclesLoaded, onWarehousesLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<OnboardingDataset>('neighborhoods');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      if (dataset === 'neighborhoods') {
        const result = await uploadFile(file);
        onDataLoaded(result.neighborhoods, result.validation, result.summary);
      } else {
        const result = await uploadDatasetFile(file, dataset);
        if (dataset === 'vehicles' && onVehiclesLoaded) {
          onVehiclesLoaded(result.vehicles || [], result.validation, result.summary);
        } else if (dataset === 'warehouses' && onWarehousesLoaded) {
          onWarehousesLoaded(result.warehouses || [], result.validation, result.summary);
        }
      }
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
    <div className="card p-4 mb-4">
      <div className="flex flex-col items-start gap-3 mb-4">
        <div>
          <h2 className="text-[15px] font-bold text-ink flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-ink" />
            Onboarding Data Trio
          </h2>
          <p className="text-xs text-ink-faint">
            Orders → vehicles → warehouses. Pick a dataset, then upload CSV/JSON or seed demo data.
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            {(
              [
                { id: 'neighborhoods', label: 'Orders', icon: UploadCloud },
                { id: 'vehicles', label: 'Vehicles', icon: Truck },
                { id: 'warehouses', label: 'Warehouses', icon: Warehouse }
              ] as { id: OnboardingDataset; label: string; icon: React.ElementType }[]
            ).map((t) => {
              const Icon = t.icon;
              const active = dataset === t.id;
              return (
                <button key={t.id} onClick={() => setDataset(t.id)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${active ? 'bg-[#14424E] text-white border-[#14424E]' : 'bg-white text-ink-soft border-[#E4E1D2] hover:bg-cream-deep'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenSyntheticModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Synthetic</span>
          </button>
          {onOpenCensusModal && (
            <button
              onClick={onOpenCensusModal}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E4E1D2] hover:border-gold text-ink rounded-full text-xs font-bold transition cursor-pointer"
            >
              <Flag className="w-4 h-4" />
              <span>Seed US City (Census)</span>
            </button>
          )}
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-[#14424E] bg-cream-deep'
            : 'border-[#E4E1D2] hover:border-gold'
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

        <div className="w-12 h-12 mx-auto rounded-2xl bg-cream-deep text-ink flex items-center justify-center mb-2.5">
          <UploadCloud className="w-6 h-6" />
        </div>

        <h4 className="text-[13px] font-semibold text-ink mb-1">
          {uploading ? "Parsing & validating dataset..." : "Drop CSV or JSON here, or click to browse"}
        </h4>
        <p className="text-xs text-ink-faint max-w-md mx-auto">
          {dataset === 'neighborhoods' && (
            <span>Automatic header mapping for: <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">neighborhood_id</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">latitude</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">longitude</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">daily_orders</code>{' '}
            (aliases: <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">id/lat/lng/orders</code>)</span>
          )}
          {dataset === 'vehicles' && (
            <span>Fleet headers: <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">vehicle_type</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">capacity</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">cost_per_km</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">fuel_type</code></span>
          )}
          {dataset === 'warehouses' && (
            <span>Site headers: <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">warehouse_id</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">latitude</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">longitude</code>,{' '}
            <code className="bg-cream-deep px-1 py-0.5 rounded text-ink-soft">capacity/radius_km/infra_cost</code></span>
          )}
        </p>

        {uploadError && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Canonical Headers Format Helper */}
      <div className="mt-3 pt-3 border-t border-[#E4E1D2] flex flex-col gap-1.5 text-xs text-ink-faint">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-ink-faint" />
          <span className="font-semibold text-ink-soft">Supported:</span>
          <span className="bg-cream-deep px-2 py-0.5 rounded-full font-mono">.csv</span>
          <span className="bg-cream-deep px-2 py-0.5 rounded-full font-mono">.json</span>
        </div>

        <div>
          Range checks: Lat [-90, 90] &bull; Lon [-180, 180] &bull; Orders &ge; 0
        </div>
      </div>
    </div>
  );
};
