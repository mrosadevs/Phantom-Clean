(function () {
  const GENERIC_ACH_DESCRIPTORS = new Set(["ach", "pmt", "achpmt"]);
  const ZELLE_REFERENCE_PREFIXES = ["Bac", "Wfct", "Cof", "Cti", "Mac", "Hna", "H50", "Bbt", "0Ou"];
  const BUILT_IN_NORMALIZATION = {
    "Motorcycle Spare Parts Max Import": "Motorcycle Spare Parts Max Import LLC",
    "Motorcycle Spare Parts Max Import L": "Motorcycle Spare Parts Max Import LLC",
    "CHARCO UTILITIES": "Charlotte County Utilities",
    "CHARLOTTE UTILTY": "Charlotte County Utilities",
    "LEE COUNTY": "LEE COUNTY TAX COLLECTOR",
    "ATT* BILL": "AT&T",
    "ATT* BILL PAYMENT": "AT&T",
    "APPLE.COM/BILL": "APPLE.COM",
    "AMAZON MKTPL": "Amazon",
    "yrr service": "YRR SERVICE LLC",
    "AIR-VAC CONNECTIO TAMPA": "AIR-VAC CONNECTION",
    "Hotel at Booking.": "Hotel",
    "NST THE HOME D": "THE HOME DEPOT",
    "FPL DIRECT DEBIT": "FPL DIRECT",
    "CULVERS PUNTA GOR PUNTA GORDA": "CULVERS",
    "TEDS MARATHON PORT CHARLOTTFL": "MARATHON",
    "MICCOSUKEE SER FORT LAUDERDAFL": "MICCOSUKEE",
    "MISSION BBQ CAPE CAPE CORAL": "MISSION BBQ",
    "SHELL SERVICE PUNTA GORDA": "SHELL SERVICE"
  };

  function normalizeSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLookupKey(value) {
    return normalizeSpaces(value).toLowerCase();
  }

  function iterateMappings(mappings, callback) {
    if (!mappings) {
      return;
    }

    if (Array.isArray(mappings)) {
      for (const entry of mappings) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        callback(entry.from, entry.to);
      }
      return;
    }

    for (const [from, to] of Object.entries(mappings)) {
      callback(from, to);
    }
  }

  function applyNameNormalization(name, customMappings) {
    let normalized = normalizeSpaces(name);
    if (!normalized) {
      return "";
    }

    if (Object.prototype.hasOwnProperty.call(BUILT_IN_NORMALIZATION, normalized)) {
      normalized = BUILT_IN_NORMALIZATION[normalized];
    }

    const targetKey = normalizeLookupKey(normalized);
    let mappedValue = "";

    iterateMappings(customMappings, (from, to) => {
      if (mappedValue) {
        return;
      }

      if (normalizeLookupKey(from) === targetKey) {
        mappedValue = normalizeSpaces(to);
      }
    });

    return mappedValue || normalized;
  }

  function wordCount(value) {
    return normalizeSpaces(value).split(/\s+/).filter(Boolean).length;
  }

  function cleanOutgoingWtWire(memo) {
    const match = memo.match(/\/Bnf=(.+?)\s+Srf#/i);
    if (!match) {
      return "";
    }

    let name = normalizeSpaces(match[1]);
    name = name.replace(/^G\s+/i, "");
    name = name.replace(/\s+CO$/i, "");
    name = name.replace(/\s+CA$/i, "");
    name = name.replace(/\s+Inc\.?$/i, "");
    return normalizeSpaces(name);
  }

  function cleanOutgoingZelleSimple(memo) {
    let name = normalizeSpaces(memo.replace(/^Zelle to\s+/i, ""));
    name = name.replace(/\s+on\s+\d{1,2}\/\d{1,2}\s+Ref\s*#.*$/i, "");
    name = name.replace(/\s+Ref\s*#.*$/i, "");
    return normalizeSpaces(name);
  }

  function cleanOutgoingZelleWithMemo(memo) {
    const match = memo.match(/^Zelle payment to\s+(.+?)\s+for\s+/i);
    if (match) {
      return normalizeSpaces(match[1]);
    }

    return normalizeSpaces(memo.replace(/^Zelle payment to\s+/i, ""));
  }

  function cleanIncomingZelle(memo) {
    let name = normalizeSpaces(memo.replace(/^Zelle Payment From\s+/i, ""));
    const referencePattern = new RegExp(
      `\\s+(?:(?:${ZELLE_REFERENCE_PREFIXES.join("|")})\\S*|\\d{8,})$`,
      "i"
    );

    let previous = "";
    while (name !== previous) {
      previous = name;
      name = name.replace(referencePattern, "").trim();
    }

    name = name.replace(/\s+CA$/i, "").trim();
    return normalizeSpaces(name);
  }

  function cleanInternalTransferToNamedAccount(memo) {
    let name = normalizeSpaces(memo.replace(/^Online Transfer to\s+/, ""));
    name = name.replace(/\s+(?:Everyday Checking|Business Checking|Savings|Personal Checking)\b.*$/i, "");
    name = name.replace(/\s+xxxxxx.*$/i, "");
    name = name.replace(/\s+Ref\s*#.*$/i, "");
    name = normalizeSpaces(name);
    return name ? `Transfer to ${name}` : "Transfer to";
  }

  function cleanMobileTransferToChk(memo) {
    const match = memo.match(/^Mobile transfer to CHK\s*(\d+)/i);
    return match ? `transfer to CHK ${match[1]}` : "transfer to CHK";
  }

  function cleanOnlineBankingPaymentToCreditCard(memo) {
    const match = memo.match(/^Online Banking payment to CRD\s*(\d+)/i);
    return match ? `Online Banking payment to CRD ${match[1]}` : "Online Banking payment to CRD";
  }

  function cleanFedwireCredit(memo) {
    const boMatch = memo.match(/B\/O:\s*\d+\/(.+?)\s*\d\/US\//i);
    const boSender = boMatch ? normalizeSpaces(boMatch[1]) : "";
    if (boSender && wordCount(boSender) > 3) {
      return boSender;
    }

    const beneficiaryMatch = memo.match(/Bnf=([^/]+)/i);
    if (beneficiaryMatch) {
      let beneficiary = normalizeSpaces(beneficiaryMatch[1]);
      beneficiary = beneficiary.replace(/\s+Miramar\s+FL.*$/i, "");
      beneficiary = normalizeSpaces(beneficiary);
      if (beneficiary) {
        return beneficiary;
      }
    }

    return "Fedwire Credit";
  }

  function cleanBookTransferCredit(memo) {
    const orgMatch = memo.match(/Org:\/\d+\s+(.+?)\s+Ref:/i);
    if (orgMatch) {
      return normalizeSpaces(orgMatch[1]);
    }

    const cityMatch = memo.match(/B\/O:\s*(.+?)(?:\s+(?:Ocala|Columbus|Miramar)\s)/i);
    if (cityMatch) {
      return normalizeSpaces(cityMatch[1]);
    }

    const zipMatch = memo.match(/B\/O:\s*(.+?)(?:\s+\w+\s+\w{2}\s+\d{5})/i);
    if (zipMatch) {
      return normalizeSpaces(zipMatch[1]);
    }

    return "Book Transfer Credit";
  }

  function cleanFeeLine(memo) {
    if (memo === "Domestic Incoming Wire Fee") {
      return "Domestic Wire Fee";
    }
    if (memo === "Online Fx International Wire Fee") {
      return "Online Fx International Wire Fee";
    }
    if (memo === "Online US Dollar Intl Wire Fee") {
      return "Intl Wire Fee";
    }
    if (memo.startsWith("Wire Trans Svc Charge")) {
      return "Wire Trans Svc Charge";
    }
    if (memo === "Wire Transfer Fee") {
      return "Wire Transfer Fee";
    }
    if (memo.startsWith("OVERDRAFT ITEM FEE")) {
      return "Overdraft Fee";
    }
    if (memo.includes("FINANCE CHARGE")) {
      return "FINANCE CHARGE";
    }
    if (memo.startsWith("Monthly Fee Business")) {
      return "Monthly Fee Business";
    }
    if (memo === "RETURN ITEM CHARGEBACK") {
      return "RETURN ITEM CHARGEBACK";
    }
    if (memo.startsWith("LATE PAYMENT FEE")) {
      return memo;
    }
    return "";
  }

  function cleanOnlineInternationalWireTransfer(memo) {
    const beneficiaryMatch = memo.match(/Ben:\/\d+\s+(.+?)\s+Ref:/i);
    if (beneficiaryMatch) {
      return normalizeSpaces(beneficiaryMatch[1]);
    }

    const accountMatch = memo.match(/A\/C:\s*(.+?)\s+Medellin/i);
    if (accountMatch) {
      return normalizeSpaces(accountMatch[1]);
    }

    return "Online International Wire Transfer";
  }

  function cleanAchOrigCoName(memo) {
    const descriptorMatch = memo.match(/CO Entry Descr:\s*([A-Za-z0-9]+)/i);
    if (descriptorMatch) {
      const descriptor = normalizeSpaces(descriptorMatch[1]);
      if (!GENERIC_ACH_DESCRIPTORS.has(descriptor.toLowerCase())) {
        return descriptor;
      }
    }

    const coNameMatch = memo.match(/Orig CO Name:(.+?)\s+Orig\s+ID:/i);
    if (coNameMatch) {
      return normalizeSpaces(coNameMatch[1]);
    }

    return memo;
  }

  function cleanDesFormattedPayment(memo) {
    if (memo.startsWith("ClickPay")) {
      const clickPayMatch = memo.match(/DES:\s*([^\s]+)/i);
      return clickPayMatch ? normalizeSpaces(clickPayMatch[1]) : memo;
    }

    const beforeDes = memo.split(/\sDES:/i)[0] || memo;
    let cleaned = normalizeSpaces(beforeDes);
    cleaned = cleaned.replace(/\s+(?:DEBIT|DIRECT)$/i, "");
    return normalizeSpaces(cleaned);
  }

  function cleanAuthorizedCardPurchase(memo) {
    let merchant = memo.replace(
      /^(Purchase authorized on|Recurring Payment authorized on|Purchase Intl authorized on)\s+/i,
      ""
    );
    merchant = merchant.replace(/^\d{1,2}\/\d{1,2}\s+/, "");
    merchant = merchant.replace(/\s+S\d{10,}\s+Card\s+\S+.*$/i, "");
    merchant = normalizeSpaces(merchant);

    merchant = merchant.replace(/\s+[A-Za-z]{3}$/, "");
    merchant = merchant.replace(/\s+[A-Z]{2}$/, "");
    merchant = merchant.replace(/\s+[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/, "");
    merchant = merchant.replace(/\s+https?:\/\/\S+$/i, "");
    merchant = merchant.replace(/\s+T\d+$/i, "");
    if (wordCount(merchant) > 1) {
      merchant = merchant.replace(/\s+[A-Z][a-z]+$/, "");
    }

    return normalizeSpaces(merchant);
  }

  function cleanPurchaseLegacy(memo) {
    let merchant = memo.replace(/^PURCHASE\s+\d{4}\s+/i, "");
    merchant = merchant.replace(/\s+\d{10,}.*$/, "");
    merchant = merchant.replace(/\s+[A-Z]{2}$/, "");
    merchant = merchant.replace(/\s+\*[A-Za-z0-9]+$/, "");
    return normalizeSpaces(merchant);
  }

  function cleanCheckcardLegacy(memo) {
    let merchant = memo.replace(/^CHECKCARD\s+\d{4}\s+/i, "");
    merchant = merchant.replace(/\s+\d{15,}.*$/, "");
    merchant = merchant.replace(/\s+RECURRING\b.*$/i, "");
    merchant = merchant.replace(/\s+CKCD\b.*$/i, "");
    merchant = merchant.replace(/\s+\d{10}\b.*$/, "");
    merchant = merchant.replace(/\s+[A-Z]{2}$/, "");
    merchant = merchant.replace(/\/[A-Za-z0-9._-]+$/, "");
    return normalizeSpaces(merchant);
  }

  function cleanBusinessToBusinessAchDebit(memo) {
    const match = memo.match(/-\s*(.+?)(?:\s+ACH\b|\s+Retry\b|\s+\d)/i);
    if (match) {
      return `${normalizeSpaces(match[1])} ACH`;
    }

    const fallbackMatch = memo.match(/-\s*(.+)$/);
    if (fallbackMatch) {
      return `${normalizeSpaces(fallbackMatch[1])} ACH`;
    }

    return "";
  }

  function cleanMemo(memo, customMappings) {
    const rawMemo = normalizeSpaces(memo);
    let cleaned = rawMemo;

    if (/^WT\s+\d+/i.test(rawMemo)) {
      cleaned = cleanOutgoingWtWire(rawMemo) || rawMemo;
    } else if (/^Zelle to\s+/i.test(rawMemo)) {
      cleaned = cleanOutgoingZelleSimple(rawMemo) || rawMemo;
    } else if (/^Zelle payment to\s+/i.test(rawMemo)) {
      cleaned = cleanOutgoingZelleWithMemo(rawMemo) || rawMemo;
    } else if (/^Zelle Payment From\s+/i.test(rawMemo)) {
      cleaned = cleanIncomingZelle(rawMemo) || rawMemo;
    } else if (/^Online Transfer to\s+/.test(rawMemo)) {
      cleaned = cleanInternalTransferToNamedAccount(rawMemo) || rawMemo;
    } else if (rawMemo.startsWith("Online Transfer To Chk")) {
      cleaned = "Transfer To Chk 7590";
    } else if (/^Mobile transfer to CHK/i.test(rawMemo)) {
      cleaned = cleanMobileTransferToChk(rawMemo) || rawMemo;
    } else if (/^Online Banking payment to CRD/i.test(rawMemo)) {
      cleaned = cleanOnlineBankingPaymentToCreditCard(rawMemo) || rawMemo;
    } else if (rawMemo.startsWith("Fedwire Credit")) {
      cleaned = cleanFedwireCredit(rawMemo) || rawMemo;
    } else if (rawMemo.startsWith("Book Transfer Credit")) {
      cleaned = cleanBookTransferCredit(rawMemo) || rawMemo;
    } else {
      const feeLine = cleanFeeLine(rawMemo);
      if (feeLine) {
        cleaned = feeLine;
      } else if (rawMemo.startsWith("Online International Wire Transfer")) {
        cleaned = cleanOnlineInternationalWireTransfer(rawMemo) || rawMemo;
      } else if (rawMemo.startsWith("Orig CO Name:")) {
        cleaned = cleanAchOrigCoName(rawMemo) || rawMemo;
      } else if (rawMemo.includes(" DES:")) {
        cleaned = cleanDesFormattedPayment(rawMemo) || rawMemo;
      } else if (/^(Purchase authorized on|Recurring Payment authorized on|Purchase Intl authorized on)\s+/i.test(rawMemo)) {
        cleaned = cleanAuthorizedCardPurchase(rawMemo) || rawMemo;
      } else if (rawMemo.startsWith("PURCHASE ")) {
        cleaned = cleanPurchaseLegacy(rawMemo) || rawMemo;
      } else if (rawMemo.startsWith("CHECKCARD ")) {
        cleaned = cleanCheckcardLegacy(rawMemo) || rawMemo;
      } else if (rawMemo.includes("Business to Business ACH Debit")) {
        cleaned = cleanBusinessToBusinessAchDebit(rawMemo) || rawMemo;
      } else if (rawMemo.startsWith("SERVICE CHARGE ACCT")) {
        cleaned = rawMemo;
      } else {
        cleaned = rawMemo;
      }
    }

    return applyNameNormalization(cleaned, customMappings);
  }

  function parseAmount(value) {
    if (value === null || value === undefined) {
      return null;
    }

    let raw = String(value).trim();
    if (!raw) {
      return null;
    }

    let isNegative = false;
    const parenMatch = raw.match(/^\((.+)\)$/);
    if (parenMatch) {
      isNegative = true;
      raw = parenMatch[1];
    }

    raw = raw.replace(/[$,]/g, "");
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount)) {
      return null;
    }

    return isNegative ? -amount : amount;
  }

  function formatAmount(value, rawFallback) {
    if (Number.isFinite(value)) {
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
    return normalizeSpaces(rawFallback);
  }

  function extractTransactionColumns(rawRow) {
    const byNormalizedHeader = {};
    for (const [rawKey, rawValue] of Object.entries(rawRow || {})) {
      const normalizedKey = normalizeLookupKey(String(rawKey || "").replace(/^\uFEFF/, ""));
      byNormalizedHeader[normalizedKey] = rawValue;
    }

    const date = byNormalizedHeader.date ?? "";
    const amountRaw = byNormalizedHeader.amount ?? "";
    const memo = byNormalizedHeader.memo ?? "";

    return {
      date: normalizeSpaces(date),
      amountRaw: String(amountRaw ?? "").trim(),
      memo: normalizeSpaces(memo)
    };
  }

  window.TransactionCleaner = {
    BUILT_IN_NORMALIZATION,
    cleanMemo,
    extractTransactionColumns,
    formatAmount,
    normalizeSpaces,
    parseAmount
  };
})();
