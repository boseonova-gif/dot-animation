"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob, exportAnimationMp4 } from "@/lib/exportMp4";
import {
  createColorDistributionSeed,
  generateFreshPalette,
  generateRandomBackgroundColor,
} from "@/lib/colorEffects";
import { computePreviewSizeForViewport } from "@/lib/previewSize";
import { extractSourcePaletteFromVideo } from "@/lib/sourcePalette";
import { PREVIEW_MAX_PROCESS_WIDTH, processVideoFrame, renderProcessedFrame } from "@/lib/videoStylizer";
import {
  DEFAULT_SETTINGS,
  normalizePalette,
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
  displayWidth,
  displayHeight,
  backgroundClass,
  panelStyle,
  children,
}: {
  label: string;
  displayWidth: number;
  displayHeight: number;
  backgroundClass: string;
  panelStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative shrink-0 rounded-2xl ${backgroundClass}`}
      style={panelStyle}
    >
      <span className="absolute left-3 top-3 z-10 rounded-md bg-black/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-white/70">
        {label}
      </span>
      <div
        className="relative"
        style={{ width: displayWidth, height: displayHeight }}
      >
        {children}
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
  const [previewSize, setPreviewSize] = useState({ width: 320, height: 180 });
  const [videoAspect, setVideoAspect] = useState({ width: 16, height: 9 });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [hasRandomDistribution, setHasRandomDistribution] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef<StylizerSettings>(DEFAULT_SETTINGS);
  const animationRef = useRef<number | null>(null);
  const recordingPreviewRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const sourcePaletteRef = useRef<string[]>(normalizePalette(DEFAULT_SETTINGS.colors));
  const colorDistributionSeedRef = useRef(0);

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

  const stopRecordingPreview = useCallback(() => {
    if (recordingPreviewRef.current !== null) {
      cancelAnimationFrame(recordingPreviewRef.current);
      recordingPreviewRef.current = null;
    }
  }, []);

  const loadVideoFromBlob = useCallback(
    async (blob: Blob, mode: SourceMode) => {
      const url = URL.createObjectURL(blob);
      const video = videoRef.current;
      if (!video) return;

      stopAnimation();
      setIsPlaying(false);
      colorDistributionSeedRef.current = 0;
      setHasRandomDistribution(false);

      if (video.srcObject) {
        video.srcObject = null;
      }
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
      if (canvas && video.videoWidth > 0) {
        setVideoAspect({ width: video.videoWidth, height: video.videoHeight });
        const palette = await extractSourcePaletteFromVideo(video, canvas, 0);
        sourcePaletteRef.current = [...palette];
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

    if (sourceCanvas.width !== video.videoWidth || sourceCanvas.height !== video.videoHeight) {
      sourceCanvas.width = video.videoWidth;
      sourceCanvas.height = video.videoHeight;
    }
    sourceContext.drawImage(video, 0, 0);

    const processed = processVideoFrame(
      sourceCanvas,
      currentSettings,
      sourcePaletteRef.current,
      colorDistributionSeedRef.current,
      { maxProcessWidth: PREVIEW_MAX_PROCESS_WIDTH },
    );
    renderProcessedFrame(outputCanvas, processed, currentSettings, { pixelRatio: 1 });
  }, []);

  const recordingPreviewTick = useCallback(() => {
    renderFrame();
    if (mediaRecorderRef.current?.state === "recording") {
      recordingPreviewRef.current = requestAnimationFrame(recordingPreviewTick);
    }
  }, [renderFrame]);

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
    renderFrame();

    if (isPlaying) {
      await video.play();
      animationRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying, renderFrame, sourceMode, tick]);

  const handleRandomPalette = useCallback(() => {
    const seed = Date.now();
    setSettings((current) => ({
      ...current,
      colors: generateFreshPalette(seed),
      backgroundColor: generateRandomBackgroundColor(seed),
    }));
  }, []);

  const handleRandomColorDistribution = useCallback(() => {
    colorDistributionSeedRef.current = createColorDistributionSeed();
    setHasRandomDistribution(true);
    renderFrame();
  }, [renderFrame]);

  const handleResetColorDistribution = useCallback(() => {
    colorDistributionSeedRef.current = 0;
    setHasRandomDistribution(false);
    renderFrame();
  }, [renderFrame]);

  const handleColorChange = useCallback((index: number, color: string) => {
    setSettings((current) => {
      const next = normalizePalette(current.colors);
      next[index] = color.toLowerCase();
      return { ...current, colors: next };
    });
  }, []);

  const handleRestoreSourcePalette = useCallback(async () => {
    const video = videoRef.current;
    const canvas = sourceCanvasRef.current;
    if (!video || !canvas || sourceMode === "idle") return;

    try {
      const palette = await extractSourcePaletteFromVideo(video, canvas, 0);
      sourcePaletteRef.current = [...palette];
      colorDistributionSeedRef.current = 0;
      setHasRandomDistribution(false);
      setSettings((current) => ({ ...current, colors: palette }));
      renderFrame();
    } catch {
      setStatus("원본 영상에서 컬러를 추출하지 못했습니다.");
    }
  }, [renderFrame, sourceMode]);

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
    stopRecordingPreview();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecording(false);
  }, [stopRecordingPreview]);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();

        const syncAspect = () => {
          if (video.videoWidth > 0) {
            setVideoAspect({ width: video.videoWidth, height: video.videoHeight });
          }
        };
        if (video.videoWidth > 0) syncAspect();
        else video.addEventListener("loadedmetadata", syncAspect, { once: true });
      }

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
        stopRecordingPreview();
        if (videoRef.current) videoRef.current.srcObject = null;
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
      recordingPreviewRef.current = requestAnimationFrame(recordingPreviewTick);
    } catch {
      setStatus("카메라 권한이 거부되었습니다.");
      setIsRecording(false);
    }
  }, [isRecording, loadVideoFromBlob, recordingPreviewTick, stopRecording, stopRecordingPreview]);

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
        assignmentPalette: sourcePaletteRef.current,
        colorDistributionSeed: colorDistributionSeedRef.current,
        onProgress: setExportProgress,
      });
      downloadBlob(blob, `blob-animation-${Date.now()}.mp4`);
      setStatus("MP4 내보내기가 완료되었습니다.");
      renderFrame();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MP4 내보내기에 실패했습니다.");
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [renderFrame, sourceMode]);

  useEffect(() => {
    const previewArea = previewAreaRef.current;
    if (!previewArea) return;

    const updatePreviewSize = () => {
      const { width, height } = previewArea.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      setPreviewSize(
        computePreviewSizeForViewport(
          videoAspect.width,
          videoAspect.height,
          width,
          height,
        ),
      );
    };

    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(previewArea);
    window.addEventListener("resize", updatePreviewSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePreviewSize);
    };
  }, [videoAspect]);

  useEffect(() => {
    if ((sourceMode !== "idle" || isRecording) && !isPlaying) {
      renderFrame();
    }
  }, [settings, sourceMode, isRecording, isPlaying, renderFrame]);

  useEffect(() => {
    return () => {
      stopAnimation();
      stopRecordingPreview();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
    };
  }, [stopAnimation, stopRecordingPreview]);

  const hasSource = sourceMode !== "idle";
  const showPreview = hasSource || isRecording;

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <div
        ref={previewAreaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pt-3 sm:px-4 sm:pt-4"
      >
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <PreviewPanel
            label={isRecording ? "Recording" : "Original"}
            displayWidth={previewSize.width}
            displayHeight={previewSize.height}
            backgroundClass="bg-neutral-900"
          >
            <div className="relative size-full overflow-hidden">
              <video
                ref={videoRef}
                className={`size-full object-contain ${showPreview ? "block" : "hidden"}`}
                playsInline
                muted
                loop={hasSource}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {isRecording && (
                <span className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-red-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" />
                  Rec
                </span>
              )}
              {!showPreview && (
                <div className="flex size-full items-center justify-center text-sm text-neutral-500">
                  원본 영상
                </div>
              )}
            </div>
          </PreviewPanel>

          <PreviewPanel
            label="Animation"
            displayWidth={previewSize.width}
            displayHeight={previewSize.height}
            backgroundClass=""
            panelStyle={{ backgroundColor: settings.backgroundColor }}
          >
            {showPreview ? (
              <canvas ref={outputCanvasRef} className="block size-full object-contain" />
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-neutral-500">
                변환 결과
              </div>
            )}
          </PreviewPanel>
        </div>

        {status && (
          <p
            className={`pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs ${
              status.includes("완료") ? "text-neutral-500" : "text-red-500"
            }`}
          >
            {status}
          </p>
        )}
        {exportProgress && (
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs text-neutral-500">
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
            {isRecording ? "녹화 중지" : "카메라"}
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
            label="도트 크기"
            value={settings.dotSize}
            onChange={(v) => updateSetting("dotSize", v)}
          />
          <Slider
            label="밀집도"
            value={settings.dotDensity}
            onChange={(v) => updateSetting("dotDensity", v)}
          />
          <Slider
            label="컬러 면적"
            value={settings.colorArea}
            onChange={(v) => updateSetting("colorArea", v)}
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
            disabled={!hasSource}
            onClick={handleRestoreSourcePalette}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
          >
            원본 컬러
          </button>

          <button
            type="button"
            onClick={handleRandomPalette}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            랜덤 컬러
          </button>

          <button
            type="button"
            disabled={!hasSource}
            onClick={handleRandomColorDistribution}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
          >
            랜덤 면적
          </button>

          <button
            type="button"
            disabled={!hasSource || !hasRandomDistribution}
            onClick={handleResetColorDistribution}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
          >
            면적 초기화
          </button>

          <div className="mx-1 h-4 w-px bg-neutral-200" />

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-neutral-400">배경</span>
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(event) => {
                updateSetting("backgroundColor", event.target.value.toLowerCase());
              }}
              className="h-7 w-7 cursor-pointer appearance-none rounded-full border-2 border-white bg-transparent shadow-sm ring-1 ring-neutral-200"
            />
            <button
              type="button"
              onClick={() => updateSetting("backgroundColor", "#ffffff")}
              className={`rounded-lg border px-2 py-1 text-[10px] ${
                settings.backgroundColor === "#ffffff"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              W
            </button>
            <button
              type="button"
              onClick={() => updateSetting("backgroundColor", "#000000")}
              className={`rounded-lg border px-2 py-1 text-[10px] ${
                settings.backgroundColor === "#000000"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              B
            </button>
          </div>
        </div>
      </div>

      <canvas ref={sourceCanvasRef} className="hidden" aria-hidden />
    </div>
  );
}
