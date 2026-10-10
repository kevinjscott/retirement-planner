"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { ThinkingOrb } from "thinking-orbs";
import {
  analyzeImportItems,
  applyImportItems,
  resolutionsForConfirmItems,
  shortImportClause,
  type ImportExtraction,
} from "@/lib/scenario-import";
import { dataUrlToBase64, pdfFileToImages } from "@/lib/pdf-pages";
import type { ScenarioInput } from "@/lib/projection";

type PendingImage = {
  id: string;
  name: string;
  dataUrl: string;
  mediaType: string;
};

type Props = {
  scenario: ScenarioInput;
  onApply: (next: ScenarioInput) => void;
  /** Replace the default masthead button (e.g. inside the guided setup). */
  renderTrigger?: (open: () => void) => ReactNode;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function ScenarioImport({ scenario, onApply, renderTrigger }: Props) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState<ImportExtraction | null>(null);
  /** Matched list items: true = replace existing (default), false = add as new. */
  const [replaceExisting, setReplaceExisting] = useState<
    Record<string, boolean>
  >({});

  const analysis = useMemo(() => {
    if (!draft) return [] as ReturnType<typeof analyzeImportItems>;
    return analyzeImportItems(scenario, draft.items);
  }, [draft, scenario]);

  const analysisById = useMemo(() => {
    const map = new Map<string, (typeof analysis)[number]>();
    for (const row of analysis) map.set(row.itemId, row);
    return map;
  }, [analysis]);

  const resetModal = useCallback(() => {
    setDraft(null);
    setReplaceExisting({});
    setDragOver(false);
    setBusy(false);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    resetModal();
  }, [resetModal]);

  const openModal = useCallback(() => {
    setStatus(null);
    resetModal();
    setOpen(true);
  }, [resetModal]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.classList.add("is-modal-open");
    body.style.overflow = "hidden";
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => {
      body.classList.remove("is-modal-open");
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  useEffect(() => {
    if (!draft) return;
    const next: Record<string, boolean> = {};
    for (const row of analyzeImportItems(scenario, draft.items)) {
      if (row.matchIndex >= 0 || row.matchExistingId != null) {
        next[row.itemId] = true;
      }
    }
    setReplaceExisting(next);
  }, [draft, scenario]);

  const addImageDataUrl = useCallback(
    async (dataUrl: string, name: string, mediaType?: string) => {
      const parsed = dataUrlToBase64(dataUrl);
      setImages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          dataUrl,
          mediaType: mediaType ?? parsed.mediaType,
        },
      ]);
    },
    [],
  );

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setStatus(null);
      try {
        for (const file of list) {
          if (
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf")
          ) {
            setStatus("Rendering PDF pages…");
            const pages = await pdfFileToImages(file);
            if (!pages.length) {
              setStatus(
                `Could not render pages from ${file.name}. Try a screenshot instead.`,
              );
              continue;
            }
            for (const page of pages) {
              await addImageDataUrl(
                page.dataUrl,
                `${file.name} · p${page.page}`,
                page.mediaType,
              );
            }
            setStatus(
              `Added PDF ${file.name} · ${pages.length} page image${pages.length === 1 ? "" : "s"}`,
            );
          } else if (file.type.startsWith("image/")) {
            const dataUrl = await fileToDataUrl(file);
            await addImageDataUrl(dataUrl, file.name, file.type);
            setStatus(`Added ${file.name}`);
          } else {
            setStatus(`Skipped unsupported file: ${file.name}`);
          }
        }
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Failed to add file");
      }
    },
    [addImageDataUrl],
  );

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((i) => i.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      await ingestFiles([file]);
    }
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      await ingestFiles(e.dataTransfer.files);
    }
  };

  const runImport = async () => {
    if (!text.trim() && images.length === 0) {
      setStatus("Paste text, or add a screenshot / PDF first");
      return;
    }
    setBusy(true);
    setStatus("Extracting with AI…");
    try {
      const payload = {
        text: text.trim(),
        scenario,
        images: images.map((img) => {
          const { base64, mediaType } = dataUrlToBase64(img.dataUrl);
          return { base64, mediaType: img.mediaType || mediaType };
        }),
      };
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ImportExtraction & {
        error?: string;
      };
      if (!res.ok) {
        setStatus(data.error ?? "Import failed");
        return;
      }
      if (!data.items?.length) {
        setStatus(data.summary || "Nothing confident enough to import");
        return;
      }
      setDraft(data);
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const dismissItem = (itemId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((item) => item.id !== itemId);
      if (!items.length) return null;
      return { ...prev, items };
    });
    setReplaceExisting((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const confirmApply = (clearFirst: boolean) => {
    if (!draft) return;
    const items = draft.items;
    if (!items.length && !clearFirst) {
      setStatus("No items to import");
      setDraft(null);
      return;
    }
    const resolutions = resolutionsForConfirmItems(
      items,
      analysis,
      clearFirst ? {} : replaceExisting,
    );
    console.info("[import] apply", {
      clearFirst,
      itemCount: items.length,
      resolutions: items.map((item) => {
        const row = analysisById.get(item.id);
        return {
          id: item.id,
          kind: item.kind,
          label: item.label,
          valueLabel: item.valueLabel,
          matchExistingId: row?.matchExistingId ?? item.matchExistingId,
          resolution: resolutions[item.id],
        };
      }),
    });
    onApply(
      applyImportItems(scenario, items, {
        clearFirst,
        resolutions,
      }),
    );
    setText("");
    setImages([]);
    const n = items.length;
    const msg = clearFirst
      ? `Reset scenario, then imported ${n} field${n === 1 ? "" : "s"}`
      : `Imported ${n} field${n === 1 ? "" : "s"}`;
    closeModal();
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await ingestFiles(e.target.files);
    e.target.value = "";
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openModal)
      ) : (
        <button
          type="button"
          className="vbg-button"
          data-variant="secondary"
          title="Import balances and assumptions from notes, screenshots, or PDF"
          onClick={openModal}
        >
          Import
        </button>
      )}
      {status && !open ? (
        <span className="vbg-meta vbg-custom-import-toast">{status}</span>
      ) : null}

      {open ? (
        <div className="vbg-custom-import-dialog-root">
          <button
            type="button"
            className="vbg-custom-popover-scrim"
            aria-label="Dismiss import"
            onClick={closeModal}
          />
          <div
            className="vbg-custom-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            {!draft ? (
              <>
                <div className="vbg-custom-import-dialog-head">
                  <h2 id={titleId} className="vbg-heading-16">
                    Import
                  </h2>
                  <p className="vbg-meta">
                    Paste notes, drop a screenshot, or upload a PDF — then
                    extract.
                  </p>
                </div>

                <div
                  className={`vbg-custom-import-drop${dragOver ? " is-dragover" : ""}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDragOver(false);
                  }}
                  onDrop={(e) => void onDrop(e)}
                >
                  <textarea
                    className="vbg-custom-import-text"
                    rows={4}
                    placeholder="Paste plan notes, balances, or a screenshot (⌘V)"
                    value={text}
                    disabled={busy}
                    onChange={(e) => setText(e.target.value)}
                    onPaste={(e) => void onPaste(e)}
                  />
                  <div className="vbg-custom-import-drop-actions">
                    <button
                      type="button"
                      className="vbg-button"
                      data-variant="secondary"
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload image / PDF
                    </button>
                    <span className="vbg-meta">or drop files here</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(e) => void onFileChange(e)}
                  />
                  {images.length > 0 ? (
                    <ul className="vbg-custom-import-thumbs">
                      {images.map((img) => (
                        <li key={img.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.dataUrl} alt={img.name} />
                          <button
                            type="button"
                            className="vbg-button"
                            data-variant="ghost"
                            aria-label={`Remove ${img.name}`}
                            disabled={busy}
                            onClick={() =>
                              setImages((prev) =>
                                prev.filter((x) => x.id !== img.id),
                              )
                            }
                          >
                            ×
                          </button>
                          <span className="vbg-meta">{img.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {busy ? (
                    <div
                      className="vbg-custom-import-extracting"
                      role="status"
                      aria-live="polite"
                    >
                      <ThinkingOrb
                        state="working"
                        size={64}
                        theme="light"
                        aria-label="Extracting with AI"
                      />
                      <p className="vbg-helper vbg-custom-import-status">
                        {status ?? "Extracting with AI…"}
                      </p>
                    </div>
                  ) : status ? (
                    <p className="vbg-helper vbg-custom-import-status">{status}</p>
                  ) : null}
                </div>

                <div className="vbg-custom-popover-actions vbg-custom-import-actions">
                  <button
                    type="button"
                    className="vbg-button"
                    data-variant="ghost"
                    onClick={closeModal}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vbg-button vbg-custom-import-extract-btn"
                    data-variant="secondary"
                    disabled={busy || (!text.trim() && images.length === 0)}
                    onClick={() => void runImport()}
                    aria-busy={busy}
                  >
                    {busy ? (
                      <>
                        <ThinkingOrb
                          state="working"
                          size={20}
                          theme="light"
                          aria-hidden
                        />
                        Extracting…
                      </>
                    ) : (
                      "Extract"
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="vbg-custom-import-dialog-head">
                  <h2 id={titleId} className="vbg-heading-16">
                    Confirm import
                  </h2>
                  <p className="vbg-meta">{draft.summary}</p>
                </div>

                <ul className="vbg-custom-import-items">
                  {draft.items.map((item) => {
                    const row = analysisById.get(item.id);
                    const matched =
                      row != null &&
                      (row.matchIndex >= 0 || row.matchExistingId != null);
                    const sourceNote = shortImportClause(item.explanation);
                    return (
                      <li key={item.id}>
                        <div className="vbg-custom-import-item">
                          <span className="vbg-custom-import-item-body">
                            <span className="vbg-custom-import-item-row">
                              <span className="vbg-label">{item.label}</span>
                              <span className="vbg-custom-import-value">
                                {item.valueLabel}
                              </span>
                            </span>
                            {item.kind === "scalar" && row?.currentValueLabel ? (
                              <span className="vbg-meta">
                                Current {row.currentValueLabel}
                                {row.conflict ? " · differs" : " · same"}
                                {" · "}
                                Import {item.valueLabel}
                              </span>
                            ) : null}
                            {matched && row.existingLabel ? (
                              <span className="vbg-meta">
                                Matches existing: {row.existingLabel}
                                {row.existingValueLabel
                                  ? ` · ${row.existingValueLabel}`
                                  : ""}
                                {row.matchExplanation
                                  ? ` — ${row.matchExplanation}`
                                  : ""}
                              </span>
                            ) : null}
                            {sourceNote ? (
                              <span className="vbg-meta">{sourceNote}</span>
                            ) : null}
                            {matched && item.kind !== "scalar" ? (
                              <label className="vbg-custom-import-choice">
                                <input
                                  type="checkbox"
                                  checked={replaceExisting[item.id] !== false}
                                  onChange={(e) =>
                                    setReplaceExisting((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.checked,
                                    }))
                                  }
                                />
                                <span>Replace existing</span>
                              </label>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="vbg-button vbg-custom-import-dismiss"
                            data-variant="ghost"
                            aria-label={`Remove ${item.label}`}
                            onClick={() => dismissItem(item.id)}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="vbg-custom-popover-actions vbg-custom-import-actions">
                  <button
                    type="button"
                    className="vbg-button"
                    data-variant="ghost"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vbg-button"
                    data-variant="secondary"
                    onClick={() => confirmApply(true)}
                  >
                    Reset and Import
                  </button>
                  <button
                    type="button"
                    className="vbg-button"
                    data-variant="secondary"
                    onClick={() => confirmApply(false)}
                  >
                    Import
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
