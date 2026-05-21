"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob, exportAnimationMp4 } from "@/lib/exportMp4";
import { generateFreshPalette } from "@/lib/colorEffects";
import { extractPaletteFromImageData } from "@/lib/colorUtils";
import { blendFrames, processVideoFrame, renderProcessedFrame } from "@/lib/videoStylizer";
import {
  DEFAULT_SETTINGS,
  MAX_COLORS,
  normalizePalette,
  type ProcessedFrame,
  type StylizerSettings,
} from "@/lib/types";

type SourceMode = "idle" | "upload" | "record";

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-[140px] flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className="tabular-nums text-neutral-400">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-neutral-900"
      />
    </label>
  );
}

function PreviewPanel({
  label,
  videoWidth,
  videoHeight,
  backgroundClass,
  children,
}: {
  label: string;
  videoWidth: number;
  videoHeight: number;
  backgroundClass: string;
  children: React.ReactNode;
}) {
  const isLandscape = videoWidth >= videoHeight;

  return (
    <div className={`relative min-h-0 overflow-hidden rounded-2xl ${backgroundClass}`}>
      <span className="absolute left-3 top-3 z-10 rounded-md bg-black/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-white/70">
        {label}
      </span>
      <div className="flex h-full w-full items-center justify-center p-2">
        <div
          className="max-h-full max-w-full"
          style={{
            aspectRatio: `${videoWidth} / ${videoHeight}`,
            width: isLandscape ? "100%" : "auto",
            height: isLandscape ? "auto" : "100%",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function VideoStylizer() {
  const [settings, setSettings] = useState<StylizerSettings>(DEFAULT_SETTINGS);
  const [sourceMode, setSourceMode] = useState<SourceMode>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null,
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef<StylizerSettings>(DEFAULT_SETTINGS);
  const animationRef = useRef<number | null>(null);
  const previousFrameRef = useRef<ProcessedFrame | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  settingsRef.current = settings;

  const updateSetting = useCallback(
    <K extends keyof StylizerSettings>(key: K, value: StylizerSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const loadVideoFromBlob = useCallback(
    async (blob: Blob, mode: SourceMode) => {
      const url = URL.createObjectURL(blob);
      const video = videoRef.current;
      if (!video) return;

      stopAnimation();
      setIsPlaying(false);
      previousFrameRef.current = null;

      video.src = url;
      video.load();

      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener("loadeddata", onLoaded);
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener("loadeddata", onLoaded);
          video.removeEventListener("error", onError);
          reject(new Error("영상을 불러오지 못했습니다."));
        };
        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("error", onError);
      });

      const canvas = sourceCanvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (canvas && context && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        setVideoSize({ width: video.videoWidth, height: video.videoHeight });
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const palette = normalizePalette(extractPaletteFromImageData(image.data, MAX_COLORS));
        setSettings((current) => ({ ...current, colors: palette }));
      }

      setSourceMode(mode);
      setStatus("");
    },
    [stopAnimation],
  );

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    if (!video || !sourceCanvas || !outputCanvas || video.readyState < 2) return;

    const currentSettings = settingsRef.current;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return;

    sourceCanvas.width = video.videoWidth;
    sourceCanvas.height = video.videoHeight;
    sourceContext.drawImage(video, 0, 0);

    const processed = processVideoFrame(sourceCanvas, currentSettings);
    const blended = blendFrames(
      previousFrameRef.current,
      processed,
      currentSettings.motionDetail,
    );
    previousFrameRef.current = blended;
    renderProcessedFrame(outputCanvas, blended, currentSettings);
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) {
      stopAnimation();
      setIsPlaying(false);
      return;
    }

    renderFrame();
    animationRef.current = requestAnimationFrame(tick);
  }, [renderFrame, stopAnimation]);

  const handlePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || sourceMode === "idle") return;

    try {
      await video.play();
      setIsPlaying(true);
      animationRef.current = requestAnimationFrame(tick);
    } catch {
      setStatus("재생을 시작할 수 없습니다.");
    }
  }, [sourceMode, tick]);

  const handlePause = useCallback(() => {
    videoRef.current?.pause();
    stopAnimation();
    setIsPlaying(false);
  }, [stopAnimation]);

  const handleRestart = useCallback(async () => {
    const video = videoRef.current;
    if (!video || sourceMode === "idle") return;

    video.currentTime = 0;
    previousFrameRef.current = null;
    renderFrame();

    if (isPlaying) {
      await video.play();
      animationRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying, renderFrame, sourceMode, tick]);

  const handleRandomPalette = useCallback(() => {
    setSettings((current) => ({
      ...current,
      colors: generateFreshPalette(),
    }));
    previousFrameRef.current = null;
  }, []);

  const handleColorChange = useCallback((index: number, color: string) => {
    setSettings((current) => {
      const next = normalizePalette(current.colors);
      next[index] = color.toLowerCase();
      return { ...current, colors: next };
    });
    previousFrameRef.current = null;
  }, []);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        await loadVideoFromBlob(file, "upload");
      } catch {
        setStatus("업로드한 영상을 처리하지 못했습니다.");
      } finally {
        event.target.value = "";
      }
    },
    [loadVideoFromBlob],
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        try {
          await loadVideoFromBlob(blob, "record");
        } catch {
          setStatus("녹화 영상을 불러오지 못했습니다.");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setStatus("화면 녹화 권한이 거부되었습니다.");
      setIsRecording(false);
    }
  }, [isRecording, loadVideoFromBlob, stopRecording]);

  const handleExportMp4 = useCallback(async () => {
    const video = videoRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    if (!video || !sourceCanvas || !outputCanvas || sourceMode === "idle") return;

    setIsExporting(true);
    setExportProgress(null);
    setStatus("MP4 내보내는 중…");

    try {
      const blob = await exportAnimationMp4({
        video,
        sourceCanvas,
        outputCanvas,
        settings: settingsRef.current,
        onProgress: setExportProgress,
      });
      downloadBlob(blob, `blob-animation-${Date.now()}.mp4`);
      setStatus("MP4 내보내기가 완료되었습니다.");
      previousFrameRef.current = null;
      renderFrame();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MP4 내보내기에 실패했습니다.");
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [renderFrame, sourceMode]);

  useEffect(() => {
    if (sourceMode !== "idle") {
      renderFrame();
    }
  }, [settings, sourceMode, renderFrame]);

  useEffect(() => {
    return () => {
      stopAnimation();
      stopRecording();
    };
  }, [stopAnimation, stopRecording]);

  const hasSource = sourceMode !== "idle";

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:gap-3">
          <PreviewPanel
            label="Original"
            videoWidth={videoSize.width}
            videoHeight={videoSize.height}
            backgroundClass="bg-neutral-900"
          >
            <div className="relative h-full w-full">
              <video
                ref={videoRef}
                className={`h-full w-full ${hasSource ? "block" : "hidden"}`}
                playsInline
                muted
                loop
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {!hasSource && (
                <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
                  원본 영상
                </div>
              )}
            </div>
          </PreviewPanel>

          <PreviewPanel
            label="Animation"
            videoWidth={videoSize.width}
            videoHeight={videoSize.height}
            backgroundClass="bg-[#F5D5CB]"
          >
            {hasSource ? (
              <canvas ref={outputCanvasRef} className="block h-full w-full" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
                변환 결과
              </div>
            )}
          </PreviewPanel>
        </div>

        {status && (
          <p className={`mt-2 text-center text-xs ${status.includes("완료") ? "text-neutral-500" : "text-red-500"}`}>
            {status}
          </p>
        )}
        {exportProgress && (
          <p className="mt-1 text-center text-xs text-neutral-500">
            내보내기 {exportProgress.current}/{exportProgress.total} 프레임
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <button
            type="button"
            disabled={!hasSource}
            onClick={isPlaying ? handlePause : handlePlay}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-30"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            disabled={!hasSource}
            onClick={handleRestart}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          >
            Restart
          </button>
          <button
            type="button"
            disabled={!hasSource || isExporting}
            onClick={handleExportMp4}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          >
            {isExporting ? "Exporting…" : "Export MP4"}
          </button>
          <div className="mx-1 h-4 w-px bg-neutral-200" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Upload
          </button>
          <button
            type="button"
            onClick={startRecording}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              isRecording
                ? "bg-red-500 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {isRecording ? "Stop Rec" : "Record"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleUpload}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-3 px-4 py-3">
          <Slider
            label="형태"
            value={settings.shapeDetail}
            onChange={(v) => updateSetting("shapeDetail", v)}
          />
          <Slider
            label="모션"
            value={settings.motionDetail}
            onChange={(v) => updateSetting("motionDetail", v)}
          />
          <Slider
            label="도트 크기"
            value={settings.dotSize}
            onChange={(v) => updateSetting("dotSize", v)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-3">
          {normalizePalette(settings.colors).map((color, index) => (
            <label key={`color-${index}`} className="flex flex-col items-center gap-0.5">
              <input
                type="color"
                value={color}
                onChange={(event) => handleColorChange(index, event.target.value)}
                className="h-7 w-7 cursor-pointer appearance-none rounded-full border-2 border-white bg-transparent shadow-sm ring-1 ring-neutral-200"
              />
              <span className="text-[9px] text-neutral-400">{index + 1}</span>
            </label>
          ))}

          <div className="mx-1 h-4 w-px bg-neutral-200" />

          <button
            type="button"
            onClick={handleRandomPalette}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            랜덤 컬러
          </button>
        </div>
      </div>

      <canvas ref={sourceCanvasRef} className="hidden" aria-hidden />
    </div>
  );
}
