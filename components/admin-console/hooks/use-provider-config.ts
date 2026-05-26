import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isValidHexColor } from "@/lib/provider-config";
import { postJson } from "../api";
import type { ProviderConfigDraft, ProviderOption } from "../types";
import { isProviderOption, toProviderConfigDraft } from "../utils/provider";

type NotifyFn = (message: string, details?: string[]) => void;

type UseProviderConfigOptions = {
  providers: ProviderOption[];
  notifySuccess: NotifyFn;
  notifyError: NotifyFn;
};

export function useProviderConfig({ providers, notifySuccess, notifyError }: UseProviderConfigOptions) {
  const router = useRouter();
  const [providerConfigDrafts, setProviderConfigDrafts] = useState<Record<number, ProviderConfigDraft>>(() =>
    providers.reduce<Record<number, ProviderConfigDraft>>((acc, provider) => {
      acc[provider.id] = toProviderConfigDraft(provider);
      return acc;
    }, {})
  );
  const [savingProviderConfigId, setSavingProviderConfigId] = useState<number | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<number | null>(null);
  const [providerDeleteConfirmOpen, setProviderDeleteConfirmOpen] = useState(false);
  const [providerDeleteTargetId, setProviderDeleteTargetId] = useState<number | null>(null);
  const [providerDeleteTransferTargetId, setProviderDeleteTransferTargetId] = useState<number | null>(null);
  const [selectedProviderConfigId, setSelectedProviderConfigId] = useState<number | null>(null);
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [providerSearchOpen, setProviderSearchOpen] = useState(false);
  const providerSearchRef = useRef<HTMLDivElement>(null);
  const providerDropdownRef = useRef<HTMLDivElement>(null);

  const filteredProviderOptions = useMemo(() => {
    const query = providerSearchQuery.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((p) => {
      const displayName = p.config?.displayName?.toLowerCase() ?? "";
      return p.name.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query) || displayName.includes(query);
    });
  }, [providers, providerSearchQuery]);

  // Auto-scroll dropdown to selected provider when opened
  useEffect(() => {
    if (!providerSearchOpen || selectedProviderConfigId === null) return;
    requestAnimationFrame(() => {
      const container = providerDropdownRef.current;
      if (!container) return;
      const activeElement = container.querySelector<HTMLElement>('[data-provider-active="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    });
  }, [providerSearchOpen, selectedProviderConfigId]);

  const selectedProviderForConfig = useMemo(
    () => (selectedProviderConfigId !== null ? providers.find((p) => p.id === selectedProviderConfigId) ?? null : null),
    [providers, selectedProviderConfigId]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (providerSearchRef.current && !providerSearchRef.current.contains(event.target as Node)) {
        setProviderSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const availableDisplayTargetProviders = useMemo(() => {
    if (!selectedProviderForConfig) return [];
    return providers.filter(
      (provider) => provider.id !== selectedProviderForConfig.id && typeof provider.config?.displayTargetProviderId !== "number"
    );
  }, [providers, selectedProviderForConfig]);

  function updateProviderDraft(providerId: number, updater: (draft: ProviderConfigDraft) => ProviderConfigDraft) {
    setProviderConfigDrafts((prev) => ({
      ...prev,
      [providerId]: updater(prev[providerId] ?? {
        displayName: "",
        displayTargetProviderId: null,
        prefixRules: [],
        brandingColor: "",
        modelsDevProviderId: "",
        modelsDevProviderAliases: "",
        pricingDisabled: false
      })
    }));
  }

  function validateProviderDraft(providerId: number, draft: ProviderConfigDraft) {
    const normalizedPrefixes = draft.prefixRules
      .map((rule) => rule.prefix.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedPrefixes.length !== new Set(normalizedPrefixes).size) {
      throw new Error("当前 provider 存在重复 prefix");
    }

    if (draft.brandingColor.trim() && !isValidHexColor(draft.brandingColor)) {
      throw new Error("颜色必须是合法的 #RRGGBB");
    }

    const duplicatePrefixOwner = new Map<string, number>();
    providers.forEach((provider) => {
      const sourceDraft = provider.id === providerId ? draft : (providerConfigDrafts[provider.id] ?? toProviderConfigDraft(provider));
      sourceDraft.prefixRules.forEach((rule) => {
        const normalized = rule.prefix.trim().toLowerCase();
        if (!normalized || !rule.enabled) return;

        const existingOwner = duplicatePrefixOwner.get(normalized);
        if (existingOwner !== undefined && existingOwner !== provider.id) {
          throw new Error(`prefix 已被其他 provider 使用: ${rule.prefix}`);
        }

        duplicatePrefixOwner.set(normalized, provider.id);
      });
    });
  }

  async function onSaveProviderConfig(providerId: number) {
    const draft = providerConfigDrafts[providerId] ?? {
      displayName: "",
      displayTargetProviderId: null,
      prefixRules: [],
      brandingColor: "",
      modelsDevProviderId: "",
      modelsDevProviderAliases: "",
      pricingDisabled: false
    };
    const normalizedDisplayName = draft.displayName.trim();
    const normalizedBrandingColor = draft.brandingColor.trim().toLowerCase();
    const modelsDevProviderId = draft.modelsDevProviderId.trim();
    const modelsDevProviderAliases = Array.from(new Set(
      draft.modelsDevProviderAliases
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ));

    try {
      validateProviderDraft(providerId, draft);
      setSavingProviderConfigId(providerId);

      const result = await postJson(
        "/api/admin/providers",
        {
          providerId,
          config: {
            displayName: normalizedDisplayName.length > 0 ? normalizedDisplayName : null,
            displayTargetProviderId: draft.displayTargetProviderId,
            prefixRules: draft.prefixRules
              .map((rule) => ({
                prefix: rule.prefix.trim(),
                enabled: rule.enabled,
                ...(typeof rule.priority === "number" && Number.isFinite(rule.priority)
                  ? { priority: Math.trunc(rule.priority) }
                  : {}),
                ...(typeof rule.note === "string" && rule.note.trim().length > 0
                  ? { note: rule.note.trim() }
                  : {})
              }))
              .filter((rule) => rule.prefix.length > 0),
            branding: {
              color: normalizedBrandingColor.length > 0 ? normalizedBrandingColor : null
            },
            pricing: {
              modelsDevProviderId: modelsDevProviderId.length > 0 ? modelsDevProviderId : null,
              modelsDevProviderAliases,
              disabled: draft.pricingDisabled
            }
          }
        },
        "PATCH"
      );

      if (isProviderOption(result?.provider) && result.provider.id === providerId) {
        setProviderConfigDrafts((prev) => ({
          ...prev,
          [providerId]: toProviderConfigDraft(result.provider)
        }));
      }

      router.refresh();
      notifySuccess("Provider 配置已保存", ["展示名、展示归并、前缀规则、配色均已提交，页面已自动刷新。"]); 
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 provider 配置失败");
    } finally {
      setSavingProviderConfigId(null);
    }
  }

  function openDeleteProviderConfirm(providerId: number) {
    const candidateProviders = providers.filter((provider) => provider.id !== providerId);
    setProviderDeleteTargetId(providerId);
    setProviderDeleteTransferTargetId(candidateProviders[0]?.id ?? null);
    setProviderDeleteConfirmOpen(true);
  }

  function closeDeleteProviderConfirm() {
    if (deletingProviderId !== null) return;
    setProviderDeleteConfirmOpen(false);
    setProviderDeleteTargetId(null);
    setProviderDeleteTransferTargetId(null);
  }

  async function onConfirmDeleteProvider() {
    if (providerDeleteTargetId === null) {
      notifyError("未选择待删除 provider");
      return;
    }

    if (providerDeleteTransferTargetId === null) {
      notifyError("请先选择模型迁移目标 provider");
      return;
    }

    try {
      setDeletingProviderId(providerDeleteTargetId);

      await postJson(
        "/api/admin/providers",
        {
          providerId: providerDeleteTargetId,
          transferTargetProviderId: providerDeleteTransferTargetId
        },
        "DELETE"
      );

      setProviderDeleteConfirmOpen(false);
      setProviderDeleteTargetId(null);
      setProviderDeleteTransferTargetId(null);
      setSelectedProviderConfigId(null);

      router.refresh();
      notifySuccess("Provider 已删除", ["该 provider 旗下 models 已迁移到新 provider，原 provider 已删除，页面已自动刷新。"]);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除 provider 失败");
    } finally {
      setDeletingProviderId(null);
    }
  }

  async function onCreateProviderFromSearch() {
    const name = providerSearchQuery.trim();
    if (!name) return;

    try {
      await postJson("/api/admin/providers", { name });
      setProviderSearchQuery("");
      setProviderSearchOpen(false);
      router.refresh();
      notifySuccess(`Provider "${name}" 已创建，页面刷新后可在列表中选择。`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "创建 Provider 失败");
    }
  }

  return {
    providerConfigDrafts,
    savingProviderConfigId,
    deletingProviderId,
    providerDeleteConfirmOpen,
    providerDeleteTargetId,
    providerDeleteTransferTargetId,
    setProviderDeleteTransferTargetId,
    selectedProviderConfigId,
    setSelectedProviderConfigId,
    providerSearchQuery,
    setProviderSearchQuery,
    providerSearchOpen,
    setProviderSearchOpen,
    providerSearchRef,
    providerDropdownRef,
    filteredProviderOptions,
    selectedProviderForConfig,
    availableDisplayTargetProviders,
    updateProviderDraft,
    onSaveProviderConfig,
    openDeleteProviderConfirm,
    closeDeleteProviderConfirm,
    onConfirmDeleteProvider,
    onCreateProviderFromSearch
  };
}
