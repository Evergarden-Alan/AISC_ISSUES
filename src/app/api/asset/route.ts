import { NextRequest, NextResponse } from "next/server";
import {
  assetContentType,
  assetIsInlineImage,
  isValidAssetPath,
} from "@/lib/attachments";
import { githubGetFileBytes } from "@/lib/github-client";

// GET /api/asset?path=issues/{目录名}/{文件名} —— 私有仓库资源代理（v0.1.2 布局）
// 大陆不可达 GitHub raw：一切图片/附件经本端点读取。
// 白名单：仅 issues/{目录}/ 内文件；拒绝 .. 与 _pending（多一段天然不匹配）。
// 注：Origin 校验仅约束写端点（03 §3）——<img> 的 GET 不携带 Origin 头，
// 且读端点已有路径白名单防护。

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ ok: false, error: "附件不存在" }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!isValidAssetPath(path)) {
    return NextResponse.json({ ok: false, error: "文件路径不合法" }, { status: 400 });
  }

  try {
    // raw 方式读字节（>1MB 文件 JSON 读不返回 content）；
    // 缓存由响应头 max-age=300 + immutable 承担
    const bytes = await githubGetFileBytes(path);
    if (!bytes) return notFound();
    const name = path.split("/").pop() ?? "file";
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": assetContentType(name),
        "Content-Disposition": `${assetIsInlineImage(name) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "public, max-age=300, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[api/asset] 读取失败：", e);
    return NextResponse.json(
      { ok: false, error: "暂时无法读取附件，请稍后重试" },
      { status: 500 }
    );
  }
}
