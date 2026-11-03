import { describe, expect, it } from "vitest";
import {
  attachmentContentType,
  attachmentLink,
  attachmentPath,
  attachmentUrl,
  imageProblem,
  isAttachmentPath,
  linkToAttachmentPath,
  MAX_ATTACHMENT_BYTES,
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

  it("rejects an image over about 10 MB, and accepts one just under", () => {
    expect(imageProblem({ type: "image/png", size: MAX_ATTACHMENT_BYTES + 1 })).toBe("Images must be under 10 MB");
    expect(imageProblem({ type: "image/png", size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(imageProblem({ type: "image/png", size: 0 })).toBe("The image is empty");
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
