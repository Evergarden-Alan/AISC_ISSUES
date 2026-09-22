import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { Schema } from "hast-util-sanitize";

// markdown 渲染配置（03 §8 XSS 条目）：
// remark-gfm + rehype-sanitize，链接协议白名单 http/https/mailto；
// 图片只允许 /api/asset 相对路径（渲染组件再过滤一层，双保险）。

export { remarkGfm };

/** [rehypeSanitize, schema] 元组，可整体放入 rehypePlugins */
export const rehypeSanitizeWithSchema: [typeof rehypeSanitize, Schema] = [
  rehypeSanitize,
  {
    ...defaultSchema,
    protocols: {
      ...defaultSchema.protocols,
      href: ["http", "https", "mailto"],
    },
  },
];

/**
 * 把 md 文本里的仓库相对附件路径改写为 /api/asset 代理地址
 * （v0.1.2 布局：md 内写 issues/{目录}/{文件}，前端渲染时重写；
 *  _pending 暂存路径不会被改写为可公开访问——白名单层同样拦截）
 */
export function rewriteAssetUrls(text: string): string {
  return text.replace(
    /issues\/[^\s)\]]+/g,
    (m) => `/api/asset?path=${encodeURIComponent(m)}`
  );
}
