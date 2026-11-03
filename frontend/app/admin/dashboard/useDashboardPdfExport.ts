"use client";

/**
 * Export PDF du tableau de bord.
 *
 * html2canvas ne sait pas rasteriser un texte en degrade : le titre est
 * temporairement repeint en aplat et les boutons masques pendant la capture.
 */
import { useRef, useState } from "react";

export function useDashboardPdfExport() {
  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // PDF export
  const exportPdf = async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");

      // Fix gradient text issue in html2canvas and hide buttons
      const titleEl = document.getElementById("dashboard-admin-title");
      const buttonsEl = document.getElementById("dashboard-admin-buttons");
      const gradClasses = [
        "bg-gradient-to-r",
        "from-white",
        "via-blue-200",
        "to-indigo-300",
        "bg-clip-text",
        "text-transparent",
      ];

      if (titleEl) {
        titleEl.classList.remove(...gradClasses);
        titleEl.classList.add("text-indigo-300");
      }
      if (buttonsEl) buttonsEl.style.display = "none";

      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#020817",
        useCORS: true,
        windowWidth: 1440,
      });

      if (titleEl) {
        titleEl.classList.add(...gradClasses);
        titleEl.classList.remove("text-indigo-300");
      }
      if (buttonsEl) buttonsEl.style.display = "flex";

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(
        `novlearn-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (e) {
      console.error("PDF export failed", e);
    } finally {
      setExporting(false);
    }
  };

  return { printRef, exporting, exportPdf };
}
