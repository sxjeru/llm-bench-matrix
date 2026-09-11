const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT_MS = 4000;

export interface TurnstileVerifyParams {
  token?: string | null;
  remoteIp?: string;
  secretKey?: string;
  timeoutMs?: number;
}

export interface TurnstileVerifyResult {
  success: boolean;
  bypassed?: boolean;
  error?: string;
}

/**
 * 校验 Cloudflare Turnstile Token
 *
 * 安全设计：
 * 1. 开箱即用与优雅降级：若未配置 TURNSTILE_SECRET_KEY（如开发环境或未配置实例），自动 Bypass，不阻塞正常业务。
 * 2. 严格前置校验：若配置了 Secret Key，必须提交有效 Token，未通过则快速失败。
 * 3. 超时保护：默认 4 秒超时中断，避免 Cloudflare 网络异常拖垮 Serverless/Node.js 实例。
 */
export async function verifyTurnstileToken({
  token,
  remoteIp,
  secretKey = process.env.TURNSTILE_SECRET_KEY,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: TurnstileVerifyParams): Promise<TurnstileVerifyResult> {
  // 未配置 Secret Key 时自动跳过验证（兼容本地开发与未启用 Turnstile 的环境）
  if (!secretKey || !secretKey.trim()) {
    return { success: true, bypassed: true };
  }

  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    return {
      success: false,
      error: "请完成人机验证后再提交"
    };
  }

  if (trimmedToken.length > 2048) {
    return {
      success: false,
      error: "人机验证凭证长度超出限制"
    };
  }

  try {
    const params = new URLSearchParams();
    params.append("secret", secretKey.trim());
    params.append("response", trimmedToken);
    if (remoteIp && remoteIp.trim() && remoteIp !== "global") {
      params.append("remoteip", remoteIp.trim());
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params,
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      return {
        success: false,
        error: "人机验证服务通信异常，请稍后重试"
      };
    }

    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };

    if (data && data.success === true) {
      return { success: true, bypassed: false };
    }

    return {
      success: false,
      error: "人机验证未通过，请刷新后重试"
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      return {
        success: false,
        error: "人机验证请求超时，请检查网络后重试"
      };
    }

    return {
      success: false,
      error: "人机验证服务暂时不可用，请稍后重试"
    };
  }
}

