(function () {
  const STORAGE_KEY = "transaction-cleaner-custom-mappings-v1";
  const cleaner = window.TransactionCleaner;

  const state = {
    rows: [],
    mappings: loadMappings(),
    rowIdCounter: 0
  };

  const dropZone = document.getElementById("drop-zone");
  const browseButton = document.getElementById("browse-button");
  const fileInput = document.getElementById("file-input");
  const statusText = document.getElementById("status-text");
  const previewBody = document.getElementById("preview-body");
  const downloadButton = document.getElementById("download-button");
  const clearButton = document.getElementById("clear-button");
  const mappingForm = document.getElementById("mapping-form");
  const mappingFromInput = document.getElementById("mapping-from");
  const mappingToInput = document.getElementById("mapping-to");
  const mappingBody = document.getElementById("mapping-body");
  const mappingEmpty = document.getElementById("mapping-empty");

  if (!cleaner) {
    setStatus("Cleaning engine did not load.", true);
    return;
  }

  bindEvents();
  renderMappings();
  renderPreview();

  function bindEvents() {
    browseButton.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("click", (event) => {
      if (event.target.tagName !== "BUTTON") {
        fileInput.click();
      }
    });

    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", async (event) => {
      await handleFiles(event.target.files);
      event.target.value = "";
    });

    for (const eventName of ["dragenter", "dragover"]) {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("drag-active");
      });
    }

    for (const eventName of ["dragleave", "drop"]) {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("drag-active");
      });
    }

    dropZone.addEventListener("drop", async (event) => {
      await handleFiles(event.dataTransfer.files);
    });

    clearButton.addEventListener("click", () => {
      state.rows = [];
      renderPreview();
      setStatus("Cleared all rows.");
    });

    downloadButton.addEventListener("click", async () => {
      await downloadExcel();
    });

    mappingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      upsertMapping();
    });

    mappingBody.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".delete-mapping");
      if (!removeButton) {
        return;
      }

      const mappingIndex = Number(removeButton.dataset.index);
      if (!Number.isInteger(mappingIndex) || mappingIndex < 0 || mappingIndex >= state.mappings.length) {
        return;
      }

      state.mappings.splice(mappingIndex, 1);
      persistMappings();
      recalculateRows();
      renderMappings();
      renderPreview();
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".csv"));
    if (!files.length) {
      setStatus("Please upload one or more CSV files.", true);
      return;
    }

    if (!window.Papa) {
      setStatus("CSV parser did not load. Check your connection and refresh.", true);
      return;
    }

    let importedRows = 0;
    const warnings = [];
    setStatus(`Reading ${files.length} file(s)...`);

    for (const file of files) {
      try {
        const parsed = await parseCsv(file);
        const headers = parsed.meta?.fields || [];
        if (!hasRequiredHeaders(headers)) {
          warnings.push(`${file.name}: missing required headers (Date, amount, memo).`);
          continue;
        }

        const mappedRows = mapCsvRows(parsed.data);
        if (mappedRows.length === 0) {
          warnings.push(`${file.name}: no usable rows found.`);
          continue;
        }

        state.rows.push(...mappedRows);
        importedRows += mappedRows.length;
      } catch (error) {
        warnings.push(`${file.name}: ${error.message || "failed to parse CSV"}`);
      }
    }

    if (importedRows > 0) {
      recalculateRows();
      renderPreview();
    }

    const successMessage = importedRows
      ? `Loaded ${importedRows} row(s) from ${files.length} file(s).`
      : "No rows were imported.";
    const warningMessage = warnings.length ? ` ${warnings.join(" ")}` : "";
    setStatus(`${successMessage}${warningMessage}`, warnings.length > 0 && importedRows === 0);
  }

  function parseCsv(file) {
    return new Promise((resolve, reject) => {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors?.length) {
            const fatalError = results.errors.find((err) => err.code !== "TooFewFields");
            if (fatalError) {
              reject(new Error(fatalError.message));
              return;
            }
          }
          resolve(results);
        },
        error: (error) => reject(error)
      });
    });
  }

  function hasRequiredHeaders(fields) {
    const normalizedHeaders = new Set(
      (fields || []).map((header) =>
        cleaner.normalizeSpaces(String(header || "").replace(/^\uFEFF/, "")).toLowerCase()
      )
    );

    return normalizedHeaders.has("date")
      && normalizedHeaders.has("amount")
      && normalizedHeaders.has("memo");
  }

  function mapCsvRows(csvRows) {
    const rows = [];
    for (const rawRow of csvRows || []) {
      const extracted = cleaner.extractTransactionColumns(rawRow);
      if (!extracted.date && !extracted.amountRaw && !extracted.memo) {
        continue;
      }

      rows.push({
        id: ++state.rowIdCounter,
        date: extracted.date,
        memo: extracted.memo,
        amountRaw: extracted.amountRaw,
        amountNumber: cleaner.parseAmount(extracted.amountRaw),
        autoClean: "",
        manualClean: "",
        hasManualOverride: false
      });
    }

    return rows;
  }

  function recalculateRows() {
    for (const row of state.rows) {
      row.autoClean = cleaner.cleanMemo(row.memo, state.mappings);
      if (!row.hasManualOverride) {
        row.manualClean = "";
      }
    }
  }

  function renderPreview() {
    previewBody.textContent = "";

    if (!state.rows.length) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 4;
      emptyCell.className = "empty-preview";
      emptyCell.textContent = "No transactions loaded yet.";
      emptyRow.appendChild(emptyCell);
      previewBody.appendChild(emptyRow);
      downloadButton.disabled = true;
      return;
    }

    for (const row of state.rows) {
      const tr = document.createElement("tr");

      const dateCell = document.createElement("td");
      dateCell.textContent = row.date;

      const cleanCell = document.createElement("td");
      const cleanInput = document.createElement("input");
      cleanInput.type = "text";
      cleanInput.className = "clean-input";
      cleanInput.value = getFinalCleanValue(row);
      cleanInput.addEventListener("input", (event) => {
        const nextValue = cleaner.normalizeSpaces(event.target.value);
        if (nextValue === row.autoClean) {
          row.hasManualOverride = false;
          row.manualClean = "";
          return;
        }

        row.hasManualOverride = true;
        row.manualClean = nextValue;
      });
      cleanCell.appendChild(cleanInput);

      const amountCell = document.createElement("td");
      amountCell.textContent = cleaner.formatAmount(row.amountNumber, row.amountRaw);

      const originalCell = document.createElement("td");
      originalCell.textContent = row.memo;

      tr.appendChild(dateCell);
      tr.appendChild(cleanCell);
      tr.appendChild(amountCell);
      tr.appendChild(originalCell);
      previewBody.appendChild(tr);
    }

    downloadButton.disabled = false;
  }

  function getFinalCleanValue(row) {
    return row.hasManualOverride ? cleaner.normalizeSpaces(row.manualClean) : row.autoClean;
  }

  async function downloadExcel() {
    if (!state.rows.length) {
      setStatus("No rows to export.", true);
      return;
    }
    if (!window.ExcelJS) {
      setStatus("Excel exporter did not load. Check your connection and refresh.", true);
      return;
    }

    const workbook = new window.ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Transactions", {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    worksheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "clean transactions", key: "clean", width: 45 },
      { header: "amount", key: "amount", width: 14 },
      { header: "orginal transactons", key: "original", width: 90 }
    ];

    for (const row of state.rows) {
      worksheet.addRow({
        date: row.date,
        clean: getFinalCleanValue(row),
        amount: Number.isFinite(row.amountNumber) ? row.amountNumber : row.amountRaw,
        original: row.memo
      });
    }

    worksheet.getColumn(3).numFmt = "#,##0.00";
    worksheet.autoFilter = { from: "A1", to: "D1" };

    worksheet.eachRow((excelRow, rowNumber) => {
      excelRow.font = {
        name: "Arial",
        size: 10,
        bold: rowNumber === 1
      };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob(
      [buffer],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = createFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus(`Exported ${state.rows.length} row(s) to Excel.`);
  }

  function createFilename() {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    return `cleaned-transactions-${stamp}.xlsx`;
  }

  function loadMappings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry) => ({
          from: cleaner.normalizeSpaces(entry.from),
          to: cleaner.normalizeSpaces(entry.to)
        }))
        .filter((entry) => entry.from && entry.to);
    } catch (_error) {
      return [];
    }
  }

  function persistMappings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mappings));
  }

  function upsertMapping() {
    const from = cleaner.normalizeSpaces(mappingFromInput.value);
    const to = cleaner.normalizeSpaces(mappingToInput.value);

    if (!from || !to) {
      return;
    }

    const key = from.toLowerCase();
    const existingIndex = state.mappings.findIndex((entry) => entry.from.toLowerCase() === key);
    if (existingIndex >= 0) {
      state.mappings[existingIndex] = { from, to };
    } else {
      state.mappings.push({ from, to });
    }

    persistMappings();
    recalculateRows();
    renderMappings();
    renderPreview();
    mappingForm.reset();
    setStatus(`Saved mapping: "${from}" -> "${to}".`);
  }

  function renderMappings() {
    mappingBody.textContent = "";
    if (!state.mappings.length) {
      mappingEmpty.hidden = false;
      return;
    }

    mappingEmpty.hidden = true;
    state.mappings.forEach((entry, index) => {
      const tr = document.createElement("tr");

      const fromCell = document.createElement("td");
      fromCell.textContent = entry.from;

      const toCell = document.createElement("td");
      toCell.textContent = entry.to;

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-mapping";
      deleteButton.dataset.index = String(index);
      deleteButton.textContent = "Remove";
      actionCell.appendChild(deleteButton);

      tr.appendChild(fromCell);
      tr.appendChild(toCell);
      tr.appendChild(actionCell);
      mappingBody.appendChild(tr);
    });
  }

  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.classList.toggle("error", Boolean(isError));
  }
})();
