import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMIT_BYTES,
  attachmentContentType,
  attachmentLimitBytes,
  attachmentLink,
  attachmentPath,
  attachmentUrl,
  imageProblem,
  isAttachmentPath,
  linkToAttachmentPath,
  MAX_ATTACHMENT_BYTES,
  removeImageLinks,
  sizeLimitMessage,
} from ".";

describe("checking an image before it is stored", () => {
  it.each(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"])("accepts %s", (type) => {
    expect(imageProblem({ type, size: 1024 })).toBeNull();
  });

  it.each(["text/plain", "application/pdf", "image/tiff", "image/x-icon", ""])(
    "rejects %j with a message naming the accepted kinds",
    (type) => {
      expect(imageProblem({ type, size: 1024 })).toBe("Images only (JPEG, PNG, GIF, WebP, SVG)");
    },
  );

  it("rejects an image over the deployment's limit, naming it, and accepts one right at it", () => {
    expect(ATTACHMENT_LIMIT_BYTES).toBe(4 * 1024 * 1024);
    expect(imageProblem({ type: "image/png", size: ATTACHMENT_LIMIT_BYTES + 1 })).toBe("Images must be under 4 MB");
    expect(imageProblem({ type: "image/png", size: ATTACHMENT_LIMIT_BYTES })).toBeNull();
  });

  it("checks against another limit when given one, in the same words", () => {
    const limit = 1024;
    expect(imageProblem({ type: "image/png", size: limit + 1 }, limit)).toBe("Images must be under 1 kB");
    expect(imageProblem({ type: "image/png", size: limit }, limit)).toBeNull();
    expect(sizeLimitMessage(4.5 * 1024 * 1024)).toBe("Images must be under 4.5 MB");
    expect(sizeLimitMessage(2_000_000)).toBe("Images must be under 1.9 MB");
  });

  it("rejects an empty file", () => {
    expect(imageProblem({ type: "image/png", size: 0 })).toBe("The image is empty");
  });
});

describe("the deployment's attachment limit", () => {
  it("is 4 MB unless the environment says otherwise, never over the 10 MB cap", () => {
    expect(attachmentLimitBytes({})).toBe(4 * 1024 * 1024);
    expect(attachmentLimitBytes({ NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES: "2097152" })).toBe(2 * 1024 * 1024);
    expect(attachmentLimitBytes({ NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES: String(20 * 1024 * 1024) })).toBe(MAX_ATTACHMENT_BYTES);
  });

  it.each(["", "lots", "0", "-5", "1.5"])("ignores the value %j", (value) => {
    expect(attachmentLimitBytes({ NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES: value })).toBe(4 * 1024 * 1024);
  });
});

describe("removing an attachment's links from a note", () => {
  const path = "attachments/3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e.png";

  it("drops the image wherever the note embeds it, and the line it stood alone on", () => {
    const body = `Day one\n\n![Beach](/${path})\n\nText ![inline](/${path} "Beach") after\n`;
    expect(removeImageLinks(body, path)).toBe("Day one\n\nText  after\n");
  });

  it("recognises a link relative to a top-level note too, and leaves other images alone", () => {
    const body = `![](${path})\n![Other](/attachments/other.png)\n![Far](https://example.com/${path})\n`;
    expect(removeImageLinks(body, path)).toBe(`![Other](/attachments/other.png)\n![Far](https://example.com/${path})\n`);
  });

  it("returns the note unchanged when it holds no such link", () => {
    expect(removeImageLinks("Just text\n", path)).toBe("Just text\n");
  });
});

describe("where an attachment lives", () => {
  it("is stored under attachments/ with an extension for its type, and linked from the notebook root", () => {
    const path = attachmentPath("image/jpeg", "3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e");
    expect(path).toBe("attachments/3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e.jpg");
    expect(attachmentLink(path)).toBe("/attachments/3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e.jpg");
    expect(attachmentContentType(path)).toBe("image/jpeg");
  });

  it("recognises root-relative links, and links relative to a top-level note, as attachments", () => {
    expect(linkToAttachmentPath("/attachments/photo.png")).toBe("attachments/photo.png");
    expect(linkToAttachmentPath("attachments/photo.png")).toBe("attachments/photo.png");
    expect(linkToAttachmentPath("https://example.com/cat.jpg")).toBeNull();
    expect(linkToAttachmentPath("/attachments/../Secret.md")).toBeNull();
    expect(linkToAttachmentPath("/attachments/notes.md")).toBeNull();
    expect(linkToAttachmentPath("data:image/png;base64,AAAA")).toBeNull();
  });

  it.each([
    ["attachments/photo.png", true],
    ["attachments/Photo 2.JPG", true],
    ["attachments/deeper/photo.png", false],
    ["attachments/../README.md", false],
    ["attachments/.hidden.png", false],
    ["attachments/photo.exe", false],
    ["attachments/", false],
    ["photo.png", false],
  ])("isAttachmentPath(%j) is %s", (path, expected) => {
    expect(isAttachmentPath(path)).toBe(expected);
  });

  it("is served through the notebook's own route, by blob SHA when known", () => {
    const notebook = { owner: "octo-member", repo: "my-notes", branch: "main" };
    expect(attachmentUrl(notebook, "attachments/photo.png")).toBe(
      "/api/notebooks/octo-member/my-notes/attachments/photo.png?branch=main",
    );
    expect(attachmentUrl(notebook, "attachments/photo.png", "a".repeat(40))).toBe(
      `/api/notebooks/octo-member/my-notes/attachments/photo.png?branch=main&sha=${"a".repeat(40)}`,
    );
    expect(attachmentUrl({ ...notebook, branch: "feature/x" }, "attachments/a b.png")).toBe(
      "/api/notebooks/octo-member/my-notes/attachments/a%20b.png?branch=feature%2Fx",
    );
  });
});
