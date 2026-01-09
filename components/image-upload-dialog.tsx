"use client";

import { useState, useCallback } from "react";
import { Upload, Link as LinkIcon, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ImageUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (url: string, alt: string) => void;
}

type TabType = "upload" | "url";

export function ImageUploadDialog({
  open,
  onOpenChange,
  onInsert,
}: ImageUploadDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [error, setError] = useState("");

  const resetState = useCallback(() => {
    setImageUrl("");
    setAltText("");
    setError("");
    setIsDragging(false);
    setIsUploading(false);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetState();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetState]
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please select an image file");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be less than 5MB");
        return;
      }

      setIsUploading(true);
      setError("");

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Upload failed");
        }

        const { url } = await response.json();
        const defaultAlt = file.name.replace(/\.[^/.]+$/, "");
        onInsert(url, altText || defaultAlt);
        handleOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [altText, handleOpenChange, onInsert]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer?.files?.[0];
      if (file) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleUrlInsert = useCallback(() => {
    if (!imageUrl.trim()) {
      setError("Please enter an image URL");
      return;
    }

    try {
      new URL(imageUrl);
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    onInsert(imageUrl, altText || "Image");
    handleOpenChange(false);
  }, [imageUrl, altText, handleOpenChange, onInsert]);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogTitle>Insert Image</AlertDialogTitle>
        <AlertDialogDescription className="sr-only">
          Upload an image or insert from URL
        </AlertDialogDescription>

        {/* Tabs */}
        <div className="flex gap-2 mt-4">
          <Button
            variant={activeTab === "upload" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("upload")}
            className="flex-1"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
          <Button
            variant={activeTab === "url" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("url")}
            className="flex-1"
          >
            <LinkIcon className="h-4 w-4 mr-2" />
            URL
          </Button>
        </div>

        <div className="mt-4">
          {activeTab === "upload" ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Uploading...</p>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag and drop an image, or
                  </p>
                  <label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <span className="text-sm text-primary hover:underline cursor-pointer">
                      browse to upload
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-2">
                    Max 5MB • PNG, JPG, GIF, WebP
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  Image URL
                </label>
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.png"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">
                  Alt Text (optional)
                </label>
                <Input
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Description of the image"
                  className="mt-1"
                />
              </div>
              <Button onClick={handleUrlInsert} className="w-full">
                Insert Image
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive mt-2">{error}</p>}

        <AlertDialogCancel className="mt-4">Cancel</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  );
}
