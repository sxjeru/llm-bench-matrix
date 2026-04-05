"use client";

import { FormEvent, useMemo, useState } from "react";

type ProviderOption = {
  id: number;
  name: string;
  slug: string;
};

type ModelOption = {
  id: number;
  providerId: number;
  modelName: string;
  canonicalKey: string;
};

type BenchmarkOption = {
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  modalities: string[];
};

type PreviewRow = {
  rowNumber: number;
  category: string | null;
  benchmarkName: string;
  modelName: string;
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  valid: boolean;
};

type ImportWarning = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  rawValue: string;
  reason: string;
};

type Props = {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  initialSettings: Record<string, unknown>;
};

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;
    throw new Error(reason);
  }

  return data;
}

async function postFormData(url: string, formData: FormData) {
  const response = await fetch(url, { method: "POST", body: formData });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;

    const error = new Error(reason) as Error & { payload?: unknown };
    error.payload = data;
    throw error;
  }

  return data;
}

export function AdminConsole({ providers, models, benchmarks, initialSettings }: Props) {
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [providerName, setProviderName] = useState("");
  const [providerId, setProviderId] = useState<number | "">(providers[0]?.id ?? "");
  const [modelName, setModelName] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [sourceModelId, setSourceModelId] = useState("");

  const [benchmarkName, setBenchmarkName] = useState("");
  const [benchmarkType, setBenchmarkType] = useState("general");
  const [benchmarkUnit, setBenchmarkUnit] = useState("score");
  const [modalities, setModalities] = useState("Text");
  const [higherIsBetter, setHigherIsBetter] = useState(true);

  const [valueModelId, setValueModelId] = useState<number | "">(models[0]?.id ?? "");
  const [valueBenchmarkId, setValueBenchmarkId] = useState<number | "">(benchmarks[0]?.id ?? "");
  const [valueRaw, setValueRaw] = useState("");
  const [valueSource, setValueSource] = useState("");
  const [benchTime, setBenchTime] = useState(() => new Date().toISOString().slice(0, 16));

  const [csvText, setCsvText] = useState(
    "provider,model,benchmark,benchmark_type,modalities,bench_time,value_raw,unit,higher_is_better,source\n"
  );

  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetPickerOpen, setSheetPickerOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<ImportWarning[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{
    benchmarkColumn: string;
    categoryColumn: string | null;
    parsedCount: number;
    warningCount: number;
  } | null>(null);
  const [allowWarningsImport, setAllowWarningsImport] = useState(false);

  const [mergeType, setMergeType] = useState<"model" | "benchmark">("model");
  const [mergeSourceId, setMergeSourceId] = useState<number | "">("");
  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");

  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("{}");
  const [settingNote, setSettingNote] = useState("");

  const sortedSettings = useMemo(() => {
    return Object.entries(initialSettings).sort(([a], [b]) => a.localeCompare(b));
  }, [initialSettings]);

  function notifySuccess(message: string) {
    setNotice({ type: "success", message });
  }

  function notifyError(message: string) {
    setNotice({ type: "error", message });
  }

  function buildWorkbookFormData(sheetName?: string, allowWarnings?: boolean) {
    if (!workbookFile) {
      throw new Error("请先选择 xlsm/xlsx 文件");
    }

    const formData = new FormData();
    formData.append("file", workbookFile);

    if (sheetName) {
      formData.append("sheetName", sheetName);
    }

    if (allowWarnings !== undefined) {
      formData.append("allowWarnings", String(allowWarnings));
    }

    return formData;
  }

  async function requestWorkbookPreview(sheetName?: string) {
    const payload = buildWorkbookFormData(sheetName || selectedSheet || undefined);
    const result = await postFormData("/api/admin/import-xlsm/preview", payload);

    setSheetNames(result.sheetNames ?? []);
    setSelectedSheet(result.selectedSheet ?? "");
    setPreviewRows((result.previewRows ?? []) as PreviewRow[]);
    setPreviewWarnings((result.warnings ?? []) as ImportWarning[]);
    setPreviewMeta({
      benchmarkColumn: result.benchmarkColumn ?? "Benchmark",
      categoryColumn: result.categoryColumn ?? null,
      parsedCount: result.parsedCount ?? 0,
      warningCount: result.warningCount ?? 0
    });

    notifySuccess(`预览完成：解析 ${result.parsedCount ?? 0} 条，警告 ${result.warningCount ?? 0} 条`);

    return result;
  }

  async function onPreviewWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await requestWorkbookPreview();
      if ((result.sheetNames ?? []).length > 1) {
        setSheetPickerOpen(true);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "预览失败");
    }
  }

  async function onSelectSheet(sheetName: string) {
    try {
      setSelectedSheet(sheetName);
      await requestWorkbookPreview(sheetName);
      setSheetPickerOpen(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "切换工作表失败");
    }
  }

  async function onImportWorkbook() {
    try {
      const payload = buildWorkbookFormData(selectedSheet || undefined, allowWarningsImport);
      const result = await postFormData("/api/admin/import-xlsm/commit", payload);
      notifySuccess(
        `导入完成：${result.inserted ?? 0}/${result.total ?? 0}，工作表 ${result.selectedSheet ?? selectedSheet}`
      );

      if (Array.isArray(result.warnings)) {
        setPreviewWarnings(result.warnings as ImportWarning[]);
      }
    } catch (error) {
      const payload = (error as Error & { payload?: unknown }).payload as
        | { warnings?: ImportWarning[] }
        | undefined;
      if (payload?.warnings) {
        setPreviewWarnings(payload.warnings);
      }
      notifyError(error instanceof Error ? error.message : "导入失败");
    }
  }

  async function onCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/providers", { name: providerName });
      setProviderName("");
      notifySuccess("Provider 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 provider 失败");
    }
  }

  async function onCreateModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (providerId === "") {
      notifyError("请先选择 provider");
      return;
    }

    try {
      await postJson("/api/admin/models", {
        providerId,
        modelName,
        modelAlias: modelAlias || undefined,
        sourceModelId: sourceModelId || undefined
      });
      setModelName("");
      setModelAlias("");
      setSourceModelId("");
      notifySuccess("Model 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 model 失败");
    }
  }

  async function onCreateBenchmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/benchmarks", {
        benchmarkName,
        benchmarkType,
        unit: benchmarkUnit,
        higherIsBetter,
        modalities: modalities
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean)
      });
      setBenchmarkName("");
      notifySuccess("Benchmark 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 失败");
    }
  }

  async function onCreateValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valueModelId === "" || valueBenchmarkId === "") {
      notifyError("请先选择 model 和 benchmark");
      return;
    }

    try {
      await postJson("/api/admin/values", {
        modelId: valueModelId,
        benchmarkId: valueBenchmarkId,
        benchTime: new Date(benchTime).toISOString(),
        valueRaw,
        source: valueSource || undefined
      });
      setValueRaw("");
      notifySuccess("Benchmark 值已保存。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 值失败");
    }
  }

  async function onImportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await postJson("/api/admin/import-csv", { csvText });
      notifySuccess(`CSV 导入完成：${result.inserted}/${result.total}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "CSV 导入失败");
    }
  }

  async function onMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mergeSourceId === "" || mergeTargetId === "") {
      notifyError("请填写 sourceId 与 targetId");
      return;
    }

    try {
      await postJson("/api/admin/merge", {
        entityType: mergeType,
        sourceId: mergeSourceId,
        targetId: mergeTargetId
      });
      notifySuccess("合并完成。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "合并失败");
    }
  }

  async function onSaveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const valueJson = JSON.parse(settingValue);
      await postJson("/api/admin/settings", {
        key: settingKey,
        valueJson,
        note: settingNote || undefined,
        updatedBy: "admin"
      });
      notifySuccess("设置项已保存。刷新页面可看到最新 settings。");
    } catch (error) {
      if (error instanceof SyntaxError) {
        notifyError("setting value 必须是合法 JSON");
        return;
      }
      notifyError(error instanceof Error ? error.message : "设置项保存失败");
    }
  }

  async function onLogout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      window.location.href = "/admin/login";
    } catch {
      notifyError("退出失败，请重试");
    }
  }

  return (
    <>
      {sheetPickerOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 20
          }}
        >
          <div className="card" style={{ width: "min(560px, 92vw)", margin: 0 }}>
            <h3>选择工作表</h3>
            <p className="small">请选择要导入的工作表，选中后会自动刷新预览。</p>
            <div style={{ display: "grid", gap: 8 }}>
              {sheetNames.map((name) => (
                <button key={name} type="button" className="secondary" onClick={() => onSelectSheet(name)}>
                  {name}
                </button>
              ))}
            </div>
            <div style={{ height: 10 }} />
            <button type="button" className="secondary" onClick={() => setSheetPickerOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid">
        <div className="col-12">
          {notice ? (
            <div className={`notice ${notice.type === "success" ? "success" : "error"}`}>{notice.message}</div>
          ) : null}
        </div>

        <section className="card col-12">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h2>后台操作台</h2>
            <button className="secondary" style={{ width: 160 }} onClick={onLogout} type="button">
              退出登录
            </button>
          </div>
        </section>

        <section className="card col-12">
          <h3>XLSM / XLSX 导入（含预览与告警）</h3>
          <p className="small">
            支持 `98.7/57.2`、`99 /33`、`65.2*`；`--`、`-`、`—` 视为空值。导入前会提示不合规值。
          </p>
          <form onSubmit={onPreviewWorkbook}>
            <div className="form-row">
              <div className="span-6">
                <input
                  type="file"
                  accept=".xlsm,.xlsx,.xls"
                  onChange={(e) => setWorkbookFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <div className="span-3">
                <button type="submit">解析并预览</button>
              </div>
              <div className="span-3">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSheetPickerOpen(true)}
                  disabled={sheetNames.length <= 1}
                >
                  选择工作表
                </button>
              </div>
            </div>
          </form>

          {previewMeta ? (
            <>
              <div className="notice" style={{ marginTop: 10 }}>
                <div>当前工作表：{selectedSheet || "-"}</div>
                <div>
                  列识别：Benchmark 列 = <b>{previewMeta.benchmarkColumn}</b>
                  {previewMeta.categoryColumn ? `，Category 列 = ${previewMeta.categoryColumn}` : "，未检测到 Category 列"}
                </div>
                <div>
                  解析记录：{previewMeta.parsedCount}，警告：{previewMeta.warningCount}
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ width: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={allowWarningsImport}
                    onChange={(e) => setAllowWarningsImport(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  忽略警告继续导入
                </label>
                <button type="button" onClick={onImportWorkbook}>
                  导入当前工作表
                </button>
              </div>
            </>
          ) : null}

          {previewWarnings.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <h4>告警（最多 200 条）</h4>
              <div style={{ overflowX: "auto", maxHeight: 240 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Benchmark</th>
                      <th>Model</th>
                      <th>Raw</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewWarnings.map((warning, idx) => (
                      <tr key={`${warning.rowNumber}-${warning.modelName}-${idx}`}>
                        <td>{warning.rowNumber}</td>
                        <td>{warning.benchmarkName}</td>
                        <td>{warning.modelName}</td>
                        <td>{warning.rawValue}</td>
                        <td>{warning.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {previewRows.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <h4>预览数据（最多 40 条）</h4>
              <div style={{ overflowX: "auto", maxHeight: 300 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Category</th>
                      <th>Benchmark</th>
                      <th>Model</th>
                      <th>Raw</th>
                      <th>Num</th>
                      <th>Num2</th>
                      <th>Note</th>
                      <th>Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={`${row.rowNumber}-${row.benchmarkName}-${row.modelName}-${row.rawValue}`}>
                        <td>{row.rowNumber}</td>
                        <td>{row.category || "-"}</td>
                        <td>{row.benchmarkName}</td>
                        <td>{row.modelName}</td>
                        <td>{row.rawValue}</td>
                        <td>{row.valueNum ?? "-"}</td>
                        <td>{row.valueNum2 ?? "-"}</td>
                        <td>{row.valueNote ?? "-"}</td>
                        <td>{row.valid ? "✅" : "⚠️"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card col-6">
          <h3>新增 Provider</h3>
          <form onSubmit={onCreateProvider}>
            <div className="form-row">
              <div className="span-12">
                <input
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="例如 OpenAI"
                  required
                />
              </div>
              <div className="span-12">
                <button type="submit">保存 Provider</button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-6">
          <h3>新增 Model</h3>
          <form onSubmit={onCreateModel}>
            <div className="form-row">
              <div className="span-4">
                <select
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="span-4">
                <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="model name" required />
              </div>
              <div className="span-4">
                <input value={modelAlias} onChange={(e) => setModelAlias(e.target.value)} placeholder="model alias (可选)" />
              </div>
              <div className="span-12">
                <input
                  value={sourceModelId}
                  onChange={(e) => setSourceModelId(e.target.value)}
                  placeholder="source model id (可选)"
                />
              </div>
              <div className="span-12">
                <button type="submit">保存 Model</button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-6">
          <h3>新增 Benchmark</h3>
          <form onSubmit={onCreateBenchmark}>
            <div className="form-row">
              <div className="span-4">
                <input
                  value={benchmarkName}
                  onChange={(e) => setBenchmarkName(e.target.value)}
                  placeholder="benchmark name"
                  required
                />
              </div>
              <div className="span-4">
                <input
                  value={benchmarkType}
                  onChange={(e) => setBenchmarkType(e.target.value)}
                  placeholder="benchmark type"
                  required
                />
              </div>
              <div className="span-4">
                <input value={benchmarkUnit} onChange={(e) => setBenchmarkUnit(e.target.value)} placeholder="unit" required />
              </div>
              <div className="span-6">
                <input
                  value={modalities}
                  onChange={(e) => setModalities(e.target.value)}
                  placeholder="Text, Vision, Audio"
                />
              </div>
              <div className="span-6" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ width: "auto" }}>
                  <input
                    type="checkbox"
                    checked={higherIsBetter}
                    onChange={(e) => setHigherIsBetter(e.target.checked)}
                    style={{ width: "auto", marginRight: 8 }}
                  />
                  higher is better
                </label>
              </div>
              <div className="span-12">
                <button type="submit">保存 Benchmark</button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-6">
          <h3>新增 Benchmark 值</h3>
          <form onSubmit={onCreateValue}>
            <div className="form-row">
              <div className="span-6">
                <select
                  value={valueModelId}
                  onChange={(e) => setValueModelId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.modelName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="span-6">
                <select
                  value={valueBenchmarkId}
                  onChange={(e) => setValueBenchmarkId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  {benchmarks.map((benchmark) => (
                    <option key={benchmark.id} value={benchmark.id}>
                      {benchmark.benchmarkName} ({benchmark.benchmarkType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="span-4">
                <input
                  type="datetime-local"
                  value={benchTime}
                  onChange={(e) => setBenchTime(e.target.value)}
                  required
                />
              </div>
              <div className="span-4">
                <input
                  value={valueRaw}
                  onChange={(e) => setValueRaw(e.target.value)}
                  placeholder="value raw, e.g. 31.5*"
                  required
                />
              </div>
              <div className="span-4">
                <input value={valueSource} onChange={(e) => setValueSource(e.target.value)} placeholder="source (optional)" />
              </div>
              <div className="span-12">
                <button type="submit">保存记录</button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-6">
          <h3>CSV 导入</h3>
          <p className="small">
            表头示例：provider,model,benchmark,benchmark_type,modalities,bench_time,value_raw,unit,higher_is_better,source
          </p>
          <form onSubmit={onImportCsv}>
            <div className="form-row">
              <div className="span-12">
                <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} required />
              </div>
              <div className="span-12">
                <button type="submit">执行导入</button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-6">
          <h3>实体合并（去重）</h3>
          <form onSubmit={onMerge}>
            <div className="form-row">
              <div className="span-4">
                <select value={mergeType} onChange={(e) => setMergeType(e.target.value as "model" | "benchmark")}
                >
                  <option value="model">model</option>
                  <option value="benchmark">benchmark</option>
                </select>
              </div>
              <div className="span-4">
                <input
                  type="number"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value ? Number(e.target.value) : "")}
                  placeholder="source id"
                  required
                />
              </div>
              <div className="span-4">
                <input
                  type="number"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value ? Number(e.target.value) : "")}
                  placeholder="target id"
                  required
                />
              </div>
              <div className="span-12">
                <button type="submit" className="danger">
                  合并实体
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="card col-12">
          <h3>Settings</h3>
          <form onSubmit={onSaveSetting}>
            <div className="form-row">
              <div className="span-3">
                <input value={settingKey} onChange={(e) => setSettingKey(e.target.value)} placeholder="key" required />
              </div>
              <div className="span-6">
                <textarea value={settingValue} onChange={(e) => setSettingValue(e.target.value)} required />
              </div>
              <div className="span-3">
                <input value={settingNote} onChange={(e) => setSettingNote(e.target.value)} placeholder="note (optional)" />
                <div style={{ height: 10 }} />
                <button type="submit">保存 Setting</button>
              </div>
            </div>
          </form>

          <h4 style={{ marginTop: 14 }}>当前 settings（初始快照）</h4>
          {sortedSettings.length === 0 ? (
            <p className="small">暂无 settings 记录</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSettings.map(([key, value]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
