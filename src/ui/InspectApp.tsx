import { useEffect, useState } from "react";
import { useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { discoverInspectModel } from "../inspect/discover.js";
import { readPreview } from "../inspect/preview.js";
import { DiscoverOptions, InspectModel } from "../inspect/types.js";
import { watchTargets } from "../inspect/watch-targets.js";
import { InspectView } from "./InspectView.js";

function lineCount(text: string | undefined, boundary: number | undefined): number {
  if (!text) return 1;
  const extra = boundary === undefined ? 0 : 1;
  return text.split("\n").length + extra;
}

export function InspectApp({ options }: { options: DiscoverOptions }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [model, setModel] = useState<InspectModel>(() => discoverInspectModel(options));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [columns, setColumns] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setColumns(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const initial = discoverInspectModel(options);
    setModel(initial);
    const watcher = chokidar.watch(watchTargets(initial), {
      ignoreInitial: true,
      ignored: ["**/node_modules/**", "**/.git/**"],
    });
    const refresh = () => {
      const next = discoverInspectModel(options);
      watcher.add(watchTargets(next));
      setModel(next);
      setSelectedIndex((index) => Math.min(index, Math.max(next.entries.length - 1, 0)));
    };
    watcher.on("add", refresh).on("change", refresh).on("unlink", refresh);
    return () => {
      void watcher.close();
    };
  }, [options]);

  const selected = model.entries[selectedIndex];
  const preview = selected ? readPreview(selected) : { notice: "未找到" };
  const maxScroll = Math.max(lineCount(preview.text, preview.loadBoundaryLine) - 1, 0);

  useInput(
    (input, key) => {
      if (input === "q") exit();
      if (input === "j" || key.downArrow) {
        setSelectedIndex((index) => Math.min(index + 1, Math.max(model.entries.length - 1, 0)));
        setPreviewScroll(0);
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((index) => Math.max(index - 1, 0));
        setPreviewScroll(0);
      }
      if (input === "]") setPreviewScroll((scroll) => Math.min(scroll + 1, maxScroll));
      if (input === "[") setPreviewScroll((scroll) => Math.max(scroll - 1, 0));
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <InspectView
      model={model}
      selectedIndex={selectedIndex}
      preview={preview}
      previewScroll={previewScroll}
      stacked={columns < 80}
    />
  );
}
