"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";

// Turnstile 人机验证（v0.1.1 M2-1，默认关）：siteKey 为空时组件不挂载、零墙外请求。
// 脚本在首次 consumeToken 时才动态注入（懒加载，不常驻、不用 next/script）；
// 加载超时 / 失败 / 取 token 超时 → resolve ""（调用方按「缺 token 降级放行」继续提交）。
// token 一次性：consumeToken 取走当前 token 后立即 reset 铸下一枚。

export interface TurnstileHandle {
  consumeToken(): Promise<string>;
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 10_000;
const TOKEN_WAIT_MS = 3_000;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

export const TurnstileWidget = forwardRef<
  TurnstileHandle,
  { siteKey: string }
>(function TurnstileWidget({ siteKey }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waitersRef = useRef<((t: string | null) => void)[]>([]);
  const scriptPromiseRef = useRef<Promise<boolean> | null>(null);

  const settleWaiters = useCallback((token: string | null) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const w of waiters) w(token);
  }, []);

  const ensureScript = useCallback((): Promise<boolean> => {
    if (!scriptPromiseRef.current) {
      scriptPromiseRef.current = new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => resolve(ok);
        const timer = setTimeout(() => {
          console.warn("[turnstile] 脚本加载超时");
          done(false);
        }, SCRIPT_TIMEOUT_MS);
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          clearTimeout(timer);
          done(true);
        };
        script.onerror = () => {
          clearTimeout(timer);
          console.warn("[turnstile] 脚本加载失败");
          done(false);
        };
        document.head.appendChild(script);
      });
    }
    return scriptPromiseRef.current;
  }, []);

  const ensureWidget = useCallback(async (): Promise<boolean> => {
    const ok = await ensureScript();
    if (!ok || !window.turnstile || !containerRef.current) return false;
    if (widgetIdRef.current === null) {
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            tokenRef.current = token;
            settleWaiters(token);
          },
          "expired-callback": () => {
            tokenRef.current = null;
          },
          "error-callback": () => {
            console.warn("[turnstile] widget 报错");
            tokenRef.current = null;
          },
        });
      } catch (e) {
        console.warn("[turnstile] 渲染失败：", e);
        return false;
      }
    }
    return widgetIdRef.current !== null;
  }, [siteKey, settleWaiters, ensureScript]);

  const consumeToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) {
      const t = tokenRef.current;
      tokenRef.current = null;
      try {
        window.turnstile?.reset(widgetIdRef.current ?? undefined);
      } catch {
        // 忽略
      }
      return t;
    }
    const rendered = await ensureWidget();
    if (!rendered) return "";
    const token = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
      waitersRef.current.push((t) => {
        clearTimeout(timer);
        resolve(t);
      });
    });
    if (!token) {
      console.warn("[turnstile] 取 token 超时，降级放行");
      return "";
    }
    try {
      window.turnstile?.reset(widgetIdRef.current ?? undefined);
    } catch {
      // 忽略
    }
    return token;
  }, [ensureWidget]);

  useImperativeHandle(ref, () => ({ consumeToken }), [consumeToken]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute left-[-9999px] top-0 size-px overflow-hidden"
    />
  );
});
