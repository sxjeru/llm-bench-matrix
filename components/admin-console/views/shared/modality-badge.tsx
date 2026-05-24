"use client";

import { Eye, Headphones, Layers, Video } from "lucide-react";
import { normalizeModalityName } from "../../utils/modality";

type ModalityBadgeProps = {
  modalityInput: string;
};

export function ModalityBadge({ modalityInput }: ModalityBadgeProps) {
  const modality = normalizeModalityName(modalityInput);

  if (modality === "Text") {
    return null;
  }

  if (modality === "Vision") {
    return (
      <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title="Vision">
        <Eye size={12} />
      </span>
    );
  }

  if (modality === "Audio") {
    return (
      <span className="inline-flex items-center rounded-md bg-purple-500/15 px-1.5 py-0.5 text-purple-300" title="Audio">
        <Headphones size={12} />
      </span>
    );
  }

  if (modality === "Video") {
    return (
      <span className="inline-flex items-center rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300" title="Video">
        <Video size={12} />
      </span>
    );
  }

  if (modality === "Multimodal") {
    return (
      <span
        className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
        title="Multimodal"
      >
        <Layers size={12} />
      </span>
    );
  }

  return null;
}
