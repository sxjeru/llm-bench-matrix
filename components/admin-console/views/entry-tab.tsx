"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Database, PlusCircle, Table2, Upload } from "lucide-react";
import type { BenchmarkOption, ModelOption, ProviderOption } from "../types";

type EntryTabProps = {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  providerName: string;
  setProviderName: Dispatch<SetStateAction<string>>;
  providerId: number | "";
  setProviderId: Dispatch<SetStateAction<number | "">>;
  modelName: string;
  setModelName: Dispatch<SetStateAction<string>>;
  modelAlias: string;
  setModelAlias: Dispatch<SetStateAction<string>>;
  sourceModelId: string;
  setSourceModelId: Dispatch<SetStateAction<string>>;
  benchmarkName: string;
  setBenchmarkName: Dispatch<SetStateAction<string>>;
  benchmarkType: string;
  setBenchmarkType: Dispatch<SetStateAction<string>>;
  benchmarkUnit: string;
  setBenchmarkUnit: Dispatch<SetStateAction<string>>;
  modalities: string;
  setModalities: Dispatch<SetStateAction<string>>;
  higherIsBetter: boolean;
  setHigherIsBetter: Dispatch<SetStateAction<boolean>>;
  valueModelId: number | "";
  setValueModelId: Dispatch<SetStateAction<number | "">>;
  valueBenchmarkId: number | "";
  setValueBenchmarkId: Dispatch<SetStateAction<number | "">>;
  benchTime: string;
  setBenchTime: Dispatch<SetStateAction<string>>;
  valueRaw: string;
  setValueRaw: Dispatch<SetStateAction<string>>;
  valueSource: string;
  setValueSource: Dispatch<SetStateAction<string>>;
  onCreateProvider: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCreateModel: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCreateBenchmark: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCreateValue: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export function EntryTab({
  providers,
  models,
  benchmarks,
  providerName,
  setProviderName,
  providerId,
  setProviderId,
  modelName,
  setModelName,
  modelAlias,
  setModelAlias,
  sourceModelId,
  setSourceModelId,
  benchmarkName,
  setBenchmarkName,
  benchmarkType,
  setBenchmarkType,
  benchmarkUnit,
  setBenchmarkUnit,
  modalities,
  setModalities,
  higherIsBetter,
  setHigherIsBetter,
  valueModelId,
  setValueModelId,
  valueBenchmarkId,
  setValueBenchmarkId,
  benchTime,
  setBenchTime,
  valueRaw,
  setValueRaw,
  valueSource,
  setValueSource,
  onCreateProvider,
  onCreateModel,
  onCreateBenchmark,
  onCreateValue
}: EntryTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <PlusCircle size={18} />
          新增 Provider
        </h3>
        <form onSubmit={onCreateProvider} className="space-y-3">
          <input
            className="input input-bordered w-full"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="例如 OpenAI"
            required
          />
          <button type="submit" className="btn btn-primary">保存 Provider</button>
        </form>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Database size={18} />
          新增 Model
        </h3>
        <form onSubmit={onCreateModel} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <select
              className="select select-bordered w-full"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}
              required
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <input
              className="input input-bordered w-full"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="model name"
              required
            />
          </div>
          <div className="md:col-span-4">
            <input
              className="input input-bordered w-full"
              value={modelAlias}
              onChange={(e) => setModelAlias(e.target.value)}
              placeholder="model alias (可选)"
            />
          </div>
          <div className="md:col-span-12">
            <input
              className="input input-bordered w-full"
              value={sourceModelId}
              onChange={(e) => setSourceModelId(e.target.value)}
              placeholder="source model id (可选)"
            />
          </div>
          <div className="md:col-span-12">
            <button type="submit" className="btn btn-primary">保存 Model</button>
          </div>
        </form>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Upload size={18} />
          新增 Benchmark
        </h3>
        <form onSubmit={onCreateBenchmark} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <input className="input input-bordered w-full" value={benchmarkName} onChange={(e) => setBenchmarkName(e.target.value)} placeholder="benchmark name" required />
          </div>
          <div className="md:col-span-4">
            <input className="input input-bordered w-full" value={benchmarkType} onChange={(e) => setBenchmarkType(e.target.value)} placeholder="benchmark type" required />
          </div>
          <div className="md:col-span-4">
            <input className="input input-bordered w-full" value={benchmarkUnit} onChange={(e) => setBenchmarkUnit(e.target.value)} placeholder="unit" required />
          </div>
          <div className="md:col-span-7">
            <input className="input input-bordered w-full" value={modalities} onChange={(e) => setModalities(e.target.value)} placeholder="Text, Vision, Audio" />
          </div>
          <div className="md:col-span-5 flex items-center">
            <label className="label cursor-pointer justify-start gap-2">
              <input type="checkbox" className="checkbox checkbox-sm" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
              <span className="label-text">higher is better</span>
            </label>
          </div>
          <div className="md:col-span-12">
            <button type="submit" className="btn btn-primary">保存 Benchmark</button>
          </div>
        </form>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Table2 size={18} />
          新增 Benchmark 值
        </h3>
        <form onSubmit={onCreateValue} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-6">
            <select className="select select-bordered w-full" value={valueModelId} onChange={(e) => setValueModelId(e.target.value ? Number(e.target.value) : "")} required>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.modelName}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-6">
            <select className="select select-bordered w-full" value={valueBenchmarkId} onChange={(e) => setValueBenchmarkId(e.target.value ? Number(e.target.value) : "")} required>
              {benchmarks.map((benchmark) => (
                <option key={benchmark.id} value={benchmark.id}>{benchmark.benchmarkName} ({benchmark.benchmarkType})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <input type="datetime-local" className="input input-bordered w-full" value={benchTime} onChange={(e) => setBenchTime(e.target.value)} required />
          </div>
          <div className="md:col-span-4">
            <input className="input input-bordered w-full" value={valueRaw} onChange={(e) => setValueRaw(e.target.value)} placeholder="value raw, e.g. 31.5*" required />
          </div>
          <div className="md:col-span-4">
            <input className="input input-bordered w-full" value={valueSource} onChange={(e) => setValueSource(e.target.value)} placeholder="source (optional)" />
          </div>
          <div className="md:col-span-12">
            <button type="submit" className="btn btn-primary">保存记录</button>
          </div>
        </form>
      </section>
    </div>
  );
}
