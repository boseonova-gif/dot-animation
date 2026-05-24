"use client";

import dynamic from "next/dynamic";

const VideoStylizer = dynamic(() => import("@/components/VideoStylizer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      Blob Motion Studio 불러오는 중…
    </div>
  ),
});

export default function VideoStylizerClient() {
  return <VideoStylizer />;
}
