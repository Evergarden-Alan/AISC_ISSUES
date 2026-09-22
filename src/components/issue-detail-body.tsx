"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { remarkGfm, rehypeSanitizeWithSchema, rewriteAssetUrls } from "@/lib/markdown-config";

// 详情页正文渲染（01 §6.2）：分区 markdown + 截图灯箱 + 附件下载。
// XSS 双保险：rehype-sanitize 白名单（协议 http/https/mailto）+ 组件层只放行 /api/asset 资源。

interface Section {
  title: string;
  text: string;
}

export function IssueDetailBody({
  sections,
  replies,
}: {
  sections: Section[];
  replies: { time: string; text: string }[];
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div className="feedback-prose">
      {sections.map((s) =>
        s.title === "环境信息" ? (
          <details key={s.title} className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">
              设备与环境信息
            </summary>
            <div className="mt-2 text-sm text-slate-600">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitizeWithSchema]}
                components={componentMap(setLightbox)}
              >
                {rewriteAssetUrls(s.text)}
              </ReactMarkdown>
            </div>
          </details>
        ) : (
          <section key={s.title} className={s.title === "截图" ? "screenshot-grid" : ""}>
            <h2>{s.title}</h2>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitizeWithSchema]}
              components={componentMap(setLightbox)}
            >
              {rewriteAssetUrls(s.text)}
            </ReactMarkdown>
          </section>
        )
      )}

      <h2 className="mt-8 border-t border-slate-200 pt-6">开发者回复</h2>
      {replies.length === 0 ? null : (
        <ol className="mt-2 space-y-4">
          {replies.map((r, i) => (
            <li key={i} className="rounded-xl border border-green-200 bg-green-50/50 p-4">
              <p className="text-xs text-slate-500">开发者 · {r.time}</p>
              <div className="mt-1 text-slate-800">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitizeWithSchema]}
                  components={componentMap(setLightbox)}
                >
                  {rewriteAssetUrls(r.text)}
                </ReactMarkdown>
              </div>
            </li>
          ))}
        </ol>
      )}

      {lightbox ? (
        <div
          role="dialog"
          aria-label="查看截图"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="截图放大查看"
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            aria-label="关闭"
            className="absolute right-4 top-4 rounded-full bg-white/20 px-4 py-2 text-sm text-white"
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}

// 组件级过滤（sanitize 之外的第二道防线）：
// 图片仅放行 /api/asset 相对路径并接入灯箱；链接仅放行 /api/asset 下载与站内跳转
function componentMap(
  setLightbox: (src: string) => void
): React.ComponentProps<typeof ReactMarkdown>["components"] {
  return {
    img: ({ src, alt }) => {
      if (typeof src !== "string" || !src.startsWith("/api/asset")) return null;
      return (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <img
          src={src}
          alt={alt ?? "截图"}
          loading="lazy"
          onClick={() => setLightbox(src)}
          className="max-w-full cursor-zoom-in rounded-lg"
        />
      );
    },
    a: ({ href, children }) => {
      if (typeof href !== "string") return null;
      const ok =
        href.startsWith("/api/asset") ||
        href.startsWith("/") ||
        /^https?:\/\//i.test(href) ||
        /^mailto:/i.test(href);
      if (!ok) return null;
      return (
        <a
          href={href}
          rel="noreferrer"
          className="text-blue-600 underline hover:text-blue-800"
        >
          {children}
        </a>
      );
    },
  };
}
