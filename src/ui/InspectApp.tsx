import { useEffect, useState } from "react";
import { useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { discoverInspectModel } from "../inspect/discover.js";
import { previewLineCount } from "../inspect/preview-display.js";
import { readPreview } from "../inspect/preview.js";
import { DiscoverOptions, InspectModel } from "../inspect/types.js";
import { watchTargets } from "../inspect/watch-targets.js";
import { InspectUiView, InspectView } from "./InspectView.js";
import {
  clampScrollOffset,
  pageSizeFromTerminal,
  scrollOffsetForSelection,
} from "./scroll-window.js";

const LIST_CHROME_ROWS = 8;
const PREVIEW_CHROME_ROWS = 6;

export function InspectApp({ options }: { options: DiscoverOptions }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [model, setModel] = useState<InspectModel>(() => discoverInspectModel(options));
  const [view, setView] = useState<InspectUiView>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [listOffset, setListOffset] = useState(0);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [columns, setColumns] = useState(process.stdout.columns ?? 80);
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);

  const listPageSize = pageSizeFromTerminal(termRows, LIST_CHROME_ROWS);
  const previewPageSize = pageSizeFromTerminal(termRows, PREVIEW_CHROME_ROWS);

  useEffect(() => {
    const onResize = () => {
      setColumns(process.stdout.columns ?? 80);
      setTermRows(process.stdout.rows ?? 24);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setListOffset((offset) =>
      scrollOffsetForSelection(
        selectedIndex,
        clampScrollOffset(offset, model.entries.length, listPageSize),
        listPageSize,
      ),
    );
  }, [selectedIndex, listPageSize, model.entries.length]);

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
      setSelectedIndex((index) => {
        if (next.entries.length === 0) return 0;
        return Math.min(index, next.entries.length - 1);
      });
      setView((current) => {
        if (current === "preview" && next.entries.length === 0) return "list";
        return current;
      });
    };
    watcher.on("add", refresh).on("change", refresh).on("unlink", refresh);
    return () => {
      void watcher.close();
    };
  }, [options]);

  const selected = model.entries[selectedIndex];
  const preview = selected ? readPreview(selected) : { notice: "未找到" };
  const totalPreviewLines = previewLineCount(preview);
  const maxPreviewScroll = Math.max(0, totalPreviewLines - previewPageSize);

  useEffect(() => {
    setPreviewScroll((scroll) => clampScrollOffset(scroll, totalPreviewLines, previewPageSize));
  }, [selected?.id, previewPageSize, totalPreviewLines]);

  useInput(
    (input, key) => {
      if (input === "q") {
        exit();
        return;
      }

      if (view === "preview") {
        if (input === "b" || key.escape) {
          setView("list");
          setPreviewScroll(0);
          return;
        }
        if (input === "j" || key.downArrow) {
          setPreviewScroll((scroll) => Math.min(scroll + 1, maxPreviewScroll));
          return;
        }
        if (input === "k" || key.upArrow) {
          setPreviewScroll((scroll) => Math.max(scroll - 1, 0));
          return;
        }
        return;
      }

      if (key.return && model.entries.length > 0) {
        setView("preview");
        setPreviewScroll(0);
        return;
      }
      if (input === "j" || key.downArrow) {
        setSelectedIndex((index) => Math.min(index + 1, Math.max(model.entries.length - 1, 0)));
        return;
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((index) => Math.max(index - 1, 0));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <InspectView
      model={model}
      view={view}
      selectedIndex={selectedIndex}
      listOffset={listOffset}
      listPageSize={listPageSize}
      preview={preview}
      previewScroll={previewScroll}
      previewPageSize={previewPageSize}
      columns={columns}
    />
  );
}
