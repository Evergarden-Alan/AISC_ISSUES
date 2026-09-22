import { NextRequest, NextResponse } from "next/server";
import {
  assetContentType,
  assetIsInlineImage,
  isValidAssetPath,
} from "@/lib/attachments";
import { githubGetFile } from "@/lib/github-client";

// GET /api/asset?path=feedback/assets/{id}/{文件名} —— 私有仓库资源代理（03 §3.3）
// 大陆不可达 GitHub raw：一切图片/附件经本端点读取。
// 白名单：仅 feedback/assets/{id}/ 内文件；拒绝 .. 与 _pending；hidden 条目 404。
// 注：Origin 校验仅约束写端点（03 §3）——<img> 的 GET 不携带 Origin 头，
// 且读端点已有路径白名单 + hidden 404 双重防护。

export const runtime = "nodejs";

const REVALIDATE_SECONDS = 300;

function notFound() {
  return NextResponse.json({ ok: false, error: "附件不存在" }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!isValidAssetPath(path)) {
    return NextResponse.json({ ok: false, error: "文件路径不合法" }, { status: 400 });
  }

  try {
    // 所属反馈 hidden ⇒ 404（02 §2.2 硬约定 3）
    const id = path.split("/")[2];
    const feedback = await githubGetFile(`feedback/${id}.md`, REVALIDATE_SECONDS);
    if (!feedback?.content) return notFound();
    const head = feedback.content.slice(0, 2048);
    if (/^status: "hidden"$/m.test(head)) return notFound();

    const asset = await githubGetFile(path, REVALIDATE_SECONDS);
    if (!asset?.content) return notFound();
    const bytes = Buffer.from(asset.content, "base64");

    const name = path.split("/").pop() ?? "file";
    return new Response(bytes, {
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
