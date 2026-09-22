import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFileName,
  isValidAssetPath,
  ASSET_PATH_PATTERN,
  PENDING_REF_PATTERN,
  pendingDirDateMs,
  extOf,
  sniffImageType,
  isZipMagic,
  assetContentType,
  assetIsInlineImage,
} from "../src/lib/attachments.ts";

// 附件安全（03 §3.2/§3.3、02 §7.1；04 §6 映射行：白名单拒绝 ../ 与非 assets 路径）

test("sanitizeFileName：空格与特殊字符替换、扩展名小写、超长截断、空名回退", () => {
  assert.equal(sanitizeFileName("屏幕截图 2026.png"), "屏幕截图-2026.png");
  assert.equal(sanitizeFileName("a:b*c?.JPG"), "a-b-c.jpg");
  assert.equal(sanitizeFileName("报\\错:日/志.log"), "报-错-日-志.log");
  const long = "长".repeat(100) + ".txt";
  const out = sanitizeFileName(long);
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith(".txt"));
  assert.equal(sanitizeFileName(""), "file");
  assert.equal(sanitizeFileName("///"), "file");
});

test("isValidAssetPath：合法放行；../、_pending、越界路径拒绝", () => {
  assert.ok(
    isValidAssetPath("feedback/assets/20260921-143025-a3f9kz/s1-导出闪退.png")
  );
  assert.ok(
    isValidAssetPath("feedback/assets/20260919-091512-m2x8q7/a1-aisc-debug.log")
  );
  // 穿越与编码穿越
  assert.ok(!isValidAssetPath("feedback/assets/../../../etc/passwd"));
  assert.ok(
    !isValidAssetPath("feedback/assets/20260921-143025-a3f9kz/..%2F..%2Fx.png")
  );
  // _pending 不匹配（目录段必须为 id 形态）
  assert.ok(!isValidAssetPath("feedback/assets/_pending/xx/a.png"));
  // 非 feedback/assets 前缀
  assert.ok(!isValidAssetPath("feedback/20260921-143025-a3f9kz.md"));
  assert.ok(!isValidAssetPath(".github/workflows/x.yml"));
  // 文件名段为 ".." 显式拒绝
  assert.ok(!isValidAssetPath("feedback/assets/20260921-143025-a3f9kz/.."));
});

test("PENDING_REF_PATTERN：日期化目录与旧 uuid 目录双格式兼容", () => {
  // v0.1.1 新格式：YYYYMMDD-HHmmss-uuid4
  assert.ok(
    PENDING_REF_PATTERN.test(
      "_pending/20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/屏幕截图.png"
    )
  );
  // v0.1.0 旧格式（过渡期兼容）
  assert.ok(
    PENDING_REF_PATTERN.test("_pending/3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/屏幕截图.png")
  );
  assert.ok(!PENDING_REF_PATTERN.test("_pending/abc/a.png")); // 非法目录
  assert.ok(
    !PENDING_REF_PATTERN.test(
      "_pending/2026-0922-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/a.png"
    )
  ); // 日期段形状非法（日期位取值合法性由 pendingDirDateMs 判）
  assert.ok(!PENDING_REF_PATTERN.test("assets/3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/a.png"));
});

test("pendingDirDateMs：目录名日期时间（北京时间）→ epoch ms", () => {
  assert.equal(
    pendingDirDateMs("20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"),
    Date.UTC(2026, 8, 22, 6, 30, 5) // 北京 = UTC+8
  );
  assert.equal(pendingDirDateMs("3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"), null); // 旧格式无日期
  assert.equal(pendingDirDateMs("garbage"), null);
});

test("ASSET_PATH_PATTERN 形态约束", () => {
  assert.match(
    "feedback/assets/20260921-143025-a3f9kz/s1-白屏.png",
    ASSET_PATH_PATTERN
  );
});

test("魔数嗅闻：jpeg/png/webp/zip；文本与其他不误判", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(sniffImageType(jpeg), "jpeg");
  assert.equal(sniffImageType(png), "png");
  assert.equal(sniffImageType(webp), "webp");
  assert.equal(sniffImageType(zip), null); // zip 不是图片
  assert.equal(sniffImageType(Buffer.from("<svg>")), null); // svg 拒绝
  assert.equal(sniffImageType(Buffer.from("%PDF-1.4")), null);
  assert.ok(isZipMagic(zip));
  assert.ok(!isZipMagic(png));
});

test("扩展名与 Content-Type 映射", () => {
  assert.equal(extOf("A.B.PNG"), "png");
  assert.equal(extOf("noext"), "");
  assert.equal(assetContentType("s1-a.jpg"), "image/jpeg");
  assert.equal(assetContentType("a1-x.log"), "text/plain; charset=utf-8");
  assert.equal(assetContentType("a1-x.zip"), "application/zip");
  assert.ok(assetIsInlineImage("s1-a.webp"));
  assert.ok(!assetIsInlineImage("a1-a.zip"));
});
